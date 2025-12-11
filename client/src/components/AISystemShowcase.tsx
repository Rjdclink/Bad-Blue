import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AIModel {
  name: string;
  provider: string;
  description: string;
  backgroundImage: string;
}

const AI_MODELS: AIModel[] = [
  // Row 1
  {
    name: "Gemini 2.5 Pro",
    provider: "Google",
    description: "Deepest reasoning with 2M token context for complex legal analysis",
    backgroundImage: "/images/what.comp3.jpg"
  },
  {
    name: "Gemini 2.5 Flash",
    provider: "Google",
    description: "Lightning-fast multimodal processing for evidence and documents",
    backgroundImage: "/images/OIP.comp4.webp"
  },
  {
    name: "Gemini 2.5 Flash Lite",
    provider: "Google",
    description: "High-throughput engine handling 1000 requests daily",
    backgroundImage: "/images/OIP.comp5.webp"
  },
  // Row 2
  {
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    description: "Premium legal reasoning with nuanced constitutional interpretation",
    backgroundImage: "/images/OIP.comp6.webp"
  },
  {
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    description: "Rapid verification specialist for real-time fact-checking",
    backgroundImage: "/images/imag.comp7.webp"
  },
  {
    name: "Llama 3.3 70B",
    provider: "Groq",
    description: "Versatile workhorse balancing speed and comprehensive analysis",
    backgroundImage: "/images/OIP.comp8.webp"
  },
  // Row 3
  {
    name: "Llama 3.1 8B",
    provider: "Groq",
    description: "Instant-response engine for lightweight task execution",
    backgroundImage: "/images/OIP.comp9.webp"
  },
  {
    name: "Mistral Small",
    provider: "Mistral",
    description: "EU-compliant processing with balanced verification protocols",
    backgroundImage: "/images/iStock-.comp10.jpg"
  },
  {
    name: "Kimi K2",
    provider: "Moonshot AI",
    description: "Trillion-parameter extraction engine for structured legal data",
    backgroundImage: "/images/OIP.comp11.webp"
  },
  // Row 4
  {
    name: "DeepSeek R1T2 Chimera",
    provider: "TNG",
    description: "671B parameter deep pattern recognition across case law",
    backgroundImage: "/images/OIP.comp12.webp"
  },
  {
    name: "Grok 4.1 Fast",
    provider: "xAI",
    description: "Massive 2M context window for entire case file processing",
    backgroundImage: "/images/superc.comp13.jpg"
  },
  {
    name: "Qwen 2.5 72B",
    provider: "Alibaba",
    description: "Precision instruction-following for procedural compliance",
    backgroundImage: "/images/OIP.comp14.webp"
  }
];

interface AISystemShowcaseProps {
  variant?: "full" | "brief" | "minimal";
}

export function AISystemShowcase({ variant = "full" }: AISystemShowcaseProps) {
  if (variant === "minimal") {
    return (
      <Badge variant="secondary" className="text-xs sm:text-sm">
        🤖 Powered by 12 AI Models
      </Badge>
    );
  }

  if (variant === "brief") {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            12-Model AI Orchestration Network
          </CardTitle>
          <CardDescription>
            Twelve specialized AI engines working in synchronized coordination
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {AI_MODELS.map((model) => (
              <div
                key={model.name}
                className="flex flex-col gap-1 p-2 rounded-md bg-background border border-border/50"
              >
                <p className="text-xs font-medium truncate">{model.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{model.provider}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Full variant - 12 Models in 4×3 Grid
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {AI_MODELS.map((model) => (
        <div 
          key={model.name}
          className="relative overflow-hidden rounded-2xl shadow-xl group hover:scale-[1.02] transition-transform duration-300"
        >
          {/* Background Image */}
          <img 
            src={model.backgroundImage}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
          
          {/* Dark Overlay */}
          <div className="absolute inset-0 bg-black/50" />
          
          {/* Content */}
          <div className="relative z-10 p-6 flex flex-col h-full min-h-[200px]">
            {/* Model Name */}
            <h3 className="text-xl font-bold text-white mb-1">{model.name}</h3>
            
            {/* Provider */}
            <p className="text-sm text-white/70 mb-3">{model.provider}</p>
            
            {/* Description - Bright soft white with shadowed edges */}
            <p 
              className="text-sm text-white/95 mt-auto"
              style={{ 
                textShadow: '1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5)' 
              }}
            >
              {model.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
