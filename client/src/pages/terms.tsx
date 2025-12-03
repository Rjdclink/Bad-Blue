import { Shield } from "lucide-react";
import { Link } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function Terms() {
  usePageFaqSchema("/terms");
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — Terms of Service | Legal Usage Agreement"
        description="BadBlue terms of service for police misconduct complaint filing, §1983 civil rights lawsuits, FOIA requests, and officer resignation petitions. Understand your rights and responsibilities."
        canonicalUrl="https://bad-blue.com/terms"
        breadcrumbs={[
          { name: "Terms of Service", url: "https://bad-blue.com/terms" }
        ]}
      />
      
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer hover-elevate px-2 py-1 rounded-md">
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground">Contact</Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">Privacy</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <PageBreadcrumbs currentPageName="Terms of Service" />
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Last Updated: November 30, 2025</p>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using BadBlue ("the Platform"), you agree to be bound by these Terms of Service. 
              BadBlue provides police accountability tools including police misconduct complaint filing, 
              42 U.S.C. §1983 civil rights lawsuit generation, FOIA request drafting, and petition creation 
              for demanding officer resignation. If you do not agree to these terms, do not use our services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Service Description</h2>
            <p className="text-muted-foreground leading-relaxed">
              BadBlue is an affordable, fully remote alternative to traditional civil rights attorney consultations. 
              Our platform offers:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
              <li><strong>Officer Search:</strong> Free badge lookup and officer background search using public records</li>
              <li><strong>Police Misconduct Complaints:</strong> AI-assisted complaint drafting with automatic routing to oversight agencies</li>
              <li><strong>§1983 Civil Rights Lawsuits:</strong> U.S. District Court-compliant lawsuit document generation</li>
              <li><strong>FOIA Requests:</strong> State-specific Freedom of Information Act request drafting and routing</li>
              <li><strong>Officer Resignation Petitions:</strong> Community petition creation with delivery to city councils</li>
              <li><strong>LegalAI Consultation:</strong> AI-powered analysis of your police misconduct case</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. Not Legal Advice</h2>
            <p className="text-muted-foreground leading-relaxed font-medium">
              IMPORTANT: BadBlue does not provide legal advice. We are a legal document preparation and 
              information platform, not a law firm. Our AI-powered tools assist with document creation 
              but do not constitute attorney-client relationships.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-2">
              For complex civil rights cases, we recommend consulting with a licensed attorney. BadBlue 
              is designed to make basic legal processes accessible and affordable for everyone, but 
              serious litigation may require professional legal representation.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. User Responsibilities</h2>
            <p className="text-muted-foreground leading-relaxed">
              By using BadBlue, you agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
              <li>Provide accurate and truthful information in all complaints and legal documents</li>
              <li>Not use the platform to file false or malicious complaints</li>
              <li>Not use officer search data for harassment or stalking</li>
              <li>Respect rate limits and not attempt to circumvent security measures</li>
              <li>Not share your account credentials with others</li>
              <li>Maintain the confidentiality of any evidence you upload</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Payment & Refunds</h2>
            <p className="text-muted-foreground leading-relaxed">
              Certain services require payment. All payments are processed securely through Square. 
              Refund policies:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
              <li>Full refund within 24 hours of purchase if no documents have been generated</li>
              <li>Partial refunds may be considered on a case-by-case basis</li>
              <li>No refunds for successfully delivered documents or submitted complaints</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              BadBlue is provided "as is" without warranties of any kind. We are not liable for:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
              <li>Outcomes of complaints, lawsuits, or petitions filed using our platform</li>
              <li>Accuracy of officer search results or public records data</li>
              <li>Responses or actions taken by law enforcement agencies or courts</li>
              <li>Technical issues, service interruptions, or data loss</li>
              <li>Any indirect, incidental, or consequential damages</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">
              Documents generated using BadBlue are yours to use. However, the platform, AI models, 
              templates, and underlying technology remain the property of BadBlue. You may not reverse 
              engineer, copy, or redistribute our platform or services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to suspend or terminate accounts that violate these terms, engage in 
              fraudulent activity, or abuse our platform. You may delete your account at any time by 
              contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These terms are governed by the laws of the United States. Any disputes shall be resolved 
              through binding arbitration, except for claims that may be brought in small claims court.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">10. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update these terms periodically. Continued use of BadBlue after changes constitutes 
              acceptance of the new terms. We will notify users of significant changes via email.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">11. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For questions about these terms or our services:
            </p>
            <p className="text-foreground font-medium mt-2">
              Email: contact.badblue@gmail.com
            </p>
            <p className="text-muted-foreground mt-4">
              BadBlue — Police accountability made affordable and accessible. File complaints, generate 
              lawsuits, and demand accountability without leaving your home.
            </p>
          </section>
        </div>
      </main>

      <SupportEmailFooter />
      
      {/* Footer Navigation */}
      <footer className="border-t bg-card py-8">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">Home</Link>
            <Link href="/contact" className="hover:text-foreground">Contact</Link>
            <Link href="/terms" className="hover:text-foreground font-medium text-foreground">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            BadBlue — Affordable police accountability tools, fully online.
          </p>
        </div>
      </footer>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/terms" />
    </div>
  );
}
