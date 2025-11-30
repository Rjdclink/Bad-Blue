/**
 * Central SEO Configuration for BadBlue
 * Contains metadata for all routes including titles, descriptions, keywords, and breadcrumbs
 * 
 * SEO Strategy:
 * - Primary keywords: High-intent action phrases ("file police complaint", "sue police officer")
 * - Secondary keywords: Service-specific terms ("Section 1983", "FOIA request")
 * - LSI keywords: Related terms that add context ("from home", "no lawyers needed", "Bad Blue does all the work")
 * - All titles under 60 chars, descriptions under 160 chars
 */

export const BASE_URL = "https://bad-blue.com";
export const SITE_NAME = "Bad Blue";
export const TWITTER_HANDLE = "@BadBlueApp";
export const DEFAULT_OG_IMAGE = `${BASE_URL}/preview.png`;

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface KeywordTaxonomy {
  primary: string[];
  secondary: string[];
  lsi: string[];
}

export interface PageSEO {
  title: string;
  description: string;
  keywords?: string;
  keywordTaxonomy?: KeywordTaxonomy;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: "website" | "article" | "service";
  canonicalPath: string;
  priority: number;
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  breadcrumbs: BreadcrumbItem[];
  noIndex?: boolean;
  includeInSitemap: boolean;
}

export const GLOBAL_KEYWORDS: KeywordTaxonomy = {
  primary: [
    "file police complaint online",
    "sue police officer",
    "police accountability",
    "police misconduct",
    "civil rights lawsuit"
  ],
  secondary: [
    "Section 1983 lawsuit",
    "42 USC 1983",
    "FOIA request",
    "officer search",
    "police brutality"
  ],
  lsi: [
    "file from home",
    "no lawyers needed",
    "Bad Blue does all the work",
    "affordable legal help",
    "online complaint form",
    "free police complaint",
    "citizen complaint"
  ]
};

export const SEO_CONFIG: Record<string, PageSEO> = {
  "/": {
    title: "Bad Blue | File Police Complaints From Home",
    description: "File police complaints, Section 1983 lawsuits, FOIA requests from home. Bad Blue does all the work. No lawyers needed.",
    keywords: "file police complaint online, police complaint form, report police misconduct, sue police officer, Section 1983 lawsuit, civil rights lawsuit, FOIA request, police accountability, file from home, no lawyers needed, Bad Blue does all the work",
    keywordTaxonomy: {
      primary: ["file police complaint online", "sue police officer", "police misconduct report"],
      secondary: ["Section 1983 lawsuit", "FOIA request", "civil rights violation"],
      lsi: ["file from home", "no lawyers needed", "Bad Blue does all the work", "free complaint form"]
    },
    ogType: "website",
    canonicalPath: "/",
    priority: 1.0,
    changefreq: "weekly",
    breadcrumbs: [],
    includeInSitemap: true,
  },
  "/landing": {
    title: "Bad Blue | Police Accountability Made Easy",
    description: "Hold police accountable from home. File complaints, lawsuits, FOIA requests. AI officer search. Bad Blue does all the work.",
    keywords: "police accountability platform, file police complaint, sue police, civil rights, police misconduct reporting, file from home, affordable legal help",
    keywordTaxonomy: {
      primary: ["police accountability", "file police complaint", "sue police officer"],
      secondary: ["AI officer search", "legal document generation", "automated complaint filing"],
      lsi: ["done from home", "no office visits", "we do all the work", "affordable alternative"]
    },
    ogType: "website",
    canonicalPath: "/landing",
    priority: 0.95,
    changefreq: "weekly",
    breadcrumbs: [{ name: "Welcome", url: `${BASE_URL}/landing` }],
    includeInSitemap: true,
  },
  "/officer": {
    title: "Police Officer Search | Find Cop Records | Bad Blue",
    description: "Search police officers by name, badge, department. Find misconduct history from home. AI-powered officer lookup.",
    keywords: "police officer search, officer lookup, badge number search, police misconduct records, officer background check, find police officer, cop lookup, officer history, search cop by name, police database",
    keywordTaxonomy: {
      primary: ["police officer search", "find police officer", "officer lookup"],
      secondary: ["badge number search", "cop lookup", "police misconduct records"],
      lsi: ["search from home", "no office visit needed", "AI-powered search", "free officer search"]
    },
    ogType: "service",
    canonicalPath: "/officer",
    priority: 0.9,
    changefreq: "daily",
    breadcrumbs: [{ name: "Officer Search", url: `${BASE_URL}/officer` }],
    includeInSitemap: true,
  },
  "/complaint-form": {
    title: "File Police Complaint Online Free | Bad Blue",
    description: "File police complaints from home. Auto-routes to authorities. No lawyers needed. Bad Blue does all the work.",
    keywords: "file police complaint, police complaint form, report police misconduct, police brutality complaint, internal affairs complaint, citizen complaint, how to file police complaint, online police complaint, free complaint form",
    keywordTaxonomy: {
      primary: ["file police complaint online", "police complaint form", "report police misconduct"],
      secondary: ["internal affairs complaint", "citizen complaint", "police brutality report"],
      lsi: ["file from home", "no lawyers needed", "automatic routing", "we do all the work"]
    },
    ogType: "service",
    canonicalPath: "/complaint-form",
    priority: 0.9,
    changefreq: "weekly",
    breadcrumbs: [{ name: "File Complaint", url: `${BASE_URL}/complaint-form` }],
    includeInSitemap: true,
  },
  "/lawsuit-form": {
    title: "Section 1983 Lawsuit Generator | Sue Police | Bad Blue",
    description: "Generate Section 1983 civil rights lawsuits from home. Court-ready documents. Affordable. No lawyers needed.",
    keywords: "Section 1983 lawsuit, sue police officer, civil rights lawsuit, 42 USC 1983, police brutality lawsuit, excessive force lawsuit, false arrest lawsuit, qualified immunity, how to sue police, file lawsuit from home",
    keywordTaxonomy: {
      primary: ["Section 1983 lawsuit", "sue police officer", "civil rights lawsuit"],
      secondary: ["42 USC 1983", "police brutality lawsuit", "excessive force lawsuit"],
      lsi: ["file from home", "affordable alternative to lawyers", "court-ready documents", "no attorney needed"]
    },
    ogType: "service",
    canonicalPath: "/lawsuit-form",
    priority: 0.9,
    changefreq: "weekly",
    breadcrumbs: [{ name: "Generate Lawsuit", url: `${BASE_URL}/lawsuit-form` }],
    includeInSitemap: true,
  },
  "/foia-request-form": {
    title: "FOIA Request Generator | Get Police Records | Bad Blue",
    description: "Get police records with FOIA requests. Body cam footage, incident reports. Filed from home. Bad Blue does all the work.",
    keywords: "FOIA request, freedom of information, police records request, public records, police body camera footage, incident reports, arrest records, how to FOIA police, get police records, request body cam footage",
    keywordTaxonomy: {
      primary: ["FOIA request", "police records request", "get police records"],
      secondary: ["body camera footage", "incident reports", "freedom of information"],
      lsi: ["file from home", "automatic agency lookup", "state-specific compliance", "we handle everything"]
    },
    ogType: "service",
    canonicalPath: "/foia-request-form",
    priority: 0.9,
    changefreq: "weekly",
    breadcrumbs: [{ name: "FOIA Request", url: `${BASE_URL}/foia-request-form` }],
    includeInSitemap: true,
  },
  "/petitions": {
    title: "Police Petitions | Demand Accountability | Bad Blue",
    description: "Create and sign petitions for police accountability. Demand officer discipline and policy changes. Join your community.",
    keywords: "police petition, community petition, police accountability petition, officer termination petition, police reform petition, citizen petition, demand police accountability, sign petition",
    keywordTaxonomy: {
      primary: ["police petition", "police accountability petition", "officer termination petition"],
      secondary: ["police reform petition", "community petition", "citizen petition"],
      lsi: ["demand accountability", "join community", "sign online", "create petition from home"]
    },
    ogType: "website",
    canonicalPath: "/petitions",
    priority: 0.8,
    changefreq: "daily",
    breadcrumbs: [{ name: "Petitions", url: `${BASE_URL}/petitions` }],
    includeInSitemap: true,
  },
  "/evidence-hub": {
    title: "Evidence Hub | Upload Police Misconduct Evidence | Bad Blue",
    description: "Securely upload police misconduct evidence. Videos, photos, documents. Private and protected. Community evidence repository.",
    keywords: "police evidence upload, misconduct evidence, police video evidence, brutality evidence, share police misconduct, evidence repository, upload police video, secure evidence storage",
    keywordTaxonomy: {
      primary: ["police evidence upload", "upload misconduct evidence", "police video evidence"],
      secondary: ["evidence repository", "secure evidence storage", "brutality evidence"],
      lsi: ["private upload", "protected storage", "community evidence", "share safely"]
    },
    ogType: "website",
    canonicalPath: "/evidence-hub",
    priority: 0.8,
    changefreq: "daily",
    breadcrumbs: [{ name: "Evidence Hub", url: `${BASE_URL}/evidence-hub` }],
    includeInSitemap: true,
  },
  "/contact": {
    title: "Contact Bad Blue | Support & Help",
    description: "Contact Bad Blue for help with police complaints, lawsuits, FOIA requests. We're here to support you.",
    keywords: "contact bad blue, bad blue support, help with police complaint, police accountability help, customer support",
    ogType: "website",
    canonicalPath: "/contact",
    priority: 0.7,
    changefreq: "monthly",
    breadcrumbs: [{ name: "Contact", url: `${BASE_URL}/contact` }],
    includeInSitemap: true,
  },
  "/privacy": {
    title: "Privacy Policy | Bad Blue",
    description: "Bad Blue privacy policy. How we protect your data, evidence, and personal information. Your security is our priority.",
    keywords: "bad blue privacy policy, data protection, evidence privacy, personal information security",
    ogType: "website",
    canonicalPath: "/privacy",
    priority: 0.5,
    changefreq: "monthly",
    breadcrumbs: [{ name: "Privacy Policy", url: `${BASE_URL}/privacy` }],
    includeInSitemap: true,
  },
  "/terms": {
    title: "Terms of Service | Bad Blue",
    description: "Bad Blue terms of service. Terms for using our police accountability platform and legal tools.",
    keywords: "bad blue terms of service, terms and conditions, user agreement, legal terms",
    ogType: "website",
    canonicalPath: "/terms",
    priority: 0.5,
    changefreq: "monthly",
    breadcrumbs: [{ name: "Terms of Service", url: `${BASE_URL}/terms` }],
    includeInSitemap: true,
  },
  "/login": {
    title: "Login | Bad Blue",
    description: "Sign in to your Bad Blue account to access your complaints, lawsuits, and legal documents.",
    canonicalPath: "/login",
    priority: 0.3,
    changefreq: "monthly",
    breadcrumbs: [{ name: "Login", url: `${BASE_URL}/login` }],
    noIndex: true,
    includeInSitemap: false,
  },
  "/home": {
    title: "Dashboard | Bad Blue",
    description: "Your Bad Blue dashboard. Access your complaints, lawsuits, FOIA requests, and evidence uploads.",
    canonicalPath: "/home",
    priority: 0.3,
    changefreq: "daily",
    breadcrumbs: [{ name: "Dashboard", url: `${BASE_URL}/home` }],
    noIndex: true,
    includeInSitemap: false,
  },
  "/petition-form": {
    title: "Create Petition | Bad Blue",
    description: "Create a new police accountability petition. Gather community support for officer discipline or policy changes.",
    canonicalPath: "/petition-form",
    priority: 0.6,
    changefreq: "weekly",
    breadcrumbs: [
      { name: "Petitions", url: `${BASE_URL}/petitions` },
      { name: "Create Petition", url: `${BASE_URL}/petition-form` }
    ],
    noIndex: true,
    includeInSitemap: false,
  },
  "/petition-workflow": {
    title: "Petition Workflow | Bad Blue",
    description: "Manage your petition workflow and track signatures.",
    canonicalPath: "/petition-workflow",
    priority: 0.5,
    changefreq: "weekly",
    breadcrumbs: [
      { name: "Petitions", url: `${BASE_URL}/petitions` },
      { name: "Workflow", url: `${BASE_URL}/petition-workflow` }
    ],
    noIndex: true,
    includeInSitemap: false,
  },
};

export function getPageSEO(path: string): PageSEO | undefined {
  return SEO_CONFIG[path];
}

export function getSitemapRoutes(): PageSEO[] {
  return Object.values(SEO_CONFIG).filter(page => page.includeInSitemap);
}

export function getBreadcrumbsForPath(path: string): BreadcrumbItem[] {
  const seo = SEO_CONFIG[path];
  return seo?.breadcrumbs || [];
}
