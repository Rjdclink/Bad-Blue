/**
 * Central SEO Configuration for BadBlue
 * Contains metadata for all routes including titles, descriptions, keywords, and breadcrumbs
 */

export const BASE_URL = "https://bad-blue.com";
export const SITE_NAME = "Bad Blue";
export const TWITTER_HANDLE = "@BadBlueApp";
export const DEFAULT_OG_IMAGE = `${BASE_URL}/preview.png`;

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageSEO {
  title: string;
  description: string;
  keywords?: string;
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

export const SEO_CONFIG: Record<string, PageSEO> = {
  "/": {
    title: "Bad Blue | File Police Complaints & Civil Rights Lawsuits From Home",
    description: "File police complaints, Section 1983 lawsuits, and FOIA requests from home. AI officer search, petitions, evidence upload. Bad Blue does all the work.",
    keywords: "police complaint, file police complaint online, police misconduct, police brutality, civil rights lawsuit, Section 1983, sue police officer, police accountability",
    ogType: "website",
    canonicalPath: "/",
    priority: 1.0,
    changefreq: "weekly",
    breadcrumbs: [],
    includeInSitemap: true,
  },
  "/landing": {
    title: "Bad Blue | AI-Powered Police Accountability Platform",
    description: "Hold police accountable from home. File complaints, generate Section 1983 lawsuits, submit FOIA requests. AI-powered officer search and legal document generation.",
    keywords: "police accountability platform, file police complaint, sue police, civil rights, police misconduct reporting",
    ogType: "website",
    canonicalPath: "/landing",
    priority: 0.95,
    changefreq: "weekly",
    breadcrumbs: [{ name: "Welcome", url: `${BASE_URL}/landing` }],
    includeInSitemap: true,
  },
  "/officer": {
    title: "Police Officer Search | Find Officer Records & Misconduct History | Bad Blue",
    description: "Search for police officer information, badge lookup, background check, and misconduct history. Find officer records without visiting any office. AI-powered search.",
    keywords: "police officer search, officer lookup, badge number search, police misconduct records, officer background check, find police officer, cop lookup",
    ogType: "service",
    canonicalPath: "/officer",
    priority: 0.9,
    changefreq: "daily",
    breadcrumbs: [{ name: "Officer Search", url: `${BASE_URL}/officer` }],
    includeInSitemap: true,
  },
  "/complaint-form": {
    title: "File Police Complaint Online | Free Complaint Generator | Bad Blue",
    description: "File police misconduct complaints online from home. Automated routing to proper authorities. Professional complaint documents generated automatically. No lawyers needed.",
    keywords: "file police complaint, police complaint form, report police misconduct, police brutality complaint, internal affairs complaint, citizen complaint against police",
    ogType: "service",
    canonicalPath: "/complaint-form",
    priority: 0.9,
    changefreq: "weekly",
    breadcrumbs: [{ name: "File Complaint", url: `${BASE_URL}/complaint-form` }],
    includeInSitemap: true,
  },
  "/lawsuit-form": {
    title: "Section 1983 Civil Rights Lawsuit Generator | Sue Police | Bad Blue",
    description: "Generate U.S. District Court-compliant Section 1983 civil rights lawsuit documents from home. Affordable alternative to expensive attorneys. No courthouse visit required.",
    keywords: "Section 1983 lawsuit, sue police officer, civil rights lawsuit, 42 USC 1983, police brutality lawsuit, excessive force lawsuit, false arrest lawsuit, qualified immunity",
    ogType: "service",
    canonicalPath: "/lawsuit-form",
    priority: 0.9,
    changefreq: "weekly",
    breadcrumbs: [{ name: "Generate Lawsuit", url: `${BASE_URL}/lawsuit-form` }],
    includeInSitemap: true,
  },
  "/foia-request-form": {
    title: "FOIA Request Generator | Get Police Records | Bad Blue",
    description: "Submit Freedom of Information Act requests for police records online. Automated agency discovery and state-specific compliance. Get police records from home.",
    keywords: "FOIA request, freedom of information, police records request, public records, police body camera footage, incident reports, arrest records",
    ogType: "service",
    canonicalPath: "/foia-request-form",
    priority: 0.9,
    changefreq: "weekly",
    breadcrumbs: [{ name: "FOIA Request", url: `${BASE_URL}/foia-request-form` }],
    includeInSitemap: true,
  },
  "/petitions": {
    title: "Police Accountability Petitions | Community Action | Bad Blue",
    description: "Create and sign community petitions calling for police accountability. Join others demanding officer discipline, policy changes, and justice.",
    keywords: "police petition, community petition, police accountability, officer termination petition, police reform petition, citizen petition",
    ogType: "website",
    canonicalPath: "/petitions",
    priority: 0.8,
    changefreq: "daily",
    breadcrumbs: [{ name: "Petitions", url: `${BASE_URL}/petitions` }],
    includeInSitemap: true,
  },
  "/evidence-hub": {
    title: "Evidence Hub | Share Police Misconduct Evidence | Bad Blue",
    description: "Securely upload and share police misconduct evidence. Community evidence repository for accountability. Protected and private evidence storage.",
    keywords: "police evidence, misconduct evidence, police video evidence, brutality evidence, share police misconduct, evidence repository",
    ogType: "website",
    canonicalPath: "/evidence-hub",
    priority: 0.8,
    changefreq: "daily",
    breadcrumbs: [{ name: "Evidence Hub", url: `${BASE_URL}/evidence-hub` }],
    includeInSitemap: true,
  },
  "/contact": {
    title: "Contact Us | Bad Blue Support",
    description: "Contact Bad Blue for support, questions, or feedback. We're here to help you with police accountability tools and legal document generation.",
    keywords: "contact bad blue, support, help, questions, feedback, police accountability help",
    ogType: "website",
    canonicalPath: "/contact",
    priority: 0.7,
    changefreq: "monthly",
    breadcrumbs: [{ name: "Contact", url: `${BASE_URL}/contact` }],
    includeInSitemap: true,
  },
  "/privacy": {
    title: "Privacy Policy | Bad Blue",
    description: "Bad Blue privacy policy. Learn how we protect your personal information and evidence uploads. Your privacy and security are our priority.",
    keywords: "privacy policy, data protection, personal information, security, evidence privacy",
    ogType: "website",
    canonicalPath: "/privacy",
    priority: 0.5,
    changefreq: "monthly",
    breadcrumbs: [{ name: "Privacy Policy", url: `${BASE_URL}/privacy` }],
    includeInSitemap: true,
  },
  "/terms": {
    title: "Terms of Service | Bad Blue",
    description: "Bad Blue terms of service. Read our terms and conditions for using the police accountability platform and legal document generation tools.",
    keywords: "terms of service, terms and conditions, legal terms, user agreement",
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
