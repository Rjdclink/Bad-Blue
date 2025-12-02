import { getPageFaqs } from "@shared/seoConfig";

interface HiddenFAQProps {
  path: string;
}

/**
 * HiddenFAQ - Renders SEO-optimized hidden FAQ markup for a specific page
 * 
 * This component renders FAQ content that is:
 * - Hidden visually using sr-only (screen reader only) class
 * - Accessible to screen readers (aria-hidden="false")
 * - Crawlable by search engines with proper Schema.org microdata
 * 
 * The FAQ content is sourced from PAGE_FAQ_CONFIG in shared/seoConfig.ts
 * and rendered with proper semantic HTML and microdata attributes.
 * 
 * @param path - The page path to render FAQ for (e.g., "/landing", "/officer-search")
 */
export function HiddenFAQ({ path }: HiddenFAQProps) {
  const faqConfig = getPageFaqs(path);
  
  if (!faqConfig || !faqConfig.faqs || faqConfig.faqs.length === 0) {
    return null;
  }

  return (
    <div 
      className="sr-only" 
      aria-hidden="false"
      itemScope 
      itemType="https://schema.org/FAQPage"
    >
      <h2>{faqConfig.name}</h2>
      <p>{faqConfig.description}</p>
      
      {faqConfig.faqs.map((faq, index) => (
        <div 
          key={index}
          itemScope 
          itemProp="mainEntity" 
          itemType="https://schema.org/Question"
        >
          <h3 itemProp="name">{faq.question}</h3>
          <div 
            itemScope 
            itemProp="acceptedAnswer" 
            itemType="https://schema.org/Answer"
          >
            <p itemProp="text">{faq.answer}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
