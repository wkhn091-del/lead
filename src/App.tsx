import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { AddLeadDialog } from './components/AddLeadDialog';
import { AddLeadFab } from './components/AddLeadFab';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ImportDialog } from './components/import/ImportDialog';
import { LeadModal } from './components/LeadModal';
import { OfflineBanner } from './components/OfflineBanner';
import { PreviewBanner } from './components/PreviewBanner';
import { DashboardView } from './components/dashboard/DashboardView';
import { CommandPalette } from './components/palette/CommandPalette';
import { PipelineView } from './components/pipeline/PipelineView';
import { ProspectorView } from './components/prospector/ProspectorView';
import { SampleDataBanner } from './components/SampleDataBanner';
import { TabBar } from './components/TabBar';
import { TodayView } from './components/today/TodayView';
import { Toaster } from './components/Toaster';
import { TrainingView } from './components/training/TrainingView';
import { ViewTabs } from './components/ViewTabs';
import { WhatsAppPanel } from './components/whatsapp/WhatsAppPanel';
import { useHotkeys } from './hooks/useHotkeys';
import { drafts } from './lib/drafts';
import { campaignCounts } from './lib/leads';
import { EASE_OUT } from './lib/motion';
import { useDashboard } from './store/dashboard';
import { useLeadStore } from './store/leads';
import { startFromKeptCopy, useOffline } from './store/offline';
import { useProspector } from './store/prospector';
import { useSync } from './store/sync';
import { useTimeline } from './store/timeline';
import { useTraining } from './store/training';
import { useUi } from './store/ui';
import { useWhatsApp } from './store/whatsapp';

/** No sign-in: the app opens straight on the dashboard, and everything loads from the start. */
export default function App() {
  useEffect(() => {
    // The copy kept on this device shows at once, even before the server answers (or when it can't)
    void startFromKeptCopy();
    drafts.prune();
    // Changes written earlier (offline, or before the page closed) go first
    void useSync.getState().flush();
    void useLeadStore.getState().load().then(() => useLeadStore.getState().loadDaily());
    loadAlongsideLeads();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="backdrop" aria-hidden />
      <Dashboard />
      <Toaster />
    </MotionConfig>
  );
}

function Dashboard() {
  const view = useUi((s) => s.view);
  const flushPendingRemovals = useLeadStore((s) => s.flushPendingRemovals);
  const loadDaily = useLeadStore((s) => s.loadDaily);

  useHotkeys();

  // Deletes wait out an undo window; send them right away if the page is hidden or closed.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushPendingRemovals();
    };
    window.addEventListener('pagehide', flushPendingRemovals);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flushPendingRemovals);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [flushPendingRemovals]);

  // Opened from the home screen's "ליד חדש" shortcut (manifest.webmanifest)
  useEffect(() => {
    if (location.hash !== '#new-lead') return;
    useUi.getState().setView(useUi.getState().view);
    useUi.getState().setAddOpen(true);
  }, []);

  // Back to the app after a while (a phone call, another app), or the connection is back: fresh data, quietly.
  // What's on screen stays meanwhile; changes still on their way stay on top of what the server sends. While the
  // server hasn't answered since the app opened (no signal, or Render still waking up), the leads are asked for
  // again every half minute and when the app comes to the front.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) refreshAll();
      else void retryServer();
    };
    const timer = setInterval(() => void retryServer(), 30_000);
    // Once the leads load again after a load failed (whichever retry it was), whatever else couldn't load comes too
    let missed = false;
    const stopWatching = useLeadStore.subscribe((state, before) => {
      if (state.loadError && !before.loadError) missed = true;
      else if (missed && state.syncedAt !== before.syncedAt) {
        missed = false;
        loadAfterLeads();
      }
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', refreshAll);
    return () => {
      clearInterval(timer);
      stopWatching();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', refreshAll);
    };
  }, []);

  // A tab left open overnight draws the new day's calls at midnight, or when you come back to it.
  useEffect(() => {
    const refreshIfNewDay = () => {
      const { daily } = useLeadStore.getState();
      if (daily && Date.now() >= Date.parse(daily.endsAt)) void loadDaily();
    };
    const timer = setInterval(refreshIfNewDay, 60_000);
    document.addEventListener('visibilitychange', refreshIfNewDay);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfNewDay);
    };
  }, [loadDaily]);

  return (
    <>
      <div className="page mx-auto w-full max-w-[1180px]">
        <Header />
        <ViewTabs className="mb-5 max-sm:hidden lg:hidden" />
        <PreviewBanner />
        <OfflineBanner onRetry={() => void retryServer()} />
        <SampleDataBanner />
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            {view === 'dashboard' ? (
              <DashboardView />
            ) : view === 'today' ? (
              <TodayView />
            ) : view === 'training' ? (
              <TrainingView />
            ) : view === 'prospector' ? (
              <ProspectorView />
            ) : (
              <PipelineView />
            )}
          </motion.main>
        </AnimatePresence>
        <Footer />
      </div>
      <TabBar />
      <AddLeadFab />
      <AddLeadDialog />
      <ImportDialog />
      <LeadModal />
      <WhatsAppPanel />
      <CommandPalette />
      <CampaignOptions />
    </>
  );
}

/** Everything the screens show, from the server again (quietly: what's shown stays until it answers) */
function refreshAll() {
  void useLeadStore.getState().load().then(() => useLeadStore.getState().loadDaily());
  void useDashboard.getState().load();
  void useTraining.getState().load();
  const { detailsId } = useUi.getState();
  if (detailsId) void useTimeline.getState().load(detailsId, true);
}

/** What the screens need besides the leads and today's calls (which are drawn from the leads, so come after them) */
function loadAlongsideLeads() {
  void useTimeline.getState().loadFeatures();
  void useTraining.getState().load();
  void useWhatsApp.getState().refresh();
  void useProspector.getState().load();
  void useDashboard.getState().load();
}

/** After the leads come back from a failed load: today's calls, and whatever else couldn't load meanwhile */
function loadAfterLeads() {
  void useLeadStore.getState().loadDaily();
  loadAlongsideLeads();
  const { detailsId } = useUi.getState();
  if (detailsId) void useTimeline.getState().load(detailsId, true);
}

/** On the copy kept on this device, or with nothing loaded: the server hasn't answered since the app opened */
const waitingForServer = () => useOffline.getState().keptAt !== null || useLeadStore.getState().loadState === 'error';

let retrying = false;

/** Asks the server for the leads again while it hasn't answered, one request at a time */
async function retryServer() {
  if (retrying || !waitingForServer()) return;
  retrying = true;
  try {
    await useLeadStore.getState().load();
  } finally {
    retrying = false;
  }
}

/** Suggestions for every campaign field */
function CampaignOptions() {
  const leads = useLeadStore((s) => s.leads);
  const campaigns = useMemo(() => campaignCounts(leads), [leads]);
  return (
    <datalist id="campaign-options">
      {campaigns.map((campaign) => (
        <option key={campaign.name} value={campaign.name} />
      ))}
    </datalist>
  );
}
