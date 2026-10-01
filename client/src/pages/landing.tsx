import { useState, useEffect, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import { LanguageSelectorLight } from "@/components/LanguageSelectorLight";
// Use Constitution.webp from public/images as background
const heroImage = "/images/Constitution.webp";
import { SEOHead } from "@/components/SEOHead";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";
import { useLocation } from "wouter";
import { FULL_ACCESS_PRICING, LAWSUIT_DIY_PRICING, LAWSUIT_FULL_SERVICE_PRICING, COMPLAINT_PRICING, PETITION_PRICING, FOIA_REQUEST_PRICING } from "@shared/schema";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { LAW_TYPE_DATA } from "@shared/lawTypes";
import { HiddenFAQ } from "@/components/HiddenFAQ";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Landing() {
  const [, setLocation] = useLocation();
  const [iconError, setIconError] = useState(false);
  const [lexaraImageError, setLexaraImageError] = useState(false);
  const { toast } = useToast();
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactSent, setContactSent] = useState(false);

  const submitQuestionComment = async (event: FormEvent) => {
    event.preventDefault();
    if (contactName.trim().length < 2 || !contactEmail.includes("@") || contactMessage.trim().length < 10) {
      toast({ title: "Please complete the form", description: "Enter your name, email, and question or comment.", variant: "destructive" });
      return;
    }
    setContactBusy(true);
    try {
      await apiRequest("/api/contact", "POST", { type: "contact", name: contactName.trim(), email: contactEmail.trim(), subject: "LegalWhat landing page question/comment", message: contactMessage.trim() });
      setContactSent(true);
      toast({ title: "Message sent", description: "Your question or comment was sent to Legal What?." });
    } catch (error: any) {
      toast({ title: "Could not send message", description: error?.message || "Please try again.", variant: "destructive" });
    } finally { setContactBusy(false); }
  };
  
  // Enhanced image error handler with logging
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>, imageName: string) => {
    console.error(`Image failed to load: ${imageName}`, e.currentTarget.src);
    console.error('Attempted path:', e.currentTarget.src);
    console.error('Current origin:', window.location.origin);
    e.currentTarget.style.display = 'none';
  };
  
  const baseUrl = import.meta.env.VITE_BASE_URL || "https://legalwhat.com";
  
  // Use PAGE_FAQ_CONFIG from seoConfig.ts for consistent, page-specific FAQs
  // Removed duplicate useFaqSchema() call that was creating two FAQ schemas
  usePageFaqSchema();
  
  // NOTE: WebSite schema is already defined in index.html - removed duplicate useWebsiteSchema call

  // Debug: Check if images exist (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      const imagesToCheck = [
        '/images/Legal%20What%20Icon.png',
        '/images/Constitution.webp',
        '/images/Tweed_Court.jpg',
        '/images/oip.webp'
      ];
      
      imagesToCheck.forEach(src => {
        const img = new Image();
        img.onload = () => console.log(`✅ Image loaded: ${src}`);
        img.onerror = () => console.error(`❌ Image failed: ${src}`);
        img.src = src;
      });
    }
  }, []);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Legal What?",
    "alternateName": ["LegalWhat", "Legal What"],
    "description": "Lexara is a jurisdiction-aware conversational legal AI with extensive knowledge across 40+ areas of law. Talk live by voice or text, analyze and revise uploaded documents and media, identify jurisdiction-specific requirements, find and use appropriate local legal forms, and create legal documents. Try LegalWhat free for 3 days, then only $19.99/month.",
    "url": baseUrl,
    "applicationCategory": "LegalApplication",
    "operatingSystem": "Web Browser",
    "offers": { "@type": "Offer", "price": "19.99", "priceCurrency": "USD", "category": "monthly subscription", "description": "3-day free trial, then $19.99/month" },
    "featureList": [
      "40 legal practice areas",
      "Two-way voice and text AI legal consultation",
      "Legal document generation and drafting",
      "Jurisdiction-aware legal guidance and research",
      "Uploaded document, image, and media analysis",
      "Media critique, editing, and alteration",
      "Intuitive jurisdiction-specific legal document generation",
      "Downloadable PDF and DOCX legal documents",
      "3-day free trial, then $19.99/month for full access"
    ]
  };

  return (
    <div className="min-h-screen">
      <SEOHead
        title="Legal What? | Lexara Conversational Legal AI"
        description="Lexara is a jurisdiction-aware conversational legal AI with extensive knowledge across 40+ areas of law. Talk live by voice or text, analyze and revise uploaded documents and media, identify jurisdiction-specific requirements, find and use appropriate local legal forms, and create legal documents. Try LegalWhat free for 3 days, then only $19.99/month."
        ogTitle="Legal What? | Lexara Conversational Legal AI"
        ogDescription="Lexara is a jurisdiction-aware conversational legal AI with extensive knowledge across 40+ areas of law. Talk live by voice or text, analyze and revise uploaded documents and media, identify jurisdiction-specific requirements, find and use appropriate local legal forms, and create legal documents. Try LegalWhat free for 3 days, then only $19.99/month."
        canonicalUrl="https://legalwhat.com/"
        ogImage="https://legalwhat.com/images/Legal%20What%20Icon.png"
        ogImageAlt="Legal What? legal technology platform logo"
        structuredData={structuredData}
      />
      {/* LEXARA - primary landing-page presentation */}
      <section className="relative py-20 px-4 overflow-hidden" aria-labelledby="lexara-overview">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/images/Tweed_Court.jpg), linear-gradient(135deg, #1a1a2e 0%, #2a2a3e 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center center'
          }}
        >
          <div className="absolute inset-0 bg-black/65" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto text-white">
          <div className="flex justify-center mb-5">
            <div className="max-w-2xl rounded-2xl border border-white/25 bg-black/45 px-5 py-3 text-center shadow-lg backdrop-blur-md">
              <p className="text-base font-semibold md:text-lg">
                Try LegalWhat free for 3 days — no payment card required.
              </p>
              <p className="mt-1 text-sm text-white/85 md:text-base">
                After your free trial, continue with full access for just $19.99/month.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/75 md:text-sm">
                Paid access includes persistent legal matter storage for your cases, filing packets, documents, evidence, deadlines, and progress; calendar and schedule organization for hearings, appointments, filing dates, due dates, and other important matter events; and access to higher legal reasoning models for more complex legal work.
              </p>
            </div>
          </div>

          <div className="flex justify-center mb-6">
            <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-6 md:p-8 border border-white/20 max-w-md w-full shadow-[0_0_40px_rgba(96,165,250,0.3),0_20px_60px_rgba(0,0,0,0.5)]">
              {!lexaraImageError ? (
                <img
                  src="/images/oip.webp"
                  alt="LEXARA - Legal Expert AI Resource Advisor"
                  className="w-full h-auto rounded-2xl object-cover shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
                  onError={() => setLexaraImageError(true)}
                />
              ) : (
                <div className="w-full h-64 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center">
                  <div className="text-center"><div className="text-6xl mb-2">⚖️</div><div className="text-sm font-semibold">LEXARA</div></div>
                </div>
              )}
              <p className="mt-5 text-center text-sm">LEXARA — Legal Expert AI Resource Advisor</p>
              <p className="mt-1 text-center text-xs text-white/80">Legal X — Computational Autonomous Reasoning Architecture</p>
            </div>
          </div>

          <div className="flex justify-center mb-12">
            <Button
              size="lg"
              className="text-lg px-10 shadow-lg"
              onClick={() => setLocation('/login')}
              data-testid="button-get-started-lexara"
            >
              Get Started
            </Button>
          </div>

          <div className="rounded-3xl border border-white/20 bg-black/30 backdrop-blur-sm p-6 md:p-10">
            <h2 id="lexara-overview" className="text-3xl md:text-4xl font-bold text-center mb-6">
              AI Legal Consultation, Document Creation &amp; Media Analysis
            </h2>
            <div className="space-y-5 text-white/90 leading-relaxed">
              <p>
                Lexara is a jurisdiction-aware conversational legal AI with extensive knowledge across 40+ areas of law. Talk live by voice or text, analyze and revise uploaded documents and media, identify jurisdiction-specific requirements, find and use appropriate local legal forms, and create legal documents.
              </p>
              <p>
                LEXARA provides legal guidance, research, analysis, and explanations based on the facts you provide. She can ask relevant follow-up questions, identify legal issues, apply jurisdiction-specific statutes, rules, and precedent, and connect your matter with deeper legal research and case-analysis tools.
              </p>
              <p>
                LEXARA can also analyze uploaded <strong>documents, images, evidence, and other media</strong>, assist with revisions, and recognize when a situation calls for a legal document. Her document tools can identify the appropriate jurisdiction and help prepare pleadings, motions, petitions, affidavits, contracts, public-record requests, and other legal materials with downloadable <strong>PDF or DOCX</strong> output.
              </p>

              <p>
                The system combines <strong>parallel reasoning, cross-validation, jurisdictional filtering, structured legal research, document drafting, alternative procedural analysis, and verifiable reasoning</strong> to provide organized and reviewable legal analysis.
              </p>

              <div className="pt-4">
                <h3 className="text-2xl font-bold text-white mb-5">LEXARA’s Integrated Capabilities</h3>
                <div className="space-y-5">
                  <p><strong>1. Parallel Reasoning Engine</strong> — Multiple specialized AIs analyze the same issue simultaneously, providing multi-angle analysis and corroboration.</p>
                  <p><strong>2. Cross-Validation Check</strong> — Legal conclusions can be independently examined across multiple models to identify inconsistencies and reduce overlooked issues.</p>
                  <p><strong>3. Document Atelier</strong> — Assists with structured drafting of pleadings, motions, contracts, affidavits, petitions, public-record requests, and other legal documents.</p>
                  <p><strong>4. Strategic Playbooks</strong> — Organizes procedural options and potential legal pathways into understandable, step-by-step guidance without predicting outcomes.</p>
                  <p><strong>5. Verifiable Reasoning Log</strong> — Provides structured explanations supporting conclusions for easier review and quality control.</p>
                  <p><strong>6. Orchestrated Expert Modules</strong> — Specialized AI engines operate through a coordinated architecture to combine different areas of expertise into unified analysis.</p>
                  <p><strong>7. Scoped Jurisdictional Filters</strong> — Narrows research and analysis to applicable jurisdictions, statutes, rules, and precedent.</p>
                  <p><strong>8. Parallel Case Simulation Sandbox</strong> — Examines alternative filings, procedural choices, and argument paths side by side to help identify available approaches.</p>
                  <p><strong>9. Legally Compliant Drafting</strong> — Applies relevant jurisdictional, statutory, and formatting requirements when preparing legal documents.</p>
                  <p><strong>10. Secure Collaboration &amp; Version Vault</strong> — Supports organized document versions, review history, annotations, and reasoning records for a clear audit trail.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hero Section */}
      <section className="relative min-h-[100vh] flex items-center justify-center py-12 overflow-hidden">
        {/* Background Image with Optimized Display */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ 
            backgroundImage: `url(${heroImage}), linear-gradient(to bottom, #1a1a2e, #16213e)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center'
          }}
        >
          {/* Dark overlay for text readability over constitutional background */}
          <div className="absolute inset-0 bg-black/40" />
        </div>

        {/* Language Selector - Fixed top right */}
        <div className="absolute top-6 right-6 z-20">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-1 border border-white/20">
            <LanguageSelectorLight />
          </div>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          {/* LegalWhat Icon - Medium-sized Prominent Display */}
          <div className="mb-8 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
            <div className="relative">
              {/* Glow effect behind icon */}
              <div className="absolute inset-0 bg-primary/30 blur-2xl rounded-full scale-125" />
              {/* Icon container with enhanced styling */}
              <div className="relative bg-white/10 backdrop-blur-md p-4 rounded-xl border-2 border-white/30 shadow-2xl hover:scale-105 transition-transform duration-300">
                {!iconError ? (
                  <img 
                    src="/images/Legal%20What%20Icon.png" 
                    alt="Legal What? - AI Legal Platform" 
                    className="w-28 h-28 md:w-32 md:h-32 object-contain filter drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                    onError={(e) => {
                      handleImageError(e, 'Legal What? Icon');
                      setIconError(true);
                    }}
                  />
                ) : (
                  <div className="w-28 h-28 md:w-32 md:h-32 flex items-center justify-center text-white text-4xl font-bold">
                    LW
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <h1 className="text-white text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 drop-shadow-2xl">
            Legal What? — AI Legal Tools for 40 Practice Areas
          </h1>

        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex items-start justify-center p-2">
            <div className="w-1.5 h-3 bg-white/70 rounded-full" />
          </div>
        </div>
      </section>

      {/* Search-visible coverage of all supported legal practice areas */}
      <section className="py-16 px-4 bg-card/40" aria-labelledby="legal-practice-areas">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <h2 id="legal-practice-areas" className="text-3xl md:text-4xl font-bold mb-4">
              40 Legal Practice Areas
            </h2>
            <p className="text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Legal What? supports AI-assisted legal information, research, issue spotting, and document workflows across the following 40 practice areas.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 max-w-6xl mx-auto">
            {LAW_TYPE_DATA.map((area) => (
              <span key={area.id} className="rounded-full border bg-background px-3 py-1.5 text-sm font-medium shadow-sm">
                {area.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Transparency - Simplified */}
      <section className="py-20 px-4 bg-card">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-6">Our Commitment</h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              Legal What? provides AI-powered legal tools and consultation across 40 practice areas. Our platform combines cutting-edge AI with professional legal frameworks to make legal services accessible and affordable.
            </p>
            <p>
              If you believe any information needs updating, please{" "}
              <a href="/contact" className="text-primary hover:underline">
                contact us
              </a>.
            </p>
            <p className="text-xs pt-4 text-muted-foreground/80">
              Use information responsibly and in accordance with applicable laws.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t bg-card/30 px-4 py-14" aria-labelledby="questions-comments">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 text-center">
            <h2 id="questions-comments" className="text-2xl font-bold">Questions or Comments?</h2>
            <p className="mt-2 text-sm text-muted-foreground">Send Legal What? a message directly at contact.badblue@gmail.com.</p>
          </div>
          {contactSent ? (
            <Card><CardContent className="py-8 text-center"><p className="font-medium">Thank you. Your message has been sent.</p></CardContent></Card>
          ) : (
            <Card><CardContent className="pt-6">
              <form onSubmit={submitQuestionComment} className="space-y-4">
                <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Your name" maxLength={100} />
                <Input value={contactEmail} onChange={e => setContactEmail(e.target.value)} type="email" placeholder="Your email" />
                <Textarea value={contactMessage} onChange={e => setContactMessage(e.target.value)} placeholder="Your question or comment" rows={5} maxLength={3000} />
                <Button type="submit" className="w-full" disabled={contactBusy}>{contactBusy ? "Sending…" : "Send Question / Comment"}</Button>
              </form>
            </CardContent></Card>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <img src="/images/Legal%20What%20Icon.png" alt="" aria-hidden="true" className="w-7 h-7 object-contain" />
                Legal What?
              </h3>
              <p className="text-sm text-muted-foreground">
                AI-powered legal platform serving 40 practice areas.
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/login" className="hover:text-foreground">How It Works</a></li>
                <li><a href="/reviews" className="hover:text-foreground">Reviews</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/privacy" className="hover:text-foreground">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-foreground">Terms of Service</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/contact" className="hover:text-foreground">Contact Us</a></li>
                <li><a href="mailto:contact.badblue@gmail.com" className="hover:text-foreground">contact.badblue@gmail.com</a></li>
              </ul>
            </div>
          </div>

          {/* Legal Disclaimer */}
          <div className="pt-8 border-t">
            <div className="bg-muted/30 rounded-lg p-6 mb-6">
              <h4 className="font-semibold mb-3 text-sm">LIMITATION OF LIABILITY AND USER RESPONSIBILITY</h4>
              <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                <p>
                  <strong className="text-foreground">No Liability for User Conduct:</strong> Legal What?, its developers, owners, affiliates, and service providers are NOT liable for any fraudulent, false, misleading, or unlawful use of this platform by users. Users are solely responsible for the accuracy, truthfulness, and legality of all information they submit, including complaints, lawsuits, officer information, and evidence.
                </p>
                <p>
                  <strong className="text-foreground">User-Generated Content:</strong> Pursuant to 47 U.S.C. § 230(c)(1) (Section 230 of the Communications Decency Act), Legal What? is not liable for information provided by users. We do not endorse, verify, or assume responsibility for user-submitted content. Users who submit false or fraudulent information may be subject to criminal prosecution under federal law, including but not limited to:
                </p>
                <ul className="ml-4 space-y-1">
                  <li>• <strong>18 U.S.C. § 1001</strong> – False Statements to Government Agencies (up to 5 years imprisonment)</li>
                  <li>• <strong>18 U.S.C. § 1621</strong> – Perjury (up to 5 years imprisonment)</li>
                  <li>• <strong>18 U.S.C. § 1623</strong> – False Declarations Before Court or Grand Jury</li>
                  <li>• State-specific laws regarding filing false police reports and perjury</li>
                </ul>
                <p>
                  <strong className="text-foreground">Document Drafting Service Only:</strong> Legal What? provides document drafting and template generation services. We are NOT a law firm and do NOT provide legal advice, legal representation, or create an attorney-client relationship. All users should consult with licensed attorneys before filing complaints or lawsuits.
                </p>
                <p>
                  <strong className="text-foreground">No Guarantee of Outcomes:</strong> Legal What? makes no representations or warranties regarding the outcome of any complaint or lawsuit filed using our services. Legal proceedings are complex and outcomes depend on many factors beyond our control.
                </p>
                <p>
                  <strong className="text-foreground">Accuracy of Public Records:</strong> While we strive for accuracy, Legal What? cannot guarantee the completeness or accuracy of officer information obtained from public records databases. Users should independently verify all information before relying on it.
                </p>
                <p className="pt-2 border-t">
                  <strong className="text-foreground">BY USING THIS SERVICE, YOU ACKNOWLEDGE AND AGREE THAT:</strong> (1) You are solely responsible for the accuracy and legality of all information you submit; (2) Submitting false information may subject you to criminal prosecution; (3) Legal What? and its affiliates are not liable for your use or misuse of this platform; (4) You will indemnify and hold harmless Legal What? from any claims arising from your use of this service.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t text-center text-sm text-muted-foreground">
            <p className="flex items-center justify-center gap-1 flex-wrap">
              &copy; 2026 Legal What?
              <img 
                src="/images/Legal%20What%20Icon.png" 
                alt="Legal What?" 
                className="inline-block h-[1em] w-auto object-contain"
                onError={(e) => e.currentTarget.style.display = 'none'}
              />
              <span>All rights reserved.</span>
            </p>
          </div>
        </div>
      </footer>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/landing" />

      <SupportEmailFooter />
    </div>
  );
}
