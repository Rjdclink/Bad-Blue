import { useEffect } from "react";

interface FAQItem {
  question: string;
  answer: string;
}

/**
 * useFaqSchema - Injects FAQPage JSON-LD structured data into the document head
 * 
 * This hook creates or updates a <script type="application/ld+json"> tag with Schema.org
 * FAQPage structured data. It does NOT render any visible UI - only invisible SEO markup.
 * 
 * @param id - Unique identifier for the script tag (e.g., "faq-officer-search")
 * @param faqs - Array of question/answer pairs to include in the FAQ schema
 * 
 * @example
 * useFaqSchema("faq-officer-search", [
 *   { question: "What is Officer Search?", answer: "A tool to search police officer records..." }
 * ]);
 */
export function useFaqSchema(id: string, faqs: FAQItem[]): void {
  useEffect(() => {
    if (!faqs || faqs.length === 0) return;

    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map((faq) => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer
        }
      }))
    };

    const scriptId = `faq-schema-${id}`;
    let script = document.querySelector(`script#${scriptId}`) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement("script");
      script.setAttribute("type", "application/ld+json");
      script.setAttribute("id", scriptId);
      document.head.appendChild(script);
    }

    script.textContent = JSON.stringify(faqSchema);

    return () => {
      const existingScript = document.querySelector(`script#${scriptId}`);
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, [id, faqs]);
}

/**
 * useWebsiteSchema - Injects WebSite JSON-LD with SearchAction into the document head
 * 
 * @param siteUrl - The canonical URL of the website
 * @param siteName - The name of the website
 * @param searchUrl - The URL template for search (use {search_term_string} as placeholder)
 */
export function useWebsiteSchema(siteUrl: string, siteName: string, searchUrl?: string): void {
  useEffect(() => {
    const websiteSchema: Record<string, any> = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": siteName,
      "url": siteUrl,
      "description": "BadBlue is a police accountability platform helping citizens search police officer public records, file complaints, submit FOIA requests, and prepare Section 1983 civil rights lawsuits."
    };

    if (searchUrl) {
      websiteSchema.potentialAction = {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": searchUrl
        },
        "query-input": "required name=search_term_string"
      };
    }

    const scriptId = "website-search-schema";
    let script = document.querySelector(`script#${scriptId}`) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement("script");
      script.setAttribute("type", "application/ld+json");
      script.setAttribute("id", scriptId);
      document.head.appendChild(script);
    }

    script.textContent = JSON.stringify(websiteSchema);
  }, [siteUrl, siteName, searchUrl]);
}

export default useFaqSchema;
