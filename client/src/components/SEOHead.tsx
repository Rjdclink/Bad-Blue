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
  noIndex?: boolean;
  ogImageAlt?: string;
  twitterSite?: string;
  articlePublishedTime?: string;
  articleModifiedTime?: string;
}

const BASE_URL = "https://legalwhat.com";
const SITE_NAME = "Legal What?";
const DEFAULT_SHARE_IMAGE = `${BASE_URL}/images/Legal%20What%20Icon.png`;

const PRIVATE_ROUTES = new Set([
  "/login",
  "/subscription-success",
  "/administrator",
  "/admin",
  "/welcome",
  "/legal-tools",
  "/people-finder",
  "/spectra",
  "/geo-console",
  "/location-intel",
  "/tshpe",
  "/tshpe-locator",
  "/positioning",
  "/inmate-locator",
  "/inmate-locator/dashboard",
  "/inmate-locator-v2",
  "/cryptocrawler",
  "/cryptocrawler-v2",
  "/control-room",
  "/orchestrator-console",
  "/badblue",
  "/home",
  "/dashboard",
  "/officer-search",
  "/complaints",
  "/complaint-form",
  "/complaint",
  "/lawsuit-form",
  "/lawsuit",
  "/petition-form",
  "/petition-workflow",
  "/petitions",
  "/foia-request",
  "/foia",
  "/legal-document-creator",
  "/history",
  "/evidence-hub",
]);

const PRIVATE_PREFIXES = [
  "/admin-",
  "/lexara-consent/",
  "/legal-consultation/",
  "/geoconsole",
  "/cryptocrawler-dashboard",
  "/officer/",
  "/complaint/",
  "/lawsuit/",
  "/petition-edit/",
  "/confirmation/",
];

function isPrivateRoute(path: string): boolean {
  return PRIVATE_ROUTES.has(path) || PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function SEOHead({
  title,
  description,
  keywords: _keywords,
  ogTitle,
  ogDescription,
  ogType = "website",
  ogImage,
  canonicalUrl,
  structuredData,
  breadcrumbs,
  pageType: _pageType = "website",
  noIndex = false,
  ogImageAlt,
  twitterSite,
  articlePublishedTime,
  articleModifiedTime,
}: SEOHeadProps) {
  useEffect(() => {
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

    const removeMetaTag = (property: string, isProperty = false) => {
      const attribute = isProperty ? "property" : "name";
      document.querySelector(`meta[${attribute}="${property}"]`)?.remove();
    };

    const path = window.location.pathname || "/";
    const inferredCanonical = new URL(path, `${BASE_URL}/`).toString();
    const finalCanonical = canonicalUrl || inferredCanonical;
    const effectiveNoIndex = noIndex || isPrivateRoute(path);
    const finalOgImage = ogImage || DEFAULT_SHARE_IMAGE;
    const finalOgImageAlt = ogImageAlt || "Legal What? legal technology platform logo";

    document.title = title;
    setMetaTag("description", description);
    setMetaTag(
      "robots",
      effectiveNoIndex
        ? "noindex, nofollow"
        : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1",
    );
    setMetaTag(
      "googlebot",
      effectiveNoIndex
        ? "noindex, nofollow"
        : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1",
    );
    setMetaTag("bingbot", effectiveNoIndex ? "noindex, nofollow" : "index, follow");
    setMetaTag("author", SITE_NAME);
    setMetaTag("referrer", "origin-when-cross-origin");

    // Search engines don't use meta-keywords for ranking. Remove any legacy
    // keyword-stuffed tag instead of emitting stale or misleading terms.
    removeMetaTag("keywords");
    removeMetaTag("revisit-after");
    removeMetaTag("rating");
    removeMetaTag("distribution");

    setMetaTag("og:title", ogTitle || title, true);
    setMetaTag("og:description", ogDescription || description, true);
    setMetaTag("og:type", ogType, true);
    setMetaTag("og:url", finalCanonical, true);
    setMetaTag("og:site_name", SITE_NAME, true);
    setMetaTag("og:locale", "en_US", true);
    setMetaTag("og:image", finalOgImage, true);
    setMetaTag("og:image:alt", finalOgImageAlt, true);
    removeMetaTag("og:image:width", true);
    removeMetaTag("og:image:height", true);

    setMetaTag("twitter:card", "summary");
    setMetaTag("twitter:title", ogTitle || title);
    setMetaTag("twitter:description", ogDescription || description);
    setMetaTag("twitter:image", finalOgImage);
    setMetaTag("twitter:image:alt", finalOgImageAlt);
    if (twitterSite) {
      setMetaTag("twitter:site", twitterSite);
      setMetaTag("twitter:creator", twitterSite);
    } else {
      removeMetaTag("twitter:site");
      removeMetaTag("twitter:creator");
    }

    if (articlePublishedTime) {
      setMetaTag("article:published_time", articlePublishedTime, true);
    } else {
      removeMetaTag("article:published_time", true);
    }
    if (articleModifiedTime) {
      setMetaTag("article:modified_time", articleModifiedTime, true);
    } else {
      removeMetaTag("article:modified_time", true);
    }

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", finalCanonical);

    let sitemapLink = document.querySelector('link[rel="sitemap"]');
    if (!sitemapLink) {
      sitemapLink = document.createElement("link");
      sitemapLink.setAttribute("rel", "sitemap");
      sitemapLink.setAttribute("type", "application/xml");
      document.head.appendChild(sitemapLink);
    }
    sitemapLink.setAttribute("href", `${BASE_URL}/sitemap.xml`);

    let pageSchema = document.querySelector("script#page-schema");
    if (structuredData) {
      if (!pageSchema) {
        pageSchema = document.createElement("script");
        pageSchema.setAttribute("type", "application/ld+json");
        pageSchema.setAttribute("id", "page-schema");
        document.head.appendChild(pageSchema);
      }
      pageSchema.textContent = JSON.stringify(structuredData);
    } else {
      pageSchema?.remove();
    }

    const finalBreadcrumbs = breadcrumbs && breadcrumbs.length > 0
      ? [{ name: "Home", url: `${BASE_URL}/` }, ...breadcrumbs]
      : [{ name: "Home", url: `${BASE_URL}/` }];

    const breadcrumbData = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": finalBreadcrumbs.map((crumb, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": crumb.name,
        "item": crumb.url,
      })),
    };

    let breadcrumbScript = document.querySelector("script#breadcrumb-schema");
    if (!breadcrumbScript) {
      breadcrumbScript = document.createElement("script");
      breadcrumbScript.setAttribute("type", "application/ld+json");
      breadcrumbScript.setAttribute("id", "breadcrumb-schema");
      document.head.appendChild(breadcrumbScript);
    }
    breadcrumbScript.textContent = JSON.stringify(breadcrumbData);

    for (const lang of ["en", "x-default"]) {
      let link = document.querySelector(`link[hreflang="${lang}"]`);
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "alternate");
        link.setAttribute("hreflang", lang);
        document.head.appendChild(link);
      }
      link.setAttribute("href", finalCanonical);
    }
  }, [
    title,
    description,
    ogTitle,
    ogDescription,
    ogType,
    ogImage,
    canonicalUrl,
    structuredData,
    breadcrumbs,
    noIndex,
    ogImageAlt,
    twitterSite,
    articlePublishedTime,
    articleModifiedTime,
  ]);

  return null;
}
