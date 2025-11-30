import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { ClientSessionProvider } from "@/contexts/ClientSessionContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { MaintenanceMode } from "@/components/MaintenanceMode";
import { lazy, Suspense, useEffect } from "react";
import { AuthLoadingSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";

// Performance monitoring
if (typeof window !== 'undefined') {
  console.log('[Performance] App component loading...');
}

// Lazy load all pages for better performance
// Critical pages loaded with higher priority
const Landing = lazy(() => {
  console.log('[Performance] Loading Landing page chunk...');
  return import("@/pages/landing");
});
const Login = lazy(() => import("@/pages/login"));
const NotFound = lazy(() => import("@/pages/not-found"))
const Home = lazy(() => import("@/pages/home"));
const Contact = lazy(() => import("@/pages/contact"));
const Privacy = lazy(() => import("@/pages/privacy"));
const Terms = lazy(() => import("@/pages/terms"));

// Feature pages - loaded on demand
const OfficerSearchPage = lazy(() => import("@/pages/officer-search"));
const OfficerInfo = lazy(() => import("@/pages/officer"));
const ComplaintForm = lazy(() => import("@/pages/complaint-form"));
const ComplaintDetail = lazy(() => import("@/pages/complaint-detail"));
const LawsuitForm = lazy(() => import("@/pages/lawsuit-form"));
const LawsuitDetail = lazy(() => import("@/pages/lawsuit-detail"));
const PetitionForm = lazy(() => import("@/pages/petition-form"));
const PetitionDetail = lazy(() => import("@/pages/petition-detail"));
const Petitions = lazy(() => import("@/pages/petitions"));
const PetitionWorkflow = lazy(() => import("@/pages/petition-workflow"));
const FOIARequestForm = lazy(() => import("@/pages/foia-request-form"));
const Complaints = lazy(() => import("@/pages/complaints"));
const History = lazy(() => import("@/pages/history"));
const Confirmation = lazy(() => import("@/pages/confirmation"));
const EvidenceHub = lazy(() => import("@/pages/evidence-hub"));
const PetitionEdit = lazy(() => import("@/pages/petition-edit"));

// Admin pages - lowest priority
const AdminPetitions = lazy(() => import("@/pages/admin-petitions"));
const AdminLawsuits = lazy(() => import("@/pages/admin-lawsuits"));
const AdminComplaints = lazy(() => import("@/pages/admin-complaints"));
const AdminFOIA = lazy(() => import("@/pages/admin-foia"));
const AdminSubAgent = lazy(() => import("@/pages/admin-subagent"));
const AdminEmail = lazy(() => import("@/pages/admin-email"));
const AdminWorkerLogs = lazy(() => import("@/pages/admin-worker-logs"));
const AdminSubscriptions = lazy(() => import("@/pages/admin-subscriptions"));
const AdminEvidenceHub = lazy(() => import("@/pages/admin-evidence-hub"));

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
        <Route path="/landing" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/contact" component={Contact} />
        <Route path="/support" component={Contact} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        
        {/* Public petition page - accessible without authentication */}
        <Route path="/petition/:slug" component={PetitionDetail} />

        {/* Protected routes - only accessible when authenticated */}
        {isAuthenticated ? (
          <>
            <Route path="/" component={Home} />
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
            <Route path="/admin-petitions" component={AdminPetitions} />
            <Route path="/admin-lawsuits" component={AdminLawsuits} />
            <Route path="/admin-complaints" component={AdminComplaints} />
            <Route path="/admin-foia" component={AdminFOIA} />
            <Route path="/admin-email" component={AdminEmail} />
            <Route path="/admin-worker-logs" component={AdminWorkerLogs} />
            <Route path="/admin-subagent" component={AdminSubAgent} />
            <Route path="/ai-subagent" component={AdminSubAgent} />
            <Route path="/admin-subscriptions" component={AdminSubscriptions} />
            <Route path="/admin-evidence-hub" component={AdminEvidenceHub} />
            <Route path="/petition-edit/:id" component={PetitionEdit} />
            <Route path="/confirmation/:type/:id" component={Confirmation} />
            <Route path="/history" component={History} />
            <Route path="/evidence-hub" component={EvidenceHub} />
          </>
        ) : (
          <Route path="/" component={Landing} />
        )}

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
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
  );
}