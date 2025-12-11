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
    <div className="min-h-screen bg-background">
      {/* PiP Webcam Preview */}
      <LexaraPiPPreview
        videoRef={lexaraMedia.setVideoElement}
        isActive={mediaEnabled && lexaraMedia.state.isVideoReady}
        position="bottom-right"
      />

      <main className="container max-w-6xl mx-auto px-4 py-8">
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
                <h1 className="text-4xl font-bold flex items-center gap-3 bg-gradient-to-r from-primary via-purple-500 to-primary bg-clip-text text-transparent">
                  <Scale className="w-10 h-10 text-primary" />
                  LEXARA
                </h1>
                <p className="text-lg text-muted-foreground mt-1">Legal Expert AI Resource Advisor</p>
                <div className="flex items-center gap-3 mt-2">
                  <LexaraWaveform
                    audioLevel={lexaraMedia.state.audioLevel}
                    isActive={voiceMode.isListening || lexaraMedia.state.isSpeaking}
                    color="hsl(var(--primary))"
                    barCount={7}
                    className="h-6"
                  />
                  {analyzeMutation.isPending && (
                    <span className="text-xs text-primary animate-pulse font-medium">
                      Analyzing your case...
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Control Panel */}
            <div className="flex flex-col items-end gap-3">
              {/* Voice & Media Controls */}
              <div className="flex items-center gap-2">
                <Button
                  variant={mediaEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={handleMediaToggle}
                  className="gap-2"
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

              {/* Status Indicators */}
              <div className="flex items-center gap-2 text-xs">
                {voiceSynthesis.isSpeaking && (
                  <span className="flex items-center gap-1 text-primary">
                    <Volume2 className="w-3 h-3 animate-pulse" />
                    Speaking
                  </span>
                )}
                {(voiceMode.isListening || lexaraMedia.state.isSpeaking) && (
                  <span className="flex items-center gap-1 text-green-500">
                    <Eye className="w-3 h-3" />
                    Listening
                  </span>
                )}
                {mediaEnabled && lexaraMedia.state.isVideoReady && (
                  <span className="flex items-center gap-1 text-blue-500">
                    <Camera className="w-3 h-3" />
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

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Consultation Area */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Sparkles className="w-6 h-6 text-primary" />
                  Legal Case Analysis
                </CardTitle>
                <CardDescription className="text-base">
                  ALEXERA will evaluate your situation with expert legal analysis
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!analysis ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="select-state">State</Label>
                      <Select value={state} onValueChange={setState}>
                        <SelectTrigger id="select-state" data-testid="select-state">
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

                    <div className="space-y-2">
                      <Label htmlFor="textarea-situation">
                        Describe Your Legal Situation
                      </Label>
                      <Textarea
                        id="textarea-situation"
                        data-testid="textarea-situation"
                        placeholder="Tell ALEXERA what happened. Include dates, locations, parties involved, specific actions taken, and any evidence you have. Be as detailed as possible..."
                        value={situation}
                        onChange={(e) => setSituation(e.target.value)}
                        rows={10}
                        className="resize-none"
                      />
                      <p className="text-sm text-muted-foreground">
                        💡 Tip: More details help ALEXERA provide better analysis
                      </p>
                    </div>

                    {/* F.M.I. Integration */}
                    <div className="space-y-2">
                      <Label>F.M.I. Evidence Upload (Optional)</Label>
                      <div className="border-2 border-dashed border-primary/20 rounded-lg p-4 bg-primary/5">
                        <div className="flex items-center gap-3 mb-3">
                          <Brain className="w-5 h-5 text-primary" />
                          <p className="text-sm font-medium">
                            Upload evidence to F.M.I. for forensic intelligence analysis
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          F.M.I. will automatically extract facts, classify content, and integrate findings with ALEXERA's legal analysis.
                        </p>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            // Scroll to F.M.I. section or open modal
                            document.getElementById('fmi-section')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Upload to F.M.I.
                        </Button>
                      </div>
                    </div>

                    {/* Disclaimer */}
                    <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="disclaimer-checkbox"
                          checked={disclaimerAccepted}
                          onCheckedChange={(checked) => setDisclaimerAccepted(checked as boolean)}
                          data-testid="checkbox-disclaimer"
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <label htmlFor="disclaimer-checkbox" className="text-sm leading-relaxed cursor-pointer">
                            <span className="font-semibold text-amber-900 dark:text-amber-100">Required Acknowledgment:</span>{" "}
                            <span className="text-amber-800 dark:text-amber-200">
                              I understand that ALEXERA provides AI-powered legal information, not legal advice. 
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
                      className="w-full"
                      size="lg"
                      data-testid="button-analyze"
                    >
                      {analyzeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          ALEXERA is analyzing...
                        </>
                      ) : (
                        <>
                          <Brain className="mr-2 h-5 w-5" />
                          Consult ALEXERA
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    {/* ALEXERA Analysis Results */}
                    <div className="space-y-6">
                      {/* Assessment Banner */}
                      <div className={`p-4 rounded-lg flex items-start gap-3 ${
                        analysis.actionable
                          ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800'
                          : 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'
                      }`}>
                        {analysis.actionable ? (
                          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <h3 className={`font-semibold text-lg mb-1 ${
                            analysis.actionable ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'
                          }`}>
                            ALEXERA Assessment: {analysis.actionable ? 'Potentially Actionable' : 'Not Clearly Actionable'}
                          </h3>
                          <p className={`text-sm ${
                            analysis.actionable ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                          }`}>
                            {analysis.actionable 
                              ? 'Based on your description, ALEXERA has identified potential legal claims that may be pursued.'
                              : 'Based on your description, ALEXERA has not identified clear legal claims at this time.'}
                          </p>
                        </div>
                      </div>

                      {/* Analysis Content */}
                      <div className="prose dark:prose-invert max-w-none">
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">
                          {analysis.analysis}
                        </div>
                      </div>

                      {/* Next Steps */}
                      {analysis.actionable && (
                        <div className="flex gap-3 pt-4">
                          <Button onClick={handleFileComplaint} variant="outline">
                            File Complaint
                          </Button>
                          <Button onClick={handleFileLawsuit}>
                            File Lawsuit
                          </Button>
                        </div>
                      )}

                      <Button
                        onClick={() => {
                          setAnalysis(null);
                          setSituation("");
                        }}
                        variant="outline"
                        className="w-full"
                      >
                        New ALEXERA Consultation
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ALEXERA Info Sidebar */}
          <div className="space-y-6">
            {/* ALEXERA Capabilities */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">About ALEXERA</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  <p>
                    ALEXERA is your Legal Expert AI Resource Advisor, providing comprehensive case analysis across 29+ areas of law.
                  </p>
                  <div className="space-y-2">
                    <h4 className="font-semibold">ALEXERA Provides:</h4>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Case evaluation & merit assessment</li>
                      <li>• Legal claim identification</li>
                      <li>• Statute of limitations analysis</li>
                      <li>• Evidence strength evaluation</li>
                      <li>• Strategic recommendations</li>
                      <li>• F.M.I. intelligence integration</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* F.M.I. Integration Card */}
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  F.M.I. Integration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  ALEXERA seamlessly integrates with F.M.I. (Forensic Media Intelligence) to analyze uploaded evidence and incorporate findings into legal strategy.
                </p>
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
                  description: "Evidence intelligence has been integrated with ALEXERA",
                });
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
