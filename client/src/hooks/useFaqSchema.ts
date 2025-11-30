import { useEffect } from "react";
import { useLocation } from "wouter";
import { PAGE_FAQ_CONFIG, BASE_URL, type FaqItem } from "@shared/seoConfig";

interface FAQItem {
  question: string;
  answer: string;
}

/**
 * usePageFaqSchema - Injects page-specific FAQPage JSON-LD from PAGE_FAQ_CONFIG
 * 
 * This hook automatically loads FAQ structured data for the current page based on
 * the route path. FAQs are defined in shared/seoConfig.ts PAGE_FAQ_CONFIG.
 * 
 * The schema is hidden from users but crawlable by search engines.
 * Google uses this for rich FAQ snippets in search results.
 * 
 * @param customPath - Optional custom path override (defaults to current route)
 * 
 * @example
 * // In /officer page component:
 * usePageFaqSchema(); // Automatically loads /officer FAQs
 */
export function usePageFaqSchema(customPath?: string): void {
  const [location] = useLocation();
  const path = customPath || location;

  useEffect(() => {
    const faqConfig = PAGE_FAQ_CONFIG[path];
    
    if (!faqConfig) {
      return;
    }

    const schemaId = `faq-schema-page${path.replace(/\//g, "-")}`;
    
    const existingScript = document.getElementById(schemaId);
    if (existingScript) {
      existingScript.remove();
    }

    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "name": faqConfig.name,
      "description": faqConfig.description,
      "url": `${BASE_URL}${path}`,
      "mainEntity": faqConfig.faqs.map((faq) => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer
        }
      }))
    };

    const script = document.createElement("script");
    script.setAttribute("type", "application/ld+json");
    script.setAttribute("id", schemaId);
    script.textContent = JSON.stringify(faqSchema);
    document.head.appendChild(script);

    return () => {
      const scriptToRemove = document.getElementById(schemaId);
      if (scriptToRemove) {
        scriptToRemove.remove();
      }
    };
  }, [path]);
}

/**
 * useFaqSchema - Injects custom FAQPage JSON-LD structured data into the document head
 * 
 * This hook creates or updates a <script type="application/ld+json"> tag with Schema.org
 * FAQPage structured data. It does NOT render any visible UI - only invisible SEO markup.
 * 
 * @param id - Unique identifier for the script tag (e.g., "faq-officer-search")
 * @param name - The name of the FAQ page (required by Google)
 * @param description - Description of the FAQ (required by Google)
 * @param faqs - Array of question/answer pairs to include in the FAQ schema
 * 
 * @example
 * useFaqSchema("officer-search", "Officer Search FAQ", "Questions about searching officers", [
 *   { question: "What is Officer Search?", answer: "A tool to search police officer records..." }
 * ]);
 */
export function useFaqSchema(id: string, name: string, description: string, faqs: FAQItem[]): void {
  useEffect(() => {
    if (!faqs || faqs.length === 0) return;

    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "name": name,
      "description": description,
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
  }, [id, name, description, faqs]);
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
