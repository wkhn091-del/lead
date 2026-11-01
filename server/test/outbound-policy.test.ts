import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The CRM is an internal tool: it never sends an email, a WhatsApp message, an SMS or a link to a lead.
 * These checks read the server's source, so a change that adds a way out fails the tests before it ships.
 * At run time, the WhatsApp link is held to the same rule by src/whatsapp/guard.ts.
 */

const root = join(import.meta.dirname, '..');
const sourceDir = join(root, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const files = sourceFiles(sourceDir).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;

/** Libraries and services that deliver email, SMS, push or chat messages */
const MESSAGING = [
  'nodemailer',
  'emailjs',
  'twilio',
  '@sendgrid/',
  'mailgun',
  'postmark',
  'resend',
  '@aws-sdk/client-ses',
  '@aws-sdk/client-sesv2',
  '@aws-sdk/client-sns',
  '@aws-sdk/client-pinpoint',
  '@vonage/',
  'vonage',
  'plivo',
  'messagebird',
  'telnyx',
  'whatsapp-web.js',
  'whatsapp-cloud-api',
  '@whiskeysockets/baileys',
  'web-push',
  'firebase-admin',
  'node-telegram-bot-api',
  'telegraf',
  '@slack/',
];

const MESSAGING_HOSTS = /graph\.facebook\.com|api\.whatsapp\.com|wa\.me\/|api\.twilio\.com|api\.sendgrid\.com|api\.mailgun\.net|api\.resend\.com|api\.postmarkapp\.com|smtp\.|hooks\.slack\.com|api\.telegram\.org/i;

/** Baileys methods that can reach a contact or change the account. Only guard.ts may name them. */
const SEND_CALL =
  /\.(sendMessage|relayMessage|sendReceipts?|readMessages|sendPresenceUpdate|presenceSubscribe|chatModify|sendNode|sendRawMessage|rejectCall|updateBlockStatus|groupCreate|groupParticipantsUpdate|groupInviteCode|updateProfile\w*|sendPeerDataOperationMessage|addOrEditContact|addChatLabel|addMessageLabel|newsletter\w+|createCallLink|sendWAMBuffer|appPatch)\s*\(/;

describe('outbound policy', () => {
  it('has no library that sends email, SMS, push or chat messages', () => {
    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    expect(dependencies.filter((name) => MESSAGING.some((lib) => name === lib || name.startsWith(lib)))).toEqual([]);
    const imports = files.flatMap(({ path, text }) =>
      [...text.matchAll(/from '([^']+)'|import\('([^']+)'\)/g)]
        .map((match) => match[1] ?? match[2])
        .filter((name) => MESSAGING.some((lib) => name === lib || name.startsWith(lib)))
        .map((name) => `${path}: ${name}`),
    );
    expect(imports).toEqual([]);
  });

  it('never talks to a messaging API', () => {
    expect(files.filter(({ text }) => MESSAGING_HOSTS.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('calls no WhatsApp method that could send, outside the read-only guard', () => {
    const calls = files
      .filter(({ path }) => path !== join('src', 'whatsapp', 'guard.ts'))
      .flatMap(({ path, text }) => text.split('\n').flatMap((line, index) => (SEND_CALL.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])));
    expect(calls).toEqual([]);
  });

  it('only reads business websites in the Prospector: GET requests, no clicks, no typing, no forms', () => {
    const prospector = files.filter(({ path }) => path.startsWith(join('src', 'prospector')));
    expect(prospector.length).toBeGreaterThan(5);
    // Only the Google Places search posts anything, and only to Google
    const posting = prospector.filter(({ text }) => /method:\s*'(POST|PUT|PATCH|DELETE)'/.test(text)).map(({ path }) => path);
    expect(posting).toEqual([join('src', 'prospector', 'discovery.ts')]);
    const discovery = prospector.find(({ path }) => path.endsWith('discovery.ts'))!.text;
    expect(discovery).toContain('places.googleapis.com');
    // The page download hard-codes GET
    const net = prospector.find(({ path }) => path.endsWith('net.ts'))!.text;
    expect(net.match(/method:\s*'[A-Z]+'/g)).toEqual(["method: 'GET'"]);
    // The headless browser loads and screenshots: it never clicks, types, focuses, submits or uploads
    const browser = prospector.find(({ path }) => path.endsWith('browser.ts'))!.text;
    // (type() and select() with an argument: message.type() just reads a console message's kind)
    expect(browser).not.toMatch(/\.(click|tap|hover|focus|press|uploadFile|submit)\(|\.(type|select)\([^)]|keyboard\.|mouse\.|touchscreen\./);
    expect(browser).toContain("method !== 'GET' && method !== 'HEAD'");
    const proxy = prospector.find(({ path }) => path.endsWith('proxy.ts'))!.text;
    expect(proxy).toContain("req.method !== 'GET' && req.method !== 'HEAD'");
  });

  it('loads Baileys only inside the WhatsApp module, behind the guard', () => {
    const importers = files.filter(({ text }) => /from 'baileys'|import\('baileys'\)/.test(text)).map(({ path }) => path);
    expect(importers.every((path) => path.startsWith(join('src', 'whatsapp')))).toBe(true);
    // The guard itself, the routes and the settings never load it
    for (const name of ['guard.ts', 'service.ts', 'auth-key.ts', 'phone.ts', 'whatsapp.routes.ts']) {
      expect(importers).not.toContain(join('src', 'whatsapp', name));
    }
    // Every socket is created in one place, from the guard's settings, and armed before use
    const creators = files.filter(({ text }) => /makeWASocket\(/.test(text)).map(({ path }) => path);
    expect(creators).toEqual([join('src', 'whatsapp', 'link.ts')]);
    const link = files.find(({ path }) => path === join('src', 'whatsapp', 'link.ts'))!.text;
    expect(link).toMatch(/makeWASocket\(\{\s*\.\.\.this\.guard\.socketConfig,/);
    expect(link).toContain('this.guard.arm(socket);');
  });
});
