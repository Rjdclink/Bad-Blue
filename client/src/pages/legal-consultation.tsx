/**
 * LEXARA Legal Consultation Page
 * Canonical voice-first, continuous legal conversation surface.
 */

import LexaraConversation from '@/components/LexaraConversation';
import { useLocation, useRoute } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Scale } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { LAW_TYPE_DATA } from '@shared/lawTypes';

export default function LegalConsultationPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/legal-consultation/:domainId');

  const domainId = params?.domainId;
  const domainInfo = domainId ? LAW_TYPE_DATA.find(type => type.id === domainId) : null;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={domainInfo ? `LEXARA - ${domainInfo.name} Legal Consultation | LegalWhat` : 'LEXARA - AI-Powered Legal Consultation | LegalWhat'}
        description={domainInfo ? `Talk with LEXARA about ${domainInfo.name}. Get conversational AI legal analysis, issue spotting, and targeted follow-up questions.` : 'Talk with LEXARA for conversational AI legal analysis, issue spotting, and targeted follow-up questions.'}
        keywords="LEXARA, legal consultation, AI legal analysis, legal issue spotting"
        ogTitle={domainInfo ? `LEXARA - ${domainInfo.name} Legal Consultation` : 'LEXARA - Conversational Legal Analysis'}
        ogDescription="Voice-first AI legal analysis with continuous two-way conversation."
        canonicalUrl="https://example.com/legal-consultation"
      />

      <header className="sticky top-0 z-50 border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation(domainId ? '/welcome' : '/')}
              data-testid="button-back"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Scale className="h-6 w-6 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">LEXARA</span>
            {domainInfo && (
              <span className="hidden text-sm text-muted-foreground sm:inline">• {domainInfo.name}</span>
            )}
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

      <LexaraConversation
        lawTypeId={domainInfo?.id || domainId}
        lawTypeName={domainInfo?.name}
      />
    </div>
  );
}
