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

// Subscription Success Page
const SubscriptionSuccess = lazyWithRetry(() => import("@/pages/subscription-success"), 'SubscriptionSuccess');

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
        {/* Public routes */}
        <Route path="/subscription-success" component={SubscriptionSuccess} />
        
        {/* Public routes */}
        <Route path="/landing" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/contact" component={Contact} />
        <Route path="/support" component={Contact} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/legal-consultation" component={LegalConsultationPage} />
        
        {/* Public petition page - accessible without authentication */}
        <Route path="/petition/:slug" component={PetitionDetail} />

        {/* Protected routes - only accessible when authenticated */}
        {isAuthenticated ? (
          <>
            {/* Root route - LegalWhat Welcome Page for law type selection */}
            <Route path="/" component={WelcomePage} />
            
            {/* New Welcome Page - Stage 1B/1C */}
            <Route path="/welcome" component={WelcomePage} />
            
            {/* Legal Tools Page - Stage 4 */}
            <Route path="/legal-tools" component={LegalToolsPage} />
            
            {/* People Finder - Global Identity Intelligence */}
            <Route path="/people-finder" component={PeopleFinderPage} />
            
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
        ) : (
          // Unauthenticated users: Root route goes to Login/Signup
          <Route path="/" component={Login} />
        )}

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