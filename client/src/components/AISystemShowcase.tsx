import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AIModel {
  icon: string;
  name: string;
  provider: string;
  specialty: string;
  context: string;
}

const AI_MODELS: AIModel[] = [
  {
    icon: "⚡",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    specialty: "Ultra-fast multimodal analysis",
    context: "1M context"
  },
  {
    icon: "⚖️",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    specialty: "Advanced legal reasoning",
    context: "200k context"
  },
  {
    icon: "🧠",
    name: "DeepSeek R1T2 Chimera",
    provider: "TNG",
    specialty: "671B parameter deep analysis",
    context: "163k context"
  },
  {
    icon: "📚",
    name: "Grok 4.1 Fast",
    provider: "xAI",
    specialty: "Massive document processing",
    context: "2M context"
  },
  {
    icon: "🎯",
    name: "Kimi K2",
    provider: "MoonshotAI",
    specialty: "1T parameter structured extraction",
    context: "256k context"
  },
  {
    icon: "🚀",
    name: "Groq Llama 3.3",
    provider: "Groq",
    specialty: "Unlimited-speed background processing",
    context: "Unlimited"
  },
  {
    icon: "✓",
    name: "Mistral Small",
    provider: "Mistral",
    specialty: "Balanced verification",
    context: "Standard"
  }
];

interface AISystemShowcaseProps {
  variant?: "full" | "brief" | "minimal";
}

export function AISystemShowcase({ variant = "full" }: AISystemShowcaseProps) {
  if (variant === "minimal") {
    return (
      <Badge variant="secondary" className="text-xs sm:text-sm">
        🤖 Powered by 7 AI Models
      </Badge>
    );
  }

  if (variant === "brief") {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            7-Provider AI Coordination System
          </CardTitle>
          <CardDescription>
            Revolutionary parallel processing with Gemini, Claude, DeepSeek, Grok, Kimi, Groq, and Mistral
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {AI_MODELS.map((model) => (
              <div
                key={model.name}
                className="flex items-center gap-1.5 p-2 rounded-md bg-background border border-border/50"
              >
                <span className="text-xl">{model.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{model.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{model.provider}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Full variant
  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-3">
            <span className="text-4xl">🤖</span>
            Revolutionary 7-Provider AI Coordination System
          </CardTitle>
          <CardDescription className="text-base">
            The world's first police accountability platform powered by seven leading AI models working in parallel
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* AI Model Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {AI_MODELS.map((model) => (
              <Card key={model.name} className="border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{model.icon}</span>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base leading-tight">
                        {model.name}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {model.provider}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-sm">{model.specialty}</p>
                  <Badge variant="secondary" className="text-xs">
                    {model.context}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* How It Works Section */}
          <div className="rounded-lg border bg-background p-6 space-y-4">
            <h3 className="text-lg font-semibold">How It Works</h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <span className="text-primary font-bold">1.</span>
                <p>
                  <strong>Parallel Processing:</strong> When you submit a search or document request, 
                  all seven AI models activate simultaneously, each applying their unique capabilities 
                  to analyze your case from different angles.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-primary font-bold">2.</span>
                <p>
                  <strong>Specialized Analysis:</strong> Gemini handles rapid multimodal analysis, 
                  Claude provides legal reasoning, DeepSeek performs deep pattern recognition, 
                  Grok processes massive document sets, Kimi extracts structured data, Groq maintains 
                  continuous background processing, and Mistral verifies accuracy.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-primary font-bold">3.</span>
                <p>
                  <strong>Coordinated Results:</strong> Results from all seven models are synthesized 
                  into a comprehensive, accurate output that's 5× faster and 10× more thorough than 
                  traditional single-AI systems.
                </p>
              </div>
            </div>
          </div>

          {/* Benefits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-start gap-2 text-sm">
              <span className="text-green-500">✓</span>
              <span>7 AI Models Analyze Every Search</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <span className="text-green-500">✓</span>
              <span>Each AI Contributes Its Specialty</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <span className="text-green-500">✓</span>
              <span>5× Faster Processing Speed</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <span className="text-green-500">✓</span>
              <span>10× More Comprehensive Results</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
