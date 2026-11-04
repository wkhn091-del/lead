import { create } from 'zustand';
import type { SortingState } from '@tanstack/react-table';
import { BOARD_COLUMNS, type BoardColumn } from '../lib/board';
import type { AddedFilter } from '../lib/leads-table';
import { safeStorage } from '../lib/storage';
import { applyThemePreference, readThemePreference, type ThemePreference } from '../lib/theme';

export type View = 'dashboard' | 'today' | 'pipeline' | 'prospector' | 'training';
const VIEWS: readonly View[] = ['dashboard', 'today', 'pipeline', 'prospector', 'training'];
const BOARD_TAB_KEY = 'omek-crm:board-tab';
const LAYOUT_KEY = 'omek-crm:leads-layout';

/** How the leads show: a table, or a column per status */
export type LeadsLayout = 'table' | 'board';
/** The parts of a lead's profile */
export type ProfileTab = 'timeline' | 'details' | 'coach';

interface UiState {
  view: View;
  /** The leads board's search */
  query: string;
  /** Empty string for every campaign */
  campaignFilter: string;
  /** The status a phone shows on the leads board, one at a time (wider screens show them all) */
  boardTab: BoardColumn;
  /** Whether the board shows the leads marked not relevant, in a column of their own */
  showArchived: boolean;
  leadsLayout: LeadsLayout;
  /** The table's status filter; empty for every status but "not relevant" */
  statusFilter: BoardColumn[];
  /** When the leads shown were added */
  addedFilter: AddedFilter;
  /** The table's sort; empty for the most recently touched first */
  tableSorting: SortingState;
  /** Lead whose details are open in a dialog */
  detailsId: string | null;
  /** Lead whose "תעד שיחה" dialog is open */
  callLogId: string | null;
  /** Lead whose WhatsApp message is being chosen, or the templates being edited (templatesOpen) */
  whatsAppLeadId: string | null;
  templatesOpen: boolean;
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
  setCampaignFilter: (campaign: string) => void;
  setBoardTab: (tab: BoardColumn) => void;
  setShowArchived: (show: boolean) => void;
  setLeadsLayout: (layout: LeadsLayout) => void;
  toggleStatus: (status: BoardColumn) => void;
  setStatusFilter: (statuses: BoardColumn[]) => void;
  setAddedFilter: (added: AddedFilter) => void;
  setTableSorting: (sorting: SortingState) => void;
  resetFilters: () => void;
  setDetailsId: (id: string | null) => void;
  openCallLog: (id: string) => void;
  closeCallLog: () => void;
  openWhatsApp: (id: string) => void;
  openTemplates: () => void;
  closeWhatsApp: () => void;
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

/** The view in the address (#pipeline, #today…); the home screen (dashboard) when there is none */
const readView = (): View => {
  const hash = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  return VIEWS.find((view) => view === hash) ?? 'dashboard';
};

const readLayout = (): LeadsLayout => (safeStorage.get(LAYOUT_KEY) === 'board' ? 'board' : 'table');

const readBoardTab = (): BoardColumn => {
  const kept = safeStorage.get(BOARD_TAB_KEY);
  return BOARD_COLUMNS.find((column) => column === kept) ?? 'new';
};

let highlightTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>()((set) => ({
  view: readView(),
  query: '',
  campaignFilter: '',
  boardTab: readBoardTab(),
  showArchived: false,
  leadsLayout: readLayout(),
  statusFilter: [],
  addedFilter: 'all',
  tableSorting: [],
  detailsId: null,
  callLogId: null,
  whatsAppLeadId: null,
  templatesOpen: false,
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
  setCampaignFilter: (campaignFilter) => set({ campaignFilter }),
  setBoardTab: (boardTab) => {
    safeStorage.set(BOARD_TAB_KEY, boardTab);
    set({ boardTab, ...(boardTab === 'archived' ? { showArchived: true } : {}) });
  },
  setShowArchived: (showArchived) => set((state) => ({ showArchived, boardTab: !showArchived && state.boardTab === 'archived' ? 'new' : state.boardTab })),
  setLeadsLayout: (leadsLayout) => {
    safeStorage.set(LAYOUT_KEY, leadsLayout);
    set({ leadsLayout });
  },
  toggleStatus: (status) =>
    set((state) => ({
      statusFilter: state.statusFilter.includes(status) ? state.statusFilter.filter((item) => item !== status) : [...state.statusFilter, status],
    })),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setAddedFilter: (addedFilter) => set({ addedFilter }),
  setTableSorting: (tableSorting) => set({ tableSorting }),
  resetFilters: () => set({ query: '', campaignFilter: '', statusFilter: [], addedFilter: 'all' }),
  setDetailsId: (detailsId) => set({ detailsId }),
  openCallLog: (callLogId) => set({ callLogId }),
  closeCallLog: () => set({ callLogId: null }),
  openWhatsApp: (whatsAppLeadId) => set({ whatsAppLeadId, templatesOpen: false }),
  openTemplates: () => set({ whatsAppLeadId: null, templatesOpen: true }),
  closeWhatsApp: () => set({ whatsAppLeadId: null, templatesOpen: false }),
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
