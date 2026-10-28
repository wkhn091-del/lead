import { AnimatePresence } from 'motion/react';
import { CircleAlert, ClipboardPaste, Inbox, Plus, RotateCcw, SearchX, type LucideIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { repository } from '../data/repository';
import { filterLeads } from '../lib/leads';
import { STAGE_META } from '../lib/stages';
import { useLeadStore } from '../store/leads';
import { useUi } from '../store/ui';
import { LeadRow } from './LeadRow';
import { Button } from './ui/Button';

export function LeadList() {
  const { leads, loadState, loadError, load, addSampleLeads } = useLeadStore(
    useShallow((s) => ({
      leads: s.leads,
      loadState: s.loadState,
      loadError: s.loadError,
      load: s.load,
      addSampleLeads: s.addSampleLeads,
    })),
  );
  const { query, stageFilter, campaignFilter, sort, expandedId, resetFilters, setAddOpen, setImportOpen } = useUi(
    useShallow((s) => ({
      query: s.query,
      stageFilter: s.stageFilter,
      campaignFilter: s.campaignFilter,
      sort: s.sort,
      expandedId: s.expandedId,
      resetFilters: s.resetFilters,
      setAddOpen: s.setAddOpen,
      setImportOpen: s.setImportOpen,
    })),
  );

  const visible = useMemo(
    () => filterLeads(leads, { query, stage: stageFilter, campaign: campaignFilter, sort, pinnedId: expandedId }),
    [leads, query, stageFilter, campaignFilter, sort, expandedId],
  );

  if (loadState === 'idle' || (loadState === 'loading' && leads.length === 0)) {
    return (
      <Panel>
        <LoadingRows />
      </Panel>
    );
  }

  if (loadState === 'error' && leads.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={CircleAlert}
          title="לא הצלחנו לטעון את הלידים"
          body={loadError ?? 'בדקו את החיבור ונסו שוב.'}
          actions={
            <Button onClick={() => void load()}>
              <RotateCcw className="size-4" aria-hidden />
              לנסות שוב
            </Button>
          }
        />
      </Panel>
    );
  }

  if (leads.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Inbox}
          title="עדיין אין לידים"
          body="הוסיפו את העסקים שאתם מתקשרים אליהם, או הדביקו רשימה שלמה מאקסל, ועקבו אחרי כל עסקה מהשיחה הראשונה ועד החתימה."
          actions={
            <>
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                ליד חדש
              </Button>
              <Button onClick={() => setImportOpen(true)}>
                <ClipboardPaste className="size-4" aria-hidden />
                ייבוא רשימה
              </Button>
              {repository.kind === 'local' && (
                <Button variant="ghost" onClick={addSampleLeads}>
                  טעינת לידים לדוגמה
                </Button>
              )}
            </>
          }
        />
      </Panel>
    );
  }

  const trimmed = query.trim();

  return (
    <Panel>
      <div
        aria-hidden
        className="lead-grid hidden border-b border-line px-5 py-3 text-[12.5px] font-medium text-fg-faint lg:grid"
      >
        <span className="ga-name">ליד</span>
        <span className="ga-meta">קמפיין</span>
        <span className="ga-status">שלב</span>
        <span className="ga-calls">שיחות</span>
        <span className="ga-value text-end">עסקה</span>
        <span className="ga-updated text-end">עודכן</span>
        <span className="ga-chevron" />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={
            trimmed
              ? `אין לידים שמתאימים לחיפוש "${trimmed}"`
              : `${stageFilter === 'archived' ? 'אין לידים שסומנו כלא רלוונטיים' : stageFilter === 'all' ? 'אין כאן לידים' : `אין לידים בשלב ${STAGE_META[stageFilter].label}`}${campaignFilter ? ` בקמפיין ${campaignFilter}` : ''}`
          }
          body="נסו חיפוש, שלב או קמפיין אחר."
          actions={<Button onClick={resetFilters}>ניקוי הסינון</Button>}
        />
      ) : (
        <ul className="relative">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((lead) => (
              <LeadRow key={lead.id} lead={lead} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="glass overflow-hidden rounded-[22px]">{children}</div>;
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="טוען לידים" className="divide-y divide-line">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-4">
          <div className="h-4 w-44 animate-pulse rounded-full bg-field-hover" />
          <div className="ms-auto h-4 w-20 animate-pulse rounded-full bg-field-hover" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actions?: ReactNode;
}

function EmptyState({ icon: Icon, title, body, actions }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-field text-fg-muted ring-1 ring-line ring-inset">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 dir="auto" className="mt-4 text-[16px] font-semibold text-balance">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-[14px] text-pretty text-fg-muted">{body}</p>
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
