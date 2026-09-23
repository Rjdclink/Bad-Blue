import { Redirect, Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { ClientSessionProvider } from "@/contexts/ClientSessionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { MaintenanceMode } from "@/components/MaintenanceMode";
import { lazy, Suspense, useEffect, useState, Component, ErrorInfo, ReactNode } from "react";
import { AuthLoadingSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";
import { useGlobalGestureNavigation } from "@/hooks/useGlobalGestureNavigation";
import MasterPanelNavigator from "@/components/MasterPanelNavigator";

if (typeof window !== 'undefined') {
  console.log('[Performance] App component loading...');
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    console.error('[ErrorBoundary] Caught error:', error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Error details:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-destructive mb-4">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">Please try refreshing the page</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function lazyWithRetry<T extends { default: React.ComponentType<any> }>(
  importFn: () => Promise<T>,
  chunkName?: string
) {
  return lazy(() =>
    importFn().catch((error) => {
      console.error(`[LazyLoad] Failed to load ${chunkName || 'chunk'}:`, error);
      return { default: () => <div className="p-4 text-center text-destructive">Failed to load page. <button onClick={() => window.location.reload()} className="underline">Refresh</button></div> } as unknown as T;
    })
  );
}

const Landing = lazyWithRetry(() => {
  console.log('[Performance] Loading Landing page chunk...');
  return import("@/pages/landing");
}, 'Landing');
const Login = lazyWithRetry(() => import("@/pages/login"), 'Login');
const NotFound = lazyWithRetry(() => import("@/pages/not-found"), 'NotFound')
const Home = lazyWithRetry(() => import("@/pages/home"), 'Home');
const Contact = lazyWithRetry(() => import("@/pages/contact"), 'Contact');
const Privacy = lazyWithRetry(() => import("@/pages/privacy"), 'Privacy');
const Terms = lazyWithRetry(() => import("@/pages/terms"), 'Terms');

const OfficerSearchPage = lazyWithRetry(() => import("@/pages/officer-search"), 'OfficerSearch');
const OfficerInfo = lazyWithRetry(() => import("@/pages/officer"), 'OfficerInfo');
const ComplaintForm = lazyWithRetry(() => import("@/pages/complaint-form"), 'ComplaintForm');
const ComplaintDetail = lazyWithRetry(() => import("@/pages/complaint-detail"), 'ComplaintDetail');
const LawsuitForm = lazyWithRetry(() => import("@/pages/lawsuit-form"), 'LawsuitForm');
const LawsuitDetail = lazyWithRetry(() => import("@/pages/lawsuit-detail"), 'LawsuitDetail');
const PetitionForm = lazyWithRetry(() => import("@/pages/petition-form"), 'PetitionForm');
const PetitionDetail = lazyWithRetry(() => import("@/pages/petition-detail"), 'PetitionDetail');
const Petitions = lazyWithRetry(() => import("@/pages/petitions"), 'Petitions');
const PetitionWorkflow = lazyWithRetry(() => import("@/pages/petition-workflow"), 'PetitionWorkflow');
const FOIARequestForm = lazyWithRetry(() => import("@/pages/foia-request-form"), 'FOIARequestForm');
const Complaints = lazyWithRetry(() => import("@/pages/complaints"), 'Complaints');
const History = lazyWithRetry(() => import("@/pages/history"), 'History');
const Confirmation = lazyWithRetry(() => import("@/pages/confirmation"), 'Confirmation');
const EvidenceHub = lazyWithRetry(() => import("@/pages/evidence-hub"), 'EvidenceHub');
const PetitionEdit = lazyWithRetry(() => import("@/pages/petition-edit"), 'PetitionEdit');
const LegalConsultationPage = lazyWithRetry(() => import("@/pages/legal-consultation"), 'LegalConsultation');
const LegalDocumentCreator = lazyWithRetry(() => import("@/pages/legal-document-creator"), 'LegalDocumentCreator');
const WelcomePage = lazyWithRetry(() => import("@/pages/welcome"), 'WelcomePage');
const LexaraConsentPage = lazyWithRetry(() => import("@/pages/lexara-consent"), 'LexaraConsent');
const LegalToolsPage = lazyWithRetry(() => import("@/pages/legal-tools"), 'LegalTools');
const PantheonPage = lazyWithRetry(() => import("@/pages/pantheon"), 'Pantheon');
const ConsultationPage = lazyWithRetry(() => import("@/pages/legal-consultation"), 'Consultation');
const SpectraPage = lazyWithRetry(() => import("@/pages/spectra"), 'Spectra');
const SubscriptionSuccess = lazyWithRetry(() => import("@/pages/subscription-success"), 'SubscriptionSuccess');
const FAQPage = lazyWithRetry(() => import("@/pages/faq"), 'FAQ');
const InmateLocatorPage = lazyWithRetry(() => import("@/pages/inmate-locator"), 'InmateLocator');
const InmateLocatorV2Page = lazyWithRetry(() => import("@/pages/inmate-locator-v2"), 'InmateLocatorV2');
const CryptoCrawlerV2Dashboard = lazyWithRetry(() => import("@/pages/cryptocrawler-v2"), 'CryptoCrawlerV2');
const CryptoCrawlerCommandDashboard = lazyWithRetry(() => import("@/pages/cryptocrawler-dashboard"), 'CryptoCrawlerCommand');
const ControlRoomPage = lazyWithRetry(() => import("@/pages/control-room"), 'ControlRoom');
const OrchestratorConsole = lazyWithRetry(() => import("@/pages/orchestrator-console"), 'OrchestratorConsole');
const AdminConsole = lazyWithRetry(() => import("@/pages/admin-console"), 'AdminConsole');
const AdminPetitions = lazyWithRetry(() => import("@/pages/admin-petitions"), 'AdminPetitions');
const AdminLawsuits = lazyWithRetry(() => import("@/pages/admin-lawsuits"), 'AdminLawsuits');
const AdminComplaints = lazyWithRetry(() => import("@/pages/admin-complaints"), 'AdminComplaints');
const AdminFOIA = lazyWithRetry(() => import("@/pages/admin-foia"), 'AdminFOIA');
const AdminSubAgent = lazyWithRetry(() => import("@/pages/admin-subagent"), 'AdminSubAgent');
const AdminEmail = lazyWithRetry(() => import("@/pages/admin-email"), 'AdminEmail');
const AdminWorkerLogs = lazyWithRetry(() => import("@/pages/admin-worker-logs"), 'AdminWorkerLogs');
const AdminUsers = lazyWithRetry(() => import("@/pages/admin-users"), 'AdminUsers');
const AdminEvidenceHub = lazyWithRetry(() => import("@/pages/admin-evidence-hub"), 'AdminEvidenceHub');
const AdminSubscriptions = lazyWithRetry(() => import("@/pages/admin-subscriptions"), 'AdminSubscriptions');

const PageLoader = () => <PageSkeleton />;

function GeoConsoleRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation('/spectra', { replace: true });
  }, [setLocation]);
  return null;
}

const ADMIN_FEATURE_FLAGS_KEY = "adminFeatureFlags";

function readAdminFeatureFlags(): { cryptocrawler: boolean; monteCarlo: boolean; reactor: boolean } {
  try {
    const raw = localStorage.getItem(ADMIN_FEATURE_FLAGS_KEY);
    if (!raw) return { cryptocrawler: true, monteCarlo: true, reactor: true };
    const parsed = JSON.parse(raw);
    return {
      cryptocrawler: parsed?.cryptocrawler ?? true,
      monteCarlo: parsed?.monteCarlo ?? true,
      reactor: parsed?.reactor ?? true,
    };
  } catch {
    return { cryptocrawler: true, monteCarlo: true, reactor: true };
  }
}

function useAdminFeatureEnabled(feature: "cryptocrawler" | "monteCarlo" | "reactor"): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return readAdminFeatureFlags()[feature];
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setEnabled(readAdminFeatureFlags()[feature]);
    const onStorage = (e: StorageEvent) => {
      if (e.key === ADMIN_FEATURE_FLAGS_KEY) sync();
    };
    const onCustom = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("adminFeatureFlagsChanged", onCustom as any);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("adminFeatureFlagsChanged", onCustom as any);
    };
  }, [feature]);

  return enabled;
}

function FeatureGate({ feature, children }: { feature: "cryptocrawler" | "monteCarlo" | "reactor"; children: ReactNode }) {
  const enabled = useAdminFeatureEnabled(feature);
  const { user } = useAuth();
  const isMasterSession = Boolean((user as any)?.isMasterBypass);
  const [, setLocation] = useLocation();

  // Master access is the root administrative authority and must never be hidden
  // by client-side feature toggles.
  if (enabled || isMasterSession) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center border rounded-lg p-6 bg-card">
        <h1 className="text-xl font-semibold mb-2">Access Disabled</h1>
        <p className="text-sm text-muted-foreground mb-4">This surface has been disabled by the Administrator control panel.</p>
        <button onClick={() => setLocation("/administrator")} className="px-4 py-2 bg-primary text-primary-foreground rounded-md w-full">
          Go to Administrator
        </button>
      </div>
    </div>
  );
}

function GatedCryptoCrawlerV2() {
  return <FeatureGate feature="cryptocrawler"><CryptoCrawlerV2Dashboard /></FeatureGate>;
}

function GatedOrchestratorConsole() {
  return <FeatureGate feature="monteCarlo"><OrchestratorConsole /></FeatureGate>;
}

function GatedControlRoom() {
  return <FeatureGate feature="reactor"><ControlRoomPage /></FeatureGate>;
}

function Router() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const isMasterSession = Boolean((user as any)?.isMasterBypass);
  const userStatus = String((user as any)?.status || "").toLowerCase();
  const hasPaidAccess = isMasterSession || Boolean(
    (user as any)?.hasPaidForAccess === true &&
    !["suspended", "past_due", "canceled", "expired"].includes(userStatus),
  );

  // Swipe routing remains available to ordinary authenticated sessions, but is
  // deliberately disabled for the master shell. On mobile, vertical scrolling
  // must never act like master Back/Forward navigation.
  useGlobalGestureNavigation({
    up: "/welcome",
    left: "/orchestrator-console",
    right: "/cryptocrawler-v2",
    down: "/control-room",
    // Ordinary page scrolling must never trigger cross-page navigation. The
    // legacy global swipe router caused normal vertical scrolling to jump users
    // several application surfaces ahead. Keep route changes button/link driven.
    enabled: false,
  });

  // Master navigation is button-driven only. Preserve native vertical scrolling
  // and pinch zoom while suppressing horizontal overscroll/history gestures when
  // the browser supports the relevant CSS controls.
  useEffect(() => {
    if (!isMasterSession || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverscrollX: html.style.overscrollBehaviorX,
      bodyOverscrollX: body.style.overscrollBehaviorX,
      bodyTouchAction: body.style.touchAction,
      htmlScrollPaddingTop: html.style.scrollPaddingTop,
    };

    html.style.overscrollBehaviorX = "none";
    body.style.overscrollBehaviorX = "none";
    body.style.touchAction = "pan-y pinch-zoom";
    html.style.scrollPaddingTop = "64px";

    return () => {
      html.style.overscrollBehaviorX = previous.htmlOverscrollX;
      body.style.overscrollBehaviorX = previous.bodyOverscrollX;
      body.style.touchAction = previous.bodyTouchAction;
      html.style.scrollPaddingTop = previous.htmlScrollPaddingTop;
    };
  }, [isMasterSession]);

  useEffect(() => {
    if (!isLoading) {
      console.log('[Performance] Auth check completed. User authenticated:', isAuthenticated);
    }
  }, [isLoading, isAuthenticated]);

  const { data: maintenanceStatus } = useQuery<{ maintenanceMode: boolean }>({
    queryKey: ['/api/maintenance-status'],
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  if (isLoading) return <AuthLoadingSkeleton />;
  if (maintenanceStatus?.maintenanceMode) return <MaintenanceMode />;

  return (
    <Suspense fallback={<PageLoader />}>
      <>
        {isMasterSession && <MasterPanelNavigator />}
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/landing" component={Landing} />

          <Route path="/subscription-success" component={SubscriptionSuccess} />
          <Route path="/control-room" component={GatedControlRoom} />
          <Route path="/orchestrator-console" component={GatedOrchestratorConsole} />
          <Route path="/login" component={Login} />
          <Route path="/contact" component={Contact} />
          <Route path="/support" component={Contact} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route path="/legal-consultation" component={LegalConsultationPage} />
          <Route path="/faq" component={FAQPage} />
          <Route path="/petition/:slug" component={PetitionDetail} />

          {isAuthenticated && hasPaidAccess ? (
            <>
              <Route path="/administrator" component={AdminConsole} />
              <Route path="/admin" component={AdminConsole} />
              <Route path="/welcome" component={WelcomePage} />
              <Route path="/lexara-consent/:domainId" component={LexaraConsentPage} />
              <Route path="/legal-tools" component={LegalToolsPage} />
              <Route path="/people-finder" component={SpectraPage} />
              <Route path="/pantheon" component={PantheonPage} />
              {/* LEXARA Viewport intentionally remains retired; /legal-consultation is canonical. */}
              <Route path="/spectra" component={SpectraPage} />
              <Route path="/geo-console" component={GeoConsoleRedirect} />
              <Route path="/legal-consultation/:domainId" component={ConsultationPage} />
              {isMasterSession && <Route path="/geoconsole" component={SpectraPage} />}
              {isMasterSession && <Route path="/geoconsole-command" component={SpectraPage} />}
              {isMasterSession && <Route path="/geoconsole-process" component={SpectraPage} />}
              {isMasterSession && <Route path="/geoconsole-report" component={SpectraPage} />}
              <Route path="/location-intel" component={SpectraPage} />
              <Route path="/tshpe" component={SpectraPage} />
              <Route path="/tshpe-locator" component={SpectraPage} />
              <Route path="/positioning" component={SpectraPage} />
              <Route path="/inmate-locator" component={InmateLocatorPage} />
              <Route path="/inmate-locator/dashboard" component={InmateLocatorPage} />
              <Route path="/inmate-locator-v2" component={InmateLocatorV2Page} />
              <Route path="/cryptocrawler" component={GatedCryptoCrawlerV2} />
              <Route path="/cryptocrawler-v2" component={GatedCryptoCrawlerV2} />
              {isMasterSession && <Route path="/cryptocrawler-dashboard" component={CryptoCrawlerCommandDashboard} />}
              <Route path="/badblue" component={Home} />
              <Route path="/home" component={Home} />
              <Route path="/dashboard" component={Home} />
              <Route path="/officer-search" component={OfficerSearchPage} />
              <Route path="/officer/:id" component={OfficerInfo} />
              <Route path="/complaints" component={Complaints} />
              <Route path="/complaint-form" component={ComplaintForm} />
              <Route path="/complaint" component={ComplaintForm} />
              <Route path="/complaint/:id" component={ComplaintDetail} />
              <Route path="/lawsuit-form" component={LawsuitForm} />
              <Route path="/lawsuit" component={LawsuitForm} />
              <Route path="/lawsuit/:id" component={LawsuitDetail} />
              <Route path="/petition-form" component={PetitionForm} />
              <Route path="/petition" component={PetitionForm} />
              <Route path="/petition-workflow" component={PetitionWorkflow} />
              <Route path="/petitions" component={Petitions} />
              <Route path="/foia-request" component={FOIARequestForm} />
              <Route path="/foia" component={FOIARequestForm} />
              <Route path="/legal-document-creator" component={LegalDocumentCreator} />
              <Route path="/admin-petitions" component={AdminPetitions} />
              <Route path="/admin-lawsuits" component={AdminLawsuits} />
              <Route path="/admin-complaints" component={AdminComplaints} />
              <Route path="/admin-foia" component={AdminFOIA} />
              <Route path="/admin-email" component={AdminEmail} />
              <Route path="/admin-worker-logs" component={AdminWorkerLogs} />
              <Route path="/admin-subagent" component={AdminSubAgent} />
              <Route path="/ai-subagent" component={AdminSubAgent} />
              <Route path="/admin-users" component={AdminUsers} />
              <Route path="/admin-subscriptions" component={AdminSubscriptions} />
              <Route path="/admin-evidence-hub" component={AdminEvidenceHub} />
              <Route path="/petition-edit/:id" component={PetitionEdit} />
              <Route path="/confirmation/:type/:id" component={Confirmation} />
              <Route path="/history" component={History} />
              <Route path="/evidence-hub" component={EvidenceHub} />
            </>
          ) : (
            <Route path="/welcome"><Redirect to="/login" /></Route>
          )}

          <Route component={NotFound} />
        </Switch>
      </>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <ClientSessionProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </ClientSessionProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
