import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  CalendarCheck,
  Check,
  ClipboardPaste,
  Copy,
  CornerDownLeft,
  GraduationCap,
  History,
  LayoutDashboard,
  MessageCircle,
  Moon,
  NotebookPen,
  PanelRightOpen,
  Plus,
  Radar,
  Search,
  Sparkles,
  SquareKanban,
  Sun,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { count, NOUNS } from '../../lib/hebrew';
import { EASE_OUT } from '../../lib/motion';
import { leadCommands, normalize, searchLeads, todaysCalls, type LeadCommand, type LeadCommandItem } from '../../lib/palette';
import { formatPhone } from '../../lib/phone';
import { dueCards } from '../../lib/practice';
import { ARCHIVED_META, leadBadge, OUTCOME_META, STAGE_META, toneStyle } from '../../lib/stages';
import { useLeadStore } from '../../store/leads';
import { toast } from '../../store/toasts';
import { useTraining } from '../../store/training';
import { useUi } from '../../store/ui';
import { useWhatsApp } from '../../store/whatsapp';
import type { Lead } from '../../types';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

const COMMAND_ICON: Record<LeadCommand, LucideIcon> = {
  no_answer: OUTCOME_META.no_answer.icon,
  answered: OUTCOME_META.answered.icon,
  advance: STAGE_META.zoom.icon,
  archive: ARCHIVED_META.icon,
  undo: Undo2,
  open: PanelRightOpen,
  note: NotebookPen,
  coach: Sparkles,
  'copy-phone': Copy,
  'whatsapp-history': History,
};

const COMMAND_TONE: Partial<Record<LeadCommand, string>> = {
  no_answer: OUTCOME_META.no_answer.tone,
  answered: OUTCOME_META.answered.tone,
  advance: STAGE_META.zoom.tone,
  archive: ARCHIVED_META.tone,
  coach: 'var(--st-zoom)',
  'whatsapp-history': 'var(--whatsapp)',
};

const WHATSAPP_STATE = {
  connected: 'מחובר',
  linking: 'בקישור',
  connecting: 'מתחבר',
  reconnecting: 'מתחבר מחדש',
  stopped: 'נעצר',
  unlinked: 'לא מקושר',
} as const;

interface LastStep {
  leadId: string;
  leadName: string;
  actionId: string;
  label: string;
}

/**
 * Ctrl+K (⌘K on a Mac): find any lead by name, contact, campaign or phone digits, and log a call without
 * touching the mouse. Pick a lead, then one key: N אין מענה, A ענה, Z נקבע זום (or the deal closed), X לא רלוונטי,
 * U undo. Keys are physical, so they work on the Hebrew layout too. Empty, it opens on the next of today's
 * calls, and after each step it's ready for the next one.
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const initialLeadId = useUi((s) => s.paletteLeadId);
  const closePalette = useUi((s) => s.closePalette);
  const leads = useLeadStore((s) => s.leads);
  const daily = useLeadStore((s) => s.daily);
  const [search, setSearch] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [last, setLast] = useState<LastStep | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const lead = leads.find((item) => item.id === leadId) ?? null;

  // Each opening starts fresh: on the lead it was opened for, or on the search
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setLeadId(initialLeadId);
    setLast(null);
    setSelected('');
  }, [open, initialLeadId]);

  const showLead = (id: string | null) => {
    setLeadId(id);
    setSearch('');
    setSelected('');
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && closePalette()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-scrim backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                input.current?.focus();
              }}
              onEscapeKeyDown={(event) => {
                // Esc steps back from a lead's actions before it closes the palette
                if (lead && !initialLeadId) {
                  event.preventDefault();
                  showLead(null);
                }
              }}
            >
              <motion.div
                className="glass-strong fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[61] mx-auto flex max-h-[min(640px,calc(100dvh-24px))] max-w-[640px] flex-col overflow-hidden rounded-[22px] sm:top-[12vh]"
                initial={{ opacity: 0, y: -8, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.99 }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
              >
                <Dialog.Title className="sr-only">{lead ? `פעולות עבור ${lead.name}` : 'חיפוש לידים ופקודות'}</Dialog.Title>
                {lead ? (
                  <LeadPage
                    lead={lead}
                    search={search}
                    setSearch={setSearch}
                    selected={selected}
                    setSelected={setSelected}
                    inputRef={input}
                    standalone={Boolean(initialLeadId)}
                    onBack={() => (initialLeadId ? closePalette() : showLead(null))}
                    onStep={(step) => {
                      if (initialLeadId) {
                        closePalette();
                        return;
                      }
                      setLast(step);
                      showLead(null);
                    }}
                  />
                ) : (
                  <RootPage
                    leads={leads}
                    queue={todaysCalls(daily, leads)}
                    search={search}
                    setSearch={setSearch}
                    selected={selected}
                    setSelected={setSelected}
                    inputRef={input}
                    last={last}
                    onUndo={() => {
                      if (!last) return;
                      useLeadStore.getState().undo(last.leadId, last.actionId);
                      setLast(null);
                    }}
                    onPick={showLead}
                  />
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface PageProps {
  search: string;
  setSearch: (value: string) => void;
  selected: string;
  setSelected: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function RootPage({
  leads,
  queue,
  search,
  setSearch,
  selected,
  setSelected,
  inputRef,
  last,
  onUndo,
  onPick,
}: PageProps & {
  leads: Lead[];
  queue: ReturnType<typeof todaysCalls>;
  last: LastStep | null;
  onUndo: () => void;
  onPick: (leadId: string) => void;
}) {
  const ui = useUi();
  const deck = useTraining((s) => s.deck);
  const whatsapp = useWhatsApp((s) => s.status);
  const due = deck ? dueCards(deck.cards).length : 0;
  const query = search.trim();

  const todo = queue.filter((item) => !item.done);
  const next = todo[0] ?? null;
  const positions = useMemo(() => new Map(queue.map((item) => [item.lead.id, item])), [queue]);
  const hits = useMemo(() => searchLeads(leads, query, new Set(queue.map((item) => item.lead.id))), [leads, query, queue]);

  const run = (action: () => void) => {
    ui.closePalette();
    action();
  };
  const commands: { id: string; label: string; icon: LucideIcon; keywords: string; hint?: string; shortcut?: string; onSelect: () => void }[] = [
    {
      id: 'go-dashboard',
      label: 'לוח בקרה: כסף צפוי, עסקאות ותזכורות',
      icon: LayoutDashboard,
      keywords: 'לוח בקרה דשבורד כסף צפוי הכנסות תחזית תזכורות מעקב עסקאות פתוחות dashboard forecast money reminders open deals',
      onSelect: () => run(() => ui.setView('dashboard')),
    },
    {
      id: 'go-today',
      label: 'השיחות של היום',
      icon: CalendarCheck,
      keywords: 'היום עשירייה יומית שיחות תור today daily 10 calls queue',
      hint: next ? `עוד ${todo.length}` : undefined,
      onSelect: () => run(() => ui.setView('today')),
    },
    { id: 'go-pipeline', label: 'משפך המכירות', icon: SquareKanban, keywords: 'משפך לידים רשימה כל הלידים pipeline leads list', onSelect: () => run(() => ui.setView('pipeline')) },
    {
      id: 'go-prospector',
      label: 'מאתר הלידים: חיפוש עסקים חדשים',
      icon: Radar,
      keywords: 'מאתר איתור חיפוש עסקים לידים חדשים גוגל אתר ציון prospector find new leads google places',
      onSelect: () => run(() => ui.setView('prospector')),
    },
    {
      id: 'warm-up',
      label: due ? `חימום: תרגול ${count(Math.min(due, 5), NOUNS.objection)}` : 'אימון התנגדויות',
      icon: GraduationCap,
      keywords: 'אימון התנגדויות כרטיסיות תרגול חימום חפיסה training objections flashcards practice warm up',
      hint: due ? `${due} לתרגול` : undefined,
      onSelect: () =>
        run(() => {
          ui.setView('training');
          if (due) useTraining.getState().start('warm-up');
        }),
    },
    {
      id: 'whatsapp',
      label: 'סנכרון וואטסאפ',
      icon: MessageCircle,
      keywords: 'וואטסאפ קישור סנכרון קריאה בלבד whatsapp link qr sync read-only guard',
      hint: whatsapp?.enabled ? WHATSAPP_STATE[whatsapp.link.state] : whatsapp ? 'כבוי' : undefined,
      onSelect: () => run(() => useWhatsApp.getState().setOpen(true)),
    },
    { id: 'add', label: 'ליד חדש', icon: Plus, keywords: 'ליד חדש הוספה יצירה new add create lead', shortcut: 'N', onSelect: () => run(() => ui.setAddOpen(true)) },
    { id: 'import', label: 'ייבוא לידים', icon: ClipboardPaste, keywords: 'ייבוא הדבקה רשימה אקסל import paste csv bulk', shortcut: 'I', onSelect: () => run(() => ui.setImportOpen(true)) },
    {
      id: 'theme',
      label: ui.theme === 'dark' ? 'מעבר לתצוגה בהירה' : 'מעבר לתצוגה כהה',
      icon: ui.theme === 'dark' ? Sun : Moon,
      keywords: 'תצוגה כהה בהירה מצב לילה theme dark light mode',
      onSelect: () => ui.setTheme(ui.theme === 'dark' ? 'light' : 'dark'),
    },
  ];
  const words = normalize(query).split(' ').filter(Boolean);
  const shownCommands = words.length
    ? commands.filter((command) => words.every((word) => normalize(`${command.label} ${command.keywords}`).includes(word)))
    : commands;

  return (
    <Command
      label="חיפוש לידים ופקודות"
      shouldFilter={false}
      loop
      vimBindings={false}
      value={selected}
      onValueChange={setSelected}
      onKeyDown={(event) => {
        const leadItem = /^lead:(.+)$/.exec(selected);
        // Mod+Enter opens the profile instead of the actions
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && leadItem) {
          event.preventDefault();
          run(() => ui.openProfile(leadItem[1], 'timeline'));
        }
        if (event.code === 'KeyZ' && (event.metaKey || event.ctrlKey) && last) {
          event.preventDefault();
          onUndo();
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <SearchField inputRef={inputRef} value={search} onChange={setSearch} placeholder="חיפוש ליד או פקודה…" />
      {last && (
        <div className="flex items-center gap-2.5 border-b border-line bg-[color-mix(in_oklab,var(--st-won)_7%,transparent)] px-4 py-2.5 text-[13px]">
          <Check className="size-4 shrink-0 text-[var(--st-won)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <b className="font-semibold">{last.label}</b> תועד אצל <span dir="auto">{last.leadName}</span>
          </span>
          <button type="button" onClick={onUndo} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-fg-muted hover:bg-field hover:text-fg">
            <Undo2 className="flip-rtl size-3.5" aria-hidden />
            ביטול <Key>{MOD}</Key>
            <Key>Z</Key>
          </button>
        </div>
      )}
      <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        <Command.Empty className="px-3 py-8 text-center text-[13.5px] text-fg-muted">
          אין ליד או פקודה שמתאימים ל"<span dir="auto">{query}</span>".
        </Command.Empty>

        {!query && next && (
          <Group heading="השיחה הבאה">
            <LeadItem lead={next.lead} badge={`שיחה ${next.position} מתוך ${queue.length}`} onSelect={() => onPick(next.lead.id)} />
          </Group>
        )}
        {!query && todo.length > 1 && (
          <Group heading={`עוד להתקשר היום · ${todo.length - 1}`}>
            {todo.slice(1).map((item) => (
              <LeadItem key={item.lead.id} lead={item.lead} badge={`שיחה ${item.position}`} onSelect={() => onPick(item.lead.id)} />
            ))}
          </Group>
        )}
        {query && hits.length > 0 && (
          <Group heading="לידים">
            {hits.map(({ lead }) => {
              const place = positions.get(lead.id);
              return (
                <LeadItem
                  key={lead.id}
                  lead={lead}
                  badge={place ? (place.done ? 'היום · בוצע' : `היום · שיחה ${place.position}`) : undefined}
                  onSelect={() => onPick(lead.id)}
                />
              );
            })}
          </Group>
        )}
        {shownCommands.length > 0 && (
          <Group heading={query ? 'פקודות' : 'מעבר אל'}>
            {shownCommands.map((command) => (
              <Item key={command.id} value={`command:${command.id}`} onSelect={command.onSelect}>
                <command.icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint && <span className="shrink-0 text-[12.5px] text-fg-faint">{command.hint}</span>}
                {command.shortcut && <Key>{command.shortcut}</Key>}
              </Item>
            ))}
          </Group>
        )}
      </Command.List>
      <Footer>
        <span><Key>↑</Key><Key>↓</Key> מעבר</span>
        <span><Key><CornerDownLeft className="size-3" aria-hidden /></Key> תיעוד שיחה</span>
        <span className="max-sm:hidden"><Key>{MOD}</Key><Key><CornerDownLeft className="size-3" aria-hidden /></Key> פתיחת הפרופיל</span>
        <span className="ms-auto"><Key>esc</Key> סגירה</span>
      </Footer>
    </Command>
  );
}

function LeadPage({
  lead,
  search,
  setSearch,
  selected,
  setSelected,
  inputRef,
  standalone,
  onBack,
  onStep,
}: PageProps & { lead: Lead; standalone: boolean; onBack: () => void; onStep: (step: LastStep) => void }) {
  const ui = useUi();
  const whatsappOn = useWhatsApp((s) => s.status?.enabled === true && s.status.link.state === 'connected');
  const commands = leadCommands(lead, { whatsapp: whatsappOn });
  const words = normalize(search).split(' ').filter(Boolean);
  const shown = words.length ? commands.filter((item) => words.every((word) => normalize(`${item.label} ${item.hint ?? ''}`).includes(word))) : commands;
  const badge = leadBadge(lead);

  const runCommand = (item: LeadCommandItem) => {
    const store = useLeadStore.getState();
    switch (item.command) {
      case 'no_answer':
      case 'answered':
      case 'advance':
      case 'archive': {
        const closing = item.command === 'advance' && lead.stage === 'zoom';
        const result = store.act(lead.id, item.command);
        if (!result) return;
        if (closing) {
          // A closed deal needs its amounts: straight to the Details tab, which starts on the setup fee.
          ui.closePalette();
          ui.openProfile(lead.id, 'details');
          toast.show({
            message: 'העסקה נסגרה',
            description: 'רשמו את סכומי העסקה כדי שייכנסו להכנסות.',
            duration: 8000,
            action: { label: 'ביטול', onClick: () => useLeadStore.getState().undo(lead.id, result.id) },
          });
          return;
        }
        onStep({ leadId: lead.id, leadName: lead.name, actionId: result.id, label: item.label });
        return;
      }
      case 'undo':
        if (lead.activity[0]) store.undo(lead.id, lead.activity[0].id);
        ui.closePalette();
        return;
      case 'open':
        ui.closePalette();
        ui.openProfile(lead.id, 'timeline');
        return;
      case 'note':
        ui.closePalette();
        ui.openProfile(lead.id, 'timeline');
        setTimeout(() => document.getElementById(`composer-${lead.id}`)?.focus(), 350);
        return;
      case 'coach':
        ui.closePalette();
        ui.openProfile(lead.id, 'coach');
        return;
      case 'copy-phone':
        void navigator.clipboard.writeText(lead.phone.trim()).then(
          () => toast.success('מספר הטלפון הועתק', formatPhone(lead.phone)),
          () => toast.error('לא הצלחנו להעתיק את המספר.'),
        );
        ui.closePalette();
        return;
      case 'whatsapp-history':
        ui.closePalette();
        void useWhatsApp.getState().fetchHistory(lead.id);
        return;
    }
  };

  return (
    <Command
      label={`פעולות עבור ${lead.name}`}
      shouldFilter={false}
      loop
      vimBindings={false}
      value={selected}
      onValueChange={setSelected}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Backspace' && !search) {
          event.preventDefault();
          onBack();
          return;
        }
        // One key per action while nothing is typed: works on any keyboard layout (physical keys)
        if (search) return;
        const item = commands.find((command) => command.code === event.code);
        if (item) {
          event.preventDefault();
          runCommand(item);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 pt-3.5 pb-3">
        <button type="button" onClick={onBack} aria-label={standalone ? 'סגירה' : 'חזרה לחיפוש'} className="-ms-1.5 rounded-lg p-1.5 text-fg-muted hover:bg-field hover:text-fg">
          <ArrowLeft className="flip-rtl size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-[15.5px] font-semibold tracking-[-0.01em]">{lead.name}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[12.5px] text-fg-muted">
            <span style={toneStyle(badge.tone)} className="tone-chip rounded-full px-2 py-px text-[11.5px] font-semibold">{badge.label}</span>
            {lead.contactName && <span dir="auto" className="truncate">{lead.contactName}</span>}
            {lead.phone && <span className="ltr tabular-nums">{formatPhone(lead.phone)}</span>}
          </p>
        </div>
      </div>
      <SearchField inputRef={inputRef} value={search} onChange={setSearch} placeholder="הקישו אות, או הקלידו לסינון…" compact />
      <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        <Command.Empty className="px-3 py-8 text-center text-[13.5px] text-fg-muted">
          אין פעולה שמתאימה ל"<span dir="auto">{search}</span>".
        </Command.Empty>
        {(['log', 'lead'] as const).map((group) => {
          const items = shown.filter((item) => item.group === group);
          if (!items.length) return null;
          return (
            <Group key={group} heading={group === 'log' ? 'תיעוד השיחה' : 'הליד הזה'}>
              {items.map((item) => {
                const Icon = COMMAND_ICON[item.command];
                const tone = COMMAND_TONE[item.command];
                return (
                  <Item key={item.command} value={`action:${item.command}`} onSelect={() => runCommand(item)}>
                    <Icon className="size-4 shrink-0" style={{ color: tone ?? 'var(--fg-muted)' }} aria-hidden />
                    <span className="min-w-0 truncate font-medium">{item.label}</span>
                    {item.hint && (
                      <span dir={item.command === 'copy-phone' ? 'ltr' : 'auto'} className="min-w-0 flex-1 truncate text-start text-[12.5px] text-fg-faint">
                        {item.hint}
                      </span>
                    )}
                    <Key className="ms-auto">{item.key}</Key>
                  </Item>
                );
              })}
            </Group>
          );
        })}
      </Command.List>
      <Footer>
        <span>הקישו אות</span>
        <span><Key><CornerDownLeft className="size-3" aria-hidden /></Key> הפעלה</span>
        <span className="ms-auto"><Key>⌫</Key> {standalone ? 'סגירה' : 'חזרה'}</span>
      </Footer>
    </Command>
  );
}

function SearchField({
  inputRef,
  value,
  onChange,
  placeholder,
  compact,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-line px-4', compact ? 'h-11' : 'h-14')}>
      <Search className="size-[18px] shrink-0 text-fg-faint" aria-hidden />
      <Command.Input
        ref={inputRef}
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        dir="auto"
        className={cn('min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-faint focus:outline-none', compact ? 'text-[14px]' : 'text-base sm:text-[15.5px]')}
      />
      {!compact && <Key className="max-sm:hidden">esc</Key>}
    </div>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.03em] [&_[cmdk-group-heading]]:text-fg-faint [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}

function Item({ value, onSelect, children }: { value: string; onSelect: () => void; children: ReactNode }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-[14px] text-fg transition-colors data-[selected=true]:bg-field-hover data-[selected=true]:ring-1 data-[selected=true]:ring-line data-[selected=true]:ring-inset"
    >
      {children}
    </Command.Item>
  );
}

function LeadItem({ lead, badge, onSelect }: { lead: Lead; badge?: string; onSelect: () => void }) {
  const stage = leadBadge(lead);
  return (
    <Item value={`lead:${lead.id}`} onSelect={onSelect}>
      <span style={toneStyle(stage.tone)} className="tone-chip flex size-7 shrink-0 items-center justify-center rounded-full">
        <stage.icon className="size-3.5" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-start font-medium">{lead.name}</span>
        <span className="flex min-w-0 gap-2 text-[12.5px] text-fg-muted">
          {lead.contactName && <span dir="auto" className="truncate">{lead.contactName}</span>}
          {lead.phone && <span className="ltr shrink-0 tabular-nums">{formatPhone(lead.phone)}</span>}
          {lead.campaign && <span dir="auto" className="truncate text-fg-faint max-sm:hidden">{lead.campaign}</span>}
        </span>
      </span>
      {badge && <span className="shrink-0 rounded-full bg-field px-2 py-0.5 text-[11.5px] font-medium text-fg-muted ring-1 ring-line ring-inset">{badge}</span>}
    </Item>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[12px] text-fg-faint">{children}</div>;
}

export function Key({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-field px-1 font-sans text-[11px] font-medium text-fg-muted ring-1 ring-line ring-inset [&+&]:ms-0.5',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
