import http from 'node:http';
import net, { isIP, type AddressInfo } from 'node:net';
import { guardedLookup, isPublicAddress } from './net.js';

/**
 * A forward proxy on 127.0.0.1 that the headless browser is started with, so every connection a page makes
 * (its images, scripts, redirects, fetches) goes through guardedLookup: a site can't use the browser to reach
 * this server, its network or a cloud metadata address. Plain HTTP requests other than GET and HEAD are
 * refused, and HTTPS tunnels only open to port 443.
 */
export interface FilteringProxy {
  readonly port: number;
  close(): Promise<void>;
}

function hostAndPort(authority: string): { host: string; port: number } | null {
  const match = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(authority);
  if (!match) return null;
  const port = Number(match[2]);
  return port > 0 && port < 65_536 ? { host: match[1], port } : null;
}

export async function startFilteringProxy(allowPrivateNetwork: boolean): Promise<FilteringProxy> {
  const lookup = guardedLookup(allowPrivateNetwork);
  const refusedAddress = (host: string) => !allowPrivateNetwork && isIP(host) !== 0 && !isPublicAddress(host);

  const server = http.createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    if (target.protocol !== 'http:' || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(405).end();
      return;
    }
    if (refusedAddress(host) || (!allowPrivateNetwork && target.port && target.port !== '80')) {
      res.writeHead(403).end();
      return;
    }
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = http.request(
      { hostname: host, port: target.port || 80, path: `${target.pathname}${target.search}`, method: req.method, headers, lookup, timeout: 15_000 },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // HTTPS: the browser asks for a tunnel to host:443 and speaks TLS through it.
  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    const target = hostAndPort(req.url ?? '');
    if (!target || refusedAddress(target.host) || (!allowPrivateNetwork && target.port !== 443)) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: target.host, port: target.port, lookup }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
