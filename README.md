# Omek Leads

The studio's sales workflow: a home screen with the headline numbers (every lead, the new ones today, the closed deals, revenue and monthly retainers, all updating the moment something changes), the money expected in the next 30 days, the open deals and what needs doing; a table of every lead to search, filter, sort and export to Excel, or a board of them by status (new, contacted by phone, WhatsApp sent, quote, client), with one-tap call notes and WhatsApp with a ready message, a daily quota of 10 cold calls drawn from weekly lead batches, a strict funnel from outreach to quote to closed deal, a timeline of every call, meeting and WhatsApp conversation with recordings and automatic transcripts, an AI deal analysis with a plan of action, a recommended price and the objections to expect before the closing call, objection flashcards built from your own calls and tailored to each kind of business, a Prospector that finds local businesses whose website needs replacing (SerpApi, with Google Places taking over when it runs out), and what closed deals bring in: setup fees, monthly retainers (MRR) and yearly renewals.

The interface is in Hebrew and runs right to left, in professional Hebrew sales terms: חדש, נוצר קשר, נשלח וואטסאפ, הצעת מחיר, נסגר / לקוח, העשירייה היומית. On a phone it installs on the home screen like an app, opens with no signal, and keeps everything you write until the server has it (see [On your phone](#on-your-phone)).

It's an internal tool: it never sends an email, a WhatsApp message, an SMS or a link to a lead by itself. **וואטסאפ** opens WhatsApp on your own phone or computer (a `wa.me` link) with a message ready to edit, and you press send there; the server has no WhatsApp connection at all, and every other outgoing path is blocked in code and checked by tests (see [server/README.md](server/README.md#nothing-goes-out-to-a-lead)).

The frontend is React 19, TypeScript, Vite, Tailwind CSS 4, Motion (formerly Framer Motion), Zustand, TanStack Table, Radix Dialog, cmdk and Lucide icons, with fflate for writing Excel files. The backend in `server/` is Express 5, Prisma 6 and MongoDB (Atlas in production), where every lead, deal, retainer and timeline entry is written the moment it changes.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # funnel rules, daily draw, timeline, palette search, practice schedule, import, Prospector, offline outbox and outbound-policy tests
npm run build      # type-checks, then builds to dist/
```

Needs Node 20.19+ or 22.12+ (22.12+ if you also run the server).

Without a backend, leads are saved in the browser (recordings in IndexedDB) and the app opens with 20 sample leads across six campaigns, with their timelines, marked as samples. הדר נדל"ן also has a sample AI analysis, בית הבד ארבל a mirrored WhatsApp chat with a transcribed voice note, Training the starter deck of common cold-call objections, and the Prospector an example search with made-up businesses (marked "דוגמה") that you can import, so you can try everything without a server. **הסרת הלידים לדוגמה** clears the sample leads without touching leads you added. The AI coach and Prospector searches need the server: API keys must never reach a browser. A line at the top says so ("זו תצוגה מקדימה, בלי שרת") and links to the app that's connected (`liveUrl` in `src/config.ts`), so this preview is never taken for it.

To store leads in MongoDB, follow [server/README.md](server/README.md). In short: start the server, then set `VITE_API_URL=/api` in `.env`. There is no sign-in: the app opens straight on the home screen, for anyone who can reach its address (see [server/README.md](server/README.md#no-sign-in)).

To put it online, either run everything as [one service on Render](server/README.md#deploy-one-service-on-render), or host the app on Vercel with the server on Render: `vercel.json` forwards `/api` to the server ([steps](server/README.md#deploy-the-app-on-vercel-the-server-on-render)).

## On your phone

The app is built for calling from a phone: the views sit in a bar along the bottom, within reach of your thumb, with **ליד חדש** just above it.

- **Install it.** Open the app's address on the phone. On an iPhone: in Safari, the Share button, then **Add to Home Screen** (הוספה למסך הבית). On Android: Chrome's menu, then **Install app** (or Add to Home screen). It opens full screen from its own icon, and on Android a long press on the icon offers **השיחות של היום** and **ליד חדש**. A new version shows by itself the next time it opens with a connection.
- **No signal, or a server still waking up.** The app keeps a copy of what it last loaded on the phone: the leads, today's calls, the dashboard, the practice deck and the timelines you opened lately. It opens on that copy at once, even with no connection or while a free Render server takes its minute to wake up: a small copy of the leads (in localStorage) is on the screen from the first frame, and the full one (in IndexedDB) takes its place a moment later. If the server takes more than a moment, a line at the top says so until it answers.
- **Nothing you write is lost.** Every change is kept on the phone first and then sent: calls and meetings logged with their outcome and notes, notes and messages, edits to a lead's details and deal, deletions, undo, and practice answers. Without a connection (or while the server doesn't answer) they wait, and go by themselves when it's back, in the order you made them and with the time each happened, so a call logged in the car at 10:05 shows at 10:05. They survive the app being closed or the phone restarting. The cloud icon at the top shows how many are waiting; tap it for the list and **לשלוח עכשיו**. If the server refuses one (the lead was deleted on another device meanwhile), it's taken back on screen with the reason and a button to copy what you wrote.
- **Drafts.** Whatever you're typing is kept on the phone until it's saved: the composer on a lead's timeline, the new-lead form, edits to an entry, your own practice answers and an import you pasted. A detail field you were typing in (the strategy, a phone number) saves itself when you leave the app, for example to make a call.
- **What needs a connection**: the AI coach (deal analysis, tailored answers, building the deck from your calls), the Prospector, uploading recordings, and imports. Exporting to Excel works offline.
- **No sign-in.** The app opens straight on the home screen, with no email, password or code, and the leads are always there: the browser is asked to keep the app's storage even when the phone runs low on space.

## What it does

- **Home (בית)**, the page the app opens on:
  - **The headline numbers**: **סך הלידים** (with how many are active and how many not relevant), **לידים חדשים היום** (and yesterday, and the last 7 days), **עסקאות שנסגרו** (this month, and how many wait on a quote), **סך ההכנסות** (the setup fees of the closed deals) and **ריטיינרים** (the monthly retainers coming in, MRR, and what that makes a year). They're worked out from the leads in memory, so logging a call, changing a status, closing a deal or importing a list moves them at once, without a reload. Each opens the leads table on what it counts (the new ones today, the clients, the biggest deals first). Deals in another currency are shown beside the main amounts, never added to them.
  - **Money expected in the next 30 days**: one number, and a bar of what it's made of: a month of active retainers, the domain and hosting renewals that fall due (a year after each deal closed, then every year), and the open deals at the quote stage, each counted by its chance of closing. That chance comes from the AI deal analysis when there is one, as a fixed rough estimate (hot 60%, warm 35%, cold 15%), otherwise from your own close rate after a quote, taken cautiously while few deals were decided. A deal's value is the setup fee the analysis recommended, or the typical setup fee of the deals you closed. Below it: what closed this month, and what the open deals are worth over their first year.
  - **What needs doing**: reminders worked out from the timelines and the analyses, the most urgent first: a follow-up the deal analysis set ("מעקב שהמאמן קבע", due today or overdue, as long as nothing was logged since), a Zoom no-show to reschedule, a deal at the quote stage with no contact for 5 days, a cold call that was answered a week ago but never asked for a quote (it no longer comes up in the daily draw), a closed deal with no amounts, a renewal due within 30 days, a closed deal with no retainer to upsell, a lead that never answers after 4 tries, the Daily 10 calls left and the objections due for practice. Each opens the right tab of the lead; **לא עכשיו** puts it off until tomorrow on this device, and a renewal marked **טופל** comes back next year.
  - **Open deals**: every deal at the quote stage, hottest first, with the AI's read of it, its estimated value, how long since the last contact, the next step from the analysis, and **ניתוח עסקה** to analyze it (or again, when something was logged since).

  The tab's badge counts the leads that need something now.
- **Today (the Daily 10)**: each day, 10 uncontacted leads are drawn at random from the pool: leads still in outreach that never picked up, aren't marked not relevant and weren't tried today. The draw holds all day on every device. Each card shows how to talk to them, the campaign, earlier unanswered calls, Call and WhatsApp buttons, **Prep** (opens the AI coach), and four quick actions:
  - **הצעת מחיר** moves the lead to the quote, which takes it out of the pool.
  - **Answered** logs a conversation that didn't ask for a quote yet. The lead has been contacted, so it leaves the random draw; follow it up from the leads board.
  - The **WhatsApp** button opens WhatsApp with the message ready for where the lead stands, and logs it (the lead moves to "נשלח וואטסאפ"), with Undo.
  - **No answer** logs the call; the lead stays in the pool for another day.
  - **Not relevant** archives it for good.

  After a step, **Add notes** opens the lead's timeline with that call ready for what was said. A strip of 10 slots fills in as you go, next to your calls this month against a target of 200. Every step can be undone for 10 minutes.
- **Strict funnel**: outreach (פנייה), then the quote (הצעת מחיר), then the closed deal (נסגר / לקוח), one stage at a time and enforced by the server. Closed and archived leads never return to the daily pool. A WhatsApp message sent from the app is a step of its own: it counts as the day's contact, not as a call attempt.
- **Deal terms**: the way a web studio is paid. A closed deal has a **setup fee** (one-time, for building the site), a **monthly retainer** (maintenance and management) and **domain and hosting** (renewed every year), in shekels or dollars. They are locked until the lead reaches Deal Closed; closing a deal opens its Details tab on the setup fee. Each amount saves on its own, and undoing the close clears them.
- **Leads (לידים)**: every lead, where it stands: **חדש** (not contacted yet), **נוצר קשר (שיחה)**, **נשלח וואטסאפ**, **הצעת מחיר** and **נסגר / לקוח**. The status is worked out from the lead's stage and its latest contact, so nothing extra is stored: a lead in outreach is new until a call or a WhatsApp message is logged, then sits where the latest one puts it. Two layouts share one search and set of filters (**טבלה** / **עמודות**, remembered on the device):
  - **The table** (TanStack Table): the business and contact person, status, phone, niche, calls, the latest contact, when it was added and the deal. Click any header to sort (again to reverse); 25, 50 or 100 rows a page. Filter by status (several at once, each chip with its count; none chosen is every status but not relevant), by niche and by when the lead was added (today, 7 or 30 days), and search as you type by business, contact, niche, email or phone digits however they're typed (054…, +972 54…, 054 123 4567). On a phone the rows are cards, with a sort menu.
  - **ייצוא לאקסל** downloads exactly what the table shows, every page of it, in its order: a real Excel file (`לידים-DD-MM-YYYY.xlsx`), right to left, with a frozen header row, a filter on every column, dates as dates, phone numbers as text (their 0 kept) and amounts as numbers: business, contact, phone, email, website, niche, status, calls, the latest contact and what it was, when added, setup fee, monthly retainer, yearly renewal, currency and how to talk to them. **CSV** beside it writes the same rows for anything else. It's written in the browser, so it works offline too. On the board it writes the columns shown, one after another.
  - **The board**: a column per status side by side on a wide screen, each scrolling on its own; one status at a time in tabs on a phone, with the leads marked not relevant in a column of their own on request. Cards are sorted by the latest contact.

  Every row and card has two quick actions:
  - **תעד שיחה** opens a quick note on the call, with how it went (ענה, אין מענה, or רוצה הצעה, which moves it to the quote; at the quote, נסגר! closes the deal). Saving it puts a lead in outreach in "נוצר קשר (שיחה)".
  - **וואטסאפ** opens WhatsApp (`https://wa.me/…`) on the lead's number with a message ready for where the lead stands, and moves it to "נשלח וואטסאפ". You read it and press send yourself, in WhatsApp; nothing is sent for you. The message is a template with the contact's first name, the business and the niche filled in: a first approach for a new lead, one for after a call nobody picked up, one for after a conversation, one with the quote, and a follow-up. The lead's profile has a **✎** beside **שלח וואטסאפ** to pick another template or change the words before it opens, and **עריכת התבניות** there (or in the command palette) edits the templates themselves, kept on this device. The message goes on the lead's timeline.

  Each comes with Undo for 10 minutes. The name opens the profile, and ⋯ opens every other action (the command palette, on that lead).
- **Lead profile**: open a lead from its card, or from a daily card, as a dialog, to see its statuses and act on it (הצעת מחיר or נסגר / לקוח, תעד שיחה, שלח וואטסאפ, ניתוח עסקה, לא רלוונטי), with three tabs:
  - **Timeline**: every call, Zoom meeting, WhatsApp message, email and note, newest first. Phone calls are numbered as attempts ("ניסיון 1: אין מענה", "ניסיון 2: ענה ← הצעת מחיר"), the same titles the AI coach uses. The composer on top logs a call or meeting with its outcome and what was said (paste a whole transcript if you have one), or a note or message, and can attach a recording. Any entry's text can be edited later, and recordings can be added to any entry.
  - **Recordings**: call recordings (mp3, m4a, wav, ogg, amr…) and Zoom videos (mp4, mov, webm) play right in the timeline, with seeking and 1×–2× speed for reviewing calls. Drop a file on the composer or attach it from any entry. Uploads show their progress and can be cancelled.
  - **Automatic transcripts**: with the server, each recording is transcribed in the background (OpenAI, any length, in Hebrew too) and the transcript is added to its entry under "Auto-transcript", for you and the coach. The entry shows "Transcribing…" with its progress until then, and a failed transcript can be retried. See [server/README.md](server/README.md#automatic-transcripts).
  - **Details**: the same groups as the New Lead form, each field saved in place. **The business** (name, campaign or niche, current website), **the contact** (person, preferred channel, phone and email, with buttons that open your own phone, WhatsApp or mail app), **the strategy** (how to approach them), and **the deal**: its three amounts laid out like a quote, with what it brings in over the first year and every year after.
  - **AI coach (ניתוח עסקה)**: one click, from the profile's **ניתוח עסקה** button or this tab, sends the lead's whole history to Claude, OpenAI or Gemini (on the server; Gemini has a free tier, see [server/README.md](server/README.md#the-ai-sales-coach)) and shows where the deal stands; a **plan of action** from today to the next commitment, each step with when to do it; a **recommended price** (setup fee, monthly retainer, domain and hosting, and the lowest setup fee worth taking), anchored on the deals you already closed, with what it includes, why, and the words to present it, and a line saying how many of your closed deals it rests on, or that it's the AI's general estimate while there are none; the **objections to expect** in the closing conversation, how likely each is and what to answer; what went well and what went wrong, your mistakes with the evidence from your notes and what to do instead, each objection raised with an answer, what you still need to find out, and the next call: its goal, when to call, a word-for-word script with a Copy button, and a message to copy and send yourself if they don't pick up. When the deal closes, its amounts can be filled from the recommendation in one click. Choose Hebrew, English, or the language of your notes. Phone numbers, emails and websites are never sent; other deals go along as amounts only. Everything it writes for you to say is held to your business description (Studio Omek's offer, unless `AI_BUSINESS_CONTEXT` says otherwise): no invented clients, results, figures, guarantees or payment terms.
  - **WhatsApp**: each message opened from the app is logged on the timeline with its text. Chats mirrored by the WhatsApp sync of earlier versions stay on the timeline as they were; the sync itself is gone (see [server/README.md](server/README.md#whatsapp-a-link-with-a-ready-message)).
- **Command palette (`Ctrl+K`, `⌘K` on a Mac)**: from anywhere, keyboard only. It opens on the next of today's calls; type to find any lead by business, contact, campaign or phone digits (054…, +972…), in Hebrew or English. Enter shows the lead's actions, each one key: `N` no answer, `A` answered, `Z` the quote (or the deal closed, at the quote), `X` not relevant, `S` open WhatsApp with the ready message, `U` undo, `O` open, `W` write a note, `P` prep with the coach, `C` copy the number. After a step it's back on the next call, with `Ctrl+Z` to undo. `Ctrl+Enter` opens a lead's profile; inside a profile, `Ctrl+K` opens on that lead.
- **Objection training**: flashcards that ask what you answer when a prospect says something. The deck starts with the 12 objections a web studio hears most on cold calls ("יש לי כבר אתר", "תשלח לי בוואטסאפ", "זה יקר לי"…): common ones, not counted from anyone's calls, with answers that offer only what the studio offers (the free homepage mockup, a landing page to start with) and claim no clients, results or numbers. Then the AI coach adds the ones your own prospects raise, from your transcripts, WhatsApp chats and notes. Each card has the answer to practise, a follow-up question, other ways to answer and, for your prospects' objections, the quotes it came from. Practise before the Daily 10 (a warm-up of up to five due cards appears on Today): say your answer out loud, `Space` flips the card, `1`–`4` grade it. Spaced repetition brings shaky cards back tomorrow and known ones up to two weeks later. Write your own version of any answer; it shows first when you practise. Refreshing the deck keeps your answers and history. **Tailored to each kind of business**: choose a niche from your leads' campaigns (or type one) and every answer is rewritten for it, so a restaurant hears about orders without the delivery apps' commission and a law firm about trust and a discreet first contact; the general answer stays one click away. A lead's profile has **תרגול התנגדויות ל<niche>**, and when most of today's calls are to one niche, the warm-up on Today is tailored to it. See [server/README.md](server/README.md#objection-training).
- **Prospector (מאתר הלידים)**: type a niche and an area ("מוסכים", "עפולה"), choose 20, 40 or 60 businesses, and the server finds them on Google Maps (through SerpApi, with Google Places taking over by itself when SerpApi's monthly searches run out or it fails, even halfway through a search), checks each website and scores how much it needs a new one: 5 for no website or one that doesn't work, 4 for an extremely outdated one (not made for phones, old WordPress, slow), down to 1 for a premium modern site. Results fill in live, with a progress bar and the count per score. The table shows the 4s and 5s first; each row opens to the verdict and its reasons, an opening line for the call, the site's facts (mobile-ready, HTTPS, load time, copyright year, accessibility statement, platform) and, with Chrome on the server, a screenshot of the homepage on a phone. Pick rows (or **בחירת כל ה-4-5**, or shift-click a range) and **ייבוא ל-CRM** (`Ctrl/⌘ + Enter`): they become new leads in today's draw pool, with the score and opening line as "how to talk to them" and the analysis on their timeline. Businesses already in the CRM are marked and skipped. It never contacts a business. See [server/README.md](server/README.md#the-prospector-finding-new-leads).
- **Add lead**: a dialog on desktop and a swipe-down sheet on phones, in the groups the Details tab uses: the business (name, campaign or niche, current website) beside the contact (person, preferred channel, phone, email), then the strategy notes, with an optional first note for the timeline. New leads start as "חדש". Only the business name is required.
- **Import a list**: paste rows from Excel or Google Sheets, a CSV, a list with one lead per line ("Arbel Olive Press - Moshe - 050-000-0142"), or one lead per paragraph. The importer:
  - picks out names, contact people, phone numbers, emails, websites, campaign or niche columns, approach notes and channels, with English and Hebrew column headers;
  - restores the 0 that Excel drops from Israeli numbers and turns +972 numbers into the local format;
  - flags leads already in your list (by phone in any format, email or name) and rows repeated in the paste.

  You check each column's mapping and each row and name the batch's campaign ("Dentists, week 43") before importing. Imported leads start as "חדש" and join the daily pool. Leads are saved 100 per request, and Undo removes the whole import.
- **Import JSON**: the same dialog's **JSON** tab takes leads pasted or opened from a file (or dropped on the box): an array, the list an export wraps them in (`{ "data": [ … ] }`), or JSON Lines. The fields are found by their usual names, in any letter case and with or without `_`, `-` or spaces, in English or Hebrew, so a Yellow Pages (דפי זהב) or Google Maps scrape imports as it is: the business from `businessName`, `company`, `name`, `title` or `label`; the phone from `phone`, `telephone`, `mobile`, `phone_number`, `tel` (a list of numbers too; any extra number goes in the note); the niche, which becomes the lead's campaign, from `niche`, `category`, `cat` or `type`; email, website and contact person onto the lead; and the address (`address`, `location`, or `street` and `city`), source, rating, the listing's link, `description` and `notes` into its first timeline note, which starts "יובא מקובץ JSON". A key that isn't one of those names is read by what's in it, after every exact name: `business_phone`, `Phone 2` and `טלפון נוסף` are phones, `mainCategory` and `סוג העסק` niches, `name_he` and `storeName` business names, while an image's URL, a job title or a place's id are left alone. An item with no phone under any key gets one from a value written like a number (`054-1234567`, `+972…`), but never from a fax. Where a file names its fields oddly, **שינוי השדות שזוהו** (open by itself when no name or phone was found) picks the key the business name, the phone and the niche come from, each with an example from the file; the server reads that key first, and the automatic choice still fills in items where it's empty. Every imported lead is saved in MongoDB as "חדש". As you paste it shows which field was found where, which fields won't be read, and where the JSON breaks if it doesn't read (quotes a phone turned into “ ” and a comma left before `]` are fixed for you). The server then saves only leads whose phone number no lead has yet: numbers already in the CRM, however they were written (054-1234567, 0541234567, +972 54-123-4567), and numbers repeated in the paste are skipped, and so are items without a name or a phone. A report lists each skipped item with the reason; the new leads join the daily pool, with Undo. Pasting JSON into the table tab offers to move it here. See [server/README.md](server/README.md#importing-json).
- **Undo**: deleting a lead shows an Undo toast for 5 seconds before the delete reaches storage.
- **Keyboard**: `Ctrl/⌘ + K` opens the command palette, `N` adds a lead, `I` imports a list, `/` focuses the leads search, `Esc` closes the open lead, `Ctrl/⌘ + Enter` saves a form, a timeline entry or an edit (and imports the businesses picked on the Prospector). The shortcuts use physical keys, so they work on a Hebrew layout too.
- **Saving**: every change shows instantly. With the server, it's kept on this device until the server has it, and sent again when a request fails for lack of a connection or because the server is down or waking up (see [On your phone](#on-your-phone)). A change the server refuses is rolled back with its message and a way to copy what was written.
- Hebrew throughout, right to left; see below.
- Light and dark themes follow the system, with a toggle that remembers your choice. Motion respects reduced-motion settings.

## Hebrew and right to left

- **The page.** `index.html` is `<html lang="he" dir="rtl">` (and `public/theme-init.js` sets the same before paint, for builds embedded elsewhere). Dates, times, numbers and money use `he-IL` (`src/config.ts`), so amounts read "13,500 ₪" and times "לפני 3 שעות".
- **Tailwind CSS 4 has no `tailwind.config.js`.** Its configuration lives in CSS: the theme tokens are in the `@theme` block at the top of `src/index.css`, and right-to-left support is built in. Layout uses logical utilities, which follow the text direction: `ms-*`/`me-*` and `ps-*`/`pe-*` instead of left and right margins and padding, `start-*`/`end-*`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-es-*`/`rounded-ee-*` (the corners of chat bubbles). Custom CSS uses logical properties too (`inset-inline-start`/`-end`), and the `rtl:` variant or a `[dir='rtl']` rule handles the rest: a progress line that grows from the right (`rtl:origin-right`), a bar animation that sweeps the other way.
- **Things that stay left to right.** Phone numbers, emails, websites, technical names and keyboard keys use the `.ltr` class or `dir="ltr"` (`<bdi>` inside sentences), so "054-000-0119" never comes out reversed. Text people type or the AI writes uses `dir="auto"`, so an English note still reads left to right. Ranges are written with a hyphen ("4-5"), which keeps the smaller number on the left, the way they read in Hebrew.
- **Icons.** Directional icons (play, arrows, external links) get `.flip-rtl`, which mirrors them in right-to-left. Media controls stay left to right, like every video player.
- **Words.** `src/lib/hebrew.ts` picks Hebrew number forms ("ליד אחד", "2 לידים", "יומיים", "שעתיים") with `Intl.PluralRules` and joins lists the Hebrew way. Stage and outcome names are in `src/lib/stages.ts`; the server's messages to the app are Hebrew too.
- **Fonts.** IBM Plex Sans Hebrew for Hebrew, Instrument Sans for Latin text and numbers.

## Project layout

```
src/
  config.ts              brand name, locale, base currency, country code, undo window
  types.ts               Lead, Interaction (with mirrored chats), MediaFile, CoachingReport, ObjectionCard and its niche variants, LeadPulse
  data/
    sampleLeads.ts       example leads with timelines (ids start with "sample-")
    sampleCoaching.ts    the labelled sample analysis
    starterDeck.ts       the starter objection deck without the server (the cards are in server/src/training/starter.ts)
    sampleProspector.ts  the Prospector's example search, with made-up businesses
    repository/
      types.ts           LeadRepository: the storage contract
      local.ts           localStorage implementation (default)
      blobs.ts           recordings in IndexedDB, for the browser-only setup
      http.ts            REST implementation for server/ (uploads with progress, a time limit, reachability)
      index.ts           picks one based on VITE_API_URL
  store/
    leads.ts             Zustand store: optimistic writes through the outbox, undo
    sync.ts              the outbox: sends changes in order, keeps them through lost connections and reloads (with tests)
    offline.ts           the copy kept on this device: opening on it (the quick copy first), keeping it up to date
    timeline.ts          timelines per lead, uploads, coach runs
    training.ts          the objection deck, practice sessions and answers tailored to a niche
    dashboard.ts         the dashboard's pulses per lead, and reminders put off on this device
    messages.ts          the WhatsApp templates, as edited on this device
    prospector.ts        Prospector searches: starting, live progress, picking businesses, import
    ui.ts                view, search, filters (status, niche, when added), the table's sort and layout, open lead,
                         dialogs, command palette, theme
    toasts.ts            notifications
  lib/
    workflow.ts          the funnel rules (the same as the server's), undo, calls per month, timeline entries
    timeline.ts          entry titles and attempt numbers (the same as the coach sees)
    media.ts             accepted recording formats, sizes and durations
    daily.ts             the daily draw when leads are kept in the browser
    leads.ts             pipeline numbers (the three income totals), filtering, sorting, campaigns
    deal.ts              deal terms: first-year and yearly value, how they read in Hebrew, leads saved with one value
    dashboard.ts         the home screen's numbers, the money expected in 30 days, open deals in order, reminders
                         (with tests)
    leads-table.ts       the leads table: its filters, sort keys and the columns an export writes (with tests)
    export.ts            the Excel (.xlsx) and CSV files of the leads shown, written in the browser (with tests)
    messages.ts          the WhatsApp templates and how each is filled for a lead (with tests)
    niche.ts             a lead's niche from its campaign (the server's rules) and niche counts
    health.ts            how the deal analysis reads a deal: labels, icons, colors
    stages.ts            stage and outcome labels, icons and colors
    palette.ts           the command palette's lead search and one-key actions (with tests)
    practice.ts          spaced repetition for objection cards (with tests)
    chat.ts              mirrored WhatsApp conversations as text and time spans
    prospects.ts         need scores, the site's facts, which businesses to show, the lead a business becomes (with tests)
    outbox.ts            what a change is, whether a failure is worth another try, changes still waiting shown on top (with tests)
    kept.ts              the copy of the server's data kept on this device (IndexedDB, through idb.ts)
    quick-copy.ts        the small copy of the leads in localStorage, read before the first render
    board.ts             the leads board: its columns, search and the line on each card (with tests)
    phone.ts             phone numbers as shown and dialled, and the wa.me link with its ready message
    drafts.ts            drafts of what's being typed, kept until saved
    hebrew.ts            Hebrew number forms and lists
    clipboard.ts         copy with a fallback for older browsers
    outbound-policy.test.ts  fails on any link that writes a message, except the wa.me link you send yourself
    import/              the paste reader: formats, columns, fields, duplicates; json.ts reads pasted JSON (with tests)
  hooks/
    useSaveOnLeave.ts    fields that save when you leave the page, and their drafts
  components/
    TabBar.tsx           the views along the bottom on phones
    SyncStatus.tsx       the header's save indicator and the list of changes waiting to be sent
    OfflineBanner.tsx    says when the copy kept on this device is showing
    PreviewBanner.tsx    says when the app runs without the server (the preview), and links to the connected app
    dashboard/           the home screen: the headline numbers, expected money, reminders, open deals
    today/               the Daily 10: progress, quota strip and daily cards
    pipeline/            the leads: the shared search and filters, the table with its export, the board's status
                         columns or tabs, lead cards, the "תעד שיחה" dialog
    LeadDetails.tsx      stage stepper, actions, and the Timeline, Details and AI coach tabs
    LeadModal.tsx        the same profile in a dialog
    profile/             timeline, mirrored WhatsApp chats, composer, recording player, AI coach panel, the Details tab
                         and its deal terms
    palette/             the Ctrl+K command palette
    training/            objection training: deck, warm-up, flashcards, the niche picker
    whatsapp/            the WhatsApp message dialog: choosing a template, changing the words, editing the templates
    prospector/          the Prospector: search form, recent searches, results table, details, import bar
    import/              the import dialog: paste, review, column mapping, and the JSON tab with its report
  components/ui/         buttons, badges, segmented controls, inputs, amounts, titled form sections
  index.css              Tailwind's @theme, design tokens for both themes, the responsive row grids, RTL helpers
public/
  manifest.webmanifest   installing on a phone: name, icons, full screen, right to left, shortcuts
  sw.js                  the offline worker: keeps the app's own files so it opens with no signal (never the API)
  icon-*.png             app icons (and apple-touch-icon.png for iPhones)
server/                  Express + Prisma API (see server/README.md)
vercel.json              for hosting the app on Vercel: forwards /api to the server, security headers
```

## Customizing

- **Brand, currency, locale**: `src/config.ts`.
- **Stages**: labels, icons and colors in `src/lib/stages.ts`; colors are the `--st-*` tokens in `src/index.css`. The rules are in `src/lib/workflow.ts` and `server/src/leads/workflow.ts`, which must stay in step.
- **Daily quota and monthly target**: `dailyQuota` and `monthlyCallTarget` in `src/config.ts`, and `DAILY_QUOTA` on the server.
- **Currencies**: `CURRENCIES` in `src/types.ts`, plus the same two server files.
- **Theme**: every color is a token at the top of `src/index.css`.
- **WhatsApp messages**: the templates everyone starts with are `DEFAULT_TEMPLATES` in `src/lib/messages.ts` (`{איש_קשר}`, `{שם_העסק}` and `{נישה}` are filled in), and `templateFor` picks one by where the lead stands. Edits made in the app stay on that device.
- **WhatsApp icon**: Lucide has no brand logos, so WhatsApp uses a chat bubble in WhatsApp green. Swap it in `CHANNEL_META` in `src/lib/stages.ts`.
