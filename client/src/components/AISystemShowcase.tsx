import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const HARMONY_MODELS = [
  "Gemini 3.7 Flash",
  "Claude Sonnet 5",
  "Claude Opus 5",
  "GPT-OSS 120B (Groq)",
  "Mistral Small 4",
  "DeepSeek V4.1 Flash",
  "Grok 4.6",
  "Kimi K3",
  "Qwen 3.8 Max",
  "GPT-5.6 Luna",
  "GPT-OSS 120B",
  "OpenRouter Auto",
  "Grok 4.6 (xAI)",
  "GPT-OSS 120B (Cerebras)",
  "GPT-OSS 120B (Fireworks)",
  "Command A+ (Cohere)",
  "GPT-OSS 120B (Together)"
];

interface AISystemShowcaseProps {
  variant?: "full" | "brief" | "minimal";
}

export function AISystemShowcase({ variant = "full" }: AISystemShowcaseProps) {
  if (variant === "minimal") {
    return <Badge variant="secondary" className="text-xs sm:text-sm">🤖 Powered by 17 Harmony AI Participants</Badge>;
  }

  return (
    <Card className={variant === "brief" ? "border-primary/20 bg-primary/5" : "relative max-w-5xl mx-auto overflow-hidden border-white/20 bg-slate-950 text-white shadow-xl"}>
      {variant === "full" && <><img src="/images/superc.comp13.jpg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0 bg-black/65" /></>}\n      <CardHeader className="relative z-10 text-center">
        <CardTitle className="text-xl md:text-2xl flex items-center justify-center gap-2">
          <span aria-hidden="true">🤖</span>
          17-Model Harmony AI Network
        </CardTitle>
        <CardDescription>
          Specialized AI participants coordinated through one orchestration network.
        </CardDescription>
      </CardHeader>
      <CardContent className="relative z-10">
        <div className="flex flex-wrap justify-center gap-2">
          {HARMONY_MODELS.map((model, index) => (
            <Badge key={`${model}-${index}`} variant="secondary" className="px-3 py-1.5 text-xs sm:text-sm bg-white/90 text-slate-900">
              {model}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
