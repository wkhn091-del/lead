import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import { Router, type RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.js';
import { LeadParams, MediaFields, MediaParams } from '../leads/leads.schemas.js';
import { ConflictError, type MediaRecord, type Stores } from '../stores/types.js';
import type { TranscriptionQueue } from '../transcription/queue.js';
import { mediaKey, type MediaStorage } from './storage.js';
import { cleanFileName, createUploader, mediaTypeOf, uploadErrorMessage } from './upload.js';

/**
 * A recording as the API returns it. Where the file is stored stays on the server, and the transcript
 * text itself is in its timeline entry, so only the job's progress is sent.
 */
export function publicMedia({ storageKey: _key, transcription, ...record }: MediaRecord) {
  return {
    ...record,
    transcription: transcription && {
      status: transcription.status,
      partsDone: transcription.partsDone,
      partsTotal: transcription.partsTotal,
      error: transcription.error,
      words: transcription.words,
      updatedAt: transcription.updatedAt,
    },
  };
}

/**
 * Upload: POST /api/leads/:id/media (multipart, field "file", optional "interactionId"); the recording
 * is then transcribed in the background when transcription is on. Status: GET /api/leads/:id/media.
 * Playback: GET /api/media/:mediaId/file. Transcribe again: POST /api/media/:mediaId/transcribe.
 * Delete: DELETE /api/media/:mediaId. All behind requireAuth.
 */
export function createMediaRouters(stores: Stores, storage: MediaStorage, maxUploadMb: number, transcription: TranscriptionQueue | null) {
  const upload = createUploader(maxUploadMb * 1024 * 1024).single('file');

  // Check the lead before accepting a large file for it.
  const requireLead: RequestHandler = async (req, _res, next) => {
    const { id } = LeadParams.parse(req.params);
    if (!(await stores.leads.get(id))) throw new HttpError(404, 'הליד הזה כבר לא קיים.');
    next();
  };
  const receiveFile: RequestHandler = (req, res, next) => {
    upload(req, res, (error: unknown) => (error ? next(uploadErrorMessage(error, maxUploadMb) ?? error) : next()));
  };

  const leadMedia = Router();
  leadMedia.post('/:id/media', requireLead, receiveFile, async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'בחרו הקלטה להעלאה, בשדה בשם "file".');
    try {
      const { id } = LeadParams.parse(req.params);
      const { interactionId } = MediaFields.parse(req.body ?? {});
      if (interactionId && !(await stores.interactions.get(id, interactionId))) {
        throw new HttpError(404, 'הרשומה הזו כבר לא קיימת בציר הזמן.');
      }
      const type = mediaTypeOf(file.mimetype, file.originalname);
      if (!type) throw new HttpError(415, 'אפשר להעלות רק הקלטת אודיו או וידאו.');

      const mediaId = randomUUID();
      const extension = extname(file.filename);
      const storageKey = mediaKey(id, mediaId, extension);
      await storage.save(storageKey, file.path, type.mimeType);
      let record: MediaRecord;
      try {
        record = await stores.media.create({
          id: mediaId,
          leadId: id,
          interactionId: interactionId ?? null,
          kind: type.kind,
          fileName: cleanFileName(file.originalname, `recording${extension}`),
          mimeType: type.mimeType,
          size: file.size,
          storageKey,
          transcription: null,
        });
      } catch (error) {
        await storage.remove([storageKey]).catch(() => {});
        throw error;
      }
      // Transcription runs in the background; the answer already says it is queued.
      const queued = transcription
        ? await transcription.enqueue(record.id).catch((error: unknown) => {
            console.error(`Couldn't queue the transcript of ${record.id}:`, error);
            return null;
          })
        : null;
      res.status(201).json(publicMedia(queued ?? record));
    } finally {
      // Already moved into storage, unless something failed on the way.
      await rm(file.path, { force: true });
    }
  });

  /** The lead's recordings with their transcript progress: what the app polls while a transcript is on its way. */
  leadMedia.get('/:id/media', requireLead, async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    res.json((await stores.media.list(id)).map(publicMedia));
  });

  const media = Router();
  media.get('/:mediaId/file', async (req, res) => {
    const { mediaId } = MediaParams.parse(req.params);
    const record = await stores.media.get(mediaId);
    if (!record) throw new HttpError(404, 'ההקלטה הזו כבר לא קיימת.');
    await storage.send(record.storageKey, record, res);
  });

  /** Transcribes a recording again from scratch: after a failure, or one uploaded before transcription was on. */
  media.post('/:mediaId/transcribe', async (req, res) => {
    if (!transcription) {
      throw new HttpError(503, 'התמלול כבוי. הגדירו TRANSCRIBE_API_KEY בשרת (וודאו ש-ffmpeg מותקן).');
    }
    const { mediaId } = MediaParams.parse(req.params);
    const record = await stores.media.get(mediaId);
    if (!record) throw new HttpError(404, 'ההקלטה הזו כבר לא קיימת.');
    const status = record.transcription?.status;
    if (status === 'queued' || status === 'running') throw new ConflictError('ההקלטה הזו כבר בתמלול.');
    const queued = await transcription.enqueue(mediaId);
    if (!queued) throw new HttpError(404, 'ההקלטה הזו כבר לא קיימת.');
    res.status(202).json(publicMedia(queued));
  });

  // Idempotent: deleting a recording that is already gone still succeeds.
  media.delete('/:mediaId', async (req, res) => {
    const { mediaId } = MediaParams.parse(req.params);
    transcription?.cancel(mediaId);
    const record = await stores.media.get(mediaId);
    if (record) {
      await stores.media.remove(mediaId);
      await storage.remove([record.storageKey]);
    }
    res.status(204).end();
  });

  return { leadMedia, media };
}
