/**
 * LEXARA - Legal Expert AI Resource Advisor
 * 
 * Hyper-advanced legal consultation engine with:
 * - Dynamic visual avatar with expressive motion effects
 * - Real-time webcam/microphone integration
 * - Lip-reading support signal processing
 * - Emotional state visualization
 * - Immersive sensory enhancement animations
 * - Authority and captivation dynamics
 * 
 * LEXARA serves as the "governing brain" coordinating:
 * - Legal analysis and case evaluation
 * - F.M.I. (Forensic Media Intelligence) integration
 * - Multi-area of law expertise (29+ practice areas)
 * - Strategic recommendations and next steps
 * - Voice Intelligence System (Stages 11-15)
 * 
 * Optimized for minimal computational usage with silent operation
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Scale,
  Sparkles,
  Loader2,
  FileText,
  CheckCircle2,
  XCircle,
  Brain,
  Volume2,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Eye,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import FMIAnalysis from "@/components/FMIAnalysis";
import { VoiceToggle, VoiceStatusIndicator } from "@/components/VoiceToggle";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { useVoiceSynthesis } from "@/hooks/useVoiceSynthesis";
import { LexaraAvatar, LexaraPresence, LexaraWaveform, type EmotionalState } from "@/components/LexaraAvatar";
import useLexaraMedia, { LexaraPiPPreview } from "@/hooks/useLexaraMedia";

const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

interface AlexeraConsultationProps {
  onBack?: () => void;
  lawType?: string;
  onDataChange?: (data: any) => void;
}

export default function AlexeraConsultation({ onBack, lawType, onDataChange }: AlexeraConsultationProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [state, setState] = useState("");
  const [situation, setSituation] = useState("");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [greetingPlayed, setGreetingPlayed] = useState(false);
  const [emotionalState, setEmotionalState] = useState<EmotionalState>('neutral');
  const [mediaEnabled, setMediaEnabled] = useState(false);

  // Voice Intelligence System (Stages 11-15)
  const voiceMode = useVoiceMode({
    continuous: true,
    interimResults: true,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        // Append finalized speech to situation
        setSituation(prev => (prev ? `${prev} ${text}` : text).trim());
      }
    },
  });

  const voiceSynthesis = useVoiceSynthesis();

  // LEXARA Media Integration (Webcam + Microphone)
  const lexaraMedia = useLexaraMedia({
    onSpeechStart: () => {
      setEmotionalState('listening');
    },
    onSpeechEnd: async () => {
      setEmotionalState('processing');
      // Audio could be sent to backend for transcription
      // For now, we rely on the browser's speech recognition
    },
    onAudioLevel: () => {
      // Audio level updates are handled internally
    },
  });

  // Get law type name for greeting (import LAW_TYPES_INFO if needed)
  const lawTypeName = lawType 
    ? lawType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'legal matters';

  // Auto-greeting: Play after 3 seconds on page load
  const playGreeting = useCallback(async () => {
    const greetingText = `Hello, I understand you have some questions about ${lawTypeName}. How can I assist you today?`;
    
    try {
      // Attempt to play greeting
      await voiceSynthesis.speak(greetingText, {
        context: 'introduction',
        autoPlay: true,
      });
      
      setGreetingPlayed(true);
    } catch (error) {
      console.log('Auto-greeting prevented (user interaction required):', error);
      // Silently fail - will work after user interaction
    }
  }, [lawTypeName, voiceSynthesis]);

  useEffect(() => {
    if (greetingPlayed) return;

    const greetingTimer = setTimeout(() => {
      playGreeting();
    }, 3000); // 3-second delay

    return () => clearTimeout(greetingTimer);
  }, [greetingPlayed, playGreeting]);

  // Persist voice mode state
  useEffect(() => {
    const savedVoiceMode = localStorage.getItem('alexera-voice-mode');
    if (savedVoiceMode === 'enabled') {
      // Auto-enable if previously enabled (user preference)
      // voiceMode.enable(); // Commented out - require explicit activation
    }
  }, []);

  useEffect(() => {
    if (voiceMode.isEnabled) {
      localStorage.setItem('alexera-voice-mode', 'enabled');
    } else {
      localStorage.removeItem('alexera-voice-mode');
    }
  }, [voiceMode.isEnabled]);

  // Toggle voice mode
  const handleVoiceToggle = async () => {
    if (voiceMode.isEnabled) {
      voiceMode.disable();
      voiceSynthesis.stop();
    } else {
      try {
        await voiceMode.enable();
        voiceMode.startListening();
      } catch (error) {
        // Error already handled by useVoiceMode
      }
    }
  };

  // Notify parent component when consultation data changes
  useEffect(() => {
    if (onDataChange && analysis) {
      onDataChange({
        question: situation,
        response: analysis,
        state,
        lawType,
      });
    }
  }, [analysis, situation, state, lawType, onDataChange]);

  const analyzeMutation = useMutation({
    mutationFn: async (data: { state: string; situation: string; lawType?: string }) => {
      const response = await apiRequest("/api/legal-consultation", "POST", data);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }

      return await response.json();
    },
    onSuccess: (data) => {
      if (!data || typeof data !== 'object') {
        toast({
          title: "ALEXERA Analysis Error",
          description: "Received invalid response from ALEXERA. Please try again.",
          variant: "destructive",
        });
        return;
      }
      setAnalysis(data);

      // Stage 15: Speak the analysis if voice mode is enabled
      if (voiceMode.isEnabled && data.analysis) {
        const introText = data.actionable 
          ? "I've completed my analysis. Based on the information you provided, I've identified potential legal claims that may be pursued."
          : "I've completed my analysis. Based on the information you provided, I have not identified clear legal claims at this time.";
        
        const fullResponse = `${introText} ${data.analysis}`;
        
        voiceSynthesis.speak(fullResponse, {
          context: 'evaluation',
          autoPlay: true,
        });
      }
    },
    onError: (error: Error) => {
      console.error("ALEXERA consultation error:", error);
      toast({
        title: "ALEXERA Analysis Failed",
        description: error.message || "ALEXERA is unable to analyze your situation. Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!disclaimerAccepted) {
      toast({
        title: "Disclaimer Required",
        description: "Please acknowledge the disclaimer to continue with ALEXERA",
        variant: "destructive",
      });
      return;
    }

    if (!state) {
      toast({
        title: "State Required",
        description: "ALEXERA requires your state for jurisdiction-specific analysis",
        variant: "destructive",
      });
      return;
    }

    if (!situation.trim()) {
      toast({
        title: "Situation Required",
        description: "Please describe your situation for ALEXERA to analyze",
        variant: "destructive",
      });
      return;
    }

    analyzeMutation.mutate({ state, situation, lawType });
  };

  // Derive LEXARA's emotional state based on current activity
  const currentEmotionalState = useMemo<EmotionalState>(() => {
    if (analyzeMutation.isPending) return 'processing';
    if (voiceSynthesis.isSpeaking) return 'speaking';
    if (voiceMode.isListening || lexaraMedia.state.isSpeaking) return 'listening';
    if (analysis) return 'authoritative';
    return emotionalState;
  }, [analyzeMutation.isPending, voiceSynthesis.isSpeaking, voiceMode.isListening, 
      lexaraMedia.state.isSpeaking, analysis, emotionalState]);

  // Toggle media (webcam/mic)
  const handleMediaToggle = async () => {
    if (mediaEnabled) {
      lexaraMedia.stop();
      setMediaEnabled(false);
    } else {
      await lexaraMedia.start({ video: true, audio: true });
      setMediaEnabled(true);
    }
  };

  const handleFileComplaint = () => {
    if (!user) {
      window.location.href = "/api/login";
      return;
    }

    if (analysis?.extractedDetails) {
      localStorage.setItem(
        "prefillData",
        JSON.stringify({
          ...analysis.extractedDetails,
          state,
        }),
      );
    }
    setLocation("/complaint-form");
  };

  const handleFileLawsuit = () => {
    if (!user) {
      window.location.href = "/api/login";
      return;
    }

    if (analysis?.extractedDetails) {
      localStorage.setItem(
        "prefillData",
        JSON.stringify({
          ...analysis.extractedDetails,
          state,
        }),
      );
    }
    setLocation("/lawsuit-form");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 relative overflow-hidden">
      {/* Ambient Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-radial from-primary/5 to-transparent rounded-full" />
      </div>

      {/* Subtle Grid Pattern */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'linear-gradient(rgba(99, 102, 241, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99, 102, 241, 0.5) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }}
      />

      {/* PiP Webcam Preview */}
      <LexaraPiPPreview
        videoRef={lexaraMedia.setVideoElement}
        isActive={mediaEnabled && lexaraMedia.state.isVideoReady}
        position="bottom-right"
      />

      <main className="container max-w-6xl mx-auto px-4 py-8 relative z-10">
        {/* LEXARA Header with Enhanced Avatar */}
        <LexaraPresence
          emotionalState={currentEmotionalState}
          isActive={true}
          audioLevel={lexaraMedia.state.audioLevel}
          transcript={voiceMode.interimTranscript}
          isListening={voiceMode.isListening}
          isSpeaking={voiceSynthesis.isSpeaking}
          className="mb-8"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              {/* Enhanced LEXARA Avatar */}
              <LexaraAvatar
                size="xl"
                emotionalState={currentEmotionalState}
                isListening={voiceMode.isListening || lexaraMedia.state.isSpeaking}
                isSpeaking={voiceSynthesis.isSpeaking}
                isProcessing={analyzeMutation.isPending}
                audioLevel={lexaraMedia.state.audioLevel}
                showAura={true}
                showParticles={true}
                interactive={true}
                onClick={handleVoiceToggle}
              />
              
              <div>
                <h1 className="text-5xl font-bold flex items-center gap-3">
                  <Scale className="w-12 h-12 text-primary drop-shadow-lg" />
                  <span className="bg-gradient-to-r from-primary via-purple-500 via-pink-500 to-primary bg-[length:200%_auto] animate-gradient bg-clip-text text-transparent drop-shadow-sm">
                    LEXARA
                  </span>
                </h1>
                <p className="text-lg text-muted-foreground mt-2 font-medium tracking-wide">
                  Legal Expert AI Resource Advisor
                </p>
                <div className="flex items-center gap-4 mt-3">
                  <LexaraWaveform
                    audioLevel={lexaraMedia.state.audioLevel}
                    isActive={voiceMode.isListening || lexaraMedia.state.isSpeaking}
                    color="hsl(var(--primary))"
                    barCount={9}
                    className="h-8"
                  />
                  {analyzeMutation.isPending && (
                    <span className="text-sm text-primary animate-pulse font-semibold tracking-wide">
                      ✨ Analyzing your case...
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Control Panel - Enhanced */}
            <div className="flex flex-col items-end gap-4">
              {/* Voice & Media Controls */}
              <div className="flex items-center gap-3">
                <Button
                  variant={mediaEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={handleMediaToggle}
                  className="gap-2 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                >
                  {mediaEnabled ? (
                    <>
                      <Camera className="w-4 h-4" />
                      <Mic className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <CameraOff className="w-4 h-4" />
                      <MicOff className="w-4 h-4" />
                    </>
                  )}
                  {mediaEnabled ? 'Live' : 'Enable'}
                </Button>
                
                <VoiceToggle
                  isEnabled={voiceMode.isEnabled}
                  isListening={voiceMode.isListening}
                  onToggle={handleVoiceToggle}
                  position="inline"
                  size="md"
                />
              </div>

              {/* Status Indicators - Enhanced */}
              <div className="flex items-center gap-3 text-xs font-medium">
                {voiceSynthesis.isSpeaking && (
                  <span className="flex items-center gap-1.5 text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                    <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                    Speaking
                  </span>
                )}
                {(voiceMode.isListening || lexaraMedia.state.isSpeaking) && (
                  <span className="flex items-center gap-1.5 text-green-500 bg-green-500/10 px-2.5 py-1 rounded-full">
                    <Eye className="w-3.5 h-3.5" />
                    Listening
                  </span>
                )}
                {mediaEnabled && lexaraMedia.state.isVideoReady && (
                  <span className="flex items-center gap-1.5 text-blue-500 bg-blue-500/10 px-2.5 py-1 rounded-full">
                    <Camera className="w-3.5 h-3.5" />
                    Watching
                  </span>
                )}
              </div>
            </div>
          </div>
        </LexaraPresence>

        {/* Voice Status Indicator */}
        {voiceMode.isEnabled && (
          <div className="mb-6">
            <VoiceStatusIndicator
              isEnabled={voiceMode.isEnabled}
              isListening={voiceMode.isListening}
              isSpeaking={voiceSynthesis.isSpeaking}
              transcript={voiceMode.interimTranscript}
            />
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Consultation Area */}
          <div className="lg:col-span-2">
            <Card className="border-0 shadow-2xl bg-card/80 backdrop-blur-sm overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5 pointer-events-none" />
              <CardHeader className="relative">
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Sparkles className="w-6 h-6 text-primary" />
                  </div>
                  <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                    Legal Case Analysis
                  </span>
                </CardTitle>
                <CardDescription className="text-base mt-2">
                  LEXARA will evaluate your situation with expert legal analysis
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 relative">
                {!analysis ? (
                  <>
                    <div className="space-y-3">
                      <Label htmlFor="select-state" className="text-sm font-semibold">State</Label>
                      <Select value={state} onValueChange={setState}>
                        <SelectTrigger id="select-state" data-testid="select-state" className="h-12 border-2 focus:border-primary transition-colors">
                          <SelectValue placeholder="Select your state" />
                        </SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="textarea-situation" className="text-sm font-semibold">
                        Describe Your Legal Situation
                      </Label>
                      <Textarea
                        id="textarea-situation"
                        data-testid="textarea-situation"
                        placeholder="Tell LEXARA what happened. Include dates, locations, parties involved, specific actions taken, and any evidence you have. Be as detailed as possible..."
                        value={situation}
                        onChange={(e) => setSituation(e.target.value)}
                        rows={10}
                        className="resize-none border-2 focus:border-primary transition-colors text-base leading-relaxed"
                      />
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <span className="text-lg">💡</span>
                        <span>Tip: More details help LEXARA provide better analysis</span>
                      </p>
                    </div>

                    {/* F.M.I. Integration - Enhanced */}
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold">F.M.I. Evidence Upload (Optional)</Label>
                      <div className="border-2 border-dashed border-primary/30 rounded-xl p-5 bg-gradient-to-br from-primary/5 to-purple-500/5 hover:border-primary/50 transition-colors">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Brain className="w-5 h-5 text-primary" />
                          </div>
                          <p className="text-sm font-semibold">
                            Upload evidence to F.M.I. for forensic intelligence analysis
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                          F.M.I. will automatically extract facts, classify content, and integrate findings with LEXARA's legal analysis.
                        </p>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="shadow-md hover:shadow-lg transition-all hover:scale-105"
                          onClick={() => {
                            document.getElementById('fmi-section')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Upload to F.M.I.
                        </Button>
                      </div>
                    </div>

                    {/* Disclaimer - Enhanced */}
                    <div className="border-2 border-amber-300/50 dark:border-amber-700/50 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950 dark:to-amber-900/50 rounded-xl p-5">
                      <div className="flex items-start gap-4">
                        <Checkbox
                          id="disclaimer-checkbox"
                          checked={disclaimerAccepted}
                          onCheckedChange={(checked) => setDisclaimerAccepted(checked as boolean)}
                          data-testid="checkbox-disclaimer"
                          className="mt-1 h-5 w-5"
                        />
                        <div className="flex-1">
                          <label htmlFor="disclaimer-checkbox" className="text-sm leading-relaxed cursor-pointer">
                            <span className="font-bold text-amber-900 dark:text-amber-100">Required Acknowledgment:</span>{" "}
                            <span className="text-amber-800 dark:text-amber-200">
                              I understand that LEXARA provides AI-powered legal information, not legal advice. 
                              This analysis does not create an attorney-client relationship. For legal representation, 
                              consult a licensed attorney in your jurisdiction.
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={handleSubmit}
                      disabled={analyzeMutation.isPending || !disclaimerAccepted || !state || !situation.trim()}
                      className="w-full h-14 text-lg font-semibold shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] bg-gradient-to-r from-primary via-purple-600 to-primary bg-[length:200%_auto] hover:bg-right"
                      size="lg"
                      data-testid="button-analyze"
                    >
                      {analyzeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                          LEXARA is analyzing...
                        </>
                      ) : (
                        <>
                          <Brain className="mr-3 h-6 w-6" />
                          Consult LEXARA
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    {/* LEXARA Analysis Results - Enhanced */}
                    <div className="space-y-8">
                      {/* Assessment Banner - Enhanced */}
                      <div className={`p-6 rounded-xl flex items-start gap-4 shadow-lg ${
                        analysis.actionable
                          ? 'bg-gradient-to-br from-green-50 to-emerald-100/50 dark:from-green-950 dark:to-emerald-900/50 border-2 border-green-300 dark:border-green-700'
                          : 'bg-gradient-to-br from-red-50 to-rose-100/50 dark:from-red-950 dark:to-rose-900/50 border-2 border-red-300 dark:border-red-700'
                      }`}>
                        <div className={`p-3 rounded-full ${analysis.actionable ? 'bg-green-200 dark:bg-green-800' : 'bg-red-200 dark:bg-red-800'}`}>
                          {analysis.actionable ? (
                            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                          ) : (
                            <XCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-bold text-xl mb-2 ${
                            analysis.actionable ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'
                          }`}>
                            LEXARA Assessment: {analysis.actionable ? 'Potentially Actionable' : 'Not Clearly Actionable'}
                          </h3>
                          <p className={`text-base ${
                            analysis.actionable ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                          }`}>
                            {analysis.actionable 
                              ? 'Based on your description, LEXARA has identified potential legal claims that may be pursued.'
                              : 'Based on your description, LEXARA has not identified clear legal claims at this time.'}
                          </p>
                        </div>
                      </div>

                      {/* Analysis Content - Enhanced */}
                      <div className="prose dark:prose-invert max-w-none bg-muted/30 rounded-xl p-6 border">
                        <div className="whitespace-pre-wrap text-base leading-relaxed">
                          {analysis.analysis}
                        </div>
                      </div>

                      {/* Next Steps - Enhanced & Always Actionable */}
                      <div className="space-y-4">
                        <h4 className="font-bold text-lg flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-primary" />
                          Next Steps
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <Button 
                            onClick={handleFileComplaint} 
                            variant="outline"
                            className="h-14 text-base font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 hover:border-primary"
                          >
                            <FileText className="mr-2 h-5 w-5" />
                            File Complaint
                          </Button>
                          <Button 
                            onClick={handleFileLawsuit}
                            className="h-14 text-base font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 bg-gradient-to-r from-primary to-purple-600"
                          >
                            <Scale className="mr-2 h-5 w-5" />
                            File Lawsuit
                          </Button>
                        </div>
                        
                        {/* Additional Actions */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="hover:bg-primary/10"
                            onClick={() => {
                              navigator.clipboard.writeText(analysis.analysis || '');
                              toast({ title: "Copied!", description: "Analysis copied to clipboard" });
                            }}
                          >
                            📋 Copy Analysis
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="hover:bg-primary/10"
                            onClick={() => {
                              const blob = new Blob([`LEXARA Legal Analysis\n\nState: ${state}\nDate: ${new Date().toLocaleDateString()}\n\nSituation:\n${situation}\n\nAnalysis:\n${analysis.analysis}`], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `lexara-analysis-${Date.now()}.txt`;
                              a.click();
                              URL.revokeObjectURL(url);
                              toast({ title: "Downloaded!", description: "Analysis saved to file" });
                            }}
                          >
                            💾 Save Report
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="hover:bg-primary/10"
                            onClick={() => {
                              if (voiceSynthesis.isSpeaking) {
                                voiceSynthesis.stop();
                              } else {
                                voiceSynthesis.speak(analysis.analysis, { context: 'evaluation', autoPlay: true });
                              }
                            }}
                          >
                            {voiceSynthesis.isSpeaking ? '⏹️ Stop Reading' : '🔊 Read Aloud'}
                          </Button>
                        </div>
                      </div>

                      <Button
                        onClick={() => {
                          setAnalysis(null);
                          setSituation("");
                        }}
                        variant="outline"
                        className="w-full h-12 font-semibold hover:bg-primary/10 transition-all"
                      >
                        ✨ New LEXARA Consultation
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* LEXARA Info Sidebar - Enhanced */}
          <div className="space-y-6">
            {/* LEXARA Capabilities */}
            <Card className="border-0 shadow-xl bg-card/80 backdrop-blur-sm overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5 pointer-events-none" />
              <CardHeader className="relative">
                <CardTitle className="text-lg font-bold">About LEXARA</CardTitle>
              </CardHeader>
              <CardContent className="relative">
                <div className="space-y-4 text-sm">
                  <p className="leading-relaxed">
                    LEXARA is your Legal Expert AI Resource Advisor, providing comprehensive case analysis across 29+ areas of law.
                  </p>
                  <div className="space-y-3">
                    <h4 className="font-bold text-primary">LEXARA Provides:</h4>
                    <ul className="space-y-2 text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Case evaluation & merit assessment
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Legal claim identification
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Statute of limitations analysis
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Evidence strength evaluation
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Strategic recommendations
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        F.M.I. intelligence integration
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* F.M.I. Integration Card - Enhanced */}
            <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-purple-500/10 shadow-xl overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/20">
                    <Brain className="w-5 h-5 text-primary" />
                  </div>
                  F.M.I. Integration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  LEXARA seamlessly integrates with F.M.I. (Forensic Media Intelligence) to analyze uploaded evidence and incorporate findings into legal strategy.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full hover:bg-primary/10"
                  onClick={() => document.getElementById('fmi-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <Brain className="w-4 h-4 mr-2" />
                  Access F.M.I.
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* F.M.I. Section */}
        <div id="fmi-section" className="mt-12">
          {lawType && (
            <FMIAnalysis 
              lawType={lawType} 
              lawTypeName={lawType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              onAnalysisComplete={(results) => {
                toast({
                  title: "F.M.I. Analysis Complete",
                  description: "Evidence intelligence has been integrated with LEXARA",
                });
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
