import { create } from 'zustand';
import { repository } from '../data/repository';
import { ApiError } from '../data/repository/http';
import { count, NOUNS } from '../lib/hebrew';
import { canImport, isChecking, isRunning, searchLabel, targetCount, type ProspectFilter, type ProspectSort } from '../lib/prospects';
import type { NewProspectSearch, Prospect, ProspectorStatus, ProspectSearch, ProspectSearchResults } from '../types';
import { useLeadStore } from './leads';
import { toast } from './toasts';
import { useUi } from './ui';

/** How often a running search is read again while its websites are checked */
const POLL_MS = 2000;
/** Searches running elsewhere (another tab, a restart) are noticed this often */
const LIST_POLL_MS = 6000;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface ProspectorState {
  status: ProspectorStatus | null;
  loadState: LoadState;
  loadError: string | null;
  /** Recent searches, newest first */
  searches: ProspectSearch[];
  /** The search on screen, with its businesses in Google's order */
  current: ProspectSearchResults | null;
  /** A search is running on the server; the tab shows it */
  searching: boolean;
  starting: boolean;
  opening: boolean;
  importing: boolean;
  /** Businesses picked for import */
  selected: ReadonlySet<string>;
  /** Businesses being checked again, until their check finishes */
  rechecking: ReadonlySet<string>;
  filter: ProspectFilter;
  sort: ProspectSort;
  /** The business whose details are open */
  openId: string | null;
  load: () => Promise<void>;
  /** Starts a search and shows it. False when it couldn't start. */
  start: (input: NewProspectSearch) => Promise<boolean>;
  open: (id: string) => Promise<void>;
  cancel: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  recheck: (id: string) => Promise<void>;
  toggle: (id: string) => void;
  setSelected: (ids: Iterable<string>, on: boolean) => void;
  clearSelection: () => void;
  setFilter: (filter: ProspectFilter) => void;
  setSort: (sort: ProspectSort) => void;
  setOpenId: (id: string | null) => void;
  /** Adds the picked businesses as leads; they join the Daily 10 pool */
  importSelected: () => Promise<void>;
  reset: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'שגיאה לא ידועה');

let pollTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every open and reset, so an answer for a search no longer on screen is dropped */
let generation = 0;

export const useProspector = create<ProspectorState>()((set, get) => {
  /** Puts a search's latest numbers into the list */
  const mergeSearch = (search: ProspectSearch) =>
    set((state) => {
      const searches = state.searches.some((item) => item.id === search.id)
        ? state.searches.map((item) => (item.id === search.id ? search : item))
        : [search, ...state.searches];
      return { searches, searching: searches.some(isRunning) };
    });

  const replaceProspect = (prospect: Prospect) =>
    set((state) =>
      state.current
        ? { current: { ...state.current, prospects: state.current.prospects.map((item) => (item.id === prospect.id ? prospect : item)) } }
        : {},
    );

  /** What still needs reading again: the search on screen, the list, or nothing */
  const pollTarget = (): 'current' | 'list' | null => {
    const { current, rechecking, searches } = get();
    if (current && (isRunning(current.search) || current.prospects.some((item) => rechecking.has(item.id) && isChecking(item)))) return 'current';
    return searches.some(isRunning) ? 'list' : null;
  };

  const schedulePoll = (delay?: number) => {
    clearTimeout(pollTimer);
    const target = pollTarget();
    if (!target) return;
    pollTimer = setTimeout(() => void poll(target), delay ?? (target === 'current' ? POLL_MS : LIST_POLL_MS));
  };

  /** Tells you a search finished while you were on another screen */
  const announce = (search: ProspectSearch) => {
    if (useUi.getState().view === 'prospector' || search.status !== 'done') return;
    toast.show({
      message: `החיפוש "${searchLabel(search)}" הסתיים`,
      description: `${count(targetCount(search), NOUNS.business)} עם ציון 4-5, מתוך ${search.total}.`,
      duration: 8000,
      action: { label: 'לתוצאות', onClick: () => useUi.getState().setView('prospector') },
    });
  };

  async function refreshCurrent(): Promise<void> {
    const shown = get().current;
    if (!shown) return;
    const ticket = generation;
    const results = await repository.prospectSearch(shown.search.id);
    if (ticket !== generation) return;
    const wasRunning = isRunning(shown.search);
    const done = new Set(results.prospects.filter((item) => !isChecking(item)).map((item) => item.id));
    set((state) => ({
      current: results,
      rechecking: new Set([...state.rechecking].filter((id) => !done.has(id))),
    }));
    mergeSearch(results.search);
    if (wasRunning && !isRunning(results.search)) {
      announce(results.search);
      // The search used some of the month's SerpApi searches, or the backup took over: show where they stand now
      void repository
        .prospector()
        .then((status) => {
          if (ticket === generation) set({ status });
        })
        .catch(() => {});
    }
  }

  let failures = 0;
  async function poll(target: 'current' | 'list') {
    try {
      if (target === 'current') await refreshCurrent();
      else {
        const before = get().searches;
        const status = await repository.prospector();
        const searches = status.searches ?? [];
        set({ status, searches, searching: searches.some(isRunning) });
        for (const search of searches) {
          if (before.find((item) => item.id === search.id && isRunning(item)) && !isRunning(search)) announce(search);
        }
      }
      failures = 0;
      schedulePoll();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Deleted elsewhere
        set({ current: null, selected: new Set() });
        void get().load();
        return;
      }
      failures += 1;
      schedulePoll(Math.min(30_000, POLL_MS * 2 ** failures));
    }
  }

  return {
    status: null,
    loadState: 'idle',
    loadError: null,
    searches: [],
    current: null,
    searching: false,
    starting: false,
    opening: false,
    importing: false,
    selected: new Set(),
    rechecking: new Set(),
    filter: 'targets',
    sort: 'score',
    openId: null,

    async load() {
      if (get().loadState === 'loading') return;
      set((state) => ({ loadState: state.status ? 'ready' : 'loading', loadError: null }));
      try {
        const status = await repository.prospector();
        const searches = status.searches ?? [];
        set({ status, searches, searching: searches.some(isRunning), loadState: 'ready' });
        const { current } = get();
        // Back on the page: the search you were on, or the latest one (a running search first)
        const next = current ? searches.find((item) => item.id === current.search.id) : (searches.find(isRunning) ?? searches[0]);
        if (next && next.id !== current?.search.id) await get().open(next.id);
        else if (current && !next) set({ current: null, selected: new Set() });
        else {
          if (current) await refreshCurrent().catch(() => {});
          schedulePoll();
        }
      } catch (error) {
        set((state) => ({ loadState: state.status ? 'ready' : 'error', loadError: messageOf(error) }));
      }
    },

    async start(input) {
      if (get().starting) return false;
      set({ starting: true });
      try {
        const search = await repository.startProspectSearch(input);
        generation += 1;
        mergeSearch(search);
        set({ current: { search, prospects: [] }, selected: new Set(), rechecking: new Set(), openId: null, filter: 'targets' });
        schedulePoll();
        return true;
      } catch (error) {
        toast.error('החיפוש לא התחיל.', messageOf(error));
        return false;
      } finally {
        set({ starting: false });
      }
    },

    async open(id) {
      generation += 1;
      const ticket = generation;
      clearTimeout(pollTimer);
      const listed = get().searches.find((item) => item.id === id);
      set({
        opening: true,
        selected: new Set(),
        rechecking: new Set(),
        openId: null,
        // The numbers show right away; the businesses follow
        current: listed ? { search: listed, prospects: [] } : get().current,
      });
      try {
        const results = await repository.prospectSearch(id);
        if (ticket !== generation) return;
        set({ current: results });
        mergeSearch(results.search);
      } catch (error) {
        if (ticket !== generation) return;
        toast.error('לא הצלחנו לפתוח את החיפוש.', messageOf(error));
        if (error instanceof ApiError && error.status === 404) {
          set((state) => ({ current: null, searches: state.searches.filter((item) => item.id !== id) }));
        }
      } finally {
        if (ticket === generation) set({ opening: false });
        schedulePoll();
      }
    },

    async cancel() {
      const current = get().current;
      if (!current || !isRunning(current.search)) return;
      try {
        const search = await repository.cancelProspectSearch(current.search.id);
        mergeSearch(search);
        await refreshCurrent();
      } catch (error) {
        toast.error('לא הצלחנו לעצור את החיפוש.', messageOf(error));
      }
    },

    async remove(id) {
      try {
        await repository.removeProspectSearch(id);
        generation += 1;
        set((state) => {
          const searches = state.searches.filter((item) => item.id !== id);
          const shown = state.current?.search.id === id;
          return {
            searches,
            searching: searches.some(isRunning),
            current: shown ? null : state.current,
            selected: shown ? new Set() : state.selected,
          };
        });
        toast.show({ message: 'החיפוש נמחק', description: 'לידים שייבאת ממנו נשארו ב-CRM.' });
        schedulePoll();
      } catch (error) {
        toast.error('לא הצלחנו למחוק את החיפוש.', messageOf(error));
      }
    },

    async recheck(id) {
      const prospect = get().current?.prospects.find((item) => item.id === id);
      if (!prospect || get().rechecking.has(id)) return;
      set((state) => ({ rechecking: new Set([...state.rechecking, id]) }));
      replaceProspect({ ...prospect, analysis: { ...prospect.analysis, status: 'checking', error: null } });
      try {
        replaceProspect(await repository.recheckProspect(id));
        schedulePoll();
      } catch (error) {
        replaceProspect(prospect);
        set((state) => ({ rechecking: new Set([...state.rechecking].filter((item) => item !== id)) }));
        toast.error('הבדיקה החוזרת לא התחילה.', messageOf(error));
      }
    },

    toggle(id) {
      set((state) => {
        const selected = new Set(state.selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        return { selected };
      });
    },

    setSelected(ids, on) {
      set((state) => {
        const selected = new Set(state.selected);
        for (const id of ids) {
          if (on) selected.add(id);
          else selected.delete(id);
        }
        return { selected };
      });
    },

    clearSelection: () => set({ selected: new Set() }),
    setFilter: (filter) => set({ filter }),
    setSort: (sort) => set({ sort }),
    setOpenId: (openId) => set({ openId }),

    async importSelected() {
      const { current, selected, importing } = get();
      if (!current || importing) return;
      const ids = current.prospects.filter((item) => selected.has(item.id) && canImport(item)).map((item) => item.id);
      if (!ids.length) return;
      set({ importing: true });
      try {
        const result = await repository.importProspects(ids);
        const createdIds = new Set(result.created.map((lead) => lead.id));
        if (result.created.length) {
          // The new leads join the list and the pool today's calls are drawn from
          useLeadStore.setState((state) => ({ leads: [...result.created, ...state.leads.filter((lead) => !createdIds.has(lead.id))] }));
          useUi.getState().highlight([...createdIds]);
          void useLeadStore.getState().loadDaily();
        }
        set({ selected: new Set() });
        await refreshCurrent().catch(() => {});
        const known = result.skipped.filter((item) => item.reason !== 'missing').length;
        if (result.created.length) {
          toast.show({
            tone: 'success',
            message:
              result.created.length === 1
                ? 'ליד אחד נוסף למאגר של העשירייה היומית'
                : `${result.created.length} לידים נוספו למאגר של העשירייה היומית`,
            description: known
              ? known === 1
                ? 'עסק אחד כבר ב-CRM (אותו טלפון או אתר), אז הוא לא נוסף שוב.'
                : `${known} עסקים כבר ב-CRM (אותו טלפון או אתר), אז הם לא נוספו שוב.`
              : 'הם בשלב שיחה קרה, עם ניתוח האתר בציר הזמן.',
            duration: 7000,
            action: { label: 'לשיחות של היום', onClick: () => useUi.getState().setView('today') },
          });
        } else {
          toast.show({ message: known === 1 ? 'העסק הזה כבר נמצא ב-CRM' : 'כל העסקים שבחרת כבר נמצאים ב-CRM' });
        }
      } catch (error) {
        toast.error('הייבוא נכשל.', messageOf(error));
      } finally {
        set({ importing: false });
      }
    },

    reset() {
      generation += 1;
      clearTimeout(pollTimer);
      set({
        status: null,
        loadState: 'idle',
        loadError: null,
        searches: [],
        current: null,
        searching: false,
        starting: false,
        opening: false,
        importing: false,
        selected: new Set(),
        rechecking: new Set(),
        filter: 'targets',
        sort: 'score',
        openId: null,
      });
    },
  };
});
