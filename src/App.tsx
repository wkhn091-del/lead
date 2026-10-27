import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { AddLeadDialog } from './components/AddLeadDialog';
import { AddLeadFab } from './components/AddLeadFab';
import { AuthScreen, SignInDialog } from './components/AuthScreen';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ImportDialog } from './components/import/ImportDialog';
import { LeadModal } from './components/LeadModal';
import { OfflineBanner } from './components/OfflineBanner';
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
import { useAuth } from './store/auth';
import { useDashboard } from './store/dashboard';
import { useLeadStore } from './store/leads';
import { startFromKeptCopy } from './store/offline';
import { useProspector } from './store/prospector';
import { useSync } from './store/sync';
import { useTimeline } from './store/timeline';
import { useTraining } from './store/training';
import { useUi } from './store/ui';
import { useWhatsApp } from './store/whatsapp';

export default function App() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  const checkSession = useAuth((s) => s.check);
  const load = useLeadStore((s) => s.load);
  const loadDaily = useLeadStore((s) => s.loadDaily);
  const reset = useLeadStore((s) => s.reset);

  useEffect(() => {
    void checkSession();
    // The copy kept on this device shows at once, even before the server answers (or when it can't)
    void startFromKeptCopy();
    drafts.prune();
  }, [checkSession]);

  // Leads load once there is someone to load them for, and leave memory on sign-out.
  useEffect(() => {
    if (signedIn) {
      // Changes written earlier (offline, or before the page closed) go first
      void useSync.getState().flush();
      void load().then(loadDaily);
      void useTimeline.getState().loadFeatures();
      void useTraining.getState().load();
      void useWhatsApp.getState().refresh();
      void useProspector.getState().load();
      void useDashboard.getState().load();
    } else {
      reset();
      useTraining.getState().reset();
      useWhatsApp.getState().reset();
      useProspector.getState().reset();
      useDashboard.getState().reset();
    }
  }, [signedIn, load, loadDaily, reset]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="backdrop" aria-hidden />
      {signedIn ? (
        <Dashboard />
      ) : (
        <div className="page mx-auto w-full max-w-[1180px]">
          <AuthScreen />
        </div>
      )}
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

  // Back to the app after a while (a phone call, another app), the connection is back, or signed in again after
  // the session ended: fresh data, quietly. What's on screen stays meanwhile; changes still on their way stay on
  // top of what the server sends.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) refreshAll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', refreshAll);
    const stopWatchingSession = useAuth.subscribe((state, before) => {
      const confirmed = (auth: typeof state) => auth.status === 'signed-in' && !auth.offline && !auth.expired;
      if (confirmed(state) && !confirmed(before)) refreshAll();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', refreshAll);
      stopWatchingSession();
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
        <OfflineBanner />
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
      <SignInDialog />
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
