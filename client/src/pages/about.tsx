import { Link } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="About LegalWhat | Founder & Mission"
        description="Learn about Robert Clinkenbeard, founder, sole proprietor, and developer of LegalWhat, and the mission to make sophisticated legal technology more accessible and affordable."
        canonicalUrl="https://legalwhat.com/about"
        breadcrumbs={[{ name: "About", url: "https://legalwhat.com/about" }]}
      />

      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer hover-elevate px-2 py-1 rounded-md">
            <img src="/images/Legal%20What%20Icon.png" alt="" aria-hidden="true" className="w-8 h-8 object-contain" />
            <span className="font-semibold text-lg">Legal What?</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">Home</Link>
            <Link href="/contact" className="hover:text-foreground">Contact</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <PageBreadcrumbs currentPageName="About" />

        <section className="mt-8" aria-labelledby="about-legalwhat">
          <h1 id="about-legalwhat" className="text-4xl font-bold mb-6">About LegalWhat</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            LegalWhat was created to make sophisticated legal technology and legal resources more accessible and affordable for everyday people.
          </p>
        </section>

        <section className="mt-12 rounded-2xl border bg-card p-6 md:p-8" aria-labelledby="what-legalwhat-offers">
          <h2 id="what-legalwhat-offers" className="text-3xl font-bold mb-6">What LegalWhat Offers</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              LegalWhat combines live two-way voice or text legal conversation with jurisdiction-aware legal research across 40 practice areas. Lexara can recognize when a legal document is needed, identify applicable local requirements and forms, analyze documents, evidence, images, and other media, and prepare downloadable PDF or DOCX legal documents.
            </p>
            <p>
              Paid users also receive persistent case and matter organization, storage for documents and evidence, and calendar and schedule organization for hearings, appointments, filing dates, due dates, and other important matter events. LegalWhat organizes dates that are provided or otherwise established in the matter; it does not invent or automatically calculate legal deadlines.
            </p>
            <p>
              LegalWhat also includes electronic-signature capability where legally permitted, with jurisdiction and document-type safeguards, plus access to higher legal-reasoning models for more complex legal work.
            </p>
          </div>
        </section>

        <section className="mt-12 rounded-2xl border bg-card p-6 md:p-8" aria-labelledby="fully-remote">
          <h2 id="fully-remote" className="text-3xl font-bold mb-4">Fully Remote — Never Leave Home</h2>
          <p className="text-muted-foreground leading-relaxed">
            Complete every step online. File complaints, generate lawsuits, submit FOIA requests, and track your cases without visiting an office or courthouse. Justice from your living room.
          </p>
        </section>

        <section className="mt-12 rounded-2xl border bg-card p-6 md:p-8" aria-labelledby="about-the-founder">
          <h2 id="about-the-founder" className="text-3xl font-bold mb-6">About the Founder</h2>
          <div className="space-y-5 text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">Robert Clinkenbeard</strong>, founder and developer of LegalWhat, created the platform with a straightforward purpose: to make meaningful legal guidance and legal resources accessible to everyday people who may not have the ability or desire to spend thousands of dollars on traditional legal services.
            </p>
            <p>
              He developed LegalWhat as a technology-driven alternative that helps users better understand their legal situations, research their rights and options, analyze documents and evidence, and prepare legal documents at a fraction of the cost traditionally associated with obtaining legal assistance.
            </p>
            <p className="font-medium text-foreground">
              His goal is simple: make sophisticated legal technology accessible, affordable, and understandable to ordinary people.
            </p>
          </div>
        </section>
      </main>

      <SupportEmailFooter />
    </div>
  );
}
