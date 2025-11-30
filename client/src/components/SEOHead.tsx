import { useEffect } from "react";

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface SEOHeadProps {
  title: string;
  description: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogImage?: string;
  canonicalUrl?: string;
  structuredData?: object;
  breadcrumbs?: BreadcrumbItem[];
  pageType?: "website" | "article" | "service" | "faq";
}

const BASE_URL = "https://bad-blue.com";

export function SEOHead({
  title,
  description,
  keywords,
  ogTitle,
  ogDescription,
  ogType = "website",
  ogImage,
  canonicalUrl,
  structuredData,
  breadcrumbs,
  pageType = "website",
}: SEOHeadProps) {
  const defaultOgImage = `${import.meta.env.VITE_BASE_URL || window.location.origin}/preview.png`;
  const finalOgImage = ogImage || defaultOgImage;
  
  // Enhanced keywords including existing and new target keywords
  const enhancedKeywords = keywords ? 
    `${keywords}, bad cops, cop assault, officer assault, law enforcement abuse, officer abuse, cop abuse, police misconduct, police brutality, excessive force, false arrest, civil rights violations, police accountability, file police complaint online, sue police officer, legal rights protection, justice accessibility, civil rights advocacy` :
    `police accountability, police misconduct, police brutality, bad cops, cop assault, officer assault, law enforcement abuse, officer abuse, cop abuse, excessive force, false arrest, civil rights violations, file police complaint online, sue police officer, legal rights protection service, transparent complaint filing system, civil rights advocacy tools, justice accessibility platform, legal empowerment for citizens`;
  
  useEffect(() => {
    // Set page title
    document.title = title;

    // Helper function to set or update meta tags
    const setMetaTag = (property: string, content: string, isProperty = false) => {
      const attribute = isProperty ? "property" : "name";
      let meta = document.querySelector(`meta[${attribute}="${property}"]`);
      
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attribute, property);
        document.head.appendChild(meta);
      }
      
      meta.setAttribute("content", content);
    };

    // Set basic meta tags
    setMetaTag("description", description);
    setMetaTag("keywords", enhancedKeywords);
    setMetaTag("robots", "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1");
    setMetaTag("author", "BadBlue");
    setMetaTag("language", "English");
    setMetaTag("revisit-after", "1 days");
    setMetaTag("rating", "General");
    setMetaTag("distribution", "Global");
    
    // Additional SEO meta tags
    setMetaTag("googlebot", "index, follow");
    setMetaTag("bingbot", "index, follow");
    setMetaTag("referrer", "origin-when-cross-origin");
    setMetaTag("format-detection", "telephone=no");
    setMetaTag("HandheldFriendly", "True");
    setMetaTag("MobileOptimized", "320");
    setMetaTag("theme-color", "#1e40af");
    setMetaTag("apple-mobile-web-app-capable", "yes");
    setMetaTag("apple-mobile-web-app-status-bar-style", "black-translucent");

    // Set Open Graph tags for social media
    setMetaTag("og:title", ogTitle || title, true);
    setMetaTag("og:description", ogDescription || description, true);
    setMetaTag("og:type", ogType, true);
    setMetaTag("og:image", finalOgImage, true);
    if (canonicalUrl) {
      setMetaTag("og:url", canonicalUrl, true);
    }

    // Set Twitter Card tags
    setMetaTag("twitter:card", "summary_large_image");
    setMetaTag("twitter:title", ogTitle || title);
    setMetaTag("twitter:description", ogDescription || description);
    setMetaTag("twitter:image", finalOgImage);

    // Set canonical URL
    if (canonicalUrl) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", canonicalUrl);
    }

    // Add sitemap link reference (always point to root sitemap)
    let sitemapLink = document.querySelector('link[rel="sitemap"]');
    if (!sitemapLink) {
      sitemapLink = document.createElement("link");
      sitemapLink.setAttribute("rel", "sitemap");
      sitemapLink.setAttribute("type", "application/xml");
      document.head.appendChild(sitemapLink);
    }
    sitemapLink.setAttribute("href", `${BASE_URL}/sitemap.xml`);

    // Add robots.txt link reference (always point to root robots.txt)
    let robotsLink = document.querySelector('link[rel="robots"]');
    if (!robotsLink) {
      robotsLink = document.createElement("link");
      robotsLink.setAttribute("rel", "robots");
      document.head.appendChild(robotsLink);
    }
    robotsLink.setAttribute("href", `${BASE_URL}/robots.txt`);

    // Add structured data (Schema.org)
    if (structuredData) {
      let script = document.querySelector('script[type="application/ld+json"]');
      if (!script) {
        script = document.createElement("script");
        script.setAttribute("type", "application/ld+json");
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(structuredData);
    }

    // Add BreadcrumbList structured data for site navigation
    const defaultBreadcrumbs: BreadcrumbItem[] = [
      { name: "Home", url: BASE_URL }
    ];
    
    const finalBreadcrumbs = breadcrumbs && breadcrumbs.length > 0 
      ? [{ name: "Home", url: BASE_URL }, ...breadcrumbs]
      : defaultBreadcrumbs;
    
    const breadcrumbData = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": finalBreadcrumbs.map((crumb, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": crumb.name,
        "item": crumb.url
      }))
    };

    let breadcrumbScript = document.querySelector('script#breadcrumb-schema');
    if (!breadcrumbScript) {
      breadcrumbScript = document.createElement("script");
      breadcrumbScript.setAttribute("type", "application/ld+json");
      breadcrumbScript.setAttribute("id", "breadcrumb-schema");
      document.head.appendChild(breadcrumbScript);
    }
    breadcrumbScript.textContent = JSON.stringify(breadcrumbData);

    // Enhanced Organization structured data with LegalService schema
    const organizationData = {
      "@context": "https://schema.org",
      "@type": ["Organization", "LegalService"],
      "name": "BadBlue - Professional Police Accountability Platform",
      "alternateName": "BadBlue Legal Rights Protection Service",
      "url": BASE_URL,
      "logo": `${BASE_URL}/preview.png`,
      "description": "Professional legal empowerment platform providing transparent complaint filing systems, civil rights protection services, and justice accessibility tools for citizens seeking police accountability",
      "slogan": "Empowering Citizens Through Legal Rights Protection",
      "sameAs": [
        BASE_URL
      ],
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "Customer Support",
        "email": "contact.badblue@gmail.com",
        "availableLanguage": ["English", "Spanish"]
      },
      "areaServed": {
        "@type": "Country",
        "name": "United States"
      },
      "hasOfferCatalog": {
        "@type": "OfferCatalog",
        "name": "Legal Services",
        "itemListElement": [
          {
            "@type": "LegalService",
            "name": "Police Complaint Filing",
            "description": "Professional assistance filing official complaints against law enforcement officers for misconduct, excessive force, or civil rights violations"
          },
          {
            "@type": "LegalService",
            "name": "Civil Rights Lawsuit Preparation",
            "description": "Legal document preparation for civil rights lawsuits against police officers and departments"
          },
          {
            "@type": "LegalService",
            "name": "FOIA Request Services",
            "description": "Freedom of Information Act request preparation and filing assistance"
          }
        ]
      }
    };

    let orgScript = document.querySelector('script#organization-schema');
    if (!orgScript) {
      orgScript = document.createElement("script");
      orgScript.setAttribute("type", "application/ld+json");
      orgScript.setAttribute("id", "organization-schema");
      document.head.appendChild(orgScript);
    }
    orgScript.textContent = JSON.stringify(organizationData);

    // NOTE: FAQ structured data is handled by useFaqSchema hook on individual pages
    // to prevent duplicate FAQPage schemas that cause Google Search Console errors

    // Add WebSite structured data for search engine optimization
    const websiteData = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "BadBlue - Police Accountability Platform",
      "url": BASE_URL,
      "potentialAction": {
        "@type": "SearchAction",
        "target": `${BASE_URL}/officer?search={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    };

    let websiteScript = document.querySelector('script#website-schema');
    if (!websiteScript) {
      websiteScript = document.createElement("script");
      websiteScript.setAttribute("type", "application/ld+json");
      websiteScript.setAttribute("id", "website-schema");
      document.head.appendChild(websiteScript);
    }
    websiteScript.textContent = JSON.stringify(websiteData);

    // Add hreflang tags for language support
    let hreflangEn = document.querySelector('link[hreflang="en"]');
    if (!hreflangEn) {
      hreflangEn = document.createElement("link");
      hreflangEn.setAttribute("rel", "alternate");
      hreflangEn.setAttribute("hreflang", "en");
      document.head.appendChild(hreflangEn);
    }
    hreflangEn.setAttribute("href", canonicalUrl || BASE_URL);

    let hreflangXDefault = document.querySelector('link[hreflang="x-default"]');
    if (!hreflangXDefault) {
      hreflangXDefault = document.createElement("link");
      hreflangXDefault.setAttribute("rel", "alternate");
      hreflangXDefault.setAttribute("hreflang", "x-default");
      document.head.appendChild(hreflangXDefault);
    }
    hreflangXDefault.setAttribute("href", canonicalUrl || BASE_URL);
  }, [title, description, enhancedKeywords, ogTitle, ogDescription, ogType, finalOgImage, canonicalUrl, structuredData, breadcrumbs, pageType]);

  return null;
}
