import { AnimatePresence, motion } from 'motion/react';
import { Info } from 'lucide-react';
import { isSampleLead } from '../data/sampleLeads';
import { EASE_OUT } from '../lib/motion';
import { useLeadStore } from '../store/leads';
import { toast } from '../store/toasts';
import { Button } from './ui/Button';

/** Labels the example data clearly and removes it in one step. */
export function SampleDataBanner() {
  const hasSamples = useLeadStore((s) => s.leads.some(isSampleLead));
  const removeSampleLeads = useLeadStore((s) => s.removeSampleLeads);
  const addSampleLeads = useLeadStore((s) => s.addSampleLeads);

  const remove = () => {
    removeSampleLeads();
    toast.show({ message: 'הלידים לדוגמה הוסרו', action: { label: 'ביטול', onClick: addSampleLeads } });
  };

  return (
    <AnimatePresence initial={false}>
      {hasSamples && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="overflow-hidden"
        >
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:ps-5">
            <p className="flex items-start gap-2.5 text-[13.5px] text-fg-muted">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              אלה לידים לדוגמה, כדי שאפשר יהיה לנסות הכול. כשתהיו מוכנים להוסיף לידים משלכם, אפשר להסיר אותם.
            </p>
            <Button size="sm" onClick={remove}>
              הסרת הלידים לדוגמה
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
