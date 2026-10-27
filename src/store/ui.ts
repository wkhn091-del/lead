import { create } from 'zustand';
import type { SortKey, StageFilter } from '../lib/leads';
import { applyThemePreference, readThemePreference, type ThemePreference } from '../lib/theme';

export type View = 'dashboard' | 'today' | 'pipeline' | 'prospector' | 'training';
const VIEWS: readonly View[] = ['dashboard', 'today', 'pipeline', 'prospector', 'training'];
/** The parts of a lead's profile */
export type ProfileTab = 'timeline' | 'details' | 'coach';

interface UiState {
  view: View;
  query: string;
  stageFilter: StageFilter;
  /** Empty string for every campaign */
  campaignFilter: string;
  sort: SortKey;
  /** Lead whose details are open in the pipeline list */
  expandedId: string | null;
  /** Lead whose details are open in a dialog (from the Today view) */
  detailsId: string | null;
  /** The profile tab last chosen, shared by every lead */
  profileTab: ProfileTab;
  /** A timeline entry to open for writing when the timeline shows, like the step just logged from a daily card */
  editEntryId: string | null;
  /** Leads that briefly glow after they are added or imported */
  highlightedIds: ReadonlySet<string>;
  addOpen: boolean;
  importOpen: boolean;
  /** The Ctrl+K command palette, optionally opened on one lead's actions */
  paletteOpen: boolean;
  paletteLeadId: string | null;
  theme: ThemePreference;
  setView: (view: View) => void;
  setQuery: (query: string) => void;
  setStageFilter: (filter: StageFilter) => void;
  setCampaignFilter: (campaign: string) => void;
  setSort: (sort: SortKey) => void;
  resetFilters: () => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string | null) => void;
  setDetailsId: (id: string | null) => void;
  setProfileTab: (tab: ProfileTab) => void;
  /** Opens a lead's profile in a dialog, on a tab, optionally with one entry open for writing */
  openProfile: (id: string, tab?: ProfileTab, editEntryId?: string | null) => void;
  setEditEntryId: (id: string | null) => void;
  setAddOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  openPalette: (leadId?: string | null) => void;
  closePalette: () => void;
  highlight: (ids: readonly string[]) => void;
  setTheme: (theme: ThemePreference) => void;
}

/** The view in the address (#today, #pipeline…); the dashboard when there is none */
const readView = (): View => {
  const hash = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  return VIEWS.find((view) => view === hash) ?? 'dashboard';
};

let highlightTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>()((set) => ({
  view: readView(),
  query: '',
  stageFilter: 'all',
  campaignFilter: '',
  sort: 'newest',
  expandedId: null,
  detailsId: null,
  profileTab: 'timeline',
  editEntryId: null,
  highlightedIds: new Set(),
  addOpen: false,
  importOpen: false,
  paletteOpen: false,
  paletteLeadId: null,
  theme: readThemePreference(),
  setView: (view) => {
    try {
      history.replaceState(null, '', `#${view}`);
    } catch {
      // The address can't change here (a sandboxed frame); the view still switches.
    }
    set({ view });
  },
  setQuery: (query) => set({ query }),
  setStageFilter: (stageFilter) => set({ stageFilter }),
  setCampaignFilter: (campaignFilter) => set({ campaignFilter }),
  setSort: (sort) => set({ sort }),
  resetFilters: () => set({ query: '', stageFilter: 'all', campaignFilter: '' }),
  toggleExpanded: (id) => set((state) => ({ expandedId: state.expandedId === id ? null : id })),
  setExpanded: (expandedId) => set({ expandedId }),
  setDetailsId: (detailsId) => set({ detailsId }),
  setProfileTab: (profileTab) => set({ profileTab }),
  openProfile: (detailsId, tab, editEntryId = null) =>
    set((state) => ({ detailsId, profileTab: tab ?? state.profileTab, editEntryId })),
  setEditEntryId: (editEntryId) => set({ editEntryId }),
  setAddOpen: (addOpen) => set({ addOpen }),
  setImportOpen: (importOpen) => set({ importOpen }),
  openPalette: (paletteLeadId = null) => set({ paletteOpen: true, paletteLeadId }),
  closePalette: () => set({ paletteOpen: false, paletteLeadId: null }),
  highlight: (ids) => {
    clearTimeout(highlightTimer);
    set({ highlightedIds: new Set(ids) });
    highlightTimer = setTimeout(() => set({ highlightedIds: new Set() }), 2400);
  },
  setTheme: (theme) => {
    applyThemePreference(theme);
    set({ theme });
  },
}));
