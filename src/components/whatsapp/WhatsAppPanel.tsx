import {
  ChevronDown,
  CircleCheck,
  LoaderCircle,
  MessageCircle,
  MicOff,
  PhoneOff,
  QrCode,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Unlink,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { repository } from '../../data/repository';
import { cn } from '../../lib/cn';
import { appConfig } from '../../config';
import { formatNumber, formatRelative } from '../../lib/format';
import { formatPhone } from '../../lib/phone';
import { toneStyle } from '../../lib/stages';
import { useWhatsApp } from '../../store/whatsapp';
import type { WhatsAppGuardStatus, WhatsAppStatus } from '../../types';
import { Button } from '../ui/Button';
import { DialogBody, DialogHeading, ResponsiveDialog } from '../ui/ResponsiveDialog';
import { inputBase, inputSize } from '../ui/styles';

type LinkedStatus = Extract<WhatsAppStatus, { enabled: true }>;

/** What the read-only guard makes impossible, in the words you'd use for it */
const NEVER: { icon: LucideIcon; text: string }[] = [
  { icon: MessageCircle, text: 'שולחת הודעה, תגובה, קובץ או סטטוס' },
  { icon: CircleCheck, text: 'מסמנת וי כחול, או "הושמע" בהודעה קולית' },
  { icon: MicOff, text: 'מציגה אותך כמחובר, מקליד או מקליט' },
  { icon: PhoneOff, text: 'עונה לשיחה, דוחה אותה או מתקשרת' },
  { icon: UserX, text: 'חוסמת מישהו, מוסיפה לקבוצה או משנה את הפרופיל שלך' },
];

const LAYER_LABEL = { method: 'מנעול הפונקציות', message: 'מנעול ההודעות', wire: 'מנעול התעבורה' } as const;

/** "לפני שעתיים", "אתמול", or "ב-12 באוק׳" for older dates */
const since = (iso: string) => {
  const relative = formatRelative(iso);
  return /^\d/.test(relative) ? `ב-${relative}` : relative;
};
const timeFormat = new Intl.DateTimeFormat(appConfig.locale, { hour: '2-digit', minute: '2-digit' });

/** Linking WhatsApp as a read-only device, and what its guard has stopped */
export function WhatsAppPanel() {
  const open = useWhatsApp((s) => s.open);
  const setOpen = useWhatsApp((s) => s.setOpen);
  const status = useWhatsApp((s) => s.status);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen} className="sm:w-[600px]">
      <DialogHeading
        title="סנכרון וואטסאפ"
        description="משקף את השיחות שלך עם לידים לציר הזמן שלהם, כולל תמלול של הודעות קוליות. הסנכרון רק קורא, ואף פעם לא שולח."
      />
      <DialogBody className="flex flex-col gap-5">
        {!status ? (
          <div aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-field" />
        ) : status.enabled ? (
          <>
            <LinkSection status={status} />
            <Guard guard={status.guard} />
          </>
        ) : (
          <>
            <div className="rounded-2xl bg-field px-4 py-4 ring-1 ring-line ring-inset">
              <p className="text-[14px] font-medium">סנכרון הוואטסאפ כבוי</p>
              <p className="mt-1 text-[13.5px] text-pretty text-fg-muted">{status.reason}</p>
              {repository.kind === 'remote' && (
                <p className="mt-2 text-[13px] text-pretty text-fg-faint">
                  כדי להפעיל, מוסיפים <code className="ltr rounded bg-raised px-1">WHATSAPP=on</code> ו-
                  <code className="ltr rounded bg-raised px-1">WHATSAPP_AUTH_KEY</code> לקובץ ה-.env של השרת ומפעילים אותו מחדש.
                </p>
              )}
            </div>
            <ReadOnlyPromise />
          </>
        )}
      </DialogBody>
    </ResponsiveDialog>
  );
}

function LinkSection({ status }: { status: LinkedStatus }) {
  const { link } = status;
  switch (link.state) {
    case 'unlinked':
      return <Unlinked reason={link.reason} />;
    case 'linking':
      return link.method === 'qr' ? <ScanQr qr={link.qr} /> : <TypeCode code={link.code} phone={link.phone} />;
    case 'connecting':
      return <Waiting text="מתחבר לוואטסאפ…" />;
    case 'reconnecting':
      return (
        <Notice
          tone="var(--st-no-answer)"
          title="מתחבר מחדש"
          body={`${link.reason} ננסה שוב ${Date.parse(link.retryAt) - Date.now() < 60_000 ? 'עוד רגע' : `ב-${timeFormat.format(new Date(link.retryAt))}`} (ניסיון ${link.attempt}).`}
        >
          <UnlinkButton />
        </Notice>
      );
    case 'stopped':
      return <Stopped reason={link.reason} />;
    case 'connected':
      return <Connected status={status} link={link} />;
  }
}

function Unlinked({ reason }: { reason?: string }) {
  const link = useWhatsApp((s) => s.link);
  const busy = useWhatsApp((s) => s.busy);
  const [usePhone, setUsePhone] = useState(false);
  const [phone, setPhone] = useState('');

  return (
    <div className="flex flex-col gap-4">
      {reason && <p className="rounded-xl bg-[color-mix(in_oklab,var(--st-no-answer)_10%,transparent)] px-3.5 py-2.5 text-[13.5px] text-pretty">{reason}</p>}
      <p className="text-[14px] text-pretty">
        מקשרים את הוואטסאפ כמו שמקשרים את WhatsApp Web. השרת הופך לאחד המכשירים המקושרים שלך, ומושך רק שיחות עם מספרים שהם לידים במערכת. השיחות
        של כל השאר נשארות בחוץ.
      </p>
      {usePhone ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void link(phone);
          }}
        >
          <label htmlFor="whatsapp-phone" className="sr-only">
            מספר הוואטסאפ שלך
          </label>
          <input
            id="whatsapp-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="מספר הוואטסאפ שלך, למשל 054-123-4567"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={cn(inputBase, inputSize, 'min-w-0 flex-1 text-right')}
          />
          <Button type="submit" variant="primary" disabled={busy === 'link' || phone.replace(/\D/g, '').length < 8}>
            {busy === 'link' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Smartphone className="size-4" aria-hidden />}
            קבלת קוד
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy === 'link'} onClick={() => void link()}>
            {busy === 'link' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <QrCode className="size-4" aria-hidden />}
            קישור עם קוד QR
          </Button>
          <Button onClick={() => setUsePhone(true)}>
            <Smartphone className="size-4" aria-hidden />
            קישור עם קוד במקום
          </Button>
        </div>
      )}
      <p className="text-[12.5px] text-pretty text-fg-faint">
        לוואטסאפ אין דרך רשמית לקרוא את השיחות שלך, אז הסנכרון משתמש בפרוטוקול של WhatsApp Web דרך ספריית קוד פתוח (Baileys). קריאה בלבד שומרת על
        סיכון נמוך, אבל תנאי השימוש של וואטסאפ לא מתירים תוכנות לא רשמיות.
      </p>
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-2 text-[13.5px]">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-2.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-field text-[11.5px] font-semibold ring-1 ring-line">{index + 1}</span>
          <span className="min-w-0 text-pretty">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function ScanQr({ qr }: { qr: string }) {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <img src={qr} alt="קוד QR לקישור הוואטסאפ" width={208} height={208} className="size-52 shrink-0 rounded-2xl bg-white p-2 ring-1 ring-line" />
      <div className="flex min-w-0 flex-col gap-3">
        <Steps steps={['פותחים את וואטסאפ בטלפון.', 'הגדרות ← מכשירים מקושרים ← קישור מכשיר.', 'מכוונים את הטלפון אל הקוד הזה.']} />
        <p className="text-[12.5px] text-fg-faint">הקוד מתחלף כל 20 שניות.</p>
        <CancelButton />
      </div>
    </div>
  );
}

function TypeCode({ code, phone }: { code: string | null; phone: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] text-fg-muted">
        עבור <span className="ltr">+{phone}</span>:
      </p>
      <p dir="ltr" className="text-end font-mono text-[34px] font-semibold tracking-[0.12em] tabular-nums" aria-live="polite">
        {code ?? <LoaderCircle className="size-7 animate-spin text-fg-faint" aria-label="מקבל קוד" />}
      </p>
      <Steps steps={['פותחים את וואטסאפ בטלפון הזה.', 'הגדרות ← מכשירים מקושרים ← קישור מכשיר.', 'מקישים על "קישור עם מספר טלפון במקום" ומקלידים את הקוד.']} />
      <CancelButton />
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-2xl bg-field px-4 py-5 text-[14px] text-fg-muted ring-1 ring-line ring-inset">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {text}
    </p>
  );
}

function Notice({ tone, title, body, children }: { tone: string; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div style={toneStyle(tone)} className="rounded-2xl bg-[color-mix(in_oklab,var(--tone)_8%,transparent)] px-4 py-4 ring-1 ring-[color-mix(in_oklab,var(--tone)_30%,transparent)] ring-inset">
      <p className="text-[14px] font-semibold">{title}</p>
      <p className="mt-1 text-[13.5px] text-pretty text-fg-muted">{body}</p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

function Stopped({ reason }: { reason: string }) {
  const reconnect = useWhatsApp((s) => s.reconnect);
  const busy = useWhatsApp((s) => s.busy);
  return (
    <Notice tone="var(--st-lost)" title="הסנכרון נעצר" body={reason}>
      <Button size="sm" disabled={busy !== null} onClick={() => void reconnect()}>
        {busy === 'reconnect' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
        התחברות מחדש
      </Button>
      <UnlinkButton />
    </Notice>
  );
}

function Connected({ status, link }: { status: LinkedStatus; link: Extract<LinkedStatus['link'], { state: 'connected' }> }) {
  const { sync, settings } = status;
  return (
    <div className="flex flex-col gap-4">
      <div style={toneStyle('var(--whatsapp)')} className="flex items-center gap-3 rounded-2xl bg-[color-mix(in_oklab,var(--whatsapp)_8%,transparent)] px-4 py-3.5 ring-1 ring-[color-mix(in_oklab,var(--whatsapp)_28%,transparent)] ring-inset">
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--whatsapp)] opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[var(--whatsapp)]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">
            מקושר{link.name ? <> בתור <span dir="auto">{link.name}</span></> : ''} ·{' '}
            <span className="ltr tabular-nums">{formatPhone(link.phone.startsWith('972') ? `0${link.phone.slice(3)}` : `+${link.phone}`)}</span>
          </p>
          <p className="text-[12.5px] text-fg-muted">התחבר {since(link.since)}. ההתראות נשארות בטלפון: המכשיר הזה אף פעם לא מופיע כמחובר.</p>
        </div>
      </div>
      {sync.historyProgress !== null && (
        <div>
          <p className="text-[13px] text-fg-muted">הטלפון שולח את ההיסטוריה: {Math.round(sync.historyProgress)}%</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-field">
            <span className="block h-full rounded-full bg-[var(--whatsapp)]" style={{ width: `${sync.historyProgress}%` }} />
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
        <Stat label="הודעות ששוקפו" value={formatNumber(sync.messages)} hint="מאז שהשרת עלה" />
        <Stat label="הודעה אחרונה" value={sync.lastMessageAt ? formatRelative(sync.lastMessageAt) : '—'} />
        <Stat
          label="הודעות קוליות"
          value={settings.transcribes ? `מתומללות (${settings.voiceNoteDays} הימים האחרונים)` : 'נשמרות, בלי תמלול'}
          hint={sync.voiceNotesWaiting ? `${sync.voiceNotesWaiting} בהורדה` : undefined}
        />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <UnlinkButton />
        <span className="text-[12.5px] text-fg-faint">השיחות ששוקפו נשארות בציר הזמן גם אחרי ניתוק הקישור.</span>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-fg-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
      {hint && <dd className="text-[11.5px] text-fg-faint">{hint}</dd>}
    </div>
  );
}

function CancelButton() {
  const unlink = useWhatsApp((s) => s.unlink);
  const busy = useWhatsApp((s) => s.busy);
  return (
    <Button size="sm" variant="ghost" className="self-start" disabled={busy !== null} onClick={() => void unlink()}>
      ביטול
    </Button>
  );
}

function UnlinkButton() {
  const unlink = useWhatsApp((s) => s.unlink);
  const busy = useWhatsApp((s) => s.busy);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);
  return (
    <Button size="sm" variant={confirm ? 'danger' : 'ghost'} disabled={busy !== null} onClick={() => (confirm ? void unlink() : setConfirm(true))}>
      {busy === 'unlink' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Unlink className="size-4" aria-hidden />}
      {confirm ? 'לחיצה נוספת לניתוק' : 'ניתוק הקישור'}
    </Button>
  );
}

/** The read-only promise, in plain words */
function ReadOnlyPromise() {
  return (
    <div className="rounded-2xl px-4 py-3.5 ring-1 ring-line ring-inset">
      <p className="text-[13px] font-medium text-fg-muted">המערכת הזו אף פעם לא</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {NEVER.map((item) => (
          <li key={item.text} className="flex items-center gap-2.5 text-[13.5px]">
            <item.icon className="size-4 shrink-0 text-fg-faint" aria-hidden />
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Guard({ guard }: { guard: WhatsAppGuardStatus }) {
  const [open, setOpen] = useState(false);
  const proven = guard.selfTest === 'passed';
  const failed = guard.selfTest === 'failed';
  const Icon = failed ? ShieldX : ShieldCheck;
  const tone = failed ? 'var(--st-lost)' : proven ? 'var(--st-won)' : 'var(--fg-muted)';
  return (
    <section aria-label="שומר הקריאה בלבד" className="rounded-2xl ring-1 ring-line ring-inset">
      <div className="flex gap-3 px-4 py-3.5">
        <Icon className="mt-0.5 size-5 shrink-0" style={{ color: tone }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">קריאה בלבד, נאכף בקוד</p>
          <p className="mt-0.5 text-[13px] text-pretty text-fg-muted">
            {failed
              ? 'השומר לא הצליח להוכיח את עצמו על החיבור הזה, אז הסנכרון נשאר כבוי.'
              : proven
                ? 'לפני החיבור, השומר הוכיח על החיבור החי שהודעה לא יכולה לצאת. כל מנה יוצאת נבדקת מול רשימת היתרים.'
                : 'השומר מוכיח את עצמו על החיבור לפני שמשהו יוצא.'}
          </p>
        </div>
      </div>
      <div className="border-t border-line px-4 py-3">
        <p className="text-[12.5px] font-medium text-fg-muted">המכשיר הזה אף פעם לא</p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {NEVER.map((item) => (
            <li key={item.text} className="flex items-center gap-2.5 text-[13px] text-fg-muted">
              <item.icon className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
              {item.text}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-start text-[12.5px] text-fg-muted hover:text-fg">
        <span className="min-w-0 flex-1">
          {guard.blocked === 0
            ? 'עד עכשיו לא נעצר כלום.'
            : `${guard.blocked === 1 ? 'נעצרה מנה יוצאת אחת' : `נעצרו ${formatNumber(guard.blocked)} מנות יוצאות`}${guard.critical ? `, ${guard.critical === 1 ? 'אחת מהן ניסיון' : `${guard.critical} מהן ניסיונות`} להגיע למישהו` : ', כולן תעבורת רקע'}.`}
        </span>
        {guard.recent.length > 0 && <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && guard.recent.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line px-4 py-3 text-[12.5px]">
          {guard.recent.map((event, index) => (
            <li key={index} className="flex gap-2">
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', event.severity === 'critical' ? 'bg-[var(--st-lost)]' : 'bg-fg-faint')} />
              <span className="min-w-0 flex-1 text-pretty">
                נחסם: {event.what} <span className="text-fg-faint">({LAYER_LABEL[event.layer]})</span>
              </span>
              <time className="shrink-0 text-fg-faint">{formatRelative(event.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
