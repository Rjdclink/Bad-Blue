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

      {/* Multi-Agent System Description - Prominent Placement */}
      <section className="container mx-auto px-4 py-8">
        <div className="bg-gradient-to-r from-slate-800/80 via-slate-900/80 to-slate-800/80 rounded-2xl p-8 border border-yellow-600/30 shadow-2xl">
          <div className="text-center space-y-4">
            <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
              Thirteen-Model Multi-Agent Legal Intelligence System
            </h2>
            <div className="text-gray-200 text-base md:text-lg leading-relaxed space-y-4 max-w-5xl mx-auto">
              <p>
                This platform is a thirteen-model, cross-computational, tandem, parallel-processing, orchestrated multi-agent legal intelligence system—purpose-built for online legal consultation, structured document drafting, procedural compliance review, substantive legal analysis, and people-information retrieval.
              </p>
              <p>
                Each model functions as a distinct legal practitioner—handling issue spotting, statutory parsing, precedent integration, burden-of-proof evaluation, argument stress-testing, drafting automation, jurisdictional rule enforcement, and OSINT-based fact development—operating together under a judicial-grade orchestration spine.
              </p>
              <p>
                Agent outputs converge through a shared reasoning lattice, enabling parallel legal inference, rapid refinement of theory and text, cross-validating analysis sharing, and disciplined consensus formation. A meta-controller governs escalation, resolves doctrinal conflict, applies expertise weighting, and maintains persistent stateful legal context across all interactions.
              </p>
              <p>
                The result is a coalition-class legal framework—a digital alliance where thirteen coordinated AI models function like a federation of law firms, executing multi-perspective legal cognition, rule-aligned drafting, adversarial review, and fact-driven optimization inside a synchronized computational ecosystem engineered explicitly for the practice of law.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Hero Section with Lady of Justice Photo */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Lady of Justice Professional Photo */}
          <div className="flex justify-center">
            <div className="relative w-full max-w-lg">
              {/* Decorative glow behind image */}
              <div className="absolute -inset-4 bg-gradient-to-r from-yellow-600/20 via-amber-500/20 to-yellow-600/20 rounded-2xl blur-2xl" />
              
              {/* Main hero image */}
              <img
                src="/images/lady-justice-hero.jpg"
                alt="Lady Justice statue with scales and gavel representing fair legal proceedings, American flag in background"
                className="relative w-full h-auto rounded-xl shadow-2xl object-cover border border-yellow-600/20"
                style={{
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(212, 175, 55, 0.1)',
                }}
              />
              
              {/* Decorative frame corners */}
              <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-l-4 border-yellow-600/50 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-16 h-16 border-t-4 border-r-4 border-yellow-600/50 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-16 h-16 border-b-4 border-l-4 border-yellow-600/50 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-16 h-16 border-b-4 border-r-4 border-yellow-600/50 rounded-br-xl" />
            </div>
          </div>

          {/* Right: Service Description */}
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Scale className="w-12 h-12 text-yellow-500" />
                <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
                  LegalWhat
                </h1>
              </div>
              <p className="text-xl text-gray-300 mb-2">
                Your AI-Powered Legal Partner
              </p>
              <div className="flex items-center gap-2 text-3xl font-bold text-yellow-400">
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
                className="w-full text-lg py-7 bg-gradient-to-r from-yellow-600 to-amber-500 hover:from-yellow-500 hover:to-amber-400 text-black font-bold shadow-xl hover:shadow-2xl transition-all duration-300"
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
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12 text-white">
          Comprehensive Legal Services at Your Fingertips
        </h2>
        
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-slate-800/50 border-slate-700 hover:border-yellow-600/50 transition-all duration-300 hover:shadow-xl hover:shadow-yellow-600/10">
            <CardHeader>
              <Scale className="w-12 h-12 text-yellow-500 mb-4" />
              <CardTitle className="text-white">Legal Consultation</CardTitle>
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

          <Card className="bg-slate-800/50 border-slate-700 hover:border-yellow-600/50 transition-all duration-300 hover:shadow-xl hover:shadow-yellow-600/10">
            <CardHeader>
              <FileText className="w-12 h-12 text-yellow-500 mb-4" />
              <CardTitle className="text-white">Document Creation</CardTitle>
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

          <Card className="bg-slate-800/50 border-slate-700 hover:border-yellow-600/50 transition-all duration-300 hover:shadow-xl hover:shadow-yellow-600/10">
            <CardHeader>
              <Search className="w-12 h-12 text-yellow-500 mb-4" />
              <CardTitle className="text-white">People Search</CardTitle>
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

      {/* AI Systems Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="bg-slate-800/30 rounded-2xl p-8 border border-slate-700">
          <h2 className="text-3xl font-bold text-center mb-4 text-white">
            Powered by Thirteen Coordinated AI Systems
          </h2>
          <p className="text-center text-gray-400 mb-12 max-w-2xl mx-auto">
            Our platform leverages thirteen specialized AI models working in parallel to provide you with the most accurate and comprehensive legal assistance
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Classification AI', desc: 'Identifies and categorizes your legal issues accurately' },
              { title: 'Drafting AI', desc: 'Provides intelligent document drafting suggestions' },
              { title: 'Optimization AI', desc: 'Refines legal language for maximum effectiveness' },
              { title: 'Question AI', desc: 'Generates relevant questions for thorough consultation' },
              { title: 'Validation AI', desc: 'Ensures accuracy and completeness of your information' },
              { title: 'Prediction AI', desc: 'Analyzes potential outcomes based on legal precedents' },
              { title: 'Auto-fill AI', desc: 'Intelligently populates repetitive legal data fields' },
              { title: 'Summary AI', desc: 'Synthesizes consultation data for document creation' },
              { title: 'Issue Spotting AI', desc: 'Identifies critical legal issues and potential claims' },
              { title: 'Precedent Integration AI', desc: 'Analyzes and applies relevant case law' },
              { title: 'Compliance AI', desc: 'Ensures procedural and jurisdictional compliance' },
              { title: 'OSINT Research AI', desc: 'Deep people and fact-based information retrieval' },
              { title: 'Meta-Controller AI', desc: 'Orchestrates all systems and resolves conflicts' },
            ].map((system, index) => (
              <Card key={index} className="bg-slate-900/50 border-slate-600 hover:border-yellow-600/30 transition-colors">
                <CardHeader className="pb-3">
                  <Brain className="w-8 h-8 text-yellow-500 mb-2" />
                  <CardTitle className="text-base text-white">{system.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-400">{system.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center border-t border-slate-800">
        <p className="text-sm text-gray-500">
          © 2024 LegalWhat. All rights reserved. Professional legal services powered by AI.
        </p>
        <p className="text-xs mt-2 text-gray-600">
          LegalWhat provides AI-assisted legal services but does not replace the advice of a licensed attorney.
        </p>
      </footer>
    </div>
  );
}
