# Omek Leads API

Express 5, Prisma 6 and MongoDB. It stores the CRM's leads and a timeline of every call, Zoom meeting, message and note, keeps call and Zoom recordings and transcribes them automatically, runs the sales funnel and the Daily 10 queue, takes bulk imports, asks Claude, OpenAI or Gemini (free tier available) to coach you on each deal, and runs the Prospector, which finds local businesses and scores how badly they need a new website. Everything sits behind a password sign-in.

Messages the app shows (errors, reasons a feature is off, WhatsApp states) are in Hebrew, like the app; the server log stays in English.

Prisma 7 doesn't support MongoDB yet, so this uses Prisma 6.19, the newest release that does. When Prisma adds MongoDB to version 7, only `src/db.ts` and `src/stores/prisma.ts` touch Prisma.

## Run it locally

You need Node 22.12 or newer, plus MongoDB from Docker or a free Atlas cluster (see below).

```bash
cd server
docker compose up -d --wait   # local MongoDB (a one-node replica set, which Prisma requires)
cp .env.example .env
npm install                   # also generates the Prisma client
npm run hash-password         # type a password (12+ characters), paste the printed line into .env
                              # and set ADMIN_EMAIL in .env too
npm run db:push               # creates the collections and indexes
npm run dev                   # API on http://localhost:4000
```

Then, in a second terminal, from the project root:

```bash
echo "VITE_API_URL=/api" > .env
npm run dev                   # http://localhost:5173 now asks you to sign in
```

The Vite dev server forwards `/api` to port 4000, so the browser sees one origin and the session cookie works without CORS.

**No database yet?** Set `STORAGE=memory` in `server/.env` to run everything, imports included, with leads kept in memory. They disappear when the server stops, and the server refuses this setting in production.

**AI coach:** add `AI_PROVIDER` and `AI_API_KEY` to `server/.env` (see [The AI sales coach](#the-ai-sales-coach)). Without them everything else works and the coach tab says how to turn it on.

**Recordings** go to `server/uploads/` by default. That folder is in `.gitignore`.

**Transcripts:** add `TRANSCRIBE_API_KEY` (an OpenAI key) and `TRANSCRIBE_LANGUAGE=he`. `npm install` also downloads a static ffmpeg build for your system, which transcription uses. See [Automatic transcripts](#automatic-transcripts).

**Prospector:** add `GOOGLE_PLACES_API_KEY` (or `SERPAPI_KEY`), and optionally `PROSPECTOR_CHROME_PATH` for phone screenshots. It scores with the AI coach's provider. See [The Prospector](#the-prospector-finding-new-leads).

## The workflow

The funnel rules live on the server (`src/leads/workflow.ts`), so no client can bend them.

- **Stages.** Every lead starts at Cold Call, then moves to Zoom Meeting, then Deal Closed, one stage at a time. New and imported leads can't start further along.
- **Actions.** `advance`, `no_answer` (nobody picked up), `answered` (a conversation that didn't move the deal, like "call me next month") and `archive` (not relevant). Each action carries the stage the client saw and a client-made id, so a retried request is applied once and a step based on an out-of-date view is refused with a 409. It can also carry `body` (what was said) and `channel` (`call` or `zoom`), which go on the timeline entry the step creates.
- **Undo.** The latest step on a lead can be undone within 10 minutes. After that the funnel only moves forward, and an archived lead stays archived. Whatever was written about an undone step stays on the timeline as a plain note.
- **Deal terms.** A closed deal has three amounts, in whole units of the lead's currency (`ILS` or `USD`): `setupFee` (one-time, for building the site), `monthlyRetainer` (maintenance and management) and `hostingYearly` (domain and hosting, renewed every year). They, and the currency, can only be set once the deal is closed (409 before that); a `PATCH` may send any of the three and the others stay as they were. A new or imported lead can't arrive with amounts, and undoing the close clears them. Leads saved before deal terms had a single `value`: a closed deal's reads as its setup fee, and moves into the deal terms (the old field removed) the next time its amounts or its stage change.
- **The Daily 10.** The first request of the day draws `DAILY_QUOTA` leads (10) at random from the pool: uncontacted leads, meaning at Cold Call, never picked up, not archived and not tried today. Every later request that day returns the same leads, on any device. If the pool was short when the day started, the next import tops the day up. Closed and archived leads never enter the pool, leads at Zoom have already been contacted, and so has a lead that answered without booking a Zoom: you follow that one up from the pipeline (the AI coach suggests when). "Today" is the calendar day in `APP_TIMEZONE` (default `Asia/Jerusalem`), so the queue turns over at your midnight, not the server's.

## The timeline

Every lead has a timeline in the `interactions` collection, one document per event:

- **Calls and Zoom meetings** come from workflow steps. Logging a step creates its entry with the same id, the notes or transcript you sent, the outcome (`no_answer`, `answered`, `held`, `no_show`) and where the step moved the lead. At Cold Call a step is a phone call; at Zoom Meeting it is a meeting, unless `channel` says it was a call. The frontend numbers phone calls as attempts: "ניסיון 1: אין מענה", "ניסיון 2: ענה ← פגישת זום" (attempt 1: no answer; attempt 2: answered, moved to Zoom Meeting).
- **Notes, WhatsApp messages and emails** are added directly (`POST /leads/:id/interactions`). A new lead's `notes`, typed in or imported, become its first notes.
- **Any entry's text can be edited**, up to 100,000 characters (an hour-long Zoom transcript fits). Notes and messages can be deleted; entries that record a step can't, so the funnel's history stays true. Clear their text, or undo the step within 10 minutes.

**Upgrading from the previous version:** leads stored before this version kept notes on the lead and have no timeline. After `npm run db:push`, run `npm run migrate:timeline` once. It turns every logged step and old note into a timeline entry (keeping their ids, so running it twice adds nothing) and removes the old `notes` field.

## Call and Zoom recordings

Recordings are uploaded with Multer as `multipart/form-data` to `POST /api/leads/:id/media`, in a field named `file`, with an optional `interactionId` to attach the file to one timeline entry. Without it, the recording belongs to the lead as a whole.

- **Formats.** mp3, m4a, aac, wav, ogg, opus, flac, amr and 3gp audio; mp4, m4v, mov and webm video. The extension must be one of these, and the browser's type must be audio or video (or unknown, for formats like .amr). Anything else gets a 415.
- **Size.** Up to `MAX_UPLOAD_MB` (500 by default; a one-hour Zoom recording at 720p is usually 200 to 400 MB). Multer writes each upload to a temp file, so a large file never sits in memory, and the server allows an hour per request for slow connections.
- **Storage.** `MEDIA_STORAGE=local` (the default) keeps files in `MEDIA_DIR` (`./uploads`). That is right on your own machine or a server with a persistent disk. On Render, Railway or Fly without a volume, the disk is wiped on every deploy, so use `MEDIA_STORAGE=s3` there. S3 works with AWS and with S3-compatible services (Cloudflare R2, Backblaze B2, MinIO) through `S3_ENDPOINT`. Files go up as multipart uploads streamed from disk.
- **Playback.** `GET /api/media/:id/file` needs the session cookie. Local files stream with HTTP range support, so players can seek. With S3 the bucket stays private and the server answers with a redirect to a signed link that expires after 15 minutes. Files are served as `inline` with a sandboxing Content Security Policy and `nosniff`, so nothing uploaded can run as a page.
- **Deleting.** `DELETE /api/media/:id` removes the record and the file. Deleting a lead deletes its recordings, timeline and coaching reports.

For S3, create a private bucket and an access key that can only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on it, then set `MEDIA_STORAGE=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (plus `S3_ENDPOINT` for R2, B2 or MinIO, and `S3_FORCE_PATH_STYLE=true` for MinIO). The bucket's host is added to the Content Security Policy's `media-src` automatically.

## Automatic transcripts

Every recording uploaded to a timeline entry is transcribed in the background, and the text is added to that entry for the AI coach to read:

1. **Queued.** `POST /api/leads/:id/media` stores the file and answers at once with `transcription.status: "queued"`. The job runs in the server process, one recording at a time.
2. **Audio out, pauses found.** ffmpeg takes the first audio track of any audio or video file and turns it into mono 16 kHz MP3 at 48 kbps, about 21 MB an hour, while noting every pause of half a second or more.
3. **Cut at pauses.** The audio is cut into parts of about `TRANSCRIBE_PART_MINUTES` (10), each in the longest pause found in the two minutes before the target, so words aren't split. A 10-minute part is about 3.5 MB, far below OpenAI's 25 MB limit, however long the recording; even 45-minute parts stay under it.
4. **Transcribed in order.** Each part goes to `POST /v1/audio/transcriptions` with `gpt-transcribe`, the language hint as `languages[]`, the lead's name, its contact and your `TRANSCRIBE_KEYWORDS` as `keywords[]`, and the end of the previous part as the `prompt`, so a sentence cut between parts carries on. Rate limits and server errors are retried with backoff, honoring `Retry-After`.
5. **Added to the timeline.** The parts are joined, and `[Auto-Transcript]` plus the text is added after the entry's notes, safely alongside other writes. A recording on the lead itself (not on an entry) gets a note of its own, and moves into it.

The job's state lives on the recording (`media.transcription`: status, parts done of total, error, word count), so the app can show "Transcribing… Part 3 of 7". It checks `GET /api/leads/:id/media` every 4 seconds while a transcript is pending, and loads the timeline once one finishes. OpenAI's API answers each part directly, so no webhook is needed.

- **Restarts.** A job interrupted by a deploy, a crash or Render's free plan sleeping picks up again when the server starts. After three interrupted runs it is marked failed instead. The finished text is saved before it is added to the entry, so a job interrupted in between never adds it twice.
- **Failures.** A recording without sound, a damaged file, a rejected key or an exhausted quota mark the transcript failed with the reason, which the entry shows with **Try again** (`POST /api/media/:id/transcribe`). That also transcribes recordings uploaded before transcripts were on.
- **Deleting** a recording or its lead stops its job.
- **Editing while it lands.** Editing an entry is paused while its transcript is on its way. If an editor was already open, the app sends `expectedUpdatedAt`; the server answers 409 instead of overwriting, and the app keeps your edit with the transcript after it.
- **Hebrew.** Set `TRANSCRIBE_LANGUAGE=he`. If the service ever refuses a language code, the job carries on without the hint rather than failing.

| Setting | Value |
| --- | --- |
| `TRANSCRIBE_API_KEY` | an OpenAI key. Without it, `AI_API_KEY` is used when `AI_PROVIDER=openai`; otherwise transcripts are off. |
| `TRANSCRIBE_MODEL` | `gpt-transcribe` (default, OpenAI's recommended model). `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `whisper-1` also work. |
| `TRANSCRIBE_LANGUAGE` | a language hint, like `he` |
| `TRANSCRIBE_KEYWORDS` | names and terms to spell right in every transcript, comma separated: `Omek, Zoom, WordPress` |
| `TRANSCRIBE_PART_MINUTES` | length of each part, 1 to 45 (default 10) |
| `TRANSCRIBE_BASE_URL` | any OpenAI-compatible service instead (the part before `/v1`), such as Groq or a Whisper server you run yourself |
| `TRANSCRIBE` | `off` turns transcripts off |
| `FFMPEG_PATH` | an ffmpeg to use instead of the bundled one |

**A local model instead of OpenAI.** Point `TRANSCRIBE_BASE_URL` at a Whisper server with an OpenAI-compatible API (for example one running faster-whisper on your own computer) and set `TRANSCRIBE_MODEL` to its model name. Running Whisper inside this server isn't practical on a small host: the models accurate enough for Hebrew need more memory than a small Render instance has, and run slowly on its CPU.

**ffmpeg.** `fluent-ffmpeg`, the usual Node wrapper, has been marked "no longer supported" on npm since May 2025, so `src/transcription/ffmpeg.ts` runs ffmpeg directly. The `ffmpeg-static` optional dependency downloads a static ffmpeg build during `npm install` (Render needs no extra packages). Without it, an `ffmpeg` on the PATH is used, or `FFMPEG_PATH`. If none is found, the server starts with transcripts off and says why at `GET /api/features`.

## The AI sales coach

`POST /api/leads/:id/coaching` sends the lead's whole history to Claude, OpenAI or Gemini and stores the answer as a coaching report: the deal analysis. It's the "ניתוח עסקה" button on every lead's profile (and on each open deal on the dashboard), and the latest one shows on the lead's AI coach tab: where the deal stands, a plan of action with when to do each step, a recommended price, the objections to expect when asking to close, and a word-for-word script for the next call. The same provider builds and tailors the objection deck and scores websites in the Prospector.

| Setting | Value |
| --- | --- |
| `AI_PROVIDER` | `anthropic`, `openai` or `gemini`. Empty turns the coach off (the route answers 503). |
| `AI_API_KEY` | from [console.anthropic.com](https://console.anthropic.com), [platform.openai.com](https://platform.openai.com) or [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| `AI_MODEL` | optional. Defaults to `claude-sonnet-5-5` for Anthropic, `gpt-6-astra` for OpenAI and `gemini-3.8-flash` for Gemini. |
| `AI_BUSINESS_CONTEXT` | optional: what you sell, in your own words. Empty, the AI is given Studio Omek's offer, as written in `src/coach/prompt.ts`. Scripts, answers and opening lines only have you claim what it says, and a price range here guides the price recommendation. |
| `AI_BASE_URL` | optional: a gateway or proxy in front of the same API |

**Free, with Gemini.** A key from Google AI Studio works without a credit card, within the free tier's limits (a handful of requests a minute and a daily cap, shown in AI Studio). On the free tier, Google's terms let it use what you send to improve its products and have people review it, and they ask you not to send personal information: lead names, your notes and call transcripts are exactly that. The Prospector only sends public website content, so it's a good fit there. For the coach and the objection deck, turn on billing for the key's Google Cloud project: the same key then counts as paid, Google stops using the data, and one person's use costs little. The server waits and tries again after a rate limit (up to twice, when the wait is short), and scores Prospector sites one at a time with Gemini.

**What the AI gets.** A system prompt that sets it up as a sales coach for your funnel, then the lead's name, contact name, campaign, stage, the deal's currency, a closed deal's terms ("Deal terms: setup fee 18,000 ILS; monthly retainer 650 ILS a month; domain and hosting none", so it can spot the natural upsell), unanswered-call count, last contact and approach notes; your price history (from your other closed deals in the same currency: the median setup fee and its range, how many pay a retainer and how much, the same for hosting, and the deals in the lead's own niche; amounts only, never which business paid them); and the timeline oldest first, each entry with its date (in `APP_TIMEZONE`), its title exactly as the app shows it ("ניסיון 2: ענה ← פגישת זום"), its notes and any automatic transcript. The prompt explains the Hebrew titles, and the coach names entries by them, so "ניסיון 2" in its advice is the entry you see on the timeline. The lead's phone, email and website fields are never sent. Each entry says whether its recordings are transcribed below, still in progress or not transcribed, and the prompt tells the coach to trust a transcript over the notes (allowing for recognition mistakes), to tell the speakers apart by context, and not to guess at recordings it can't read. The notes are escaped and marked as data, so text in them can't pose as instructions. Long histories are fitted into about 150,000 characters: every note first, newest first, then the transcripts in the room left, shortened from the middle so each call's opening and ending stay.

**Only what's true.** Every prompt that writes words for you to say (the deal analysis, the objection deck, the answers for a niche, the Prospector's opening lines) is given your business description (`AI_BUSINESS_CONTEXT`, or Studio Omek's offer in `src/coach/prompt.ts`) and the same rule: no statistics or invented figures, and no clients, results, reviews, years of experience, guarantees, discounts or payment terms beyond what the description and your own deals say. An offer you don't make yet can come as a tip to you, never in a script. The coach's price recommendation is saved with how many of your closed deals it was anchored on, and the app says so above it: "based on 3 of your closed deals", or a general estimate while there are none.

**What comes back.** Every provider is called with structured outputs (Claude's `output_config.format` with a JSON schema; OpenAI's `response_format` with `strict: true`, which Gemini's OpenAI-compatible endpoint takes too), so the answer always has this shape, which the server checks again with Zod before saving:

```ts
{
  summary: string;                      // where the deal stands and why
  dealHealth: 'won' | 'hot' | 'warm' | 'cold' | 'stalled' | 'lost';
  actionPlan: { step: string; when: string; why: string }[];   // today to the next commitment, in order
  pricing: {                            // what to quote, whole amounts in the deal's currency
    setupFee: number;
    monthlyRetainer: number;            // 0 when not worth proposing
    hostingYearly: number;
    walkAwaySetupFee: number;           // the lowest setup fee to take; below it, cut scope
    scope: string[];                    // what the package includes
    rationale: string;                  // anchored on your closed deals, or says there is little to go on
    howToPresent: string;               // the words to say the price with
  };
  closingObjections: { objection: string; likelihood: 'high' | 'medium' | 'low'; why: string; response: string }[];
  wentWell: string[];                   // each tied to an entry, like "ניסיון 2: …"
  wentWrong: string[];
  mistakes: { mistake: string; evidence: string; fix: string }[];
  objections: { objection: string; status: 'resolved' | 'open'; response: string }[];
  openQuestions: string[];              // decision maker, budget, timing…
  tips: string[];                       // actions for this deal, not general advice
  nextCall: {
    goal: string;
    timing: string;
    inDays: number;                     // days from today to that contact: the dashboard's reminder
    script: { step: string; say: string }[];   // word for word
    fallbackMessage: string;                    // a message for you to send yourself if they don't pick up
  };
}
```

The server keeps the price with the deal's currency at the time. The plan, the price and the closing objections are checked on their own: if one comes back malformed, it's left out and the rest of the analysis is still saved (amounts are rounded to whole numbers, and a walk-away price above the price is brought down to it). Reports from before these fields simply don't show them. When a deal closes with no amounts written yet, its Details tab offers the recommended price in one click ("מילוי לפי ההמלצה"); amounts already written are never replaced.

The request body can set `language`: `auto` (the language of your notes), `he` or `en`. Each analysis is one API call: a few thousand input tokens for a lead with short notes, tens of thousands once you paste transcripts, and about 2,000 output tokens, so the cost depends on the model and on how much you've written. The route allows 40 analyses an hour and one at a time per lead. When the provider fails, the browser gets a message saying what to fix (a rejected key, an unknown model, a rate limit) and the server log gets the provider's own error.

The provider code is in `src/coach/providers.ts`: plain `fetch` calls, one function per API (Gemini goes through the same Chat Completions code as OpenAI, at its own address, with `max_tokens` and light thinking). To try another model or provider, change `AI_MODEL` or add a function there; the routes and the schema stay the same.

**Data from the previous version:** leads stored before this version have a `status` instead of a `stage` and can't be read by this schema. Empty the `leads` collection (or start a new database) and import them again.

## Nothing goes out to a lead

This CRM is for your eyes only. It never sends an email, a WhatsApp message, an SMS or a link to anyone: there is no email or SMS library in it, no messaging API it calls, and the WhatsApp link below can only read. The coach's "if they don't pick up" message is a draft you copy and send from your own phone. The Call, WhatsApp and Email buttons on a lead only open your phone's dialer, your WhatsApp or your mail app on that contact; nothing is filled in and nothing is sent for you.

Two tests keep it that way: `test/outbound-policy.test.ts` fails if the server gains a messaging library, calls a messaging API, or calls a WhatsApp method that can send anywhere outside the guard; `src/lib/outbound-policy.test.ts` in the frontend fails on any link that writes a message for you (`wa.me/…?text=`, `mailto:…?body=`, `sms:`).

## WhatsApp sync (read-only)

The server links to your WhatsApp the way WhatsApp Web does, as one of your linked devices, and mirrors your conversations with leads onto their timelines: one read-only entry per lead per day, shown as a chat, with voice notes downloaded and transcribed into the conversation. The AI coach and objection training read these chats like any other entry. Chats with anyone who isn't a lead are never stored; only the chat's id and its last message's id and time are kept (no text), so a lead you add later can pull in the conversation.

| Setting | Value |
| --- | --- |
| `WHATSAPP` | `on` to turn it on (off by default) |
| `WHATSAPP_AUTH_KEY` | 32 random bytes, from `openssl rand -base64 32`. Seals the linked device's keys in the database. Keep it with your other secrets: whoever has the keys and this value can read your WhatsApp. |
| `WHATSAPP_COUNTRY_CODE` | for lead numbers written without one: `972` turns 054… into 97254… (default 972) |
| `WHATSAPP_HISTORY` | `full` asks your phone for all of its history when linking; `recent` for the last few months |
| `WHATSAPP_VOICE_DAYS` | voice notes newer than this are downloaded and transcribed as they sync (default 30); older ones have a "Get and transcribe" button |

Then open the WhatsApp icon in the app's header, choose **Link with a QR code** (or a code typed on your phone), and on your phone go to Settings → Linked devices → Link a device. The link survives restarts. Unlinking from the app removes the server from your linked devices; mirrored conversations stay.

**How it can never send.** WhatsApp has no official API for reading your own chats, so this uses [Baileys](https://github.com/WhiskeySockets/Baileys), an open-source WhatsApp Web client, behind a guard in `src/whatsapp/guard.ts`. Four independent layers each stop a message on their own:

1. **Config.** The device is created invisible (never "online", so your phone keeps its notifications) and keeps no copy of messages, so it has nothing to resend.
2. **Method lock.** Every socket method that can send or change something (`sendMessage`, `readMessages`, `sendPresenceUpdate`, `chatModify`, `groupParticipantsUpdate`, `updateBlockStatus`, `rejectCall`, `sendNode`, `relayMessage`, `query`…) is replaced with one that throws. The rest of the server never gets the socket, only a facade of read-only lookups and requests to your own phone.
3. **Message lock.** Baileys passes every outgoing message through `patchMessageBeforeSending` before encrypting it. Ours throws for anything but a history request addressed to your own phone.
4. **Wire lock.** Baileys shows each frame to its logger just before writing it. The guard checks it against an allow list and, for anything else, makes the socket report itself closed to that one write, so the frame is never encrypted or sent. Before each connection, the guard pushes a test message frame through Baileys' real write path and checks that it stopped it; if it can't prove that (a future Baileys version, say), WhatsApp stays off.

The allow list is what any linked device needs to stay connected: the handshake, keep-alive pings, encryption keys, acknowledgements, delivery receipts (grey ticks, which WhatsApp Web sends too), decryption retries, and history requests to your own phone. Everything else is blocked: messages of any kind, read and played receipts (blue ticks), presence (online, typing, recording), calls, group changes, blocking, profile and privacy changes, and chat settings. Baileys sends a few harmless ones on its own (an "online" presence when your profile name syncs); those are held back quietly. An attempt to reach a lead stops the sync until you reconnect it, and the WhatsApp panel lists what the guard held back. `test/whatsapp-guard.test.ts` runs the real Baileys socket against a local WebSocket server and checks, frame by frame, what reaches it. Baileys is pinned to an exact version in `package.json`: upgrade it on purpose, and run `npm test` before deploying the upgrade.

**Matching chats to leads.** By phone number: the lead's number as typed (054-123-4567, +972…, 00972…) against the chat's. WhatsApp now hides some numbers behind privacy ids (`…@lid`); their phone numbers come from the ids WhatsApp sends alongside and from its own mapping. Two leads with the same number both get the chat. A new lead with an existing chat gets its recent history right away, and **Earlier WhatsApp messages** on a lead's timeline asks your phone for 50 more each time. Your phone has to be online to answer.

**Good to know.**
- WhatsApp's terms don't allow unofficial clients. Reading only (no messages, no automation toward contacts) keeps the risk low, but an account can still be restricted.
- Only one copy of the server can hold the link; a second one disconnects the first.
- It's an extra linked device, separate from any WhatsApp bot on the same number. Messages your bot sends to a lead appear as yours ("Me"), because they come from your number.
- Edits show as edited. A message deleted for everyone stays as "This message was deleted" without its text, and a deleted voice note's recording is removed too.

## Objection training

Flashcards for practising the objections prospects raise. A new deck starts with the 12 objections a web studio hears most on cold calls (`src/training/starter.ts`), so there is something real to practise from the first day; they stay in the deck, after the ones your prospects raised. The AI coach adds those from every lead's timeline: call transcripts and WhatsApp chats first (the prospect's own words), then your notes. `POST /api/training/generate` sends them in one request (about 160,000 characters, newest conversations first; phone numbers, emails and websites stay on the server), with structured output in this shape:

```ts
{
  cards: {
    key: string;          // stable id, like "price-too-high"; existing keys are passed in so cards keep theirs
    category: 'price' | 'timing' | 'trust' | 'need' | 'authority' | 'competition' | 'diy' | 'other';
    objection: string;    // as prospects say it, in their language
    insight: string;      // what usually sits behind it
    response: string;     // the answer to practise, spoken, under 60 words
    alternatives: string[];
    followUp: string;     // the question to ask right after
    sources: { entry: string; quote: string }[];   // "L3.E2" and the prospect's exact words
  }[];
}
```

Each entry in the prompt has a short ref (`L3.E2`: lead 3, entry 2), so every card cites where it was heard. The server maps refs back to leads and checks each quote against the entry it cites (most of its words must be there, since transcripts are messy); cards with no quote that checks out are dropped, so the deck holds only objections someone really raised. Cards are stored like this (`objection_cards`):

```ts
{
  id, key, category, objection, insight, response, alternatives, followUp,
  leadCount: number;      // leads that raised it, the deck's order
  mentions: number;
  sources: { leadId, leadName, interactionId, at, quote }[];
  myResponse: string;     // your own version, shown first when you practise
  practice: { box: 1-5, dueAt, reviews, lapses, lastGrade: 1-4 | null, lastReviewedAt };
  retired: boolean;       // no longer found; kept with its history
}
```

Refreshing the deck updates cards by key and keeps your answers and practice history; cards it no longer finds are retired, except the common objections, which stay (with `leadCount` 0 when none of your prospects raised them lately). The AI sees the deck's keys, so a common objection your prospects raise gets their words instead of a second card. Practice is spaced repetition with five Leitner boxes: box 1 comes back every session, then 1, 3, 7 and 14 days, counted in `APP_TIMEZONE` so a card due tomorrow is in tomorrow morning's warm-up. Missed sends a card back to box 1, hard keeps it where it is, good moves it up one box and easy two. Each refresh is one AI call; the route allows 10 an hour.

**Answers for each kind of business.** "It's too expensive" means one thing to a restaurant owner (the delivery apps already take their cut) and another to a lawyer, so the deck can be tailored to a niche: the answer to every card is rewritten in that niche's terms. A lead's niche is its campaign without the area ("מסעדות · טבריה" is "מסעדות"), and the training page lists your leads' niches to pick from, or takes one typed in. Tailoring is one AI call for the whole deck, with the niche's own evidence: how many of your leads are in it and where they stand, what deals in it closed for, and the objections those leads raised, quoted (never who said them). Each card gets the objection as an owner in that niche would say it, the answer, two alternatives, a follow-up question and what sits behind it; your own answer still comes first when you practise, and the general answer stays one click away.

| Route | |
| --- | --- |
| `GET /api/training/niches` | your leads' niches with lead counts, which are tailored and when, and which are being tailored now |
| `GET /api/training/variants?niche=מסעדות` | that niche's answers, and whether new ones are being written (`tailoring`), or why the last try failed (`error`, said once) |
| `POST /api/training/variants` | `{ niche, language }` starts tailoring and answers 202 at once: the AI call runs in the background, since a whole deck can take longer than a proxy waits (Vercel's limit is 2 minutes). The app checks `GET /variants` every few seconds until it's done. 20 an hour. |

Answers are stored per niche and card (`objection_variants`) and replaced when the niche is tailored again; cards added to the deck later show the general answer until then. The practice links on a lead's profile and the Daily 10 warm-up (when most of the day's calls are to one niche) choose the niche, start practising, and have it tailored first if it isn't yet.

## The Prospector: finding new leads

The Prospector page finds local businesses by niche and area ("מוסכים" in "עפולה"), checks each one's website, and scores how much it needs a new one, from 1 to 5. You pick the 4s and 5s and import them: they become leads at Cold Call, in the pool the Daily 10 is drawn from.

**How a search runs** (`src/prospector/`, in the background, so you can leave the page):

1. **Discovery.** One request to SerpApi's Google Maps engine (or Google Places Text Search) for "<niche> ב<area>", 20, 40 or 60 businesses (Google stops at 60 a query, 20 a page). When the first can't search, the other takes over (below). Each comes back with its name, phone, website, address, category, rating and Google Maps link. Permanently closed businesses are dropped; temporarily closed ones are marked. Businesses whose phone or website is already a lead are marked "כבר ב-CRM".
2. **The website check.** Each homepage is fetched once, like a phone visitor would see it: redirects followed, Hebrew legacy encodings (windows-1255) decoded, at most 1.5 MB. Branches of a chain that share a website are checked once, and a site checked in the last 14 days is reused. With `PROSPECTOR_CHROME_PATH`, a headless Chrome also opens the page at phone size (390 px), takes a screenshot, and measures whether the layout spills past the screen and when the main content appears.
3. **Signals.** Cheerio reads the page: viewport tag, HTTPS, load time, the platform and its version (WordPress 4.9, Wix, Next.js, Framer, Webflow…), signs of age (table layouts, frames, Flash, old jQuery, windows-1255), the copyright year, click-to-call and WhatsApp buttons, a contact form, an accessibility statement (required of Israeli sites), a privacy policy, images and meta tags.
4. **The need score.**
   - **5, decided without AI:** no website on the listing; a "website" that is only a Facebook, Instagram, Linktree or WhatsApp page, a directory listing or an ordering platform; or a site that doesn't work (dead domain, refused connection, certificate error, 404, server errors, a parked or "for sale" domain, a builder's expired-site page, an empty page).
   - **1 to 4, by the AI:** the signals, the page's visible text and the screenshot go to the coach's provider with a rubric: 4 extremely outdated or not made for phones, 3 working but dated or missing basics, 2 decent, 1 premium and modern. It answers with structured output: the score, a one-line verdict, the reasons (each something you can check by opening the site) and an opening line for the call. A site without a phone viewport never scores below 4.
   - **Without AI** (`PROSPECTOR_AI=off`, no AI key, or the AI failing), working sites are scored by the signals alone, with Hebrew reasons.
   - A site that turns the check away (bot protection) gets no score rather than a guess, and **בדיקה חוזרת** (check again) runs any business's check again.
5. **Import.** `POST /api/prospector/import` creates the leads with the campaign "<niche> · <area>", the score and opening line as "how to talk to them", and the whole analysis as the first timeline note, which the AI coach reads when you prep the call. A business whose phone or website is already a lead is skipped (two branches with one website become one lead). Today's queue tops up if it's short.

| Setting | Value |
| --- | --- |
| `SERPAPI_KEY` | a key from [serpapi.com](https://serpapi.com): its Google Maps engine returns the businesses with their details. The free plan has 250 searches a month, without a card. |
| `GOOGLE_PLACES_API_KEY` | a Google Cloud API key with **Places API (New)** enabled (and billing on the project), alone or as SerpApi's backup. Restrict the key to that API. |
| `PROSPECTOR_PROVIDER` | which one searches first when both keys are set: `serpapi` (the default) or `google` |
| `PROSPECTOR_FALLBACK` | `on` (default): with both keys, the other provider takes over when the first can't search. `off`: only the first is ever used. |
| `PROSPECTOR_CHROME_PATH` | optional: a Chrome or Chromium executable for phone screenshots and layout checks. Without it, sites are judged from their HTML. |
| `PROSPECTOR_AI` | `on` (default) scores working sites with the AI coach's provider (`AI_PROVIDER`, `AI_API_KEY`); `off` uses the signals alone |
| `PROSPECTOR_AI_MODEL` | optional: another model for scoring, such as a cheaper one, from the same provider |
| `PROSPECTOR_RETENTION_DAYS` | how long search results are kept, 1 to 30 (default 30). Imported leads stay. |
| `PROSPECTOR_LANGUAGE`, `PROSPECTOR_REGION` | the language of names and categories from Google (`he`) and the country searched (`IL`) |
| `WHATSAPP_COUNTRY_CODE` | also used to match phone numbers against your leads (default 972) |

**When SerpApi runs out: the backup.** With both keys, SerpApi searches first, and Google Places takes over by itself whenever SerpApi can't: its month's searches are used up, its key is refused, it's down or slow, or it found nothing. It happens mid-search too: if SerpApi runs out on the second page, Google Places fills in the rest, and since both read the same Google Maps listings (the same place ids), no business is added twice. The search page says so in one quiet line ("נגמרו החיפושים בחבילת SerpApi החודש. את שאר העסקים מצא Google Places."), and the search records which provider found its businesses (`provider`, `fallbackFrom`, `notice`).

- Before each search, the server asks SerpApi's [Account API](https://serpapi.com/account-api) how many searches are left this month (free, not counted as a search, asked at most once a minute). With none left, it goes straight to Google Places without a wasted request, and back to SerpApi as soon as the plan renews. The search page shows the count ("נשארו 182 מתוך 250 בקשות החודש"; a search of 60 businesses is 3 requests).
- A provider that failed rests before it's tried again: 15 minutes after running out, 30 after a refused key, 2 after being down.
- With SerpApi alone, a search it can't run says when the searches renew and how to keep going meanwhile. A search it stops partway keeps what it found and says so.
- Why not an AI as the backup: Gemini's free tier can't search Google, and without search an AI makes up businesses and phone numbers, which would mean calling strangers. With search grounding (paid), Google's terms don't allow storing the results as a list. Both providers here return real listings.

**Getting a Google key.** In the [Google Cloud console](https://console.cloud.google.com), create a project, link a billing account, enable **Places API (New)** (not the legacy Places API), and create an API key under **APIs & Services → Credentials**. Restrict it to Places API (New), and to your server's IP if it has a fixed one. The key stays on the server.

**What it costs** (check current prices before relying on them): the search asks only for the fields it needs, but phone and website put each request in Google's Text Search Enterprise tier, about US$35 per 1,000 requests after a monthly free allowance of 1,000. A search for 20 businesses is one request and one for 60 is three, so a weekly batch of 40 to 60 businesses costs well under a dollar. SerpApi's free plan covers 250 searches a month, each 20 results. Scoring is one AI call per working website, with a screenshot when Chrome is on: a few thousand tokens each. Searches are limited to 15 an hour.

**Read-only, like everything else.** The Prospector never contacts a business. Outside this server it does three things: the search request to SerpApi or Google (and SerpApi's Account API, a GET), plain GET requests for each business's homepage, and the AI call.

- `src/prospector/net.ts` only ever sends `GET`, only to http(s) on the standard ports, and checks every address (including after each redirect, and at connect time, so DNS can't be used to slip past) against private and internal networks.
- Chrome runs with all its traffic through a filtering proxy (`proxy.ts`) that allows only GET and HEAD to public addresses. In the page, anything else (form posts, beacons, pings) and known trackers are aborted, nothing is clicked or typed, dialogs are dismissed and pop-ups closed. Each check gets a fresh browser profile.
- Phone numbers and email addresses on a page are replaced with `[phone]` and `[email]` before its text goes to the AI. The AI never gets the business's phone number.
- `test/outbound-policy.test.ts` fails if any Prospector file but the search client sends a POST, if the page fetcher uses another method, if the browser code calls an interaction API, or if the proxy loses its GET/HEAD check.

**Good to know.**
- Google's terms let an app keep a place's id indefinitely but other Places content only briefly, so search results (names, phones, ratings, screenshots) are deleted after `PROSPECTOR_RETENTION_DAYS` (30 at most), checked every six hours. Leads you import keep the name, phone and website as your own records; whether that fits your use is for you to judge against [Google's policies](https://developers.google.com/maps/documentation/places/web-service/policies).
- A search survives a restart: unfinished searches pick up where they stopped.
- The "need" is about the website, not the business: a busy business with no site (many Google reviews, no website) is exactly the 5 worth calling.

## MongoDB Atlas

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. Under **Database Access**, add a database user with a password.
3. Under **Network Access**, allow your host. Render and most hosts don't have fixed outgoing IPs on their basic plans, so that usually means `0.0.0.0/0`; the database password still protects it.
4. Under **Connect → Drivers**, copy the connection string and add the database name before the `?`:

   ```
   mongodb+srv://omek:<password>@cluster0.abcde.mongodb.net/omek_leads?retryWrites=true&w=majority
   ```

   If the password contains characters such as `@`, `:` or `/`, URL-encode them (`@` becomes `%40`). The server stops at startup with a clear message when the database name is missing.

5. Put the string in `DATABASE_URL` and run `npm run db:push` once to create the indexes.

## Connecting the frontend

`VITE_API_URL` is baked into the frontend when it's built, so set it before `npm run build` (locally in `.env`, or as an environment variable on your host).

| Where the frontend lives | `VITE_API_URL` | Server settings |
| --- | --- | --- |
| Served by this server (recommended) | `/api` | none |
| On Vercel, which forwards `/api` to this server ([below](#deploy-the-app-on-vercel-the-server-on-render)) | `/api` | `CORS_ORIGINS=<the Vercel address>` |
| Its own subdomain, e.g. `crm.omek.co.il` with the API on `api.omek.co.il` | `https://api.omek.co.il/api` | `CORS_ORIGINS=https://crm.omek.co.il` |
| An unrelated domain, e.g. `*.vercel.app` with the API on `*.onrender.com` | the API's full URL + `/api` | `CORS_ORIGINS=<frontend origin>` and `COOKIE_SAMESITE=none` |

The last setup depends on third-party cookies, which Safari (and every iPhone browser) blocks, so sign-in won't stick there. Use one of the others.

When this server finds a frontend build at `FRONTEND_DIST` (default `../dist`), it serves it with long-lived caching for the hashed files and sends every non-API path to `index.html`.

## Deploy (one service on Render)

1. Create the Atlas cluster above.
2. Create a Web Service from the repository, with the repository root as its root directory.
   - Build command: `npm ci --include=dev && npm run build && cd server && npm ci --include=dev && npm run build && npm run db:push -- --skip-generate`
   - Start command: `cd server && npm start`
   - Health check path: `/api/health`
3. Add these environment variables:

   | Name | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | your Atlas string, with the database name |
   | `ADMIN_EMAIL` | the email you sign in with |
   | `ADMIN_PASSWORD_HASH` | the line from `npm run hash-password` on your machine |
   | `TRUST_PROXY` | `1` |
   | `APP_TIMEZONE` | `Asia/Jerusalem` |
   | `VITE_API_URL` | `/api` |
   | `AI_PROVIDER`, `AI_API_KEY` | to turn on the AI coach |
   | `TRANSCRIBE_API_KEY`, `TRANSCRIBE_LANGUAGE` | an OpenAI key and `he`, to transcribe recordings |
   | `WHATSAPP`, `WHATSAPP_AUTH_KEY` | `on` and a key from `openssl rand -base64 32`, to mirror WhatsApp chats with leads |
   | `GOOGLE_PLACES_API_KEY` | to turn on the Prospector |
   | `MEDIA_STORAGE` | `s3`, with `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, because Render's disk doesn't survive a deploy |

4. Deploy, open the service URL and sign in.

`--include=dev` matters: with `NODE_ENV=production`, npm skips devDependencies, and the build needs TypeScript, Vite and the Prisma CLI. Railway and Fly work the same way.

Render's native Node runtime has no Chrome, so leave `PROSPECTOR_CHROME_PATH` empty there (websites are judged from their HTML, without screenshots), or deploy with a Docker image that installs Chromium and point the variable at it.

The WhatsApp sync works best with the server running all the time. A free Render instance sleeps when idle: messages that arrived meanwhile are picked up when it wakes, but a server that is rarely up can miss some, and WhatsApp unlinks devices that stay away too long. Run one instance only: a second copy of the server would take the link from the first.

## Deploy: the app on Vercel, the server on Render

Vercel can host the app's pages but not this server: the WhatsApp sync, the transcript queue and Prospector searches keep working between requests, and recordings are larger than a Vercel Function accepts (4.5 MB). So the server runs on Render (Railway and Fly work too), and `vercel.json` at the repository root has Vercel forward every `/api` request to it. To the browser it's one site, so the sign-in cookie stays first-party and works in Safari too.

1. Push the repository to GitHub (a private repository). The `.gitignore` files keep `node_modules`, builds and both `.env` files out.
2. Create the Atlas cluster above.
3. On Render, create a Web Service from the repository:
   - Root directory: `server`
   - Build command: `npm ci --include=dev && npm run build && npm run db:push -- --skip-generate`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Environment: the variables from [the one-service deploy](#deploy-one-service-on-render) except `VITE_API_URL`, plus `CORS_ORIGINS` set to your Vercel address (`https://omek-leads.vercel.app`, or your own domain). Requests reach the server through Vercel, so this is how it knows the page they come from is yours. Without it, signing in fails with "בקשות מהאתר הזה לא מורשות."
4. `vercel.json` forwards `/api` to `https://lead-nkeo.onrender.com`. If your Render address is different, change it there, in both places (the rewrite and `connect-src`), and push.
5. On Vercel, import the repository, leave the root directory as it is (it detects Vite), and add the environment variable `VITE_API_URL` = `/api`. Deploy, open the address and sign in.

Use `/api`, not the Render address, for `VITE_API_URL`: through Vercel the browser sees one site, so the sign-in cookie is first-party. With the Render address the cookie becomes a third-party cookie, which Safari and iPhones refuse, and the server would also need `COOKIE_SAMESITE=none`. (`connect-src` lists the Render address too, so that setup isn't blocked outright; it is just the fragile one.) After changing `VITE_API_URL`, redeploy on Vercel: Vite writes it into the build.

`vercel.json` also gives the pages the security headers this server would send them (a Content Security Policy, frame blocking, no sniffing) and tells Vercel never to cache anything under `/api`. Sign in on the production address: preview deployments get addresses of their own, which `CORS_ORIGINS` doesn't list.

Two limits come with Vercel in front. A request through it can take at most 2 minutes, so uploading a very long Zoom video over a slow connection may fail. And a free Render instance still sleeps when idle, so the first request after a break takes a while. The app handles that wait: it opens on the copy it keeps on the device, and changes made meanwhile are kept and sent once the server answers (Vercel's 502s while it wakes count as "try again"). See [On your phone](../README.md#on-your-phone).

The app installs on a phone from the same address (`public/manifest.webmanifest`, and `public/sw.js`, which keeps the app's own files so it opens with no signal; it never touches `/api`). `vercel.json` serves both with `Cache-Control: no-cache`, so a new deploy reaches installed phones the next time they open with a connection.

## Security

- **One account.** The email and an scrypt password hash live in environment variables. There is no sign-up route.
- **Session cookie.** Signing in sets an httpOnly cookie that page scripts can't read. In production it is `Secure`, `SameSite=Lax` and `__Host-` prefixed. The database stores only a SHA-256 hash of each session token, so a leaked database can't be used to sign in. Sessions last a year (`SESSION_TTL_DAYS`, 365 by default) and renew while you use the app, so you stay signed in on your phone like in any app; signing out deletes them.
- **Brute force.** 10 failed sign-ins per 15 minutes per IP. Every request is also capped at 1,500 per 15 minutes per IP.
- **Cross-site requests.** Writes whose `Origin` isn't this site (or a `CORS_ORIGINS` entry) are refused, on top of the SameSite cookie. CORS stays off unless you set `CORS_ORIGINS`.
- **Input.** Zod validates every body and URL parameter. Unknown fields, wrong types and out-of-range values get a 400. Bodies are capped at 100 kB, 512 kB for notes and transcripts, or 2 MB and 500 leads for a bulk import. Because Prisma builds every query, request JSON never reaches MongoDB as a query operator.
- **Uploads.** Only signed-in requests reach Multer, and only after the lead is found. One file per request, recordings only (extension and type both checked), up to `MAX_UPLOAD_MB`. Stored names are server-made UUIDs, never the uploaded name. Playback needs the session, is served `inline` with `sandbox` and `nosniff`, and S3 links are signed and expire in 15 minutes.
- **AI.** Only the fields listed under [The AI sales coach](#the-ai-sales-coach) leave the server, the key stays on the server, and the coach route is limited to 40 calls an hour (deck refreshes to 10).
- **Outbound.** Nothing is ever sent to a lead; see [Nothing goes out to a lead](#nothing-goes-out-to-a-lead).
- **Prospector.** Website checks only read, through a GET-only fetcher and proxy that refuse private and internal addresses (so a business's listing can't point the server at itself or your network), with size and time limits. Screenshots are served only to the signed-in owner, and searches are limited to 15 an hour.
- **WhatsApp keys.** The linked device's credentials and keys are sealed with AES-256-GCM under `WHATSAPP_AUTH_KEY`, each bound to its own id, so the database alone can't be used to read your WhatsApp. Download details for voice notes stay on the server; the browser only learns whether it can ask for one.
- **Transcripts.** Recordings are sent to OpenAI (or your `TRANSCRIBE_BASE_URL`) to be transcribed; leave the key empty if they must stay on your server. ffmpeg only ever processes files uploaded by the signed-in owner, in a temporary folder that is deleted afterwards.
- **Headers.** Helmet sets a Content Security Policy, HSTS (production), `nosniff` and frame blocking. API responses are `Cache-Control: no-store`.
- **Errors.** Clients get a plain message, and stack traces stay in the server log. Request logs never include bodies.
- **Local database.** `docker-compose.yml` publishes MongoDB on 127.0.0.1 only, because it has no password.

To sign out everywhere, delete the documents in the `sessions` collection (`npm run db:studio` opens a browser view of the data).

## API

All routes are under `/api` and speak JSON (uploads are multipart). Everything except `/health` and `/auth` needs the session cookie.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | | `{ "status": "ok" }` after pinging the database |
| POST | `/auth/login` | `{ email, password }` | `{ email }` and the session cookie |
| GET | `/auth/session` | | `{ email }`, or 401 when signed out |
| POST | `/auth/logout` | | 204 |
| GET | `/features` | | `{ coach, media, transcription, whatsapp, prospector }`: what is turned on, or why it is off |
| GET | `/leads` | | `Lead[]`, newest first |
| POST | `/leads` | `Lead`, with optional `notes: [{ id, body, createdAt }]` | 201 `Lead` (409 if the id exists); the notes go on its timeline |
| POST | `/leads/bulk` | `{ leads: Lead[] }`, up to 500 | 201 `{ created: Lead[], skippedIds: string[] }` |
| POST | `/leads/bulk-delete` | `{ ids: string[] }`, up to 500 | 204, with their timelines, recordings and reports |
| PATCH | `/leads/:id` | changed details only; `deal: { setupFee?, monthlyRetainer?, hostingYearly? }` changes just the amounts sent | `Lead` (409 for amounts or a currency before the deal is closed) |
| POST | `/leads/:id/actions` | `{ id, type, from, body?, channel?, at? }` | `Lead` after the step, which is also logged on the timeline (409 when it isn't allowed). `at`: when it happened, for a step logged on a phone without a connection and sent later; kept within the last week, never before the lead's latest step or after now. The same `id` twice is applied once |
| POST | `/leads/:id/actions/:actionId/undo` | | `Lead` (409 after 10 minutes or if it isn't the latest step) |
| DELETE | `/leads/:id` | | 204, also when it was already gone |
| GET | `/leads/:id/timeline` | | `{ interactions, media, coaching }`: entries and recordings newest first, and the latest report |
| POST | `/leads/:id/interactions` | `{ id, kind: note \| whatsapp \| email, body, at? }` | 201 `Interaction` |
| PATCH | `/leads/:id/interactions/:interactionId` | `{ body, expectedUpdatedAt? }` | `Interaction` (409 if it changed after `expectedUpdatedAt`) |
| DELETE | `/leads/:id/interactions/:interactionId` | | 204 (409 for an entry that records a step, or a mirrored WhatsApp chat) |
| POST | `/leads/:id/media` | multipart: `file`, `interactionId?` | 201 `Media`, its transcript queued (413 too large, 415 not a recording) |
| GET | `/leads/:id/media` | | `Media[]` with each transcript's progress |
| POST | `/media/:mediaId/transcribe` | | 202 `Media`, transcribed again from scratch (409 while one is running, 503 when transcripts are off) |
| GET | `/media/:mediaId/file` | | the recording, with range support (or a redirect to a signed S3 link) |
| DELETE | `/media/:mediaId` | | 204 |
| POST | `/leads/:id/coaching` | `{ language?: auto \| he \| en }` | 201 `CoachingReport` (503 when the coach is off, 502 when the AI fails) |
| GET | `/daily` | | `{ date, startsAt, endsAt, leadIds, poolSize, quota }`, drawn on the first request of the day |
| GET | `/dashboard` | | `{ pulses }`: for each lead in play, its last timeline entry and last Zoom (time, kind, outcome) and the gist of its latest deal analysis (health, next contact and in how many days, first step, recommended price). No contact details. |
| GET | `/whatsapp` | | the link's state, the guard's report and the sync's progress (or `{ enabled: false, reason }`) |
| POST | `/whatsapp/link` | `{ phone? }` | starts linking: a QR code, or a pairing code for `phone` (409 when already linked) |
| POST | `/whatsapp/reconnect` | | after the guard or WhatsApp stopped the link |
| POST | `/whatsapp/unlink` | | removes this server from your linked devices; mirrored chats stay |
| POST | `/leads/:id/whatsapp/history` | | 202: asked your phone for older messages with this lead (409 with the reason when it can't) |
| POST | `/leads/:id/whatsapp/voice/:messageId` | | 202: downloads and transcribes an older voice note |
| GET | `/training` | | `{ run, cards }`: the objection deck and the analysis that built it |
| POST | `/training/generate` | `{ language?: auto \| he \| en }` | 201 `{ run, cards }` (503 without the AI coach, 409 with nothing to learn from yet) |
| POST | `/training/cards/:id/review` | `{ grade: 1-4, at? }` | the card with its next review. `at`: when you answered (practice done offline); the same answer with the same `at` counts once |
| PATCH | `/training/cards/:id` | `{ myResponse }` | the card |
| GET | `/training/niches` | | `{ niches: [{ key, label, leads, tailored }], tailoring }` |
| GET | `/training/variants?niche=` | | `{ niche, variants, updatedAt, tailoring, error }`: the deck's answers for that niche |
| POST | `/training/variants` | `{ niche, language? }` | 202 the same, with `tailoring: true`: the answers are written in the background (503 without the AI coach) |
| GET | `/prospector` | | `{ enabled, provider, backup, providers, browser, ai, retentionDays, searches }` (or `{ enabled: false, reason }`). `providers` gives each one's state (`ready`, `exhausted`, `resting`) and SerpApi's searches left this month. |
| POST | `/prospector/searches` | `{ niche, location, limit: 20 \| 40 \| 60, language? }` | 202: the search, running in the background (15 an hour) |
| GET | `/prospector/searches/:id` | | `{ search, prospects }`: counts by score, and each business with its check so far |
| POST | `/prospector/searches/:id/cancel` | | the search, stopped |
| DELETE | `/prospector/searches/:id` | | 204: the search, its results and screenshots (imported leads stay) |
| POST | `/prospector/prospects/:id/recheck` | | 202: checks that business's website again (409 while it's being checked) |
| GET | `/prospector/prospects/:id/screenshot` | | the homepage as a phone shows it (JPEG) |
| POST | `/prospector/import` | `{ ids }`, up to 100 | 201 `{ created: Lead[], skipped: [{ id, reason, leadId? }] }` |

The frontend creates ids (UUIDs) and timestamps, so an item shows up at once and a retried request can't create a duplicate. A bulk import writes each batch with one `insertMany`, and ids the database already has come back in `skippedIds` rather than failing the batch. The frontend sends imports in batches of 100. Errors look like `{ "error": { "message": "…", "issues": [{ "path": "leads.3.email", "message": "…" }] } }`.

## Data model

- `leads`: one document per lead, `_id` set to the client's UUID, with its activity embedded (every step, newest first, with what it replaced so it can be undone) and its deal terms embedded as `deal: { setupFee, monthlyRetainer, hostingYearly }` (a composite type, all zero until the deal closes; leads stored before it may still carry the old `value` instead, which is read as the setup fee and removed when the amounts or the stage are next saved). The list view loads in one read.
- `interactions`: the timeline, one document per call, meeting, message or note, indexed by lead and time. Kept out of the lead document so long transcripts don't slow down the list.
- `media`: one document per recording (lead, optional timeline entry, file name, type, size, storage key, and its transcript job: status, parts, attempts, error, text, word count). The files themselves are on disk or in S3.
- `coaching_reports`: every analysis, with the provider, model and how many entries it read. The newest one is shown, and the dashboard reads each lead's newest one for its health, next contact and price.
- `daily_queues`: one document per day, holding the lead ids drawn for it. Each lead's outcome for the day is read from its activity, so working a lead anywhere in the app counts.
- `sessions`: sign-in sessions, holding only token hashes, with a unique index on the hash.
- `interactions` also holds mirrored WhatsApp conversations: `source: "whatsapp"` and `chat`, the day's messages (sender, time, type, text, voice note recording and transcript), with `body` holding the same conversation as text for the coach. Their ids are `wa-<lead>-<day>`.
- `whatsapp_chats`: every chat seen on the linked phone, by id, with its number and last message's id and time. Never any text.
- `whatsapp_auth`: the linked device's credentials and keys, each sealed with `WHATSAPP_AUTH_KEY`.
- `objection_cards` and `training_runs`: the objection deck (see [Objection training](#objection-training)) and each analysis that built it.
- `objection_variants`: the deck's answers tailored to a niche, one per niche and card (unique on both).
- `prospect_searches` and `prospects`: Prospector searches and the businesses they found, each with its website check embedded (status, site state, score, verdict, reasons, opening line, signals and screenshot key). A search records which provider found its businesses and, when the backup took over, from which one and why. Deleted after `PROSPECTOR_RETENTION_DAYS`.

## Project layout

```
server/
  prisma/schema.prisma        Lead, Interaction, Media, CoachingReport, DailyQueue, Session, WhatsAppChat, WhatsAppAuth, ObjectionCard,
                              ObjectionVariant, TrainingRun, ProspectSearch, Prospect
  src/
    index.ts                  starts the server, shuts down cleanly on SIGTERM
    app.ts                    middleware order and routes
    config.ts                 reads and checks environment variables at startup
    db.ts                     the Prisma client
    services.ts               opens recording storage and the AI provider from the settings
    stores/
      types.ts                store interfaces (leads, timeline, media, coaching, daily, sessions)
      prisma.ts               MongoDB through Prisma
      memory.ts               in-memory version, for tests and STORAGE=memory
      legacy.ts               turns pre-timeline data into timeline entries
      index.ts                opens the configured one
    auth/                     sign-in routes, sessions, requireAuth
    leads/                    routes, Zod schemas, and workflow.ts (the funnel rules)
    timeline/                 the lead profile: timeline, notes and messages
    media/                    Multer upload checks, local and S3 storage, playback and transcript routes
    transcription/            ffmpeg (audio, pauses, parts), the OpenAI client, the pipeline, the background queue
    coach/                    the deal analysis: schema, prompt, price history (pricing.ts), the Anthropic, OpenAI and Gemini calls, the route
    dashboard/                what the dashboard needs per lead: last touch and the latest analysis's gist
    training/                 the objection deck: the starter cards, prompt, schema, quote checks, spaced repetition, routes,
                              niches (niche.ts, shared with the app) and answers tailored to them (tailor.ts)
    whatsapp/
      guard.ts                the read-only guard: allow list, the four locks, the self-test (no Baileys import)
      link.ts                 the connection: linking, reconnecting, unlinking, the read-only facade
      sync.ts                 chats to timelines: matching leads, day entries, edits, voice notes, history
      chat.ts                 WhatsApp messages as timeline lines and text
      auth-state.ts           the linked device's keys in the database; auth-key.ts seals them
      phone.ts                lead numbers as WhatsApp numbers
      service.ts, index.ts    what the routes see; loads Baileys only when WHATSAPP=on
      whatsapp.routes.ts      status, link, unlink, history and voice note routes
    prospector/
      discovery.ts            SerpApi and Google Places (New) searches, and why one failed (quota, key, down, rejected)
      fallback.ts             one provider after the other: the backup taking over, rests, SerpApi's Account API
      engine.ts               runs searches in the background: discovery, checks, scoring, resume, clean-up
      net.ts, proxy.ts        the GET-only page fetcher and the browser's filtering proxy (no private addresses)
      browser.ts              headless Chrome at phone size: screenshot, overflow and load time (puppeteer-core)
      site.ts, signals.ts     what isn't a website or doesn't work, and the signals a page shows
      score.ts                the rules score, the AI rubric and its schema, contact redaction
      importer.ts             businesses to leads: matching existing leads, the campaign and the first note
      prospector.routes.ts    searches, results, re-checks, screenshots and import
    daily/                    the daily draw and time-zone days
    middleware/               security headers, CORS, origin check, rate limits, errors, logging
    frontend.ts               serves the built Vite app
  scripts/hash-password.ts    creates ADMIN_PASSWORD_HASH
  scripts/migrate-timeline.ts one-time upgrade for data from before the timeline
  test/                       API, prompt, provider, transcription, WhatsApp guard and sync, training, Prospector and outbound-policy tests
                              (real ffmpeg, a real Baileys socket and, when it's installed, real headless Chrome against local
                              stand-in websites; the AI, OpenAI, Google and WhatsApp's servers are stand-ins)
```

Routes only talk to the store interfaces, so moving to another database means writing one more file in `stores/`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and restarts it on changes |
| `npm run build` | Generates the Prisma client and compiles to `dist/` |
| `npm start` | Runs the compiled server |
| `npm test` | API tests on in-memory stores, or on MongoDB when `TEST_DATABASE_URL` is set (that database is emptied first, so its name must end in `_test`) |
| `npm run db:push` | Creates collections and indexes from `schema.prisma` (MongoDB has no migrations) |
| `npm run db:studio` | Opens Prisma Studio to browse the data |
| `npm run hash-password` | Hashes a password for `ADMIN_PASSWORD_HASH` |
| `npm run migrate:timeline` | Once, after upgrading: turns older leads' steps and notes into timeline entries |
