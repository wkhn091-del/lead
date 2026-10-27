import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Response } from 'express';
import { HttpError } from '../lib/http-error.js';

export interface StoredFile {
  mimeType: string;
  fileName: string;
}

/** Where recordings live. Routes only use this interface, so storage can change without touching them. */
export interface MediaStorage {
  readonly kind: 'local' | 's3';
  /** Hosts the browser plays files from, besides this server (for the Content Security Policy's media-src) */
  readonly origins: string[];
  /** Moves an uploaded temp file into storage under `key` */
  save(key: string, tempPath: string, mimeType: string): Promise<void>;
  /** Plays the file: streamed with range support (local), or a redirect to a 15-minute link (S3) */
  send(key: string, file: StoredFile, res: Response): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Runs `use` with a path to the file on this machine (downloaded to a temp file first, for S3) */
  withLocalFile<T>(key: string, use: (path: string) => Promise<T>): Promise<T>;
}

/** Inline playback only, never rendered as a page, whatever the file holds. */
function playbackHeaders(file: StoredFile) {
  return {
    'Content-Type': file.mimeType,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}

const isMissing = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT';

/** A folder on this server's disk. Fine on your own machine or with a persistent disk; not on hosts that wipe it. */
export function createLocalStorage(directory: string): MediaStorage {
  const root = resolve(directory);
  const pathFor = (key: string) => {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid storage key.');
    return path;
  };

  return {
    kind: 'local',
    origins: [],
    async save(key, tempPath) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      try {
        await rename(tempPath, target);
      } catch {
        // A different disk (temp on tmpfs): copy, then remove the temp file.
        await copyFile(tempPath, target);
        await unlink(tempPath);
      }
    },
    async send(key, file, res) {
      await new Promise<void>((done, fail) => {
        // sendFile answers Range requests, so audio and video can seek. The API's no-store header stays.
        res.sendFile(pathFor(key), { headers: playbackHeaders(file), cacheControl: false, dotfiles: 'allow' }, (error) => {
          if (!error || res.headersSent) return done(); // a listener that stopped midway is not an error
          fail(isMissing(error) ? new HttpError(404, 'קובץ ההקלטה חסר באחסון של השרת.') : error);
        });
      });
    },
    async remove(keys) {
      await Promise.all(keys.map((key) => rm(pathFor(key), { force: true })));
    },
    withLocalFile(key, use) {
      return use(pathFor(key));
    },
  };
}

export interface S3Options {
  bucket: string;
  region: string;
  /** For S3-compatible services such as Cloudflare R2, Backblaze B2 or MinIO */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/** An S3 bucket (or any S3-compatible service). The bucket stays private; playback uses short-lived signed links. */
export function createS3Storage(options: S3Options): MediaStorage {
  const client = new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials:
      options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined,
  });
  // Signed links point at the bucket's own host (or the service's host, with path-style addresses).
  const origins = options.endpoint
    ? [new URL(options.endpoint).origin, `${new URL(options.endpoint).protocol}//*.${new URL(options.endpoint).host}`]
    : [`https://${options.bucket}.s3.${options.region}.amazonaws.com`, `https://s3.${options.region}.amazonaws.com`];

  return {
    kind: 's3',
    origins,
    async save(key, tempPath, mimeType) {
      try {
        // Multipart upload streamed from disk, so large Zoom recordings never sit in memory.
        await new Upload({
          client,
          params: { Bucket: options.bucket, Key: key, Body: createReadStream(tempPath), ContentType: mimeType },
        }).done();
      } finally {
        await rm(tempPath, { force: true });
      }
    },
    async send(key, file, res) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: key,
          ResponseContentType: file.mimeType,
          ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        }),
        { expiresIn: 15 * 60 },
      );
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, url);
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        if (batch.length === 0) continue;
        await client.send(
          new DeleteObjectsCommand({ Bucket: options.bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }),
        );
      }
    },
    async withLocalFile(key, use) {
      const directory = await mkdtemp(join(tmpdir(), 'omek-media-'));
      const path = join(directory, basename(key));
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
        if (!object.Body) throw new Error(`S3 returned no body for ${key}`);
        // Streamed to disk, so a long Zoom video never sits in memory.
        await pipeline(object.Body as Readable, createWriteStream(path));
        return await use(path);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export const mediaKey = (leadId: string, mediaId: string, extension: string) => join('leads', leadId, `${mediaId}${extension}`);
