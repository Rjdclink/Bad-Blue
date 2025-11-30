import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Shield, FileText, Scale, ChevronRight, Users, Search as SearchIcon, Bell, Image as ImageIcon, Mail, Activity, CreditCard } from "lucide-react";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { FULL_ACCESS_PRICING, LAWSUIT_DIY_PRICING, LAWSUIT_FULL_SERVICE_PRICING, COMPLAINT_PRICING, PETITION_PRICING, FOIA_REQUEST_PRICING } from "@shared/schema";
import LegalConsultation from "@/components/LegalConsultation";
import OfficerSearch from "@/components/OfficerSearch";
import { AISubAgentPanel } from "@/components/AISubAgentPanel";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";
import { SEOHead } from "@/components/SEOHead";

export default function Home() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeFeature, setActiveFeature] = useState<'consultation' | 'officer-search' | 'ai-subagent' | null>(null);

  // Redirect to landing if not authenticated
  if (!user) {
    window.location.href = "/landing";
    return null;
  }

  // DEPRECATED: Payment success/cancel redirect handler removed
  // Officer search and legal consultation are now FREE for all signed-in users

  const handleLogout = async () => {
    window.location.href = "/api/logout";
  };

  // DEPRECATED: handlePayment function removed as access payment is no longer required
  // Officer search and legal consultation are now FREE for all signed-in users

  // DEPRECATED: Payment gate removed - Officer search and legal consultation are now FREE for all signed-in users
  // All authenticated users now have full access to officer search and legal consultation

  // If LegalAI Consultation is selected, show it
  if (activeFeature === 'consultation') {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center gap-4 px-4">
            <Link href="/" className="flex items-center gap-2 hover-elevate active-elevate-2 px-2 py-1 rounded-md">
              <Shield className="h-10 w-auto text-primary" />
              <span className="font-semibold">BadBlue</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <LanguageSelector />
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Back Button */}
        <div className="container px-4 py-4">
          <Button variant="ghost" onClick={() => setActiveFeature(null)} data-testid="button-back">
            ← Back to Dashboard
          </Button>
        </div>

        {/* Feature Content */}
        <div className="container px-4 py-8">
          <LegalConsultation />
        </div>
      </div>
    );
  }

  // If Officer Search is selected, show it
  if (activeFeature === 'officer-search') {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center gap-4 px-4">
            <Link href="/" className="flex items-center gap-2 hover-elevate active-elevate-2 px-2 py-1 rounded-md">
              <Shield className="h-10 w-auto text-primary" />
              <span className="font-semibold">BadBlue</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <LanguageSelector />
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Back Button */}
        <div className="container px-4 py-4">
          <Button variant="ghost" onClick={() => setActiveFeature(null)} data-testid="button-back">
            ← Back to Dashboard
          </Button>
        </div>

        {/* Feature Content */}
        <OfficerSearch onBack={() => setActiveFeature(null)} />
      </div>
    );
  }

  // If AI Sub-Agent is selected, show it (Admin Only)
  if (activeFeature === 'ai-subagent') {
    // Strict admin-only access check
    if (!(user as any).isAdmin) {
      return (
        <div className="min-h-screen bg-background">
          {/* Header */}
          <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-14 items-center gap-4 px-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <span className="font-semibold">BadBlue</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                  Logout
                </Button>
              </div>
            </div>
          </header>

          {/* Unauthorized Access */}
          <div className="container px-4 py-16 text-center">
            <h1 className="text-3xl font-bold text-destructive mb-4">Access Denied</h1>
            <p className="text-muted-foreground mb-6">
              This feature is restricted to administrators only.
            </p>
            <Button onClick={() => setActiveFeature(null)}>
              Return to Dashboard
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center gap-4 px-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <span className="font-semibold">BadBlue - Admin</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                Logout
              </Button>
            </div>
          </div>
        </header>

        {/* Back Button */}
        <div className="container px-4 py-4">
          <Button variant="ghost" onClick={() => setActiveFeature(null)} data-testid="button-back">
            ← Back to Dashboard
          </Button>
        </div>

        {/* Feature Content */}
        <div className="container px-4 py-8">
          <AISubAgentPanel />
        </div>
      </div>
    );
  }

  // Main Dashboard View
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — Dashboard | Police Accountability Tools"
        description="Access officer search, file misconduct complaints, generate §1983 civil rights lawsuits, submit FOIA requests, and create officer resignation petitions. Affordable alternative to attorneys, fully online."
        keywords="police officer search, officer information search, find police officer, locate officer, search police department, find department information, police brutality legal help, officer assault legal advice, police complaint help, officer grievance assistance, FOIA police request, FOIA officer documents, police records search, officer background search, police information database, officer details search, locate police officer, find officer by name, search officer by badge, police department search, officer department information, police legal consultation, officer legal advice, police accountability tools, officer accountability resources, search police records, find officer records, police misconduct information, officer misconduct search, police brutality help, officer assault assistance, file police complaint, file officer grievance, police lawsuit help, officer lawsuit assistance, FOIA request police, FOIA request officer, petition police officer, petition officer resignation, police documents search, officer documents request, police legal help online, officer legal advice online, search for police officer, search for officer information, find police department, locate officer department, police officer database, officer information database, police search tools, officer search resources, police accountability platform, officer accountability system, police information help, officer information assistance, legal advice police case, legal help officer case, police brutality resources, officer assault resources, police complaint tools, officer grievance tools, police lawsuit resources, officer lawsuit help, department search tools, department information search"
        ogTitle="BadBlue Dashboard | Professional Legal Rights Protection Service"
        ogDescription="Professional civil rights advocacy platform for reporting police misconduct, law enforcement abuse & bad cops. Transparent complaint filing system for justice accessibility."
        noIndex={true}
      />
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold">BadBlue</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSelector />
            {user && (
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                Logout
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Back Button */}
      <div className="container px-4 py-4">
        <Button variant="ghost" onClick={() => setLocation('/landing')} data-testid="button-back">
          ← Back to Landing Page
        </Button>
      </div>

      {/* Hero Section */}
      <section className="py-12 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="container max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Welcome to BadBlue
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            Your complete police accountability platform. Access all features below.
          </p>
          {user && (
            <p className="text-sm text-muted-foreground">
              Logged in as: {user.email}
            </p>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4">
        <div className="container max-w-5xl mx-auto">
          <div className="space-y-6">
            {/* 1. LegalAI Consultation */}
            <Card className="hover-elevate cursor-pointer transition-all" onClick={() => setActiveFeature('consultation')} data-testid="card-legal-consultation">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <Bell className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">LegalAI Consultation</CardTitle>
                      <CardDescription className="mt-1">
                        Comprehensive legal research, fact-law analysis & plausibility scoring - <span className="text-green-600 dark:text-green-400 font-semibold">Included with access</span>
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Get instant AI analysis of your case for legal actionability. Our system analyzes your situation for potential civil rights violations and recommends the best course of action.
                </p>
              </CardContent>
            </Card>

            {/* 2. Officer Search */}
            <Card className="hover-elevate cursor-pointer transition-all" onClick={() => setActiveFeature('officer-search')} data-testid="card-officer-search">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <SearchIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Officer Search</CardTitle>
                      <CardDescription className="mt-1">
                        Comprehensive public records search - <span className="text-green-600 dark:text-green-400 font-semibold">Included with access</span>
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Search officer public records including rank, training, incidents, cases, salary, and career history from official databases across all 50 states.
                </p>
              </CardContent>
            </Card>

            {/* 3. FOIA Records Request */}
            <Card className="hover-elevate cursor-pointer transition-all" onClick={() => setLocation('/foia-request')} data-testid="card-foia-request">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">FOIA Records Request</CardTitle>
                      <CardDescription className="mt-1">
                        Official police records via Freedom of Information Act
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Request official police records including body camera footage, incident reports, and disciplinary files through state-specific FOIA statutes.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• AI-powered department address search</li>
                  <li>• State-specific FOIA compliance</li>
                  <li>• Professional letter generation</li>
                  <li>• Certified mail delivery with tracking</li>
                </ul>
              </CardContent>
            </Card>

            {/* AI Sub-Agent Control Panel (Admin Only) */}
            {(user as any).isAdmin && (
              <Card className="hover-elevate cursor-pointer transition-all border-primary/50" onClick={() => setActiveFeature('ai-subagent')} data-testid="card-ai-subagent">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10">
                        <ImageIcon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <CardTitle className="text-2xl flex items-center gap-2">
                          AI Sub-Agent Control Panel
                          <span className="text-xs font-normal bg-purple-600 dark:bg-purple-500 text-white px-2 py-0.5 rounded">ADMIN</span>
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Command the AI to analyze code, debug, generate reports & manage systems
                        </CardDescription>
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Issue natural language commands to the AI Sub-Agent for code analysis, debugging, system operations, data analysis, and automated reporting.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* 2. Start Officer Resignation Petition */}
            <Card className="hover-elevate cursor-pointer transition-all" onClick={() => setLocation('/petition-form')} data-testid="card-start-petition">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <Users className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Start an Officer Resignation Petition</CardTitle>
                      <CardDescription className="mt-1">
                        Demand accountability with community support
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Create a public officer resignation petition calling for officer resignation or departmental action. Officer resignation petitions circulate for 90 days and are automatically sent with all signatures.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Public officer resignation petition page with sharing</li>
                  <li>• 90-day signature collection</li>
                  <li>• Automatic delivery to department</li>
                  <li>• Professional formatting & distribution</li>
                </ul>
              </CardContent>
            </Card>

            {/* 3. File Complaint */}
            <Card className="hover-elevate cursor-pointer transition-all" onClick={() => setLocation('/complaint-form')} data-testid="card-file-complaint">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">File a Complaint</CardTitle>
                      <CardDescription className="mt-1">
                        Formal complaints with automated routing
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Document and report instances of police misconduct. Your complaint will be automatically routed to the Internal Affairs office or oversight authority.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• AI-generated professional complaint</li>
                  <li>• Automatic routing to IA/oversight</li>
                  <li>• Legal format compliance</li>
                  <li>• Verified delivery tracking</li>
                </ul>
              </CardContent>
            </Card>

            {/* Admin Panels - Only visible to admin account */}
            {(user as any).isAdmin && (
              <>
            {/* 4. Admin Panel - Officer Resignation Petition Management */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20" onClick={() => setLocation('/admin-petitions')} data-testid="card-admin-petitions">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-amber-500/10">
                      <FileText className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Officer Resignation Petitions</CardTitle>
                      <CardDescription className="mt-1">
                        Manage all petitions and signatures
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Access the petition management dashboard to view all petitions, copy shareable URLs, compile signatures, and email petition packages.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• View all petitions & signatures</li>
                  <li>• Copy shareable petition URLs</li>
                  <li>• Compile signatures to plain text</li>
                  <li>• Email petition ZIP packages</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4b. Admin Panel - Lawsuit Management */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20" onClick={() => setLocation('/admin-lawsuits')} data-testid="card-admin-lawsuits">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-blue-500/10">
                      <Scale className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Lawsuits</CardTitle>
                      <CardDescription className="mt-1">
                        View full-service lawsuits filed by BadBlue
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Access the lawsuit management dashboard to view all full-service lawsuits filed by BadBlue and review submitted documents.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• View all full-service lawsuits</li>
                  <li>• See plaintiff information</li>
                  <li>• Review lawsuit documents</li>
                  <li>• Track filing status</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4c. Admin Panel - Complaint Management */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-green-500/50 bg-green-50/50 dark:bg-green-950/20" onClick={() => setLocation('/admin-complaints')} data-testid="card-admin-complaints">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-green-500/10">
                      <FileText className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Complaints</CardTitle>
                      <CardDescription className="mt-1">
                        View all filed complaints
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Access the complaint management dashboard to view all filed complaints ordered by purchase date and review submission details.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• View all complaints by purchase date</li>
                  <li>• See user and officer information</li>
                  <li>• Review complaint details</li>
                  <li>• Track submission status</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4d. Admin Panel - FOIA Management */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-purple-500/50 bg-purple-50/50 dark:bg-purple-950/20" onClick={() => setLocation('/admin-foia')} data-testid="card-admin-foia">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-purple-500/10">
                      <FileText className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: FOIA Requests</CardTitle>
                      <CardDescription className="mt-1">
                        Manage FOIA requests and certified mail tracking
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Access the FOIA request management dashboard to view all requests and enter certified mail tracking numbers.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• View all FOIA requests</li>
                  <li>• See user and officer information</li>
                  <li>• Review generated letters</li>
                  <li>• Enter certified mail tracking numbers</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4e. Admin Panel - Email Control */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-rose-500/50 bg-rose-50/50 dark:bg-rose-950/20" onClick={() => setLocation('/admin-email')} data-testid="card-admin-email">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-rose-500/10">
                      <Mail className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Email Control</CardTitle>
                      <CardDescription className="mt-1">
                        Manage support email and user communications
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Configure the platform support email address and send emails to individual users with attachments.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Set support email address and sender name</li>
                  <li>• View all registered users</li>
                  <li>• Send emails to individual users</li>
                  <li>• Attach files to user emails</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4f. Admin Panel - Worker Logs */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-cyan-500/50 bg-cyan-50/50 dark:bg-cyan-950/20" onClick={() => setLocation('/admin-worker-logs')} data-testid="card-admin-worker-logs">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-cyan-500/10">
                      <Activity className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Worker Logs</CardTitle>
                      <CardDescription className="mt-1">
                        View background worker diagnostics and system health
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Monitor the BadBlue Worker's automated diagnostics, failure tracking, and system-wide functional tests.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• View failure logs with severity levels</li>
                  <li>• Review system-wide test results</li>
                  <li>• Track auto-repair activities</li>
                  <li>• Monitor system health status</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4g. Admin Panel - Subscription Management */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20" onClick={() => setLocation('/admin-subscriptions')} data-testid="card-admin-subscriptions">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-emerald-500/10">
                      <CreditCard className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Subscriptions</CardTitle>
                      <CardDescription className="mt-1">
                        Manage subscription tiers and user accounts
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Create and manage subscription plans, assign subscriptions to users, and view active subscriptions.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Create and edit subscription tiers</li>
                  <li>• Set pricing and duration</li>
                  <li>• Assign subscriptions to users</li>
                  <li>• View and cancel active subscriptions</li>
                </ul>
              </CardContent>
            </Card>

            {/* 4h. Admin Panel - Evidence Hub Management */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-purple-500/50 bg-purple-50/50 dark:bg-purple-950/20" onClick={() => setLocation('/admin-evidence-hub')} data-testid="card-admin-evidence-hub">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-purple-500/10">
                      <ImageIcon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Admin Panel: Evidence Hub</CardTitle>
                      <CardDescription className="mt-1">
                        Manage community-shared evidence submissions
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  View, edit, and manage all evidence shared by the community, including bulk deletion capabilities.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• View all shared evidence submissions</li>
                  <li>• Edit evidence metadata and details</li>
                  <li>• Bulk delete inappropriate content</li>
                  <li>• Monitor community contributions</li>
                </ul>
              </CardContent>
            </Card>
              </>
            )}

            {/* 5. File Lawsuit - DIY Option */}
            <Card className="hover-elevate cursor-pointer transition-all border-2" onClick={() => setLocation('/lawsuit-form?tier=diy')} data-testid="card-file-lawsuit-diy">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <Scale className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">File Lawsuit (DIY)</CardTitle>
                      <CardDescription className="mt-1">
                        You file
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Get everything you need to file your own Section 1983 civil rights lawsuit.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• 1983 lawsuit formatting & drafting</li>
                  <li>• Comprehensive legal AI case analysis</li>
                  <li>• Professional claim drafting</li>
                  <li>• Completed civil cover sheet</li>
                  <li>• Court filing instructions</li>
                </ul>
              </CardContent>
            </Card>

            {/* 5. File Lawsuit - Full Service Option */}
            <Card className="hover-elevate cursor-pointer transition-all border-2 border-primary/50" onClick={() => setLocation('/lawsuit-form?tier=full')} data-testid="card-file-lawsuit-full">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <Scale className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">File Lawsuit (Full Service)</CardTitle>
                      <CardDescription className="mt-1">
                        We file for you
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3">
                  Complete lawsuit filing service - we handle everything for you.
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• <strong>Everything in DIY, plus:</strong></li>
                  <li>• BadBlue files everything for you</li>
                  <li>• Complete peace of mind</li>
                </ul>
              </CardContent>
            </Card>

            {/* Public Evidence Hub */}
            <Card className="hover-elevate cursor-pointer transition-all" onClick={() => setLocation('/evidence-hub')} data-testid="card-evidence-hub">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10">
                      <ImageIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Public Evidence Hub</CardTitle>
                      <CardDescription className="mt-1">
                        Community-shared evidence - <span className="text-green-600 dark:text-green-400 font-semibold">Included with access</span>
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Access photos, videos, and documents shared by the BadBlue community documenting police accountability issues.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
      
      <SupportEmailFooter />
    </div>
  );
}