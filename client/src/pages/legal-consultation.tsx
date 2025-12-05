import LexaraConsultation from "@/components/LexaraConsultation";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Shield, ArrowLeft } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";

export default function LegalConsultationPage() {
  const [, setLocation] = useLocation();
  
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="LEXARA - AI-Powered Legal Analysis | BadBlue"
        description="Consult with LEXARA (Legal Expert AI Resource Advisor) for expert legal case analysis. Get AI-powered case evaluation with actionable recommendations and statute citations."
        keywords="LEXARA, legal consultation, AI legal analysis, civil rights case evaluation, police misconduct analysis"
        ogTitle="LEXARA - Expert Legal Case Analysis & Consultation"
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
              onClick={() => setLocation('/')}
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </div>
          
          <Button
            variant="outline"
            onClick={() => setLocation('/login')}
            data-testid="button-login"
          >
            Sign In
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <LexaraConsultation onBack={() => setLocation('/')} />
    </div>
  );
}
