/**
 * LEXARA Legal Consultation Page
 * 
 * Premium legal consultation experience with:
 * - OIP.webp avatar image (via LexaraAvatar component)
 * - Continuous audio pipeline for two-way communication
 * - Domain-specific legal consultation
 * - Loads from welcome page via /legal-consultation/:domainId
 */

import { Suspense } from "react";
import LexaraConsultation from "@/components/LexaraConsultation";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scale, Loader2 } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { LAW_TYPE_DATA } from "@shared/lawTypes";

// Loading fallback for Suspense
const ConsultationLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="text-center space-y-4">
      <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
      <p className="text-muted-foreground">Loading LEXARA Legal Consultation...</p>
    </div>
  </div>
);

export default function LegalConsultationPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/legal-consultation/:domainId');
  
  // Get domain info if coming from /legal-consultation/:domainId route
  const domainId = params?.domainId;
  const domainInfo = domainId ? LAW_TYPE_DATA.find(t => t.id === domainId) : null;
  
  return (
    <Suspense fallback={<ConsultationLoader />}>
      <div className="min-h-screen bg-background">
        <SEOHead
          title={domainInfo ? `LEXARA - ${domainInfo.name} Legal Consultation | LegalWhat` : "LEXARA - AI-Powered Legal Consultation | LegalWhat"}
          description={domainInfo ? `Consult with LEXARA for expert ${domainInfo.name} legal analysis. Get AI-powered case evaluation with actionable recommendations.` : "Consult with LEXARA (Legal Expert AI Resource Advisor) for expert legal case analysis. Get AI-powered case evaluation with actionable recommendations and statute citations."}
          keywords="LEXARA, legal consultation, AI legal analysis, civil rights case evaluation, police misconduct analysis"
          ogTitle={domainInfo ? `LEXARA - ${domainInfo.name} Legal Consultation` : "LEXARA - Expert Legal Case Analysis & Consultation"}
          ogDescription="AI-powered legal analysis by LEXARA to determine if you have an actionable complaint or lawsuit. Get detailed case evaluation with statute citations and F.M.I. evidence intelligence integration."
          canonicalUrl="https://example.com/legal-consultation"
        />
        
        {/* Header */}
        <header className="border-b bg-card sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation(domainId ? '/welcome' : '/')}
                data-testid="button-back"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Scale className="w-6 h-6 text-primary" aria-hidden="true" />
              <span className="font-semibold text-lg">LEXARA</span>
              {domainInfo && (
                <span className="text-muted-foreground text-sm hidden sm:inline">• {domainInfo.name}</span>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setLocation('/login')}
                data-testid="button-login"
              >
                Sign In
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content - Pass lawType and audio state */}
        <LexaraConsultation 
          onBack={() => setLocation(domainId ? '/welcome' : '/')} 
          lawType={domainInfo?.name}
        />
      </div>
    </Suspense>
  );
}
