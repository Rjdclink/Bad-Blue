import { Shield } from "lucide-react";
import { Link } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function Privacy() {
  usePageFaqSchema("/privacy");
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — Privacy Policy | Data Protection & User Rights"
        description="BadBlue privacy policy: how we protect your data during police misconduct complaints, §1983 civil rights lawsuits, FOIA requests, and officer resignation petitions. Your privacy matters."
        canonicalUrl="https://bad-blue.com/privacy"
        breadcrumbs={[
          { name: "Privacy Policy", url: "https://bad-blue.com/privacy" }
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
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <PageBreadcrumbs currentPageName="Privacy Policy" />
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last Updated: November 30, 2025</p>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              BadBlue ("we," "our," or "us") is a police accountability platform that provides tools for filing 
              police misconduct complaints, generating 42 U.S.C. §1983 civil rights lawsuits, submitting FOIA requests, 
              and creating petitions demanding officer resignation. We are committed to protecting your privacy and 
              personal information while you use our affordable, fully remote legal empowerment services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-medium mb-2">Account Information</h3>
                <p className="text-muted-foreground leading-relaxed">
                  When you register, we collect your email address and username. We use secure password hashing 
                  and never store plaintext passwords.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-medium mb-2">Complaint & Legal Document Data</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Information you provide when filing police misconduct complaints, creating §1983 civil rights 
                  lawsuits, or submitting FOIA requests. This includes incident details, officer information, 
                  and evidence uploads. This data is encrypted and stored securely.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-medium mb-2">Officer Search Queries</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Search terms used in our free officer lookup tool. We use this to improve search accuracy 
                  and help identify patterns of police misconduct.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-medium mb-2">Device & Usage Information</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Device fingerprints for rate limiting purposes only. We do not track your browsing 
                  behavior across other websites.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>Process and route your police misconduct complaints to appropriate oversight agencies</li>
              <li>Generate §1983 civil rights lawsuit documents compliant with U.S. District Court rules</li>
              <li>Submit FOIA requests to law enforcement agencies on your behalf</li>
              <li>Deliver petitions demanding officer resignation to city councils and oversight boards</li>
              <li>Send confirmation emails and status updates about your submissions</li>
              <li>Improve our AI-powered legal consultation and officer search tools</li>
              <li>Prevent abuse and ensure platform security</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">4. Data Protection & Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement industry-standard security measures including encrypted database storage, 
              secure session management, and HTTPS encryption. Evidence files are stored in secure, 
              access-controlled storage. We use AI services from trusted providers (Mistral, Groq, Google, Anthropic) 
              with strict data handling agreements.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">5. Data Retention & Deletion</h2>
            <p className="text-muted-foreground leading-relaxed">
              <strong>Automatic Data Cleanup:</strong> For your privacy, we automatically delete user data 
              14 days after payment completion. Error logs are deleted after 30 days. Your username, email, 
              and any evidence files you explicitly request to preserve are retained. You can request immediate 
              deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use the following third-party services:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
              <li><strong>Stripe:</strong> Payment processing (PCI-DSS compliant)</li>
              <li><strong>Resend:</strong> Transactional email delivery</li>
              <li><strong>AI Providers:</strong> Mistral, Groq, Google Gemini, and Anthropic Claude for legal analysis</li>
              <li><strong>Supabase:</strong> Secure database hosting</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              You have the right to:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-2">
              <li>Access your personal data</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your complaint and legal document history</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">8. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              For privacy-related inquiries, data requests, or concerns about how we handle your information:
            </p>
            <p className="text-foreground font-medium mt-2">
              Email: contact.badblue@gmail.com
            </p>
            <p className="text-muted-foreground mt-4">
              BadBlue is an affordable alternative to hiring a civil rights attorney. Our fully remote platform 
              means you never need to leave home to pursue police accountability.
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
            <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-foreground font-medium text-foreground">Privacy Policy</Link>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            BadBlue — Affordable police accountability tools, fully online.
          </p>
        </div>
      </footer>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/privacy" />
    </div>
  );
}
