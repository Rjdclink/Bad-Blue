/**
 * LEXARA - Legal Expert AI Resource Advisor
 * 
 * The intelligent legal consultation engine featuring a professional female attorney persona.
 * Visual identity based on OIP.webp - composed, confident, authoritative advisor.
 * 
 * LEXARA serves as the "governing brain" coordinating:
 * - Legal analysis and case evaluation
 * - F.M.I. (Forensic Media Intelligence) integration
 * - Multi-area of law expertise (29+ practice areas)
 * - Strategic recommendations and next steps
 * 
 * Future: Full voice capabilities with TTS/STT for conversational mode
 */

import { useState, useEffect } from "react";
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
  AlertCircle,
  FileText,
  CheckCircle2,
  XCircle,
  Brain,
  Mic,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import FMIAnalysis from "@/components/FMIAnalysis";

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

interface LexaraConsultationProps {
  onBack?: () => void;
  lawType?: string;
  onDataChange?: (data: any) => void;
}

export default function LexaraConsultation({ onBack, lawType, onDataChange }: LexaraConsultationProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [state, setState] = useState("");
  const [situation, setSituation] = useState("");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false); // Future: Live conversational mode

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
          title: "LEXARA Analysis Error",
          description: "Received invalid response from LEXARA. Please try again.",
          variant: "destructive",
        });
        return;
      }
      setAnalysis(data);
    },
    onError: (error: Error) => {
      console.error("LEXARA consultation error:", error);
      toast({
        title: "LEXARA Analysis Failed",
        description: error.message || "LEXARA is unable to analyze your situation. Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!disclaimerAccepted) {
      toast({
        title: "Disclaimer Required",
        description: "Please acknowledge the disclaimer to continue with LEXARA",
        variant: "destructive",
      });
      return;
    }

    if (!state) {
      toast({
        title: "State Required",
        description: "LEXARA requires your state for jurisdiction-specific analysis",
        variant: "destructive",
      });
      return;
    }

    if (!situation.trim()) {
      toast({
        title: "Situation Required",
        description: "Please describe your situation for LEXARA to analyze",
        variant: "destructive",
      });
      return;
    }

    analyzeMutation.mutate({ state, situation, lawType });
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
      <main className="container max-w-6xl mx-auto px-4 py-8">
        {/* LEXARA Header with Avatar */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* LEXARA Avatar - OIP.webp */}
            <div className="relative">
              <img 
                src="/images/OIP.webp" 
                alt="LEXARA - Legal Expert AI Resource Advisor"
                className="w-20 h-20 rounded-full object-cover border-4 border-primary shadow-lg"
              />
              <div className="absolute -bottom-1 -right-1 bg-primary text-white rounded-full p-1">
                <Brain className="w-4 h-4" />
              </div>
            </div>
            
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Scale className="w-8 h-8 text-primary" />
                LEXARA
              </h1>
              <p className="text-muted-foreground">Legal Expert AI Resource Advisor</p>
            </div>
          </div>

          {/* Voice Mode Toggle (Future Implementation) */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="voice-mode"
              checked={voiceEnabled}
              onCheckedChange={(checked) => setVoiceEnabled(checked as boolean)}
              disabled
              className="disabled:opacity-50"
            />
            <Label htmlFor="voice-mode" className="text-sm text-muted-foreground cursor-pointer">
              <span className="flex items-center gap-1">
                <Mic className="w-3 h-3" />
                Voice
              </span>
            </Label>
          </div>
        </div>

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
                  LEXARA will evaluate your situation with expert legal analysis
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
                        placeholder="Tell LEXARA what happened. Include dates, locations, parties involved, specific actions taken, and any evidence you have. Be as detailed as possible..."
                        value={situation}
                        onChange={(e) => setSituation(e.target.value)}
                        rows={10}
                        className="resize-none"
                      />
                      <p className="text-sm text-muted-foreground">
                        💡 Tip: More details help LEXARA provide better analysis
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
                          F.M.I. will automatically extract facts, classify content, and integrate findings with LEXARA's legal analysis.
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
                      className="w-full"
                      size="lg"
                      data-testid="button-analyze"
                    >
                      {analyzeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          LEXARA is analyzing...
                        </>
                      ) : (
                        <>
                          <Brain className="mr-2 h-5 w-5" />
                          Consult LEXARA
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    {/* LEXARA Analysis Results */}
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
                            LEXARA Assessment: {analysis.actionable ? 'Potentially Actionable' : 'Not Clearly Actionable'}
                          </h3>
                          <p className={`text-sm ${
                            analysis.actionable ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                          }`}>
                            {analysis.actionable 
                              ? 'Based on your description, LEXARA has identified potential legal claims that may be pursued.'
                              : 'Based on your description, LEXARA has not identified clear legal claims at this time.'}
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
                        New LEXARA Consultation
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* LEXARA Info Sidebar */}
          <div className="space-y-6">
            {/* LEXARA Capabilities */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">About LEXARA</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  <p>
                    LEXARA is your Legal Expert AI Resource Advisor, providing comprehensive case analysis across 29+ areas of law.
                  </p>
                  <div className="space-y-2">
                    <h4 className="font-semibold">LEXARA Provides:</h4>
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
                  LEXARA seamlessly integrates with F.M.I. (Forensic Media Intelligence) to analyze uploaded evidence and incorporate findings into legal strategy.
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
