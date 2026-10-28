import { repository } from '../data/repository';
import { isSampleLead } from '../data/sampleLeads';
import { useLeadStore } from '../store/leads';
import { MOD } from './palette/CommandPalette';
import { Kbd } from './ui/Button';

export function Footer() {
  const local = repository.kind === 'local';
  const hasSamples = useLeadStore((s) => s.leads.some(isSampleLead));
  const hasLeads = useLeadStore((s) => s.leads.length > 0);
  const addSampleLeads = useLeadStore((s) => s.addSampleLeads);

  return (
    <footer className="flex flex-col items-center gap-3 pt-10 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] text-center text-[12.5px] text-fg-faint sm:flex-row sm:justify-between sm:pb-10 sm:text-start">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span>{local ? 'הלידים נשמרים רק בדפדפן הזה.' : 'הלידים נשמרים בשרת שלך.'}</span>
        {local && hasLeads && !hasSamples && (
          <button
            type="button"
            onClick={addSampleLeads}
            className="rounded-md px-1.5 py-0.5 font-medium text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
          >
            טעינת לידים לדוגמה
          </button>
        )}
      </p>
      <p className="items-center gap-1.5 max-md:hidden md:flex">
        <Kbd>{MOD === '⌘' ? '⌘K' : 'Ctrl K'}</Kbd> חיפוש ליד ותיעוד שיחה, <Kbd>N</Kbd> ליד חדש, <Kbd>I</Kbd> ייבוא רשימה
      </p>
    </footer>
  );
}
