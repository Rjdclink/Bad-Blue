/**
 * LEXARA Legal Consultation Page
 * 
 * Premium legal consultation experience with:
 * - OIP.webp avatar image (via LexaraAvatar component)
 * - Continuous audio pipeline for two-way communication
 * - Domain-specific legal consultation
 * - Loads from welcome page via /consultation/:domainId
 */

import { useEffect, useCallback, useState, Suspense } from "react";
import LexaraConsultation from "@/components/LexaraConsultation";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Scale, Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { LAW_TYPE_DATA } from "@shared/lawTypes";
import { useLexaraContinuousAudio } from "@/hooks/useLexaraContinuousAudio";

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
  const [, params] = useRoute('/consultation/:domainId');
  const [isAudioInitialized, setIsAudioInitialized] = useState(false);
  
  // Get domain info if coming from /consultation/:domainId route
  const domainId = params?.domainId;
  const domainInfo = domainId ? LAW_TYPE_DATA.find(t => t.id === domainId) : null;
  
  // Initialize continuous audio pipeline for two-way communication
  const continuousAudio = useLexaraContinuousAudio({
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        console.log('[LEXARA] Final transcript:', text);
      }
    },
    onResponse: (text) => {
      console.log('[LEXARA] Response:', text);
    },
    onSpeakingStart: () => {
      console.log('[LEXARA] Speaking started');
    },
    onSpeakingEnd: () => {
      console.log('[LEXARA] Speaking ended');
    },
    onError: (error) => {
      console.error('[LEXARA] Audio error:', error);
    },
  });
  
  // Auto-initialize audio on user interaction
  const handleInitializeAudio = useCallback(async () => {
    if (!isAudioInitialized) {
      try {
        await continuousAudio.initialize();
        setIsAudioInitialized(true);
      } catch (err) {
        console.error('[LEXARA] Failed to initialize audio:', err);
      }
    }
  }, [continuousAudio, isAudioInitialized]);
  
  // Setup first interaction listener for audio context resume
  useEffect(() => {
    const handleFirstInteraction = () => {
      if (!isAudioInitialized) {
        handleInitializeAudio();
      }
    };
    
    document.addEventListener('click', handleFirstInteraction, { once: true });
    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    
    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, [handleInitializeAudio, isAudioInitialized]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isAudioInitialized) {
        continuousAudio.stop();
      }
    };
  }, [continuousAudio, isAudioInitialized]);
  
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
        
        {/* Header with audio status indicators */}
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
            
            {/* Audio status indicators */}
            <div className="flex items-center gap-2">
              {continuousAudio.state.isStreaming && (
                <Badge 
                  variant="outline" 
                  className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                >
                  {continuousAudio.state.isListening ? (
                    <>
                      <Mic className="w-3 h-3 animate-pulse" />
                      Listening
                    </>
                  ) : continuousAudio.state.isSpeaking ? (
                    <>
                      <Volume2 className="w-3 h-3 animate-pulse" />
                      Speaking
                    </>
                  ) : (
                    <>
                      <Mic className="w-3 h-3" />
                      Ready
                    </>
                  )}
                </Badge>
              )}
              
              {!isAudioInitialized && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInitializeAudio}
                  className="flex items-center gap-1.5"
                >
                  <MicOff className="w-4 h-4" />
                  Enable Voice
                </Button>
              )}
              
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
        
        {/* Interim transcript display */}
        {continuousAudio.state.interimTranscript && (
          <div className="fixed bottom-4 left-4 right-4 max-w-md mx-auto">
            <div className="bg-card/95 backdrop-blur-sm border rounded-lg p-3 shadow-lg">
              <p className="text-sm text-muted-foreground italic">
                {continuousAudio.state.interimTranscript}...
              </p>
            </div>
          </div>
        )}
      </div>
    </Suspense>
  );
}
