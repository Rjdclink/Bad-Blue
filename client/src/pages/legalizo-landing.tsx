import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale, FileText, Brain, CheckCircle, Search } from "lucide-react";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";

export default function LegalWhatLanding() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <SEOHead
        title="LegalWhat - AI-Powered Legal Platform | Professional Legal Services"
        description="Access comprehensive legal services with AI-assisted guidance. Get legal consultation, document creation, and support for all types of law. Subscribe for $25.99/month."
        keywords="legal platform, AI legal services, legal consultation, document creation, legal assistance, LegalWhat"
        ogTitle="LegalWhat - Your AI-Powered Legal Partner"
        ogDescription="Professional legal services with AI assistance for all types of law. Subscribe now for $25.99/month."
      />

      {/* Welcome Header - Top of Page */}
      <section className="container mx-auto px-4 pt-12 pb-6">
        <div className="text-center">
          <h1 className="text-5xl md:text-7xl font-serif font-bold bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-200 bg-clip-text text-transparent drop-shadow-2xl tracking-wide mb-2">
            WELCOME TO LEGALWHAT
          </h1>
          <div className="h-1 w-64 mx-auto bg-gradient-to-r from-transparent via-yellow-600 to-transparent"></div>
        </div>
      </section>

      {/* Multi-Agent System Description - Compact Top Placement */}
      <section className="container mx-auto px-4 pb-8">
        <div className="bg-gradient-to-br from-slate-800/90 via-slate-900/90 to-slate-800/90 rounded-xl p-6 border border-amber-700/40 shadow-xl backdrop-blur-sm">
          <div className="text-center space-y-3">
            <h2 className="text-xl md:text-2xl font-serif font-bold bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent">
              Thirteen-Model Multi-Agent Legal Intelligence Consortium
            </h2>
            <div className="text-gray-300 text-sm md:text-base leading-relaxed max-w-5xl mx-auto">
              <p className="mb-3">
                A sophisticated federation of thirteen specialized artificial intelligence models orchestrated in parallel to deliver comprehensive legal services. Each AI model serves as a distinguished legal specialist within our digital consortium, collectively providing counsel across all domains of jurisprudence.
              </p>
              
              {/* AI Models Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-4 text-left">
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Kimi K2</h3>
                  <p className="text-gray-400 text-xs">Moonshot AI • Complex case analysis with extensive contextual reasoning across 200K tokens</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">DeepSeek R1</h3>
                  <p className="text-gray-400 text-xs">Advanced reasoning engine • Legal document structuring and logical framework development</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Grok 4.1 Fast</h3>
                  <p className="text-gray-400 text-xs">xAI • Expedited legal inquiries with real-time data integration and rapid response</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Qwen 2.5 72B</h3>
                  <p className="text-gray-400 text-xs">Alibaba Cloud • Multilingual jurisprudence and precision instruction-following protocols</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Gemini 2.5 Pro</h3>
                  <p className="text-gray-400 text-xs">Google • Premier analytical engine with 2M token context for complex legal compositions</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Gemini 2.5 Flash</h3>
                  <p className="text-gray-400 text-xs">Google • Accelerated legal consultation with 1M token capacity for efficient processing</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Gemini 2.5 Flash Lite</h3>
                  <p className="text-gray-400 text-xs">Google • Swift Q&A facilitation and form automation with optimized performance</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Llama 3.3 70B</h3>
                  <p className="text-gray-400 text-xs">Meta via Groq • Versatile general counsel with Groq LPU™ acceleration technology</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Llama 3.1 8B</h3>
                  <p className="text-gray-400 text-xs">Meta via Groq • Ultra-fast response for real-time legal dialogue and instant guidance</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Mistral Large</h3>
                  <p className="text-gray-400 text-xs">Mistral AI • European compliance specialist ensuring GDPR adherence and EU standards</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Claude 3.5 Sonnet</h3>
                  <p className="text-gray-400 text-xs">Anthropic • Premium analytical counsel with superior reasoning and accuracy</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Claude 3.5 Haiku</h3>
                  <p className="text-gray-400 text-xs">Anthropic • Cost-efficient premium consultation with expedited processing capabilities</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded border border-amber-800/30">
                  <h3 className="text-amber-400 font-semibold text-xs mb-1">Meta-Orchestrator</h3>
                  <p className="text-gray-400 text-xs">Proprietary System • Judicial-grade coordination framework governing all AI interactions</p>
                </div>
              </div>

              <p className="mt-4 text-xs text-gray-400 italic">
                This coalition-class legal architecture operates as a synchronized digital law firm—executing parallel inference, precedent integration, jurisdictional compliance, and adversarial review within a unified computational ecosystem purpose-built for the practice of law.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Hero Section with Lady of Justice Photo */}
      <section className="container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Lady of Justice Professional Photo */}
          <div className="flex justify-center">
            <div className="relative w-full max-w-lg">
              {/* Decorative glow behind image */}
              <div className="absolute -inset-4 bg-gradient-to-r from-amber-600/20 via-yellow-500/20 to-amber-600/20 rounded-2xl blur-2xl" />
              
              {/* Main hero image */}
              <img
                src="/images/lady-justice-hero.jpg"
                alt="Lady Justice statue with scales and gavel representing fair legal proceedings, American flag in background"
                className="relative w-full h-auto rounded-xl shadow-2xl object-cover border border-amber-700/30"
                style={{
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(212, 175, 55, 0.1)',
                }}
              />
              
              {/* Decorative frame corners */}
              <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-l-4 border-amber-600/50 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-16 h-16 border-t-4 border-r-4 border-amber-600/50 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-16 h-16 border-b-4 border-l-4 border-amber-600/50 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-16 h-16 border-b-4 border-r-4 border-amber-600/50 rounded-br-xl" />
            </div>
          </div>

          {/* Right: Service Description */}
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Scale className="w-12 h-12 text-amber-500" />
                <h2 className="text-5xl md:text-6xl font-serif font-bold bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-200 bg-clip-text text-transparent">
                  LegalWhat
                </h2>
              </div>
              <p className="text-xl text-gray-300 mb-2 font-serif">
                Your AI-Powered Legal Partner
              </p>
              <div className="flex items-center gap-2 text-3xl font-bold text-amber-400">
                <span>$25.99</span>
                <span className="text-lg text-gray-400 font-normal">/month</span>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-lg leading-relaxed text-gray-300">
                LegalWhat is a revolutionary subscription-based legal platform that democratizes access to professional legal services through cutting-edge AI technology. Our platform combines the expertise of thirteen coordinated AI systems with comprehensive legal knowledge to provide you with unparalleled legal assistance.
              </p>

              <div className="grid gap-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-white">Professional Legal Consultation</p>
                    <p className="text-sm text-gray-400">Get expert guidance on your legal matters with AI-powered analysis and recommendations</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-white">Document Creation & Automation</p>
                    <p className="text-sm text-gray-400">Generate professional legal documents tailored to your specific needs</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-white">Thirteen AI Systems Working in Harmony</p>
                    <p className="text-sm text-gray-400">Benefit from coordinated AI for classification, drafting, optimization, validation, and more</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-white">All Types of Law Covered</p>
                    <p className="text-sm text-gray-400">From family law to corporate law, immigration to intellectual property - we cover 30+ legal practice areas</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-white">Deep OSINT People Search</p>
                    <p className="text-sm text-gray-400">Comprehensive background research with professional reports for your legal needs</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6">
              <Button 
                size="lg" 
                className="w-full text-lg py-7 bg-gradient-to-r from-amber-600 to-yellow-500 hover:from-amber-500 hover:to-yellow-400 text-black font-bold shadow-xl hover:shadow-2xl transition-all duration-300"
                onClick={() => setLocation("/legalizo-auth")}
              >
                Login or Sign Up
              </Button>
              <p className="text-xs text-center text-gray-500 mt-3">
                Start your legal journey today. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-12">
        <h2 className="text-3xl font-serif font-bold text-center mb-12 bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-200 bg-clip-text text-transparent">
          Comprehensive Legal Services at Your Disposal
        </h2>
        
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-slate-800/50 border-amber-800/40 hover:border-amber-600/60 transition-all duration-300 hover:shadow-xl hover:shadow-amber-600/10">
            <CardHeader>
              <Scale className="w-12 h-12 text-amber-500 mb-4" />
              <CardTitle className="text-white font-serif">Legal Consultation</CardTitle>
              <CardDescription className="text-gray-400">
                AI-powered legal analysis and consultation for your specific case
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Case evaluation and analysis
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Legal strategy recommendations
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Statute and case law research
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-amber-800/40 hover:border-amber-600/60 transition-all duration-300 hover:shadow-xl hover:shadow-amber-600/10">
            <CardHeader>
              <FileText className="w-12 h-12 text-amber-500 mb-4" />
              <CardTitle className="text-white font-serif">Document Creation</CardTitle>
              <CardDescription className="text-gray-400">
                Professional legal documents generated and customized for you
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Contracts and agreements
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Legal briefs and motions
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Complaints and petitions
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-amber-800/40 hover:border-amber-600/60 transition-all duration-300 hover:shadow-xl hover:shadow-amber-600/10">
            <CardHeader>
              <Search className="w-12 h-12 text-amber-500 mb-4" />
              <CardTitle className="text-white font-serif">People Search</CardTitle>
              <CardDescription className="text-gray-400">
                Deep OSINT research with comprehensive professional reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Public records aggregation
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Social media analysis
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Professional report generation
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center border-t border-amber-900/30">
        <p className="text-sm text-gray-400 font-serif">
          © 2024 LegalWhat. All rights reserved. Professional legal services powered by AI.
        </p>
        <p className="text-xs mt-2 text-gray-500">
          LegalWhat provides AI-assisted legal services but does not replace the advice of a licensed attorney.
        </p>
      </footer>
    </div>
  );
}
