import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { ClientSessionProvider } from "@/contexts/ClientSessionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { MaintenanceMode } from "@/components/MaintenanceMode";
import { lazy, Suspense, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { AuthLoadingSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";

// Performance monitoring
if (typeof window !== 'undefined') {
  console.log('[Performance] App component loading...');
}

// Error Boundary to catch lazy loading failures
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

// Helper for lazy loading with error handling and retry
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

// Lazy load all pages for better performance
// Critical pages loaded with higher priority
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

// Feature pages - loaded on demand
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

// New LegalWhat Welcome Page - Stage 1B/1C
const WelcomePage = lazyWithRetry(() => import("@/pages/welcome"), 'WelcomePage');

// Legal Tools Page - Stage 4
const LegalToolsPage = lazyWithRetry(() => import("@/pages/legal-tools"), 'LegalTools');

// People Finder Page - Global Identity Intelligence
const PeopleFinderPage = lazyWithRetry(() => import("@/pages/people-finder"), 'PeopleFinder');

// PANTHEON Page - Advanced Intelligence Platform
const PantheonPage = lazyWithRetry(() => import("@/pages/pantheon"), 'Pantheon');

// Domain Consultation Page - 4JI Orchestrator Integration
const ConsultationPage = lazyWithRetry(() => import("@/pages/consultation"), 'Consultation');

// LEXARA Viewport - Full-Page AI Legal Consultation (Production, FULL AUTO)
const LexaraViewport = lazyWithRetry(() => import("@/components/LexaraViewport"), 'LexaraViewport');

// Subscription Success Page
const SubscriptionSuccess = lazyWithRetry(() => import("@/pages/subscription-success"), 'SubscriptionSuccess');

// FAQ Page
const FAQPage = lazyWithRetry(() => import("@/pages/faq"), 'FAQ');

// Location Intelligence Page - Interactive Heatmap Dashboard
const LocationIntelPage = lazyWithRetry(() => import("@/pages/location-intel"), 'LocationIntel');

// TSHPE - Triangulated Satellite-Hybrid Positioning Engine
const TSHPELocatorPage = lazyWithRetry(() => import("@/pages/tshpe-locator"), 'TSHPELocator');

// Nationwide Inmate Locator Page
const InmateLocatorPage = lazyWithRetry(() => import("@/pages/inmate-locator"), 'InmateLocator');

// Three-Tier Master Password Access Zones
// Zone A: LegalWhat User Access (SARBEAR)
const LegalWhatHome = lazyWithRetry(() => import("@/pages/legalwhat-home"), 'LegalWhatHome');
// Zone B: 4JI Orchestrator Admin Console (FORGEAI)
const OrchestratorConsole = lazyWithRetry(() => import("@/pages/orchestrator-console"), 'OrchestratorConsole');
// Zone C: CryptoCrawler Command Dashboard (CRPTCRWLR)
const CryptoCrawlerDashboard = lazyWithRetry(() => import("@/pages/cryptocrawler-dashboard"), 'CryptoCrawlerDashboard');

// Admin pages - lowest priority
const AdminPetitions = lazyWithRetry(() => import("@/pages/admin-petitions"), 'AdminPetitions');
const AdminLawsuits = lazyWithRetry(() => import("@/pages/admin-lawsuits"), 'AdminLawsuits');
const AdminComplaints = lazyWithRetry(() => import("@/pages/admin-complaints"), 'AdminComplaints');
const AdminFOIA = lazyWithRetry(() => import("@/pages/admin-foia"), 'AdminFOIA');
const AdminSubAgent = lazyWithRetry(() => import("@/pages/admin-subagent"), 'AdminSubAgent');
const AdminEmail = lazyWithRetry(() => import("@/pages/admin-email"), 'AdminEmail');
const AdminWorkerLogs = lazyWithRetry(() => import("@/pages/admin-worker-logs"), 'AdminWorkerLogs');
const AdminUsers = lazyWithRetry(() => import("@/pages/admin-users"), 'AdminUsers');
const AdminEvidenceHub = lazyWithRetry(() => import("@/pages/admin-evidence-hub"), 'AdminEvidenceHub');

// Loading fallback component with better UX
const PageLoader = () => <PageSkeleton />;

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  
  // Performance monitoring for auth check
  useEffect(() => {
    if (!isLoading) {
      console.log('[Performance] Auth check completed. User authenticated:', isAuthenticated);
    }
  }, [isLoading, isAuthenticated]);
  
  // Check for maintenance mode every 30 seconds
  const { data: maintenanceStatus } = useQuery<{ maintenanceMode: boolean }>({
    queryKey: ['/api/maintenance-status'],
    refetchInterval: 30000, // Check every 30 seconds
    refetchIntervalInBackground: true,
  });

  // Use better loading skeleton for auth loading
  if (isLoading) {
    return <AuthLoadingSkeleton />;
  }
  
  // Show maintenance mode screen if system is under maintenance
  if (maintenanceStatus?.maintenanceMode) {
    return <MaintenanceMode />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* LegalWhat Platform Landing Page - Public Entry Point */}
        <Route path="/" component={Landing} />
        <Route path="/landing" component={Landing} />
        
        {/* Public routes - accessible to everyone */}
        <Route path="/subscription-success" component={SubscriptionSuccess} />
        
        {/* Other public routes */}
        <Route path="/login" component={Login} />
        <Route path="/contact" component={Contact} />
        <Route path="/support" component={Contact} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/legal-consultation" component={LegalConsultationPage} />
        <Route path="/faq" component={FAQPage} />
        
        {/* Public petition page - accessible without authentication */}
        <Route path="/petition/:slug" component={PetitionDetail} />

        {/* Protected routes - only accessible when authenticated */}
        {isAuthenticated ? (
          <>
            {/* THREE-TIER MASTER PASSWORD ACCESS ZONES */}
            {/* Zone A: LegalWhat User Access (SARBEAR) */}
            <Route path="/legalwhat/home" component={LegalWhatHome} />
            <Route path="/legalwhat" component={LegalWhatHome} />
            
            {/* Zone B: 4JI Orchestrator Admin Console (FORGEAI) */}
            <Route path="/4ji/orchestrator" component={OrchestratorConsole} />
            <Route path="/4ji" component={OrchestratorConsole} />
            <Route path="/orchestrator" component={OrchestratorConsole} />
            
            {/* Zone C: CryptoCrawler Command Dashboard (CRPTCRWLR) */}
            <Route path="/cryptocrawler/dashboard" component={CryptoCrawlerDashboard} />
            <Route path="/cryptocrawler" component={CryptoCrawlerDashboard} />
            <Route path="/crypto-dashboard" component={CryptoCrawlerDashboard} />
            
            {/* Welcome Page - LegalWhat law type selection (post-login) */}
            <Route path="/welcome" component={WelcomePage} />
            
            {/* Legal Tools Page - Stage 4 */}
            <Route path="/legal-tools" component={LegalToolsPage} />
            
            {/* People Finder - Global Identity Intelligence */}
            <Route path="/people-finder" component={PeopleFinderPage} />
            
            {/* PANTHEON - Advanced Intelligence Platform */}
            <Route path="/pantheon" component={PantheonPage} />
            
            {/* LEXARA Viewport - Full-Page AI Legal Consultation (FULL AUTO) */}
            <Route path="/lexara" component={LexaraViewport} />
            
            {/* GEO Console - Renders INSIDE LexaraViewport, redirects to /lexara */}
            <Route path="/geo-console">
              {() => {
                // Redirect geo-console to lexara with geo flag
                window.location.href = '/lexara?geo=true';
                return null;
              }}
            </Route>
            
            {/* Domain Consultation - 4JI Orchestrator Integration */}
            <Route path="/consultation/:domainId" component={ConsultationPage} />
            
            {/* Location Intelligence - Interactive Heatmap Dashboard */}
            <Route path="/location-intel" component={LocationIntelPage} />
            
            {/* TSHPE - Triangulated Satellite-Hybrid Positioning Engine */}
            <Route path="/tshpe" component={TSHPELocatorPage} />
            <Route path="/tshpe-locator" component={TSHPELocatorPage} />
            <Route path="/positioning" component={TSHPELocatorPage} />
            
            {/* Nationwide Inmate Locator */}
            <Route path="/inmate-locator" component={InmateLocatorPage} />
            
            {/* BadBlue routes - Law Enforcement Accountability */}
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
            <Route path="/admin-evidence-hub" component={AdminEvidenceHub} />
            <Route path="/petition-edit/:id" component={PetitionEdit} />
            <Route path="/confirmation/:type/:id" component={Confirmation} />
            <Route path="/history" component={History} />
            <Route path="/evidence-hub" component={EvidenceHub} />
          </>
        ) : null}

        <Route component={NotFound} />
      </Switch>
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