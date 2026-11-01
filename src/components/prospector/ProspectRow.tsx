import { AnimatePresence, motion } from 'motion/react';
import {
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  ExternalLink,
  Gauge,
  Globe,
  MapPin,
  Quote,
  RefreshCw,
  Star,
  UserRound,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { repository } from '../../data/repository';
import { copyText } from '../../lib/clipboard';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { EASE_OUT } from '../../lib/motion';
import { formatPhone } from '../../lib/phone';
import { CHECK_LABEL, isChecking, leadIdOf, SITE_STATE_LABEL, siteFacts } from '../../lib/prospects';
import { websiteHref, websiteLabel } from '../../lib/website';
import { useProspector } from '../../store/prospector';
import { useUi } from '../../store/ui';
import type { Prospect } from '../../types';
import { Button } from '../ui/Button';
import { ScoreBadge } from './ScoreBadge';

const CONFIDENCE_LABEL = { high: 'ביטחון גבוה', medium: 'ביטחון בינוני', low: 'ביטחון נמוך' } as const;

interface RowProps {
  prospect: Prospect;
  /** The example search: nothing in it links out, since none of it is real */
  demo: boolean;
  selected: boolean;
  /** Shift-click selects the range from the last row picked */
  onSelect: (id: string, event: MouseEvent<HTMLInputElement>) => void;
}

/** One business: a table row on wide screens, a card on phones. Clicking it opens what the check found. */
export function ProspectRow({ prospect, demo, selected, onSelect }: RowProps) {
  const open = useProspector((s) => s.openId === prospect.id);
  const setOpenId = useProspector((s) => s.setOpenId);
  const { analysis } = prospect;
  const leadId = leadIdOf(prospect);
  const rowId = `prospect-${prospect.id}`;
  const panelId = `${rowId}-details`;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'border-t border-line transition-colors first:border-t-0',
        open ? 'bg-field' : selected && 'bg-[color-mix(in_oklab,var(--focus)_7%,transparent)]',
        leadId && !open && 'opacity-75',
      )}
    >
      <div className="flex items-start">
        <label className="flex shrink-0 cursor-pointer items-start self-stretch ps-4 pe-1 pt-4 sm:ps-5 lg:items-center lg:pt-0">
          <input
            type="checkbox"
            checked={selected}
            disabled={leadId !== null}
            onChange={() => {}}
            onClick={(event) => onSelect(prospect.id, event)}
            aria-label={leadId ? `${prospect.name} כבר ב-CRM` : `בחירת ${prospect.name}`}
            className="size-[18px] cursor-pointer accent-[var(--focus)] disabled:cursor-default"
          />
        </label>
        <button
          id={rowId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpenId(open ? null : prospect.id)}
          className={cn('prospect-grid min-w-0 flex-1 py-3.5 ps-3 pe-4 text-start transition-colors sm:pe-5 lg:py-3', !open && 'hover:bg-field')}
        >
          <span className="gp-score flex">
            <ScoreBadge prospect={prospect} />
          </span>

          <span className="gp-name min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span dir="auto" className="truncate text-[15px] font-semibold tracking-[-0.005em]">
                {prospect.name}
              </span>
              {leadId && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-field px-1.5 py-0.5 text-[11.5px] font-medium text-fg-muted ring-1 ring-line ring-inset">
                  <Check className="size-3" aria-hidden />
                  {prospect.importedLeadId ? 'יובא' : 'כבר ב-CRM'}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-muted">
              {prospect.category && (
                <span dir="auto" className="truncate">
                  {prospect.category}
                </span>
              )}
              {prospect.rating !== null && (
                <span className="flex shrink-0 items-center gap-0.5 tabular-nums" aria-label={`דירוג ${prospect.rating} בגוגל`}>
                  {prospect.category && <span className="text-fg-faint" aria-hidden>·</span>}
                  <Star className="size-3 fill-current text-[var(--st-no-answer)]" aria-hidden />
                  {prospect.rating.toFixed(1)}
                  {prospect.reviews !== null && <span className="text-fg-faint">({prospect.reviews})</span>}
                </span>
              )}
            </span>
          </span>

          <span className="gp-phone min-w-0 text-[13.5px] tabular-nums">
            {prospect.phone ? (
              <span className="ltr block truncate">{formatPhone(prospect.phone)}</span>
            ) : (
              <span className="text-fg-faint">אין טלפון</span>
            )}
          </span>

          <span className="gp-site min-w-0 text-[13px] max-lg:text-end">
            <SiteCell prospect={prospect} />
          </span>

          <span className="gp-verdict min-w-0 text-[13.5px] text-pretty text-fg-muted">
            <span dir="auto" className="line-clamp-2">
              {analysis.verdict || (isChecking(prospect) ? CHECK_LABEL[analysis.status] : analysis.error ?? CHECK_LABEL[analysis.status])}
            </span>
          </span>

          <span className="gp-chevron hidden items-center justify-end text-fg-faint lg:flex">
            <ChevronDown className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
          </span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            id={panelId}
            role="region"
            aria-labelledby={rowId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <ProspectDetails prospect={prospect} demo={demo} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function SiteCell({ prospect }: { prospect: Prospect }) {
  const { analysis } = prospect;
  if (!prospect.website) return <span className="text-fg-faint">אין אתר</span>;
  const state = analysis.siteState;
  const tech = analysis.signals?.tech[0];
  return (
    <span className="flex min-w-0 flex-col max-lg:items-end">
      <span className="ltr block max-w-full truncate text-fg">{websiteLabel(prospect.website)}</span>
      {state && state !== 'ok' ? (
        <span className={cn('truncate text-[12px]', state === 'blocked' ? 'text-fg-faint' : 'text-[var(--st-lost)]')}>{SITE_STATE_LABEL[state]}</span>
      ) : tech ? (
        <span className="ltr block max-w-full truncate text-[12px] text-fg-faint">{tech}</span>
      ) : null}
    </span>
  );
}

/** What the check found: the verdict and its reasons, an opening line, the site's facts and its screenshot */
function ProspectDetails({ prospect, demo }: { prospect: Prospect; demo: boolean }) {
  const recheck = useProspector((s) => s.recheck);
  const rechecking = useProspector((s) => s.rechecking.has(prospect.id));
  const openProfile = useUi((s) => s.openProfile);
  const { analysis } = prospect;
  const leadId = leadIdOf(prospect);
  const facts = analysis.signals ? siteFacts(analysis.signals) : [];
  // A dead site's one reason is its verdict
  const reasons = analysis.reasons.filter((reason) => reason !== analysis.verdict);
  const screenshot = repository.prospectScreenshot(prospect);
  const site = demo ? null : websiteHref(prospect.website);
  const checking = isChecking(prospect);

  return (
    <div className="grid gap-6 px-4 pt-1 pb-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8 lg:ps-[3.25rem]">
      <div className="min-w-0">
        {checking ? (
          <p className="text-[14px] text-fg-muted">{CHECK_LABEL[analysis.status]}</p>
        ) : (
          <>
            {(analysis.verdict || analysis.error) && (
              <p dir="auto" className="text-[15px] font-medium text-pretty">
                {analysis.verdict || analysis.error}
              </p>
            )}
            {analysis.verdict && analysis.error && <p className="mt-1 text-[13px] text-[var(--st-no-answer)]">{analysis.error}</p>}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-faint">
              {analysis.scoredBy && (
                <span className="flex items-center gap-1">
                  {analysis.scoredBy === 'ai' ? <Bot className="size-3.5" aria-hidden /> : <Gauge className="size-3.5" aria-hidden />}
                  {analysis.scoredBy === 'ai' ? 'ציון מה-AI' : 'ציון לפי סימני האתר'}
                  {analysis.confidence && ` · ${CONFIDENCE_LABEL[analysis.confidence]}`}
                </span>
              )}
              {analysis.analyzedAt && <span>נבדק {formatRelative(analysis.analyzedAt)}</span>}
              {analysis.reusedFrom && <span>אותו אתר כמו סניף אחר ברשימה</span>}
            </p>
          </>
        )}

        {reasons.length > 0 && (
          <ul className="mt-3.5 flex flex-col gap-1.5">
            {reasons.map((reason) => (
              <li key={reason} dir="auto" className="flex gap-2 text-[14px] text-pretty">
                <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-fg-faint" aria-hidden />
                {reason}
              </li>
            ))}
          </ul>
        )}

        {analysis.pitch && (
          <div className="approach mt-4 rounded-xl px-3.5 py-3">
            <p className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-fg-muted">
              <span className="flex items-center gap-1.5">
                <Quote className="size-3.5" aria-hidden />
                פתיחה לשיחה
              </span>
              <button
                type="button"
                onClick={() => void copyText(analysis.pitch, { copied: 'הפתיחה הועתקה', failed: 'לא הצלחנו להעתיק את הפתיחה.' })}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-faint hover:bg-field-hover hover:text-fg"
              >
                <Copy className="size-3.5" aria-hidden />
                העתקה
              </button>
            </p>
            <p dir="auto" className="mt-1.5 text-[14.5px] leading-relaxed text-pretty">
              {analysis.pitch}
            </p>
          </div>
        )}

        {facts.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="מה נמצא באתר">
            {facts.map((fact) => (
              <li
                key={fact.label}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] ring-1 ring-inset',
                  fact.good === true && 'text-[var(--st-won)] ring-[color-mix(in_oklab,var(--st-won)_30%,transparent)]',
                  fact.good === false && 'text-[var(--st-lost)] ring-[color-mix(in_oklab,var(--st-lost)_30%,transparent)]',
                  fact.good === null && 'text-fg-muted ring-line',
                )}
              >
                {fact.good === true ? <CircleCheck className="size-3.5" aria-hidden /> : fact.good === false ? <CircleX className="size-3.5" aria-hidden /> : null}
                <span dir={fact.ltr ? 'ltr' : undefined}>{fact.label}</span>
              </li>
            ))}
            {analysis.signals?.tech.filter((tech) => !analysis.signals?.legacy.includes(tech)).map((tech) => (
              <li key={tech} dir="ltr" className="inline-flex h-7 items-center rounded-full bg-field px-2.5 text-[12.5px] text-fg-muted">
                {tech}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {leadId && (
            <Button size="sm" variant="primary" onClick={() => openProfile(leadId)}>
              <UserRound className="size-4" aria-hidden />
              פתיחת הליד
            </Button>
          )}
          {site && (
            <a href={site} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-field px-3 text-[13.5px] font-medium ring-1 ring-line ring-inset hover:bg-field-hover">
              <Globe className="size-4" aria-hidden />
              לאתר
              <ExternalLink className="flip-rtl size-3.5 text-fg-faint" aria-hidden />
            </a>
          )}
          {!demo && prospect.mapsUrl && (
            <a href={prospect.mapsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-field px-3 text-[13.5px] font-medium ring-1 ring-line ring-inset hover:bg-field-hover">
              <MapPin className="size-4" aria-hidden />
              במפות Google
              <ExternalLink className="flip-rtl size-3.5 text-fg-faint" aria-hidden />
            </a>
          )}
          {!demo && prospect.website && (
            <Button size="sm" variant="ghost" disabled={checking || rechecking} onClick={() => void recheck(prospect.id)}>
              <RefreshCw className={cn('size-4', (checking || rechecking) && 'animate-spin')} aria-hidden />
              {checking || rechecking ? 'בודק…' : 'בדיקה חוזרת'}
            </Button>
          )}
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-3 lg:border-s lg:border-line lg:ps-6">
        {screenshot && (
          <figure className="mx-auto w-[11.5rem] overflow-hidden rounded-[22px] bg-raised p-1.5 shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line">
            <img src={screenshot} alt={`דף הבית של ${prospect.name} בטלפון`} loading="lazy" className="aspect-[390/844] w-full rounded-[16px] object-cover object-top" />
            <figcaption className="py-1 text-center text-[11.5px] text-fg-faint">כך נראה דף הבית בטלפון</figcaption>
          </figure>
        )}
        <dl className="grid gap-2 text-[13px]">
          {prospect.address && (
            <div>
              <dt className="text-[12px] text-fg-faint">כתובת</dt>
              <dd dir="auto">{prospect.address}</dd>
            </div>
          )}
          {prospect.rating !== null && (
            <div>
              <dt className="text-[12px] text-fg-faint">בגוגל</dt>
              <dd>
                ★{prospect.rating.toFixed(1)}
                {prospect.reviews !== null && ` · ${prospect.reviews} ביקורות`}
              </dd>
            </div>
          )}
          {(prospect.unclaimed || prospect.closed) && (
            <div className="text-[12.5px] text-[var(--st-no-answer)]">
              {prospect.unclaimed && <p>בעל העסק לא תבע את הכרטיס בגוגל</p>}
              {prospect.closed && <p>בגוגל העסק מסומן כסגור זמנית</p>}
            </div>
          )}
        </dl>
      </aside>
    </div>
  );
}
