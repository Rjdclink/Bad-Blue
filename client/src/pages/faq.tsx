/**
 * Legal What? FAQ Page
 * 
 * Comprehensive FAQ page for Legal What? platform
 * Current pricing, legal guidance, documents, research, and 40 practice areas
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

// Core AI Systems
const CORE_SYSTEMS = [
  {
    name: "LEXARA",
    acronym: "Legal Expert AI Resource Advisor",
    description: "Two-way voice and text legal guidance, research, and follow-up questions across 40 areas of law",
    icon: Brain,
    iconColor: "text-blue-600"
  },
  {
    name: "Document Preparation",
    acronym: "Legal drafting and local forms",
    description: "Helps identify local forms and prepare, revise, and download legal drafts as PDF or DOCX",
    icon: FileText,
    iconColor: "text-purple-600"
  },
  {
    name: "File & Evidence Analysis",
    acronym: "Documents, images, audio, and video",
    description: "Reviews supported uploads, summarizes relevant information, and connects evidence with your legal questions",
    icon: Camera,
    iconColor: "text-green-600"
  },
  {
    name: "Public-Record Research",
    acronym: "Court records, background research, and maps",
    description: "Researches available public records, incarceration information, and relevant people, businesses, and places",
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
      title: "LegalWhat & Lexara",
      icon: Sparkles,
      items: [
        {
          question: "What is LegalWhat?",
          answer: "LegalWhat combines AI-assisted legal guidance, jurisdiction-aware research, document preparation, file and evidence analysis, public-record research, and matter organization in one online platform. It covers 40 areas of law."
        },
        {
          question: "What is Lexara?",
          answer: "Lexara (Legal Expert AI Resource Advisor) is LegalWhat's conversational legal assistant. Explain your situation by voice or text, answer follow-up questions, and receive plain-English explanations connected to your facts and jurisdiction."
        },
        {
          question: "Can I ask follow-up questions?",
          answer: "Yes. Continue the conversation by voice or text, add facts or supported files, and ask Lexara to explain an answer or revise a draft. Paid access includes persistent matter storage for ongoing work."
        }
      ]
    },
    {
      title: "Documents, Evidence & Public Records",
      icon: Brain,
      items: [
        {
          question: "What documents can LegalWhat help prepare?",
          answer: "LegalWhat can help prepare and revise motions, petitions, complaints, affidavits, declarations, contracts, demand letters, briefs, discovery materials, family-law filings, and FOIA or public-record requests. It can identify appropriate local forms and offer PDF or DOCX downloads through supported document workflows."
        },
        {
          question: "Can LegalWhat help with criminal-record expungement?",
          answer: "LegalWhat can help gather case information, research jurisdiction-specific expungement requirements, identify available forms, and prepare draft materials. Eligibility and filing requirements depend on the jurisdiction and your case history."
        },
        {
          question: "Can LegalWhat research court and public records?",
          answer: "LegalWhat can research available state and federal court records, incarceration information, professional licenses, business registrations, and other public-source information relevant to a matter. Availability depends on the source; some records require separate access or are unavailable online."
        },
        {
          question: "What are Spectra and the Inmate Locator?",
          answer: "Spectra supports location-related research with public-source evidence and map-based displays. The Inmate Locator helps search available county, state, and federal incarceration sources. Results depend on source availability and should be checked against the underlying records."
        }
      ]
    },
    {
      title: "40 Areas of Law",
      icon: Scale,
      items: [
        {
          question: "What areas of law does Legal What? cover?",
          answer: (
            <div>
              <p className="mb-4">
                Legal What? provides AI-powered legal assistance across 40 comprehensive areas of law:
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
          answer: "Law Enforcement Accountability is a featured Legal What? specialty. It includes tools for officer and public-record research, police misconduct complaint workflows, Section 1983 document generation, FOIA requests, and community petitions, integrated with the platform's broader AI-assisted legal tools."
        }
      ]
    },
    {
      title: "Getting Started",
      icon: ArrowRight,
      items: [
        {
          question: "How do I get started with Legal What??",
          answer: (
            <div>
              <ol className="list-decimal list-inside space-y-2">
                <li>Create an account by clicking "Get Started" or "Sign Up"</li>
                <li>Choose from 40 areas of law, or describe your situation in ordinary language</li>
                <li>Tell Lexara your jurisdiction, important facts, and what you need help understanding</li>
                <li>Speak or type follow-up questions, upload supported files, and request research or a document draft</li>
                <li>Use paid access to save matters and organize documents, evidence, deadlines, and calendar events</li>
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
          question: "Do I need legal experience to use Legal What??",
          answer: "No legal experience is required. Legal What? is designed for everyone, from individuals with no legal background to experienced legal professionals. Our AI systems guide you through every step, explain legal concepts in plain language, and provide templates and examples. However, for complex matters, we always recommend consulting with a licensed attorney."
        },
        {
          question: "Can I use Legal What? on mobile devices?",
          answer: "Yes. LegalWhat works in a web browser on smartphones, tablets, and desktop computers. Voice features require a supported browser and microphone access."
        }
      ]
    },
    {
      title: "Pricing & Access",
      icon: DollarSign,
      items: [
        {
          question: "How much does Legal What? cost?",
          answer: "LegalWhat offers a 3-day free trial (72 hours), then full access costs $19.99/month. Paid access includes persistent matter storage, document and evidence organization, deadlines, calendar and schedule tools, and access to higher legal reasoning models for more complex work."
        },
        {
          question: "Is there a free trial?",
          answer: "Yes. Eligible new users can try LegalWhat free for 3 days (72 hours), with no payment card required to start the trial. After the trial, a $19.99/month subscription is required to continue using protected tools. You can also choose to skip the trial and pay now."
        },
        {
          question: "What payment methods do you accept?",
          answer: "Subscription payments are handled through Square checkout. Available payment methods and subscription details are shown before you confirm payment."
        }
      ]
    },
    {
      title: "Privacy & Security",
      icon: Lock,
      items: [
        {
          question: "Is my information secure?",
          answer: "LegalWhat uses HTTPS and account access controls to help protect your information. See the Privacy Policy for details about data handling and the Terms of Service for platform conditions."
        },
        {
          question: "Who can see my legal information?",
          answer: "Your matter workspace requires account access. Information submitted for AI analysis may be processed by supporting AI and service providers. See the Privacy Policy for details about data handling."
        },
        {
          question: "Do you keep logs of my consultations?",
          answer: "Paid access includes persistent matter storage so you can organize case information and continue work. Storage and retention depend on the feature and account state. Consult the Privacy Policy or contact support for details about consultation data."
        },
        {
          question: "Can I delete my data?",
          answer: "For help with account data, documents, deletion, or other privacy requests, contact support through the Contact page. The Privacy Policy explains how to direct data requests; retention requirements may apply."
        }
      ]
    },
    {
      title: "Platform Capabilities",
      icon: Sparkles,
      items: [
        {
          question: "What can Legal What? help me with?",
          answer: "LegalWhat can help explain legal issues in plain English, research statutes and cases, identify local forms, analyze supported uploads, prepare and revise legal drafts, research available public records, and organize matters across 40 areas of law."
        },
        {
          question: "How should I verify AI-generated legal information?",
          answer: "AI can make mistakes or miss relevant facts. Check important answers, citations, deadlines, and document requirements against current primary sources and your court or agency. LegalWhat provides legal information and research assistance; it does not guarantee accuracy or outcomes."
        },
        {
          question: "Does Legal What? work in my state/country?",
          answer: "LegalWhat supports jurisdiction-aware legal research and document workflows across the United States. Provide the state, court, or agency involved so research can focus on the relevant rules. Coverage and source availability vary by jurisdiction."
        },
        {
          question: "Can Legal What? analyze video/photo evidence?",
          answer: "LegalWhat can help analyze supported documents, images, audio, and video, summarize relevant details, and connect them to legal questions and research. Available analysis depends on the file format and tools."
        }
      ]
    },
    {
      title: "Legal Disclaimers",
      icon: AlertTriangle,
      items: [
        {
          question: "Is Legal What? a law firm?",
          answer: (
            <div>
              <p className="font-semibold text-red-600 dark:text-red-400 mb-2">
                NO. Legal What? is NOT a law firm.
              </p>
              <p>
                Legal What? is a legal technology platform that provides AI-powered legal information, document 
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
                NO. Legal What? does NOT provide legal advice.
              </p>
              <p>
                The information provided by Legal What?'s AI systems is for educational and informational purposes only. 
                It is not legal advice and should not be relied upon as such. Every legal situation is unique, and 
                laws vary by jurisdiction. You should consult with a licensed attorney in your area for advice about 
                your specific situation. Using Legal What? does not create an attorney-client relationship.
              </p>
            </div>
          )
        },
        {
          question: "Should I hire a lawyer?",
          answer: "For complex legal matters, serious charges, or cases involving significant money or rights, we strongly recommend consulting with a licensed attorney. Legal What? can help you understand your situation, prepare initial documents, and conduct research, but it cannot replace the personalized advice and representation of a qualified attorney who can review all the details of your specific case."
        },
        {
          question: "What if I use Legal What? and something goes wrong?",
          answer: "Legal What? provides tools and information to assist you, but you are responsible for your own legal decisions and actions. We make no warranties about the accuracy, completeness, or reliability of the information provided. We are not liable for any outcomes resulting from your use of our platform. Always verify critical information with a licensed attorney and understand the risks before taking legal action."
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
        title="Legal What? FAQ | AI Legal Tools & Search Services"
        description="Answers about LegalWhat: a 3-day free trial, $19.99/month subscription, voice and text legal guidance across 40 areas, documents, public records, and matter storage."
      />

      {/* Header */}
      <AppHeader 
        title="Legal What? FAQ" 
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
            Answers about LegalWhat's current pricing, legal guidance, documents, research, and account features
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
                Ready to Get Started with Legal What??
              </CardTitle>
              <CardDescription className="text-base">
                Try LegalWhat free for 3 days, then continue with full access for $19.99/month
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg"
                onClick={() => setLocation('/login')}
                className="shadow-lg"
              >
                Start Your 3-Day Free Trial
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
