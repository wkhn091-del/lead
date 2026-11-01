import type { AddressInfo } from 'node:net';
import makeWASocket, {
  binaryNodeToString,
  decodeBinaryNode,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  type BinaryNode,
  type WASocket,
} from 'baileys';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  classifyFrame,
  createReadOnlyGuard,
  isOwnPhoneRequest,
  OWN_PHONE_REQUESTS,
  PEER_DATA_OPERATION_REQUEST_MESSAGE,
  ReadOnlyViolation,
  SOCKET_METHODS_ALLOWED,
  type GuardEvent,
} from '../src/whatsapp/guard.js';

const ME = '972500000001';
const ME_LID = '187654321098765';
const LEAD = '972541234567@s.whatsapp.net';
const own = new Set([ME, ME_LID]);
const silent = { warn: () => {}, error: () => {} };

const verdict = (node: BinaryNode) => classifyFrame(binaryNodeToString(node), own);
const iq = (type: string | undefined, xmlns: string, children: BinaryNode[] = []): BinaryNode => ({
  tag: 'iq',
  attrs: { id: '1', to: 's.whatsapp.net', ...(type ? { type } : {}), xmlns },
  content: children,
});
const child = (tag: string, attrs: Record<string, string> = {}, content?: BinaryNode[]): BinaryNode => ({ tag, attrs, content });

describe('read-only guard: what may go out on the wire', () => {
  it.each<[string, BinaryNode]>([
    ['a keep-alive ping', iq('get', 'w:p', [child('ping')])],
    ['an encryption key upload', iq('set', 'encrypt', [child('registration'), child('type'), child('identity'), child('list')])],
    ['switching to active after login', iq('set', 'passive', [child('active')])],
    ['clearing dirty bits', iq('set', 'urn:xmpp:whatsapp:dirty', [child('clean', { type: 'account_sync' })])],
    ['asking where to download media', iq('set', 'w:m', [child('media_conn')])],
    ['fetching contact names and chat settings', iq('set', 'w:sync:app:state', [child('sync', {}, [child('collection', { name: 'regular', version: '3' })])])],
    ['linking with a pairing code', iq('set', 'md', [child('link_code_companion_reg', { stage: 'companion_hello' })])],
    ['unlinking this server', iq('set', 'md', [child('remove-companion-device', { reason: 'user_initiated' })])],
    ['an answer to the server', { tag: 'iq', attrs: { id: '2', to: 's.whatsapp.net', type: 'result' } }],
    ['an acknowledgement', { tag: 'ack', attrs: { id: 'A1', to: LEAD, class: 'message' } }],
    ['a delivery receipt (grey ticks)', { tag: 'receipt', attrs: { id: 'A1', to: LEAD } }],
    ['a delivery receipt in the background', { tag: 'receipt', attrs: { id: 'A1', to: LEAD, type: 'inactive' } }],
    ['a decryption retry', { tag: 'receipt', attrs: { id: 'A1', to: LEAD, type: 'retry' } }],
    ['a history chunk receipt', { tag: 'receipt', attrs: { id: 'A1', to: `${ME}@s.whatsapp.net`, type: 'hist_sync' } }],
    ['asking your phone to re-upload a voice note', { tag: 'receipt', attrs: { id: 'A1', to: `${ME}@s.whatsapp.net`, type: 'server-error' } }],
    ['going invisible', { tag: 'presence', attrs: { name: 'Rozen', type: 'unavailable' } }],
    ['a history request to your own phone', { tag: 'message', attrs: { id: 'H1', to: `${ME}@s.whatsapp.net`, type: 'text', category: 'peer' } }],
    ['asking for the next offline batch', { tag: 'ib', attrs: {}, content: [child('offline_batch', { count: '100' })] }],
  ])('lets through %s', (_label, node) => {
    expect(verdict(node)).toEqual({ allow: true });
  });

  it.each<[string, BinaryNode, string]>([
    ['a text message to a lead', { tag: 'message', attrs: { id: 'M1', to: LEAD, type: 'text' }, content: [child('enc', { v: '2', type: 'msg' })] }, 'a message'],
    ['a "peer" message to someone else', { tag: 'message', attrs: { id: 'M2', to: LEAD, type: 'text', category: 'peer' } }, 'a message'],
    ['a status post', { tag: 'message', attrs: { id: 'M3', to: 'status@broadcast', type: 'text' } }, 'a message'],
    ['a read receipt', { tag: 'receipt', attrs: { id: 'A1', to: LEAD, type: 'read' } }, 'a read receipt (blue ticks)'],
    ['marking read on your own phone', { tag: 'receipt', attrs: { id: 'A1', to: `${ME}@s.whatsapp.net`, type: 'read-self' } }, 'a read receipt (blue ticks)'],
    ['a "played" receipt for a voice note', { tag: 'receipt', attrs: { id: 'A1', to: LEAD, type: 'played' } }, 'a "played" receipt'],
    ['a re-upload request to someone else', { tag: 'receipt', attrs: { id: 'A1', to: LEAD, type: 'server-error' } }, 'a "server-error" receipt'],
    ['a typing indicator', { tag: 'chatstate', attrs: { from: `${ME}@s.whatsapp.net`, to: LEAD }, content: [child('composing')] }, 'a typing or recording indicator'],
    ['rejecting a call', { tag: 'call', attrs: { from: `${ME}@s.whatsapp.net`, to: LEAD }, content: [child('reject', { 'call-id': 'C1' })] }, 'a call action'],
    ['showing you online', { tag: 'presence', attrs: { name: 'Rozen', type: 'available' } }, 'a "available" presence'],
    ['subscribing to a lead’s presence', { tag: 'presence', attrs: { to: LEAD, type: 'subscribe' } }, 'a "subscribe" presence'],
    ['adding a lead to a group', iq('set', 'w:g2', [child('add', {}, [child('participant', { jid: LEAD })])]), 'a group change'],
    ['blocking a lead', iq('set', 'blocklist', [child('item', { action: 'block', jid: LEAD })]), 'a block or unblock'],
    ['archiving or marking a chat read', iq('set', 'w:sync:app:state', [child('sync', {}, [child('collection', { name: 'regular' }, [child('patch')])])]), 'a chat settings change'],
    ['changing your status text', iq('set', 'status', [child('status')]), 'a profile status change'],
    ['changing privacy settings', iq('set', 'privacy', [child('privacy', {}, [child('category', { name: 'last', value: 'all' })])]), 'a privacy setting change'],
    ['any other device change', iq('set', 'md', [child('pair-device-sign')]), 'a device change'],
  ])('blocks %s and stops the link', (_label, node, what) => {
    expect(verdict(node)).toEqual({ allow: false, severity: 'critical', what });
  });

  it.each<[string, BinaryNode]>([
    ['the bare presence Baileys sends when your name syncs', { tag: 'presence', attrs: { name: undefined } as unknown as Record<string, string> }],
    ['contact tokens Baileys issues after sending', iq('set', 'privacy', [child('tokens', {}, [child('token', { jid: LEAD, type: 'trusted_contact' })])])],
    ['GraphQL requests', iq('get', 'w:mex', [child('query', { query_id: '1' })])],
    ['analytics', iq(undefined, 'w:stats', [child('add')])],
    ['frames it doesn’t know', { tag: 'something_new', attrs: { to: LEAD } }],
  ])('quietly holds back %s', (_label, node) => {
    const result = verdict(node);
    expect(result.allow).toBe(false);
    expect(result).toMatchObject({ severity: 'quiet' });
  });

  it('refuses a frame whose attributes it can’t read with certainty', () => {
    // A quote inside a value makes the attributes ambiguous: the frame is treated as untrusted
    expect(classifyFrame(`<message to='${LEAD}' note='it's' type='text'/>`, own)).toMatchObject({ allow: false, severity: 'critical' });
    expect(classifyFrame('not a frame', own)).toMatchObject({ allow: false, severity: 'critical' });
  });
});

describe('read-only guard: what may be encrypted at all', () => {
  const historyRequest = proto.Message.fromObject({
    protocolMessage: {
      type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE,
      peerDataOperationRequestMessage: {
        peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND,
        historySyncOnDemandRequest: { chatJid: LEAD, oldestMsgId: 'A1', oldestMsgFromMe: false, onDemandMsgCount: 50 },
      },
    },
  });

  it('matches Baileys’ own protocol numbers', () => {
    expect(PEER_DATA_OPERATION_REQUEST_MESSAGE).toBe(proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE);
    expect([...OWN_PHONE_REQUESTS].sort()).toEqual(
      [proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND, proto.Message.PeerDataOperationRequestType.PLACEHOLDER_MESSAGE_RESEND].sort(),
    );
  });

  it('allows a history request addressed to your own phone, directly or wrapped for your devices', () => {
    expect(isOwnPhoneRequest(historyRequest, [`${ME}@s.whatsapp.net`], own)).toBe(true);
    const wrapped = { deviceSentMessage: { destinationJid: `${ME}@s.whatsapp.net`, message: historyRequest } };
    expect(isOwnPhoneRequest(wrapped, [`${ME}:0@s.whatsapp.net`, `${ME_LID}:3@lid`], own)).toBe(true);
  });

  it('refuses everything else', () => {
    const text = proto.Message.fromObject({ conversation: 'Hi Amir!' });
    const revoke = proto.Message.fromObject({ protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { id: 'A1' } } });
    const linkPreview = proto.Message.fromObject({
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE,
        peerDataOperationRequestMessage: { peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.GENERATE_LINK_PREVIEW },
      },
    });
    const smuggled = { ...historyRequest, conversation: 'hidden text' };
    expect(isOwnPhoneRequest(text, [`${ME}@s.whatsapp.net`], own)).toBe(false);
    expect(isOwnPhoneRequest(revoke, [`${ME}@s.whatsapp.net`], own)).toBe(false);
    expect(isOwnPhoneRequest(linkPreview, [`${ME}@s.whatsapp.net`], own)).toBe(false);
    expect(isOwnPhoneRequest(smuggled, [`${ME}@s.whatsapp.net`], own)).toBe(false);
    expect(isOwnPhoneRequest(historyRequest, [LEAD], own)).toBe(false);
    expect(isOwnPhoneRequest(historyRequest, [`${ME}@s.whatsapp.net`, LEAD], own)).toBe(false);
    expect(isOwnPhoneRequest(historyRequest, undefined, own)).toBe(false);
    expect(isOwnPhoneRequest({ deviceSentMessage: { destinationJid: LEAD, message: historyRequest } }, [`${ME}@s.whatsapp.net`], own)).toBe(false);
    expect(isOwnPhoneRequest(historyRequest, [`${ME}@s.whatsapp.net`], new Set())).toBe(false);
  });
});

/**
 * The real Baileys socket against a local WebSocket server that records every frame it receives. Before the
 * handshake finishes Baileys writes frames unencrypted, so the server can decode exactly what left.
 */
describe('read-only guard on a live Baileys socket', () => {
  let server: WebSocketServer;
  const received: BinaryNode[] = [];
  let sock: WASocket;
  let sendNode: WASocket['sendNode'];
  let relayMessage: WASocket['relayMessage'];
  const critical: GuardEvent[] = [];
  let guard: ReturnType<typeof createReadOnlyGuard>;

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
      let intro = true;
      socket.on('message', (data: Buffer) => {
        // The first write is the handshake hello; after it, each write is a 3-byte length and an encoded node
        if (intro) {
          intro = false;
          return;
        }
        const length = (data[0] << 16) | (data[1] << 8) | data[2];
        void decodeBinaryNode(Buffer.from(data.subarray(3, 3 + length))).then((node) => received.push(node));
      });
    });
    await new Promise((resolve) => server.once('listening', resolve));

    const creds = initAuthCreds();
    creds.me = { id: `${ME}:7@s.whatsapp.net`, lid: `${ME_LID}:7@lid`, name: 'Rozen' };
    const keys = makeCacheableSignalKeyStore({ get: async () => ({}), set: async () => {} });
    guard = createReadOnlyGuard({ ownUsers: () => own, log: silent, onCritical: (event) => critical.push(event) });
    sock = makeWASocket({
      ...guard.socketConfig,
      patchMessageBeforeSending: guard.socketConfig.patchMessageBeforeSending as never,
      auth: { creds, keys },
      waWebSocketUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: 1_000,
    });
    // Kept before the guard replaces them, to try the raw paths Baileys uses internally
    sendNode = sock.sendNode;
    relayMessage = sock.relayMessage;
    guard.arm(sock);
    for (let i = 0; i < 50 && !(sock.ws as unknown as { isOpen: boolean }).isOpen; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    sock?.end(undefined);
    await new Promise((resolve) => server.close(resolve));
  });

  const attempt = async (node: BinaryNode) => {
    const outcome = await sendNode(node).then(
      () => 'written',
      () => 'refused',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    return outcome;
  };
  const arrived = (id: string) => received.some((node) => node.attrs.id === id);

  it('proves itself before connecting', () => {
    expect(guard.report().selfTest).toBe('passed');
    expect((sock.ws as unknown as { isOpen: boolean }).isOpen).toBe(true);
  });

  it('writes the protocol frames a linked device needs', async () => {
    expect(await attempt(iq('get', 'w:p', [child('ping')]))).toBe('written');
    expect(await attempt({ tag: 'receipt', attrs: { id: 'R-delivered', to: LEAD } })).toBe('written');
    expect(await attempt({ tag: 'message', attrs: { id: 'H-peer', to: `${ME}@s.whatsapp.net`, type: 'text', category: 'peer' } })).toBe('written');
    expect(arrived('1') && arrived('R-delivered') && arrived('H-peer')).toBe(true);
  });

  it('never lets a message, read receipt or "online" reach the server', async () => {
    const message: BinaryNode = { tag: 'message', attrs: { id: 'M-text', to: LEAD, type: 'text' }, content: [child('enc', { v: '2', type: 'msg' })] };
    expect(await attempt(message)).toBe('refused');
    expect(await attempt({ tag: 'receipt', attrs: { id: 'R-read', to: LEAD, type: 'read' } })).toBe('refused');
    expect(await attempt({ tag: 'presence', attrs: { id: 'P-online', name: 'Rozen', type: 'available' } })).toBe('refused');
    expect(await attempt({ tag: 'chatstate', attrs: { id: 'S-typing', to: LEAD }, content: [child('composing')] })).toBe('refused');
    expect(arrived('M-text') || arrived('R-read') || arrived('P-online') || arrived('S-typing')).toBe(false);
    // The link reports the first critical block once, so it can close the connection
    await new Promise((resolve) => setImmediate(resolve));
    expect(critical.map((event) => event.what)).toEqual(['a message']);
  });

  it('stops Baileys’ own send path before anything is encrypted', async () => {
    const before = received.length;
    await expect(relayMessage(LEAD, { conversation: 'Hi Amir' }, {})).rejects.toThrow(ReadOnlyViolation);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received.slice(before).some((node) => node.tag === 'message')).toBe(false);
  });

  it('replaces every send-capable method on the socket', async () => {
    const methods = sock as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of ['sendMessage', 'readMessages', 'sendPresenceUpdate', 'chatModify', 'sendNode', 'relayMessage', 'rejectCall', 'groupParticipantsUpdate', 'updateBlockStatus', 'query']) {
      expect(() => methods[name]('972541234567@s.whatsapp.net', { text: 'hi' })).toThrow(ReadOnlyViolation);
    }
    const left = Object.keys(sock).filter((key) => typeof methods[key] === 'function' && !SOCKET_METHODS_ALLOWED.has(key));
    for (const name of left) expect(() => methods[name]()).toThrow(ReadOnlyViolation);
    expect(guard.report().blocked).toBeGreaterThan(left.length);
  });

  it('keeps its logger at the level that shows it every frame', () => {
    const logger = guard.socketConfig.logger;
    logger.level = 'info';
    expect(logger.level).toBe('trace');
    expect(logger.child({ class: 'x' }).level).toBe('trace');
  });
});

describe('read-only guard self-test', () => {
  it('refuses to arm a socket whose writes it can’t see', () => {
    let ended = false;
    class FakeWs {
      get isOpen() {
        return false;
      }
    }
    const fake = {
      ws: new FakeWs(),
      // A Baileys version that no longer shows frames to the logger
      sendNode: async () => {},
      sendMessage: async () => {},
      end: () => {
        ended = true;
      },
    };
    const guard = createReadOnlyGuard({ ownUsers: () => own, log: silent });
    expect(() => guard.arm(fake)).toThrow(/לא הצליח לוודא/);
    expect(guard.report().selfTest).toBe('failed');
    expect(ended).toBe(true);
  });
});
