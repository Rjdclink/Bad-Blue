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
import { Badge } from "@/components/ui/badge";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Scale,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { generateDeviceFingerprint } from "@/lib/deviceFingerprint";

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

export default function SampleLegalConsultation() {
  const { toast } = useToast();
  const [state, setState] = useState("");
  const [situation, setSituation] = useState("");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const [wordCount, setWordCount] = useState(0);

  const analyzeMutation = useMutation({
    mutationFn: async (data: { 
      state: string; 
      situation: string;
      deviceFingerprint: string;
    }) => {
      const response = await apiRequest("/api/sample-legal-consultation", "POST", data);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }

      return await response.json();
    },
    onSuccess: (data) => {
      if (data.alreadyUsed) {
        setDeviceBlocked(true);
        toast({
          title: "Sample Already Used",
          description: "You've already used your free sample consultation. Sign up for full access to unlimited consultations.",
          variant: "destructive",
        });
        return;
      }

      if (!data || typeof data !== 'object') {
        toast({
          title: "Analysis Error",
          description: "Received invalid response. Please try again.",
          variant: "destructive",
        });
        return;
      }
      
      setAnalysis(data);
      toast({
        title: "Sample Analysis Complete",
        description: "This is a sample consultation. Sign up for comprehensive legal analysis.",
      });
    },
    onError: (error: Error) => {
      console.error("Sample consultation error:", error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Unable to analyze your situation. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async () => {
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

    if (wordCount > 200) {
      toast({
        title: "Description Too Long",
        description: "Sample consultations are limited to 200 words",
        variant: "destructive",
      });
      return;
    }

    // Generate device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();

    analyzeMutation.mutate({ 
      state, 
      situation: situation.trim().substring(0, 1000), // Truncate for safety
      deviceFingerprint 
    });
  };

  const handleSituationChange = (value: string) => {
    setSituation(value);
    const words = value.trim().split(/\s+/).filter(word => word.length > 0);
    setWordCount(words.length);
  };

  if (deviceBlocked) {
    return (
      <Card data-testid="card-sample-blocked">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Sample Already Used
          </CardTitle>
          <CardDescription>
            You've already tried the free sample consultation on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Sign up for full access to get:
              <ul className="mt-2 ml-4 list-disc">
                <li>Unlimited legal consultations</li>
                <li>Detailed statute citations and case law</li>
                <li>Officer badge identification</li>
                <li>Complaint and lawsuit filing assistance</li>
              </ul>
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Create an account above to unlock all features for $25.99/month.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-sample-consultation">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5" />
            Try Sample Legal Consultation
          </CardTitle>
          <Badge variant="secondary">FREE SAMPLE</Badge>
        </div>
        <CardDescription>
          Experience BadBlue's AI-powered legal analysis with a free sample consultation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!analysis ? (
          <>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This is a limited sample consultation. Sign up for comprehensive legal analysis including detailed statutes, case law, and actionable recommendations.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="state" data-testid="label-state">
                Select Your State
              </Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger data-testid="select-state">
                  <SelectValue placeholder="Choose your state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code} data-testid={`select-item-${s.code}`}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="situation" data-testid="label-situation">
                  Describe Your Situation (Sample)
                </Label>
                <span className={`text-xs ${wordCount > 200 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {wordCount}/200 words
                </span>
              </div>
              <Textarea
                id="situation"
                placeholder="Briefly describe your legal situation (max 200 words for sample)"
                value={situation}
                onChange={(e) => handleSituationChange(e.target.value)}
                rows={4}
                className="resize-none"
                data-testid="textarea-situation"
              />
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox
                id="disclaimer"
                checked={disclaimerAccepted}
                onCheckedChange={(checked) => setDisclaimerAccepted(checked as boolean)}
                data-testid="checkbox-disclaimer"
              />
              <Label
                htmlFor="disclaimer"
                className="text-xs cursor-pointer"
                data-testid="label-disclaimer"
              >
                I understand this is a sample consultation for demonstration purposes. Full BadBlue services provide comprehensive legal consultation with detailed analysis and actionable recommendations.
              </Label>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={analyzeMutation.isPending || !disclaimerAccepted || !state || !situation.trim() || wordCount > 200}
              className="w-full"
              data-testid="button-analyze-sample"
            >
              {analyzeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing Sample...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Try Free Sample Analysis
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <Alert className="border-primary/50 bg-primary/5">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                Sample Analysis Complete
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-sm mb-1">Sample Legal Analysis</h4>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {analysis.analysis}
                </div>
              </div>
            </div>

            <Alert className="border-orange-500/50 bg-orange-500/5">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <AlertDescription className="text-sm">
                <strong>This is a sample analysis.</strong> For comprehensive legal consultation including detailed statutes, case law, and actionable recommendations, sign up for full BadBlue access.
              </AlertDescription>
            </Alert>

            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground mb-3">
                Ready for full legal consultation? Sign up above to:
              </p>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Get detailed statute citations and case law</li>
                <li>• Access officer badge identification</li>
                <li>• File complaints and lawsuits</li>
                <li>• Receive comprehensive legal strategies</li>
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}