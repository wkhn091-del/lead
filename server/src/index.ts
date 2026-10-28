import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.js';
import { config } from './config.js';
import { openCoach, openMediaStorage, openProspector, openTranscription, openWhatsApp } from './services.js';
import { openStores } from './stores/index.js';

const { stores, close } = await openStores();
const storage = openMediaStorage();
const coach = openCoach();
const { queue: transcription, off: transcriptionOff } = await openTranscription(stores, storage);
const { service: whatsapp, off: whatsappOff } = await openWhatsApp(stores, storage, transcription);
const { engine: prospector, off: prospectorOff } = await openProspector(stores, storage, coach);
const app = createApp({ stores, storage, coach, transcription, transcriptionOff, whatsapp, whatsappOff, prospector, prospectorOff });

const server = app.listen(config.port, () => {
  const frontend = existsSync(join(config.frontendDist, 'index.html'))
    ? `serving the frontend from ${config.frontendDist}`
    : 'API only (no frontend build found)';
  const ai = coach ? `AI coach: ${coach.name} ${coach.model}` : 'AI coach off';
  const transcripts = transcription ? `transcripts: ${transcription.transcriber.model}` : 'transcripts off';
  const wa = whatsapp ? `WhatsApp: read-only, ${whatsapp.status().link.state}` : 'WhatsApp off';
  const finder = prospector
    ? `Prospector: ${prospector.providerName}${prospector.backupName ? ` (backup: ${prospector.backupName})` : ''}${prospector.browser ? ' + browser' : ''}${prospector.ai ? ' + AI' : ''}`
    : 'Prospector off';
  console.log(`Omek Leads API on http://localhost:${config.port} (${config.env}, ${frontend}, ${ai}, recordings: ${storage.kind}, ${transcripts}, ${wa}, ${finder})`);
  // Transcripts that were queued or running when the server last stopped carry on, and so do searches.
  void transcription?.resume().catch((error: unknown) => console.error("Couldn't resume transcripts:", error));
  void prospector?.resume().catch((error: unknown) => console.error("Couldn't resume Prospector searches:", error));
});

// A long Zoom recording on a slow connection takes a while to upload (Node's default limit is 5 minutes).
server.requestTimeout = 60 * 60 * 1000;

server.on('error', (error) => {
  console.error('The server could not start:', error.message);
  process.exit(1);
});

/** Finish in-flight requests, then close the database connection. */
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down…`);
  // A transcript in progress stops here and starts again on the next start (its state is in the database).
  transcription?.stop();
  whatsapp?.stop();
  // Closes the website checker's browser, if one is open
  const stopped = prospector?.stop().catch(() => {});
  server.close(() => {
    void Promise.all([stopped, close()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
