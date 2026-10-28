import { Handshake, Lock, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { DEAL_FIELDS, DEAL_META, dealPhrase, firstYearValue, hasDealTerms, justClosed, recurringYearly } from '../../lib/deal';
import { formatMoney } from '../../lib/format';
import { useLeadStore } from '../../store/leads';
import { useTimeline } from '../../store/timeline';
import type { Currency, DealTerms, Lead } from '../../types';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { FormSection } from '../ui/FormSection';
import { Segmented, type SegmentedOption } from '../ui/Segmented';

const CURRENCY_OPTIONS: readonly SegmentedOption<Currency>[] = [
  { value: 'ILS', label: '₪', ariaLabel: 'שקלים' },
  { value: 'USD', label: '$', ariaLabel: 'דולרים' },
];

/**
 * What the deal brings in, laid out like a quote: the one-time setup fee, the monthly retainer and the yearly
 * domain and hosting renewal, then what that adds up to. Locked until the deal closes, as the server requires.
 */
export function DealSection({ lead }: { lead: Lead }) {
  const updateLead = useLeadStore((s) => s.updateLead);
  const closed = lead.stage === 'closed';

  return (
    <FormSection
      titleId={`lead-${lead.id}-deal`}
      title="העסקה"
      icon={Handshake}
      aside={
        closed && (
          <Segmented
            label="מטבע"
            value={lead.currency}
            options={CURRENCY_OPTIONS}
            onChange={(currency) => updateLead(lead.id, { currency })}
            className="h-9 w-[5.5rem] shrink-0 [&_button]:px-2"
          />
        )
      }
    >
      {closed ? <DealTermsEditor lead={lead} /> : <LockedDeal archived={Boolean(lead.archivedAt)} />}
    </FormSection>
  );
}

function DealTermsEditor({ lead }: { lead: Lead }) {
  const updateLead = useLeadStore((s) => s.updateLead);
  // The price the deal analysis recommended, if there is one
  const pricing = useTimeline((s) => s.profiles[lead.id]?.coaching?.analysis.pricing ?? null);
  // Just closed: start on the setup fee. Decided once, so it doesn't jump back after the first amount.
  const [startHere] = useState(() => justClosed(lead));
  const { deal, currency } = lead;
  const filled = hasDealTerms(deal);
  const recurring = recurringYearly(deal);
  const suggestion = pricing && hasDealTerms(pricing) ? dealPhrase(pricing, pricing.currency) : null;

  const applySuggestion = () => {
    if (!pricing) return;
    updateLead(lead.id, {
      currency: pricing.currency,
      deal: { setupFee: pricing.setupFee, monthlyRetainer: pricing.monthlyRetainer, hostingYearly: pricing.hostingYearly },
    });
    // The suggestion hides (see the totals below); the amounts take focus, to check or change them
    document.getElementById(`lead-${lead.id}-setupFee`)?.focus();
  };

  return (
    <div>
      {suggestion && (
        <div
          hidden={filled}
          style={{ background: 'color-mix(in oklab, var(--st-won) 7%, transparent)' }}
          className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl px-3.5 py-2.5 ring-1 ring-[color-mix(in_oklab,var(--st-won)_25%,transparent)] ring-inset"
        >
          <p className="flex min-w-0 items-center gap-2 text-[13px] text-pretty">
            <Sparkles className="size-4 shrink-0 text-[var(--st-won)]" aria-hidden />
            <span className="min-w-0">
              <span className="text-fg-muted">ניתוח העסקה המליץ על </span>
              <span className="font-medium tabular-nums">{suggestion}</span>
            </span>
          </p>
          <Button size="sm" onClick={applySuggestion}>
            מילוי לפי ההמלצה
          </Button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {DEAL_FIELDS.map((field, index) => {
          const meta = DEAL_META[field];
          const id = `lead-${lead.id}-${field}`;
          return (
            <li key={field} className="grid grid-cols-[minmax(0,1fr)_minmax(8.5rem,11rem)] items-center gap-x-4 py-3 first:pt-0">
              <div className="min-w-0">
                <label htmlFor={id} className="block text-[14px] font-medium text-fg">
                  {meta.label}
                </label>
                <p id={`${id}-hint`} className="mt-0.5 text-[12.5px] leading-snug text-fg-muted">
                  {meta.hint}
                </p>
              </div>
              <AmountInput
                id={id}
                value={deal[field]}
                currency={currency}
                per={meta.per}
                hintId={`${id}-hint`}
                autoFocus={startHere && index === 0}
                onCommit={(amount) => updateLead(lead.id, { deal: { [field]: amount } as Partial<DealTerms> })}
              />
            </li>
          );
        })}
      </ul>

      {/*
        The totals show and hide rather than mount, so saving an amount never takes nodes out of the page while
        focus moves to the next field: inside a dialog, that would send focus back to the dialog itself.
      */}
      <div className="mt-1 border-t border-line-strong pt-3.5">
        <dl hidden={!filled} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13.5px] text-fg-muted">שווי העסקה בשנה הראשונה</dt>
            <dd className="text-[20px] leading-tight tracking-[-0.02em] tabular-nums [font-weight:600] [font-stretch:92%]">
              {formatMoney(firstYearValue(deal), currency)}
            </dd>
          </div>
          <div hidden={recurring === 0} className="flex items-baseline justify-between gap-4">
            <dt className="text-[13.5px] text-fg-muted">ובכל שנה אחריה</dt>
            <dd className="text-[15px] font-semibold tabular-nums">{formatMoney(recurring, currency)}</dd>
          </div>
        </dl>
        <p hidden={filled} className="text-[13px] text-fg-muted">
          הסכומים נכנסים להכנסות שבראש המשפך.
        </p>
      </div>
    </div>
  );
}

function LockedDeal({ archived }: { archived: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3.5">
      <Lock className="mt-0.5 size-4 shrink-0 text-fg-faint" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-fg">{archived ? 'אין כאן עסקה' : 'נפתח כשהעסקה נסגרת'}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-fg-muted">
          {archived
            ? 'הליד סומן כלא רלוונטי.'
            : 'אז רושמים כאן את דמי ההקמה, הריטיינר החודשי והדומיין והאחסון.'}
        </p>
      </div>
    </div>
  );
}
