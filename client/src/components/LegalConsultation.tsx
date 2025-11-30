import { useState } from "react";
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
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

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

interface LegalConsultationProps {
  onBack?: () => void;
}

export default function LegalConsultation({ onBack }: LegalConsultationProps) {
  const { toast } = useToast();
  
  // NOTE: FAQ schema moved to page level to prevent duplicate FAQPage errors in Google Search Console
  // Each page should have only ONE FAQPage schema - components should not add their own

  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [state, setState] = useState("");
  const [situation, setSituation] = useState("");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  const analyzeMutation = useMutation({
    mutationFn: async (data: { state: string; situation: string }) => {
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
          title: "Analysis Error",
          description: "Received invalid response from AI service. Please try again.",
          variant: "destructive",
        });
        return;
      }
      setAnalysis(data);
    },
    onError: (error: Error) => {
      console.error("Legal consultation error:", error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Unable to analyze your situation. Please try again or contact support if the issue persists.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!disclaimerAccepted) {
      toast({
        title: "Disclaimer Required",
        description: "Please acknowledge the disclaimer to continue",
        variant: "destructive",
      });
      return;
    }

    if (!state) {
      toast({
        title: "State Required",
        description: "Please select your state",
        variant: "destructive",
      });
      return;
    }

    if (!situation.trim()) {
      toast({
        title: "Situation Required",
        description: "Please describe your situation",
        variant: "destructive",
      });
      return;
    }

    analyzeMutation.mutate({ state, situation });
  };

  const handleFileComplaint = () => {
    // Check if user is authenticated
    if (!user) {
      window.location.href = "/api/login";
      return;
    }

    // Store extracted details in localStorage for pre-filling
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
    // Check if user is authenticated
    if (!user) {
      window.location.href = "/api/login";
      return;
    }

    // Store extracted details in localStorage for pre-filling
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
      <main className="container max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Scale className="w-8 h-8" />
              Do I Have an Actionable Lawsuit/Complaint?
            </CardTitle>
            <CardDescription className="text-base">
              Get AI-powered legal assessment with case detail extraction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!analysis ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="select-state">State</Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger id="select-state" data-testid="select-state">
                      <SelectValue placeholder="Select state" />
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
                    Describe Your Situation
                  </Label>
                  <Textarea
                    id="textarea-situation"
                    data-testid="textarea-situation"
                    placeholder="Describe what happened, including dates, locations, officer names/badges, actions taken, and any evidence you have. Be as detailed as possible..."
                    value={situation}
                    onChange={(e) => setSituation(e.target.value)}
                    rows={10}
                    className="resize-none"
                  />
                  <p className="text-sm text-muted-foreground">
                    Tip: Include officer names, badge numbers, dates, locations,
                    and specific actions
                  </p>
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
                          I acknowledge that the responses provided by this LegalAI Consultation are purely for informational purposes only and do not constitute legal advice. For legal advice specific to my situation, I should consult with a qualified attorney.
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button
                    onClick={handleSubmit}
                    disabled={analyzeMutation.isPending || !disclaimerAccepted}
                    className="flex-1"
                    size="lg"
                    data-testid="button-analyze"
                  >
                    {analyzeMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Analyze My Case
                      </>
                    )}
                  </Button>
                  {onBack && (
                    <Button
                      variant="outline"
                      onClick={onBack}
                      data-testid="button-back"
                    >
                      Go Back
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-6">
                  {/* Actionability Header */}
                  <div
                    className={`border-2 rounded-lg p-6 ${
                      analysis.isActionable
                        ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                        : "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      {analysis.isActionable ? (
                        <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                      ) : (
                        <XCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                      )}
                      <div className="flex-1">
                        <h3 className="text-2xl font-bold">
                          {analysis.isActionable
                            ? "You Have an Actionable Case"
                            : "Not Currently Actionable"}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {analysis.isActionable
                            ? "Based on your description, you may proceed with the following actions:"
                            : "Based on the information provided, this may not meet the threshold for formal action"}
                        </p>
                      </div>
                      {analysis.claimStrengthRating && (
                        <div className="flex flex-col items-center">
                          <div
                            className={`flex items-center justify-center w-16 h-16 rounded-full text-2xl font-bold ${
                              analysis.claimStrengthRating === 3
                                ? "bg-green-600 text-white"
                                : analysis.claimStrengthRating === 2
                                  ? "bg-blue-600 text-white"
                                  : "bg-yellow-600 text-white"
                            }`}
                          >
                            {analysis.claimStrengthRating}
                          </div>
                          <p className="text-xs mt-1 text-center font-medium">
                            {analysis.claimStrengthRating === 3
                              ? "Very Strong"
                              : analysis.claimStrengthRating === 2
                                ? "Sound Claim"
                                : "Cognizable"}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Details Provided Feedback */}
                    {analysis.detailsProvided && (
                      <div
                        className={`mt-4 p-3 rounded-lg border ${
                          analysis.detailsProvided.level === "comprehensive"
                            ? "bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800"
                            : analysis.detailsProvided.level === "moderate"
                              ? "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800"
                              : "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-sm mb-1">
                              Details Provided:{" "}
                              {analysis.detailsProvided.level
                                .charAt(0)
                                .toUpperCase() +
                                analysis.detailsProvided.level.slice(1)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {analysis.detailsProvided.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Claim Strength Rating Explanation */}
                    {analysis.claimStrengthRating && (
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm font-semibold mb-2">
                          Claim Strength Rating Scale:
                        </p>
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div
                            className={`p-2 rounded ${
                              analysis.claimStrengthRating === 1
                                ? "bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-300 dark:border-yellow-700"
                                : "opacity-60"
                            }`}
                          >
                            <span className="font-bold">1 - Cognizable</span>
                            <p className="mt-1 text-muted-foreground">
                              Weak but valid claim
                            </p>
                          </div>
                          <div
                            className={`p-2 rounded ${
                              analysis.claimStrengthRating === 2
                                ? "bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700"
                                : "opacity-60"
                            }`}
                          >
                            <span className="font-bold">2 - Sound</span>
                            <p className="mt-1 text-muted-foreground">
                              Solid legal basis
                            </p>
                          </div>
                          <div
                            className={`p-2 rounded ${
                              analysis.claimStrengthRating === 3
                                ? "bg-green-100 dark:bg-green-900/50 border border-green-300 dark:border-green-700"
                                : "opacity-60"
                            }`}
                          >
                            <span className="font-bold">3 - Very Strong</span>
                            <p className="mt-1 text-muted-foreground">
                              Compelling case
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {analysis.isActionable &&
                      analysis.recommendedActions &&
                      analysis.recommendedActions.length > 0 && (
                        <div className="mt-4 pt-4 border-t">
                          <p className="font-semibold mb-3">
                            Recommended Actions:
                          </p>
                          <div className="flex flex-wrap gap-3">
                            {analysis.recommendedActions.includes(
                              "complaint",
                            ) && (
                              <Button
                                onClick={handleFileComplaint}
                                size="lg"
                                data-testid="button-file-complaint-prefilled"
                              >
                                <FileText className="w-4 h-4 mr-2" />
                                File Complaint (Auto-Filled)
                              </Button>
                            )}
                            {analysis.recommendedActions.includes(
                              "lawsuit",
                            ) && (
                              <Button
                                onClick={handleFileLawsuit}
                                size="lg"
                                data-testid="button-file-lawsuit-prefilled"
                              >
                                <Scale className="w-4 h-4 mr-2" />
                                File Lawsuit (Auto-Filled)
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                  </div>

                  {/* Legal Analysis Summary */}
                  {analysis.legalAnalysis?.summary && (
                    <div className="bg-card border rounded-lg p-6 space-y-4">
                      <h3 className="text-xl font-semibold">Legal Analysis</h3>
                      <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {analysis.legalAnalysis.summary}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Case Strength:</span>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            analysis.legalAnalysis.strengthAssessment ===
                            "very_strong"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                              : analysis.legalAnalysis.strengthAssessment ===
                                  "strong"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                                : analysis.legalAnalysis.strengthAssessment ===
                                    "moderate"
                                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
                                  : analysis.legalAnalysis
                                        .strengthAssessment === "weak"
                                    ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100"
                                    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
                          }`}
                        >
                          {analysis.legalAnalysis.strengthAssessment
                            ?.replace("_", " ")
                            .toUpperCase()}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Violations Identified */}
                  {analysis.legalAnalysis?.violationsIdentified &&
                    analysis.legalAnalysis.violationsIdentified.length > 0 && (
                      <div className="bg-card border rounded-lg p-6 space-y-4">
                        <h3 className="text-xl font-semibold">
                          Violations Identified
                        </h3>
                        <ul className="space-y-2">
                          {analysis.legalAnalysis.violationsIdentified.map(
                            (violation: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-600 dark:bg-red-400 mt-2" />
                                <span className="text-muted-foreground">
                                  {violation}
                                </span>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}

                  {/* Applicable Statutes */}
                  {analysis.legalAnalysis?.applicableStatutes &&
                    analysis.legalAnalysis.applicableStatutes.length > 0 && (
                      <div className="bg-card border rounded-lg p-6 space-y-4">
                        <h3 className="text-xl font-semibold">
                          Applicable Statutes & Codes
                        </h3>
                        <ul className="space-y-2">
                          {analysis.legalAnalysis.applicableStatutes.map(
                            (statute: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                                <span className="text-muted-foreground">
                                  {statute}
                                </span>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}

                  {/* Next Steps */}
                  {analysis.legalAnalysis?.nextSteps &&
                    analysis.legalAnalysis.nextSteps.length > 0 && (
                      <div className="bg-card border rounded-lg p-6 space-y-4">
                        <h3 className="text-xl font-semibold">
                          Recommended Next Steps
                        </h3>
                        <ol className="space-y-3">
                          {analysis.legalAnalysis.nextSteps.map(
                            (step: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-3">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary font-semibold text-sm flex-shrink-0">
                                  {idx + 1}
                                </span>
                                <span className="text-muted-foreground">
                                  {step}
                                </span>
                              </li>
                            ),
                          )}
                        </ol>
                      </div>
                    )}

                  {/* Evidence Needed */}
                  {analysis.legalAnalysis?.recommendedEvidence &&
                    analysis.legalAnalysis.recommendedEvidence.length > 0 && (
                      <div className="bg-card border rounded-lg p-6 space-y-4">
                        <h3 className="text-xl font-semibold flex items-center gap-2">
                          <AlertCircle className="w-5 h-5" />
                          Evidence Needed
                        </h3>
                        <ul className="space-y-2">
                          {analysis.legalAnalysis.recommendedEvidence.map(
                            (evidence: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                                <span className="text-muted-foreground">
                                  {evidence}
                                </span>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}

                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground italic">
                      <strong>DISCLAIMER:</strong> This assessment is provided
                      for informational purposes only and does not constitute
                      legal advice. The information provided is based on the
                      details you submitted and general legal principles. Laws
                      vary by jurisdiction and individual circumstances. For
                      specific legal advice regarding your situation, please
                      consult with a licensed attorney in your state. This
                      analysis does not create an attorney-client relationship.
                    </p>
                  </div>

                  <div className="flex gap-4">
                    <Button
                      onClick={() => {
                        setAnalysis(null);
                        setSituation("");
                        localStorage.removeItem("prefillData");
                      }}
                      variant="outline"
                      className="flex-1"
                      data-testid="button-new-analysis"
                    >
                      New Analysis
                    </Button>
                    {onBack && (
                      <Button
                        onClick={onBack}
                        variant="outline"
                        data-testid="button-back-to-home"
                      >
                        Back to Home
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}