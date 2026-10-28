import { ExternalLink, MonitorSmartphone } from 'lucide-react';
import { appConfig } from '../config';
import { repository } from '../data/repository';
import { buttonStyles } from './ui/Button';

const liveHost = (() => {
  try {
    return new URL(appConfig.liveUrl).host;
  } catch {
    return null;
  }
})();

/** True when this page is the live address itself (a deployment built without the server, which shouldn't happen) */
function atLiveAddress(): boolean {
  try {
    return liveHost !== null && window.location.host === liveHost;
  } catch {
    return false;
  }
}

/**
 * Says it plainly when the app runs without the server (the preview): the leads stay in this browser, and what
 * needs the server (the deal analysis, the Prospector, answers for a niche, WhatsApp) can't run here. Points to the
 * app that's connected, so the preview is never taken for it.
 */
export function PreviewBanner() {
  if (repository.kind !== 'local') return null;
  const here = atLiveAddress();

  return (
    <div
      role="note"
      className="mb-4 flex flex-col gap-3 rounded-2xl px-4 py-3 ring-1 ring-[color-mix(in_oklab,var(--st-zoom)_28%,transparent)] ring-inset sm:flex-row sm:items-center sm:justify-between sm:ps-5"
      style={{ background: 'color-mix(in oklab, var(--st-zoom) 7%, transparent)' }}
    >
      <p className="flex items-start gap-2.5 text-[13.5px] text-pretty text-fg-muted">
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-[var(--st-zoom)]" aria-hidden />
        {here ? (
          <span>
            <span className="font-medium text-fg">האפליקציה בכתובת הזו לא מחוברת לשרת</span>, כי היא נבנתה בלי <bdi dir="ltr">VITE_API_URL=/api</bdi>. בפריסה הבאה
            ב-Vercel זה מתוקן לבד. עד אז הלידים נשמרים רק בדפדפן הזה, וניתוח עסקה, מאתר הלידים ווואטסאפ לא פועלים.
          </span>
        ) : (
          <span>
            <span className="font-medium text-fg">זו תצוגה מקדימה, בלי שרת.</span> הלידים נשמרים רק בדפדפן הזה, וניתוח עסקה, מאתר הלידים, התאמת
            התשובות לסוג עסק ווואטסאפ לא פועלים כאן. כל אלה עובדים באפליקציה שמחוברת לשרת
            {liveHost && (
              <>
                , בכתובת{' '}
                <bdi dir="ltr" className="font-medium whitespace-nowrap text-fg">
                  {liveHost}
                </bdi>
              </>
            )}
            .
          </span>
        )}
      </p>
      {!here && liveHost && (
        <a href={appConfig.liveUrl} target="_blank" rel="noreferrer noopener" className={buttonStyles({ variant: 'primary', size: 'sm', className: 'max-sm:w-full' })}>
          לאפליקציה
          <ExternalLink className="flip-rtl size-4" aria-hidden />
        </a>
      )}
    </div>
  );
}
