import OfficerSearch from "@/components/OfficerSearch";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function OfficerSearchPage() {
  usePageFaqSchema("/officer-search");
  
  const [, setLocation] = useLocation();

  return (
    <>
      <SEOHead
        title="Officer Search - BadBlue Police Accountability"
        description="Search public records for police officer information including rank, disciplinary history, lawsuits, and career history. Comprehensive database search for police accountability."
        keywords="police officer search, officer lookup, police accountability, disciplinary records, police database"
      />
      <div className="min-h-screen bg-background">
        <div className="container max-w-4xl mx-auto px-4 py-4">
          <Button
            variant="ghost"
            onClick={() => setLocation("/home")}
            className="mb-4"
            data-testid="button-back-to-dashboard"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>

          {/* AI Explanation Card */}
          <Card className="mb-6 border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                7 AI Models Analyze Your Search
              </CardTitle>
              <CardDescription>
                Revolutionary parallel processing for comprehensive results
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                When you search, Gemini, Claude, DeepSeek, Grok, Kimi, Groq, and Mistral analyze 
                records simultaneously. Each AI contributes its specialty to deliver the most 
                comprehensive officer background report available.
              </p>
              
              {/* AI Model Badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs">⚡ Gemini - Multimodal Analysis</Badge>
                <Badge variant="secondary" className="text-xs">⚖️ Claude - Legal Reasoning</Badge>
                <Badge variant="secondary" className="text-xs">🧠 DeepSeek - Deep Analysis</Badge>
                <Badge variant="secondary" className="text-xs">📚 Grok - Document Processing</Badge>
                <Badge variant="secondary" className="text-xs">🎯 Kimi - Data Extraction</Badge>
                <Badge variant="secondary" className="text-xs">🚀 Groq - Background Processing</Badge>
                <Badge variant="secondary" className="text-xs">✓ Mistral - Verification</Badge>
              </div>

              <div className="text-xs text-muted-foreground pt-2 border-t">
                <strong>How it works:</strong> All seven AI models process your search in parallel, 
                cross-referencing public records, court filings, news articles, and disciplinary 
                databases to deliver results 5× faster and 10× more comprehensive than traditional systems.
              </div>
            </CardContent>
          </Card>
        </div>
        <OfficerSearch onBack={() => setLocation("/home")} />

        {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
        <HiddenFAQ path="/officer-search" />
      </div>
    </>
  );
}
