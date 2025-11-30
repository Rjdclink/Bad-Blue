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

export interface FaqItem {
  question: string;
  answer: string;
}

export interface PageFaqConfig {
  name: string;
  description: string;
  faqs: FaqItem[];
}

export const PAGE_FAQ_CONFIG: Record<string, PageFaqConfig> = {
  "/officer": {
    name: "Police Officer Search FAQ",
    description: "Frequently asked questions about searching for police officers and finding misconduct records.",
    faqs: [
      {
        question: "How do I search for a police officer?",
        answer: "Enter the officer's name, badge number, or department in the search box. Bad Blue's AI-powered search finds officer records, misconduct history, and department information. Search entirely from home without visiting any office."
      },
      {
        question: "What information can I find about a police officer?",
        answer: "You can find officer names, badge numbers, departments, rank, misconduct complaints, disciplinary actions, lawsuits filed against them, and public records. Bad Blue compiles information from multiple sources."
      },
      {
        question: "Is the officer search free?",
        answer: "Basic officer searches are free. You can search by name, badge number, or department at no cost. Advanced features and detailed reports may require a subscription."
      },
      {
        question: "How accurate is the officer search?",
        answer: "Bad Blue uses AI to search multiple databases and public records. Results are compiled from official sources, news reports, court records, and community submissions. We verify information where possible."
      },
      {
        question: "Can I search for officers in any state?",
        answer: "Yes, Bad Blue's officer search covers police departments across all 50 states. Enter any department name or location to find officers in that jurisdiction."
      }
    ]
  },
  "/complaint-form": {
    name: "Police Complaint Filing FAQ",
    description: "Frequently asked questions about filing police misconduct complaints online from home.",
    faqs: [
      {
        question: "How do I file a police complaint online?",
        answer: "Fill out Bad Blue's complaint form with details about the incident, officer involved, and your contact information. Bad Blue generates a professional complaint document and automatically routes it to the correct authorities. File entirely from home."
      },
      {
        question: "Where does my complaint get sent?",
        answer: "Bad Blue automatically identifies and routes your complaint to internal affairs divisions, civilian oversight boards, police chiefs, and relevant authorities based on the department and jurisdiction. We do all the work."
      },
      {
        question: "Do I need a lawyer to file a police complaint?",
        answer: "No lawyers needed. Bad Blue generates professional complaint documents that meet official requirements. You can file a complete complaint on your own without legal representation."
      },
      {
        question: "What happens after I file a complaint?",
        answer: "After filing, your complaint is sent to the appropriate authorities who are required to investigate. You'll receive confirmation and can track your complaint status. Response times vary by department."
      },
      {
        question: "Is my complaint confidential?",
        answer: "Bad Blue protects your privacy. Your personal information is encrypted and stored securely. Some jurisdictions allow anonymous complaints, though identified complaints often carry more weight in investigations."
      },
      {
        question: "What should I include in my complaint?",
        answer: "Include the date, time, and location of the incident, officer name or badge number if known, detailed description of what happened, names of witnesses, and any evidence you have. More detail strengthens your complaint."
      }
    ]
  },
  "/lawsuit-form": {
    name: "Section 1983 Lawsuit FAQ",
    description: "Frequently asked questions about filing civil rights lawsuits against police officers.",
    faqs: [
      {
        question: "What is a Section 1983 lawsuit?",
        answer: "A Section 1983 lawsuit (42 U.S.C. § 1983) allows you to sue police officers and government officials who violate your constitutional rights. This includes excessive force, false arrest, unlawful search, and other civil rights violations."
      },
      {
        question: "Can I file a lawsuit without a lawyer?",
        answer: "Yes, you can file pro se (representing yourself). Bad Blue generates court-ready Section 1983 lawsuit documents formatted for U.S. District Court. Our platform provides an affordable alternative to expensive attorneys."
      },
      {
        question: "What is qualified immunity?",
        answer: "Qualified immunity protects officers from lawsuits unless they violate 'clearly established' constitutional rights. Bad Blue helps you identify relevant precedents and structure your case to overcome qualified immunity defenses."
      },
      {
        question: "How much does it cost to file a lawsuit?",
        answer: "Federal court filing fees are typically around $400. Bad Blue's lawsuit generation is significantly cheaper than hiring an attorney. You may qualify for fee waivers if you cannot afford filing fees."
      },
      {
        question: "What damages can I recover?",
        answer: "You may recover compensatory damages for injuries, medical bills, lost wages, and emotional distress. Punitive damages may be awarded for egregious misconduct. Attorney fees can also be recovered if you win."
      },
      {
        question: "What is the deadline to file a lawsuit?",
        answer: "Statutes of limitations vary by state, typically 2-3 years from the date of the incident. Some states have shorter deadlines. Don't wait - file your lawsuit promptly to preserve your rights."
      }
    ]
  },
  "/foia-request-form": {
    name: "FOIA Request FAQ",
    description: "Frequently asked questions about requesting police records through Freedom of Information Act requests.",
    faqs: [
      {
        question: "What is a FOIA request?",
        answer: "A Freedom of Information Act (FOIA) request is a legal demand for government records. You can request police body camera footage, incident reports, arrest records, use of force reports, and other police documents."
      },
      {
        question: "How do I request police body camera footage?",
        answer: "Use Bad Blue's FOIA Request Generator. Enter the incident date, location, and officers involved. We automatically identify the correct agency, apply state-specific rules, and generate a compliant request. File from home."
      },
      {
        question: "How long does a FOIA request take?",
        answer: "Response times vary by agency and state law. Federal agencies have 20 business days. State and local agencies may have different deadlines. Agencies can request extensions for complex requests."
      },
      {
        question: "What records can I request?",
        answer: "You can request body camera footage, dash cam video, incident reports, arrest reports, use of force reports, internal affairs files, training records, policy documents, and other police records."
      },
      {
        question: "Are there fees for FOIA requests?",
        answer: "Agencies may charge search and copying fees. Many agencies waive fees for small requests. Bad Blue's request includes language requesting fee waivers when applicable."
      },
      {
        question: "What if my request is denied?",
        answer: "You have the right to appeal denials. Bad Blue can help you understand exemptions cited and prepare appeals. Some records may be partially redacted rather than fully denied."
      }
    ]
  },
  "/petitions": {
    name: "Police Accountability Petitions FAQ",
    description: "Frequently asked questions about creating and signing police accountability petitions.",
    faqs: [
      {
        question: "How do I create a police accountability petition?",
        answer: "Click 'Create Petition' and describe the officer, incident, and action you're demanding. Bad Blue helps you craft an effective petition that can be shared with your community and submitted to officials."
      },
      {
        question: "Who sees my petition?",
        answer: "Petitions can be shared publicly to gather community signatures. Once you have enough signatures, petitions are submitted to city councils, police chiefs, oversight boards, and relevant officials."
      },
      {
        question: "How many signatures do I need?",
        answer: "There's no minimum requirement, but more signatures demonstrate stronger community support. Some officials require minimum signatures for official consideration. Aim for as many as possible."
      },
      {
        question: "Can I sign petitions anonymously?",
        answer: "You can view petitions without signing in. To sign, you'll need to create an account. Your signature shows community support - named signatures carry more weight with officials."
      },
      {
        question: "What actions can petitions demand?",
        answer: "Petitions can demand officer discipline, termination, policy changes, independent investigations, body camera requirements, use of force policy reforms, or other accountability measures."
      }
    ]
  },
  "/evidence-hub": {
    name: "Evidence Hub FAQ",
    description: "Frequently asked questions about uploading and sharing police misconduct evidence.",
    faqs: [
      {
        question: "What evidence can I upload?",
        answer: "You can upload videos, photos, audio recordings, documents, medical records, witness statements, and other evidence of police misconduct. All file types are accepted."
      },
      {
        question: "Is my evidence secure?",
        answer: "Yes, all uploads are encrypted and stored securely. Your evidence is protected with bank-level security. Only you control who can access your evidence."
      },
      {
        question: "Can I share evidence with my attorney?",
        answer: "Yes, you can share evidence with attorneys, journalists, investigators, or anyone you choose. Generate secure sharing links with customizable access permissions."
      },
      {
        question: "How long is evidence stored?",
        answer: "Evidence is stored securely for as long as you need it. We recommend keeping evidence until any legal proceedings are complete. You can delete your uploads at any time."
      },
      {
        question: "Can evidence be used in court?",
        answer: "Evidence uploaded to Bad Blue maintains its integrity and can be used in legal proceedings. We preserve metadata and chain of custody information for evidentiary purposes."
      }
    ]
  },
  "/landing": {
    name: "Bad Blue Platform FAQ",
    description: "Frequently asked questions about the Bad Blue police accountability platform.",
    faqs: [
      {
        question: "What is Bad Blue?",
        answer: "Bad Blue is an AI-powered police accountability platform that helps citizens file complaints, generate Section 1983 lawsuits, submit FOIA requests, and search for officer records. Do everything from home - Bad Blue does all the work."
      },
      {
        question: "How much does Bad Blue cost?",
        answer: "Many features are free, including officer search and basic complaint filing. Premium features like lawsuit generation and advanced FOIA requests are available at affordable prices - a fraction of what lawyers charge."
      },
      {
        question: "Do I need legal experience?",
        answer: "No legal experience needed. Bad Blue guides you through every step and generates professional legal documents automatically. Our platform is designed for regular citizens, not lawyers."
      },
      {
        question: "Is Bad Blue available nationwide?",
        answer: "Yes, Bad Blue covers all 50 states. We have jurisdiction-specific rules for complaints, FOIA requests, and lawsuits. Our system automatically applies the correct requirements for your location."
      },
      {
        question: "How does the AI officer search work?",
        answer: "Bad Blue's AI searches multiple databases, public records, news sources, and court records to compile officer information. Enter a name, badge number, or department to find misconduct history and officer details."
      }
    ]
  }
};

export function getPageFaqs(path: string): PageFaqConfig | undefined {
  return PAGE_FAQ_CONFIG[path];
}
