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
  noIndex?: boolean; // For pages that should not be indexed (auth pages, admin, etc.)
  ogImageAlt?: string; // Alt text for Open Graph image
  twitterSite?: string; // Twitter @username
  articlePublishedTime?: string; // For article pages
  articleModifiedTime?: string; // For article pages
}

const BASE_URL = "https://example.com";
const TWITTER_SITE = "@BadBlueApp"; // Official Twitter handle

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
  noIndex = false,
  ogImageAlt,
  twitterSite,
  articlePublishedTime,
  articleModifiedTime,
}: SEOHeadProps) {
  const defaultOgImage = `${BASE_URL}/preview.png`;
  const finalOgImage = ogImage || defaultOgImage;
  const finalOgImageAlt = ogImageAlt || "BadBlue - AI-powered police accountability platform for filing complaints and civil rights lawsuits";
  
  // Default AI keywords to include on all pages
  const aiKeywords = [
    "7 provider AI system",
    "parallel AI processing",
    "Gemini Claude DeepSeek Grok Kimi Groq Mistral",
    "AI coordination system",
    "multi-AI analysis",
    "AI legal team"
  ];
  
  // Enhanced keywords including existing, new target keywords, and AI keywords
  const enhancedKeywords = keywords ? 
    `${keywords}, ${aiKeywords.join(", ")}, bad cops, cop assault, officer assault, law enforcement abuse, officer abuse, cop abuse, police misconduct, police brutality, excessive force, false arrest, civil rights violations, police accountability, file police complaint online, sue police officer, legal rights protection, justice accessibility, civil rights advocacy` :
    `${aiKeywords.join(", ")}, police accountability, police misconduct, police brutality, bad cops, cop assault, officer assault, law enforcement abuse, officer abuse, cop abuse, excessive force, false arrest, civil rights violations, file police complaint online, sue police officer, legal rights protection service, transparent complaint filing system, civil rights advocacy tools, justice accessibility platform, legal empowerment for citizens`;
  
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
    
    // Set robots directive based on noIndex prop
    const robotsDirective = noIndex 
      ? "noindex, nofollow" 
      : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
    setMetaTag("robots", robotsDirective);
    setMetaTag("googlebot", noIndex ? "noindex, nofollow" : "index, follow, max-snippet:-1, max-image-preview:large");
    setMetaTag("bingbot", noIndex ? "noindex, nofollow" : "index, follow");
    
    setMetaTag("author", "BadBlue");
    setMetaTag("language", "English");
    setMetaTag("revisit-after", "1 days");
    setMetaTag("rating", "General");
    setMetaTag("distribution", "Global");
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

    // Set Twitter Card tags with enhanced metadata
    setMetaTag("twitter:card", "summary_large_image");
    setMetaTag("twitter:site", twitterSite || TWITTER_SITE);
    setMetaTag("twitter:creator", twitterSite || TWITTER_SITE);
    setMetaTag("twitter:title", ogTitle || title);
    setMetaTag("twitter:description", ogDescription || description);
    setMetaTag("twitter:image", finalOgImage);
    setMetaTag("twitter:image:alt", finalOgImageAlt);
    
    // Additional Open Graph metadata
    setMetaTag("og:site_name", "BadBlue", true);
    setMetaTag("og:locale", "en_US", true);
    setMetaTag("og:image:alt", finalOgImageAlt, true);
    setMetaTag("og:image:width", "1200", true);
    setMetaTag("og:image:height", "630", true);
    
    // Article-specific metadata (for blog posts, news, etc.)
    if (articlePublishedTime) {
      setMetaTag("article:published_time", articlePublishedTime, true);
    }
    if (articleModifiedTime) {
      setMetaTag("article:modified_time", articleModifiedTime, true);
    }

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

    // NOTE: Organization and WebSite structured data are defined in index.html
    // DO NOT duplicate them here - causes Google Search Console "duplicate field" errors
    // FAQ structured data is handled by useFaqSchema hook on individual pages

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
  }, [title, description, enhancedKeywords, ogTitle, ogDescription, ogType, finalOgImage, canonicalUrl, structuredData, breadcrumbs, pageType, noIndex, finalOgImageAlt, twitterSite, articlePublishedTime, articleModifiedTime]);

  return null;
}
