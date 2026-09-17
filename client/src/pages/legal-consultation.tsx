/**
 * LEXARA Legal Consultation Page
 * Canonical continuous conversation surface with the existing full case-analysis
 * capabilities preserved as an alternate, consent-safe tool mode.
 */

import { useMemo } from 'react';
import LexaraConversation from '@/components/LexaraConversation';
import LexaraCaseTools from '@/components/LexaraCaseTools';
import { useLocation, useRoute, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Scale } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { LAW_TYPE_DATA } from '@shared/lawTypes';

export default function LegalConsultationPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [, params] = useRoute('/legal-consultation/:domainId');

  const domainId = params?.domainId;
  const domainInfo = domainId ? LAW_TYPE_DATA.find(type => type.id === domainId) : null;
  const toolsMode = useMemo(
    () => new URLSearchParams(search).get('mode') === 'tools',
    [search],
  );

  const canonicalPath = domainId ? `/legal-consultation/${domainId}` : '/legal-consultation';

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={domainInfo ? `LEXARA - ${domainInfo.name} Legal Consultation | LegalWhat` : 'LEXARA - AI-Powered Legal Consultation | LegalWhat'}
        description={domainInfo ? `Talk with LEXARA about ${domainInfo.name}. Get conversational AI legal analysis, issue spotting, targeted follow-up questions, and access to full case-analysis tools.` : 'Talk with LEXARA for conversational AI legal analysis, issue spotting, targeted follow-up questions, and full case-analysis tools.'}
        keywords="LEXARA, legal consultation, AI legal analysis, legal issue spotting"
        ogTitle={domainInfo ? `LEXARA - ${domainInfo.name} Legal Consultation` : 'LEXARA - Conversational Legal Analysis'}
        ogDescription="Continuous voice-first AI legal analysis with the existing full case-analysis workflow preserved."
        canonicalUrl={`https://legalwhat.com${canonicalPath}`}
      />

      <header className="sticky top-0 z-50 border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation(domainId ? '/welcome' : '/')}
              data-testid="button-back"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Scale className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">LEXARA</span>
            {domainInfo && (
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">• {domainInfo.name}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setLocation(toolsMode ? canonicalPath : `${canonicalPath}?mode=tools`)}
            >
              {toolsMode ? 'Live conversation' : 'Case tools'}
            </Button>
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

      {toolsMode ? (
        <LexaraCaseTools
          lawTypeId={domainInfo?.id || domainId}
          lawTypeName={domainInfo?.name}
        />
      ) : (
        <LexaraConversation
          lawTypeId={domainInfo?.id || domainId}
          lawTypeName={domainInfo?.name}
        />
      )}
    </div>
  );
}
