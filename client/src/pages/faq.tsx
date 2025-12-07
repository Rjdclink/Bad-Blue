/**
 * LegalWhat FAQ Page
 * 
 * Comprehensive FAQ page for LegalWhat platform
 * Includes P.A.N.T.H.E.O.N. 13-AI system, core AI systems, and all 30 law types
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronDown, 
  ChevronUp, 
  ArrowRight, 
  Shield, 
  Brain, 
  FileText, 
  Camera, 
  Search,
  Sparkles,
  Scale,
  Lock,
  DollarSign,
  AlertTriangle
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { AppHeader } from "@/components/AppHeader";
import { LAW_TYPE_DATA } from "@shared/lawTypes";

// P.A.N.T.H.E.O.N. AI Models Data
const AI_MODELS = [
  { num: 1, name: "Gemini 2.5 Flash Lite", provider: "Google", specs: "1000 RPD, ultra-fast processing" },
  { num: 2, name: "Gemini 2.5 Flash", provider: "Google", specs: "50 RPD, multimodal + Google Search grounding" },
  { num: 3, name: "Claude 3.5 Haiku", provider: "Anthropic", specs: "Fast verification" },
  { num: 4, name: "Claude 3.5 Sonnet", provider: "Anthropic", specs: "200k context, advanced legal reasoning" },
  { num: 5, name: "Groq Llama 3.3 70B", provider: "Groq", specs: "Unlimited autonomous capacity" },
  { num: 6, name: "Mistral Large/Small", provider: "Mistral AI", specs: "150k tokens/day, verification" },
  { num: 7, name: "DeepSeek R1T2 Chimera", provider: "DeepSeek", specs: "671B params, 163k context, pattern recognition" },
  { num: 8, name: "Grok 4.1 Fast", provider: "xAI", specs: "2M context, multimodal" },
  { num: 9, name: "Kimi K2", provider: "Moonshot AI", specs: "1T params, 256k context, structured extraction" },
  { num: 10, name: "Qwen 2.5 72B", provider: "Alibaba", specs: "Research and analysis" },
  { num: 11, name: "Llama 3 70B", provider: "Meta", specs: "General purpose" },
  { num: 12, name: "Mistral Large (OpenRouter)", provider: "OpenRouter", specs: "Alternate routing" },
  { num: 13, name: "Gemini 2.0 Flash", provider: "Google", specs: "Experimental fallback" },
];

// Core AI Systems
const CORE_SYSTEMS = [
  {
    name: "ALEXERA",
    acronym: "Legal Expert AI Resource Advisor",
    description: "Primary legal consultation AI providing comprehensive legal guidance across all 30 law types",
    icon: Brain,
    iconColor: "text-blue-600"
  },
  {
    name: "C.A.D.E.",
    acronym: "Case Adaptive Drafting Entity",
    description: "Jurisprudential drafting intelligence engine, procedural law-aware, content-adaptive, jurisdiction-specific legal authoring machine, operating as co-counsel to ALEXERA",
    icon: FileText,
    iconColor: "text-purple-600"
  },
  {
    name: "F.M.I.",
    acronym: "Forensic Media Intelligence",
    description: "Evidence analysis system for videos, photos, audio, and documents with advanced pattern recognition",
    icon: Camera,
    iconColor: "text-green-600"
  },
  {
    name: "I-DRIVE",
    acronym: "Identity Data Retrieval & Investigative Examiner",
    description: "Advanced people and identity search tool aggregating data from multiple public and legal sources",
    icon: Search,
    iconColor: "text-orange-600"
  },
];

// FAQ Sections
interface FAQItem {
  question: string;
  answer: string | JSX.Element;
}

export default function FAQPage() {
  const [, setLocation] = useLocation();
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0])); // First section expanded by default

  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };

  // Image error handler
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    console.error('Image failed to load:', e.currentTarget.src);
    // Hide image by adding CSS class
    e.currentTarget.classList.add('hidden');
  };

  const faqSections: { title: string; icon: any; items: FAQItem[] }[] = [
    {
      title: "P.A.N.T.H.E.O.N. - 13-AI Parallel Framework",
      icon: Sparkles,
      items: [
        {
          question: "What is P.A.N.T.H.E.O.N.?",
          answer: (
            <div>
              <p className="mb-4">
                P.A.N.T.H.E.O.N. (Parallel Autonomous Network for Tactical Heuristic Eidolon Operations Network) is 
                LegalWhat's revolutionary 13-AI orchestration framework. Unlike traditional single-model AI systems, 
                P.A.N.T.H.E.O.N. runs 13 different AI models in parallel, cross-computational tandem to provide 
                the most accurate, comprehensive, and reliable legal intelligence available.
              </p>
              <p className="mb-4 font-semibold">The 13 AI Models:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-primary/20">
                      <th className="text-left py-2 px-3">#</th>
                      <th className="text-left py-2 px-3">Model</th>
                      <th className="text-left py-2 px-3">Provider</th>
                      <th className="text-left py-2 px-3">Specifications</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AI_MODELS.map((model) => (
                      <tr key={model.num} className="border-b border-muted hover:bg-muted/50">
                        <td className="py-2 px-3">{model.num}</td>
                        <td className="py-2 px-3 font-medium">{model.name}</td>
                        <td className="py-2 px-3">{model.provider}</td>
                        <td className="py-2 px-3 text-muted-foreground">{model.specs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                These models work together, validating each other's outputs and providing redundancy to ensure 
                the highest quality legal assistance.
              </p>
            </div>
          )
        },
        {
          question: "How does the parallel AI system work?",
          answer: "P.A.N.T.H.E.O.N. sends your legal query to multiple AI models simultaneously. Each model analyzes your situation from its unique perspective and expertise. The system then cross-validates the responses, synthesizes the best insights, and delivers a comprehensive answer that leverages the strengths of all 13 models. This parallel processing ensures accuracy, reduces AI hallucinations, and provides multiple verification layers."
        },
        {
          question: "Why use 13 different AI models?",
          answer: "Different AI models excel at different tasks. Some are better at legal reasoning, others at document analysis, and others at understanding context. By using 13 models in tandem, LegalWhat ensures that your legal matter is analyzed from every possible angle, with multiple layers of verification. This redundancy also ensures system reliability - if one model is unavailable, the others continue working seamlessly."
        }
      ]
    },
    {
      title: "Core AI Systems",
      icon: Brain,
      items: [
        {
          question: "What is ALEXERA?",
          answer: (
            <div>
              <p className="mb-2">
                <span className="font-bold">ALEXERA</span> <span className="text-sm text-muted-foreground">(Legal Expert AI Resource Advisor)</span>
              </p>
              <p>
                ALEXERA is LegalWhat's primary legal consultation AI. Powered by the P.A.N.T.H.E.O.N. framework, 
                ALEXERA provides comprehensive legal guidance across all 30 law types. It analyzes your situation, 
                explains relevant laws, identifies your rights, suggests legal strategies, and provides 
                jurisdiction-specific advice tailored to your location.
              </p>
            </div>
          )
        },
        {
          question: "What is C.A.D.E.?",
          answer: (
            <div>
              <p className="mb-2">
                <span className="font-bold">C.A.D.E.</span> <span className="text-sm text-muted-foreground">(Case Adaptive Drafting Entity)</span>
              </p>
              <p>
                C.A.D.E. is LegalWhat's jurisprudential drafting intelligence engine. This procedural law-aware, 
                content-adaptive, jurisdiction-specific legal authoring machine operates as co-counsel to ALEXERA. 
                C.A.D.E. drafts legal documents including complaints, motions, contracts, and pleadings with 
                court-ready formatting and proper legal citations.
              </p>
            </div>
          )
        },
        {
          question: "What is F.M.I.?",
          answer: (
            <div>
              <p className="mb-2">
                <span className="font-bold">F.M.I.</span> <span className="text-sm text-muted-foreground">(Forensic Media Intelligence)</span>
              </p>
              <p>
                F.M.I. is LegalWhat's evidence analysis system. It analyzes videos, photos, audio files, and 
                documents to extract legally relevant information. F.M.I. can identify people, objects, locations, 
                timestamps, detect alterations, transcribe audio, perform OCR on documents, and generate detailed 
                forensic reports suitable for legal proceedings.
              </p>
            </div>
          )
        },
        {
          question: "What is I-DRIVE?",
          answer: (
            <div>
              <p className="mb-2">
                <span className="font-bold">I-DRIVE</span> <span className="text-sm text-muted-foreground">(Identity Data Retrieval & Investigative Examiner)</span>
              </p>
              <p>
                I-DRIVE is LegalWhat's advanced people and identity search tool. It aggregates data from public 
                records, court filings, social media, professional networks, and more to create comprehensive 
                dossiers on individuals. I-DRIVE is essential for finding witnesses, researching opposing parties, 
                locating experts, and conducting due diligence.
              </p>
            </div>
          )
        }
      ]
    },
    {
      title: "30 Law Types",
      icon: Scale,
      items: [
        {
          question: "What areas of law does LegalWhat cover?",
          answer: (
            <div>
              <p className="mb-4">
                LegalWhat provides AI-powered legal assistance across 30 comprehensive areas of law:
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {LAW_TYPE_DATA.map((lawType, index) => (
                  <div 
                    key={lawType.id} 
                    className={`p-3 rounded-md border ${
                      lawType.featured 
                        ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' 
                        : 'bg-muted/50 border-muted'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="font-semibold text-primary shrink-0">{index + 1}.</span>
                      <div>
                        <p className={`font-semibold ${lawType.featured ? 'text-red-700 dark:text-red-400' : ''}`}>
                          {lawType.name}
                          {lawType.featured && (
                            <Badge variant="destructive" className="ml-2 text-xs">Featured</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">{lawType.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        },
        {
          question: "What makes Law Enforcement Accountability special?",
          answer: "Law Enforcement Accountability is LegalWhat's featured specialty, operating under the BadBlue brand. This comprehensive subset includes specialized tools for police misconduct cases, including officer database search, automated complaint filing, Section 1983 lawsuit generation, FOIA requests for police records, and community petitions. BadBlue combines all of LegalWhat's AI systems with domain-specific expertise in civil rights and police accountability law."
        }
      ]
    },
    {
      title: "Getting Started",
      icon: ArrowRight,
      items: [
        {
          question: "How do I get started with LegalWhat?",
          answer: (
            <div>
              <ol className="list-decimal list-inside space-y-2">
                <li>Create a free account by clicking "Get Started" or "Sign Up"</li>
                <li>Choose your area of law from our 30 law types</li>
                <li>Describe your legal situation to ALEXERA for instant consultation</li>
                <li>Use C.A.D.E. to draft legal documents, F.M.I. to analyze evidence, or I-DRIVE to search for people</li>
                <li>Access all tools and AI systems from your dashboard</li>
              </ol>
              <p className="mt-4">
                <Button 
                  onClick={() => setLocation('/login')} 
                  className="w-full sm:w-auto"
                >
                  Get Started Now
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </p>
            </div>
          )
        },
        {
          question: "Do I need legal experience to use LegalWhat?",
          answer: "No legal experience is required. LegalWhat is designed for everyone, from individuals with no legal background to experienced legal professionals. Our AI systems guide you through every step, explain legal concepts in plain language, and provide templates and examples. However, for complex matters, we always recommend consulting with a licensed attorney."
        },
        {
          question: "Can I use LegalWhat on mobile devices?",
          answer: "Yes! LegalWhat is fully responsive and works seamlessly on smartphones, tablets, and desktop computers. Access your account, consult with ALEXERA, draft documents, and use all features from any device with an internet connection."
        }
      ]
    },
    {
      title: "Pricing & Access",
      icon: DollarSign,
      items: [
        {
          question: "How much does LegalWhat cost?",
          answer: "LegalWhat offers flexible pricing options to fit your needs. We provide free access to basic consultations with ALEXERA. Premium features including advanced document drafting with C.A.D.E., comprehensive evidence analysis with F.M.I., and unlimited identity searches with I-DRIVE are available through affordable subscription plans. Special pricing is available for specific services like complaints, lawsuits, and FOIA requests."
        },
        {
          question: "Is there a free trial?",
          answer: "Yes! New users can access ALEXERA consultations for free to experience the power of our P.A.N.T.H.E.O.N. AI system. You can ask legal questions, get initial guidance, and explore the platform before committing to a paid plan."
        },
        {
          question: "What payment methods do you accept?",
          answer: "We accept all major credit cards (Visa, Mastercard, American Express, Discover), debit cards, and digital payment methods through our secure payment processor. All transactions are encrypted and PCI-compliant."
        }
      ]
    },
    {
      title: "Privacy & Security",
      icon: Lock,
      items: [
        {
          question: "Is my information secure?",
          answer: "Absolutely. LegalWhat uses bank-level encryption (AES-256) to protect all your data. Your legal information, documents, and communications are encrypted both in transit and at rest. We comply with GDPR, CCPA, and other privacy regulations. Our servers are hosted in secure, SOC 2 certified data centers."
        },
        {
          question: "Who can see my legal information?",
          answer: "Your legal information is completely private and confidential. Only you can access your account and data. LegalWhat staff cannot view your consultations or documents. We never share, sell, or disclose your information to third parties except as required by law or with your explicit consent."
        },
        {
          question: "Do you keep logs of my consultations?",
          answer: "Yes, we maintain encrypted logs of your consultations and interactions for your benefit - so you can review past advice, track your legal matters, and maintain continuity. However, these logs are encrypted and only accessible to you through your secure account. We do not use your consultation data to train AI models or for any other purpose."
        },
        {
          question: "Can I delete my data?",
          answer: "Yes. You have complete control over your data. You can delete individual documents, consultations, or your entire account at any time. When you delete data, it is permanently removed from our systems within 30 days. We provide data export tools so you can download your information before deletion."
        }
      ]
    },
    {
      title: "Platform Capabilities",
      icon: Sparkles,
      items: [
        {
          question: "What can LegalWhat help me with?",
          answer: "LegalWhat can help with legal consultations, document drafting, evidence analysis, people searches, understanding your rights, filing complaints, drafting lawsuits, requesting public records, researching case law, understanding statutes, preparing for court, negotiating settlements, and much more across all 30 law types."
        },
        {
          question: "How accurate is the AI legal advice?",
          answer: "LegalWhat's P.A.N.T.H.E.O.N. system provides highly accurate legal information by cross-validating responses across 13 different AI models. However, AI cannot account for every nuance of your specific situation. The information provided is for educational and informational purposes. For critical legal decisions, always consult with a licensed attorney in your jurisdiction."
        },
        {
          question: "Does LegalWhat work in my state/country?",
          answer: "LegalWhat covers all 50 US states, Washington D.C., and US territories. Our AI systems are trained on jurisdiction-specific laws and procedures. For international users, LegalWhat can provide general legal information and US law guidance, but we recommend consulting local legal professionals for matters governed by foreign law."
        },
        {
          question: "Can LegalWhat analyze video/photo evidence?",
          answer: "Yes! F.M.I. (Forensic Media Intelligence) can analyze videos, photos, audio files, and documents. Upload your evidence files and F.M.I. will extract timestamps, identify people and objects, detect alterations, transcribe audio, perform OCR on text, and generate detailed forensic reports. This is especially useful for police misconduct cases, personal injury claims, and contract disputes."
        }
      ]
    },
    {
      title: "Legal Disclaimers",
      icon: AlertTriangle,
      items: [
        {
          question: "Is LegalWhat a law firm?",
          answer: (
            <div>
              <p className="font-semibold text-red-600 dark:text-red-400 mb-2">
                NO. LegalWhat is NOT a law firm.
              </p>
              <p>
                LegalWhat is a legal technology platform that provides AI-powered legal information, document 
                preparation tools, and legal research assistance. We do not provide legal advice, legal representation, 
                or legal services. We are not attorneys and do not form an attorney-client relationship with users.
              </p>
            </div>
          )
        },
        {
          question: "Is the information provided legal advice?",
          answer: (
            <div>
              <p className="font-semibold text-red-600 dark:text-red-400 mb-2">
                NO. LegalWhat does NOT provide legal advice.
              </p>
              <p>
                The information provided by LegalWhat's AI systems is for educational and informational purposes only. 
                It is not legal advice and should not be relied upon as such. Every legal situation is unique, and 
                laws vary by jurisdiction. You should consult with a licensed attorney in your area for advice about 
                your specific situation. Using LegalWhat does not create an attorney-client relationship.
              </p>
            </div>
          )
        },
        {
          question: "Should I hire a lawyer?",
          answer: "For complex legal matters, serious charges, or cases involving significant money or rights, we strongly recommend consulting with a licensed attorney. LegalWhat can help you understand your situation, prepare initial documents, and conduct research, but it cannot replace the personalized advice and representation of a qualified attorney who can review all the details of your specific case."
        },
        {
          question: "What if I use LegalWhat and something goes wrong?",
          answer: "LegalWhat provides tools and information to assist you, but you are responsible for your own legal decisions and actions. We make no warranties about the accuracy, completeness, or reliability of the information provided. We are not liable for any outcomes resulting from your use of our platform. Always verify critical information with a licensed attorney and understand the risks before taking legal action."
        }
      ]
    }
  ];

  return (
    <div className="min-h-screen relative">
      {/* Background with gradient overlay */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat -z-10"
        style={{ backgroundImage: "url(/images/Law-book.webp)" }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/75 to-black/80" />
      </div>

      <SEOHead
        title="FAQ - LegalWhat AI Legal Platform"
        description="Frequently asked questions about LegalWhat's P.A.N.T.H.E.O.N. 13-AI system, ALEXERA consultation, C.A.D.E. document drafting, F.M.I. evidence analysis, and I-DRIVE identity search."
      />

      {/* Header */}
      <AppHeader 
        title="LegalWhat FAQ" 
        fallbackRoute="/landing"
        className="bg-black/50 backdrop-blur-md border-b border-white/20"
      />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 sm:py-12 max-w-6xl">
        {/* Hero Section */}
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-5xl font-bold mb-4 text-white flex items-center justify-center flex-wrap gap-2">
            Frequently Asked Questions
            <img 
              src="/images/Legal What Icon.png" 
              alt="?" 
              className="inline-block h-[1em] w-auto object-contain"
              style={{ marginBottom: '-0.08em' }}
              onError={handleImageError}
            />
          </h1>
          <p className="text-lg sm:text-xl text-white/90 max-w-3xl mx-auto mb-6">
            Everything you need to know about LegalWhat's revolutionary AI-powered legal platform
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {CORE_SYSTEMS.map((system) => (
              <Badge 
                key={system.name} 
                variant="secondary" 
                className="text-sm px-3 py-1"
              >
                {system.name}
              </Badge>
            ))}
          </div>
        </div>

        {/* Core AI Systems Showcase */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {CORE_SYSTEMS.map((system) => {
            const Icon = system.icon;
            return (
              <Card 
                key={system.name}
                className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-2 hover:shadow-lg transition-all"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`h-6 w-6 ${system.iconColor}`} />
                    <CardTitle className="text-lg">{system.name}</CardTitle>
                  </div>
                  <p className="text-xs text-muted-foreground italic">
                    {system.acronym}
                  </p>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">
                    {system.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* FAQ Sections */}
        <div className="space-y-4">
          {faqSections.map((section, sectionIndex) => {
            const SectionIcon = section.icon;
            const isSectionExpanded = expandedSections.has(sectionIndex);

            return (
              <Card 
                key={sectionIndex}
                className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm overflow-hidden"
              >
                <CardHeader 
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection(sectionIndex)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <SectionIcon className="h-6 w-6 text-primary" />
                      <CardTitle className="text-xl">{section.title}</CardTitle>
                    </div>
                    {isSectionExpanded ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>

                {isSectionExpanded && (
                  <CardContent className="pt-0">
                    <div className="space-y-6">
                      {section.items.map((item, itemIndex) => (
                        <div 
                          key={itemIndex} 
                          className={`${itemIndex > 0 ? 'pt-6 border-t border-muted' : ''}`}
                        >
                          <h3 className="font-semibold text-lg mb-3 text-primary">
                            {item.question}
                          </h3>
                          <div className="text-muted-foreground space-y-2">
                            {typeof item.answer === 'string' ? (
                              <p>{item.answer}</p>
                            ) : (
                              item.answer
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        {/* Call to Action */}
        <div className="mt-12 text-center">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="text-2xl sm:text-3xl">
                Ready to Get Started with LegalWhat?
              </CardTitle>
              <CardDescription className="text-base">
                Experience the power of P.A.N.T.H.E.O.N. AI and get instant legal assistance
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg"
                onClick={() => setLocation('/login')}
                className="shadow-lg"
              >
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button 
                size="lg"
                variant="outline"
                onClick={() => setLocation('/landing')}
              >
                Learn More
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Footer Note */}
        <div className="mt-8 text-center text-sm text-white/70">
          <p>
            Still have questions? <Button 
              variant="link" 
              className="text-primary hover:text-primary/80 p-0 h-auto"
              onClick={() => setLocation('/contact')}
            >
              Contact our support team
            </Button>
          </p>
        </div>
      </main>
    </div>
  );
}
