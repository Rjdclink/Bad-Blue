/**
 * Law Types Constants - LegalWhat Platform
 * 
 * STAGE 1A: Created with 40 law types
 * STAGE 1B: Will be imported by WelcomePage component
 * STAGE 2: Will be used for media upload tagging
 * STAGE 3-4: Will be mapped to AI expertise
 * STAGE 5: Will be used for legal tools routing
 * 
 * DO NOT MODIFY without updating dependent stages
 */

// Array of all law type IDs (40 total)
export const LAW_TYPES = [
  'law-enforcement-accountability',
  'criminal-law',
  'civil-law',
  'family-law',
  'juvenile-law',
  'appellate-law',
  'constitutional-law',
  'property-law',
  'real-estate-law',
  'contract-law',
  'civil-rights-law',
  'tort-law',
  'probate-estate-law',
  'administrative-law',
  'trusts-law',
  'immigration-law',
  'banking-financing-law',
  'insurance-law',
  'employment-labor-law',
  'military-veterans-law',
  'foia-open-records-law',
  'cyber-technology-law',
  'intellectual-property-law',
  'public-housing-law',
  'procedural-law',
  'post-conviction-law',
  'securities-law',
  'international-law',
  'tax-law',
  'environmental-law',
  'municipal-government-law',
  'agricultural-law',
  'banking-consumer-credit-debt-law',
  'bankruptcy-law',
  'business-corporate-law',
  'disability-law',
  'education-law',
  'health-medical-law',
  'landlord-tenant-law',
  'personal-injury-medical-malpractice-law',
] as const;

// TypeScript type for law types
export type LawType = typeof LAW_TYPES[number];

// Interface for law type display information
export interface LawTypeInfo {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  route: string; // Where to navigate when selected
  featured?: boolean; // Only Law Enforcement is featured
  color: 'red' | 'blue'; // Red for featured, blue for others
}

// Full law type data (used by Welcome page in Stage 1B)
export const LAW_TYPE_DATA: LawTypeInfo[] = [
  {
    id: 'law-enforcement-accountability',
    name: 'Law Enforcement Accountability',
    description: 'Police misconduct, excessive force, wrongful arrest, civil rights violations',
    icon: 'Shield',
    route: '/lexara-consent/law-enforcement-accountability',
    featured: true,
    color: 'red',
  },
  {
    id: 'criminal-law',
    name: 'Criminal Law',
    description: 'Charges, defense, appeals, expungements, criminal records',
    icon: 'Gavel',
    route: '/legal-tools?type=criminal-law',
    color: 'blue',
  },
  {
    id: 'civil-law',
    name: 'Civil Law',
    description: 'Disputes between individuals, damages, liability, negligence',
    icon: 'Scale',
    route: '/legal-tools?type=civil-law',
    color: 'blue',
  },
  {
    id: 'family-law',
    name: 'Family Law',
    description: 'Divorce, custody, adoption, child support, domestic issues',
    icon: 'Users',
    route: '/legal-tools?type=family-law',
    color: 'blue',
  },
  {
    id: 'juvenile-law',
    name: 'Juvenile Law',
    description: 'Minors in legal system, juvenile court, delinquency, guardianship',
    icon: 'Baby',
    route: '/legal-tools?type=juvenile-law',
    color: 'blue',
  },
  {
    id: 'appellate-law',
    name: 'Appellate Law',
    description: 'Appeals, higher court review, challenging verdicts',
    icon: 'TrendingUp',
    route: '/legal-tools?type=appellate-law',
    color: 'blue',
  },
  {
    id: 'constitutional-law',
    name: 'Constitutional Law',
    description: 'Rights violations, First Amendment, constitutional challenges',
    icon: 'BookOpen',
    route: '/legal-tools?type=constitutional-law',
    color: 'blue',
  },
  {
    id: 'property-law',
    name: 'Property Law',
    description: 'Ownership, boundaries, easements, property rights',
    icon: 'Home',
    route: '/legal-tools?type=property-law',
    color: 'blue',
  },
  {
    id: 'real-estate-law',
    name: 'Real Estate Law',
    description: 'Buying, selling, leasing, title issues, closings',
    icon: 'Building',
    route: '/legal-tools?type=real-estate-law',
    color: 'blue',
  },
  {
    id: 'contract-law',
    name: 'Contract Law',
    description: 'Agreements, breaches, negotiations, enforcement',
    icon: 'FileText',
    route: '/legal-tools?type=contract-law',
    color: 'blue',
  },
  {
    id: 'civil-rights-law',
    name: 'Civil Rights Law',
    description: 'Discrimination, equal protection, constitutional rights',
    icon: 'Flag',
    route: '/legal-tools?type=civil-rights-law',
    color: 'blue',
  },
  {
    id: 'tort-law',
    name: 'Tort Law',
    description: 'Personal injury, negligence, liability, damages',
    icon: 'AlertCircle',
    route: '/legal-tools?type=tort-law',
    color: 'blue',
  },
  {
    id: 'probate-estate-law',
    name: 'Probate and Estate Law',
    description: 'Wills, estates, inheritance, probate court',
    icon: 'Briefcase',
    route: '/legal-tools?type=probate-estate-law',
    color: 'blue',
  },
  {
    id: 'administrative-law',
    name: 'Administrative Law',
    description: 'Government agencies, regulations, permits, licenses',
    icon: 'Clipboard',
    route: '/legal-tools?type=administrative-law',
    color: 'blue',
  },
  {
    id: 'trusts-law',
    name: 'Trusts Law',
    description: 'Trust creation, management, fiduciary duties',
    icon: 'Lock',
    route: '/legal-tools?type=trusts-law',
    color: 'blue',
  },
  {
    id: 'immigration-law',
    name: 'Immigration Law',
    description: 'Visas, citizenship, deportation, asylum',
    icon: 'Globe',
    route: '/legal-tools?type=immigration-law',
    color: 'blue',
  },
  {
    id: 'banking-financing-law',
    name: 'Banking and Financing Law',
    description: 'Loans, mortgages, foreclosure, banking disputes',
    icon: 'DollarSign',
    route: '/legal-tools?type=banking-financing-law',
    color: 'blue',
  },
  {
    id: 'insurance-law',
    name: 'Insurance Law',
    description: 'Claims, denials, coverage disputes, bad faith',
    icon: 'Umbrella',
    route: '/legal-tools?type=insurance-law',
    color: 'blue',
  },
  {
    id: 'employment-labor-law',
    name: 'Employment and Labor Law',
    description: 'Wrongful termination, discrimination, wage disputes',
    icon: 'UserCog',
    route: '/legal-tools?type=employment-labor-law',
    color: 'blue',
  },
  {
    id: 'military-veterans-law',
    name: 'Military/Veterans Law',
    description: 'VA benefits, discharge upgrades, service-related claims',
    icon: 'Award',
    route: '/legal-tools?type=military-veterans-law',
    color: 'blue',
  },
  {
    id: 'foia-open-records-law',
    name: 'FOIA/Open Records Law',
    description: 'Public records requests, government transparency',
    icon: 'Eye',
    route: '/legal-tools?type=foia-open-records-law',
    color: 'blue',
  },
  {
    id: 'cyber-technology-law',
    name: 'Cyber Technology Law',
    description: 'Data breaches, privacy, cybersecurity, tech disputes',
    icon: 'Cpu',
    route: '/legal-tools?type=cyber-technology-law',
    color: 'blue',
  },
  {
    id: 'intellectual-property-law',
    name: 'Intellectual Property Law',
    description: 'Patents, trademarks, copyrights, trade secrets',
    icon: 'Lightbulb',
    route: '/legal-tools?type=intellectual-property-law',
    color: 'blue',
  },
  {
    id: 'public-housing-law',
    name: 'Public Housing Law',
    description: 'Section 8, housing authority, tenant rights',
    icon: 'Building2',
    route: '/legal-tools?type=public-housing-law',
    color: 'blue',
  },
  {
    id: 'procedural-law',
    name: 'Procedural Law',
    description: 'Court procedures, filings, motions, legal process',
    icon: 'FileStack',
    route: '/legal-tools?type=procedural-law',
    color: 'blue',
  },
  {
    id: 'post-conviction-law',
    name: 'Post Conviction',
    description: 'State post-conviction relief, federal habeas, ineffective assistance, newly discovered evidence',
    icon: 'BookCheck',
    route: '/legal-tools?type=post-conviction-law',
    color: 'blue',
  },
  {
    id: 'securities-law',
    name: 'Securities Law',
    description: 'Stock fraud, investments, SEC regulations',
    icon: 'LineChart',
    route: '/legal-tools?type=securities-law',
    color: 'blue',
  },
  {
    id: 'international-law',
    name: 'International Law',
    description: 'Cross-border disputes, treaties, international transactions',
    icon: 'Globe2',
    route: '/legal-tools?type=international-law',
    color: 'blue',
  },
  {
    id: 'tax-law',
    name: 'Tax Law',
    description: 'IRS disputes, tax liens, audits, tax planning',
    icon: 'Receipt',
    route: '/legal-tools?type=tax-law',
    color: 'blue',
  },
  {
    id: 'environmental-law',
    name: 'Environmental Law',
    description: 'EPA regulations, pollution, environmental compliance',
    icon: 'Leaf',
    route: '/legal-tools?type=environmental-law',
    color: 'blue',
  },
  {
    id: 'municipal-government-law',
    name: 'Municipal/Government Law',
    description: 'Local government, zoning, permits, municipal codes',
    icon: 'Landmark',
    route: '/legal-tools?type=municipal-government-law',
    color: 'blue',
  },
  {
    id: 'agricultural-law',
    name: 'Agricultural Law',
    description: 'Farming, agricultural contracts, USDA programs, land use, and agricultural regulation',
    icon: 'Wheat',
    route: '/legal-tools?type=agricultural-law',
    color: 'blue',
  },
  {
    id: 'banking-consumer-credit-debt-law',
    name: 'Banking/Consumer Credit and Debt Law',
    description: 'Consumer lending, credit reporting, debt collection, banking disputes, and debtor rights',
    icon: 'CreditCard',
    route: '/legal-tools?type=banking-consumer-credit-debt-law',
    color: 'blue',
  },
  {
    id: 'bankruptcy-law',
    name: 'Bankruptcy Law',
    description: 'Chapter 7, 11, and 13 cases, automatic stay, discharge, exemptions, and creditor issues',
    icon: 'Landmark',
    route: '/legal-tools?type=bankruptcy-law',
    color: 'blue',
  },
  {
    id: 'business-corporate-law',
    name: 'Business/Corporate Law',
    description: 'Business formation, corporations, LLCs, governance, fiduciary duties, and ownership disputes',
    icon: 'Building2',
    route: '/legal-tools?type=business-corporate-law',
    color: 'blue',
  },
  {
    id: 'disability-law',
    name: 'Disability Law',
    description: 'ADA rights, accessibility, accommodations, disability discrimination, and benefits-related issues',
    icon: 'Accessibility',
    route: '/legal-tools?type=disability-law',
    color: 'blue',
  },
  {
    id: 'education-law',
    name: 'Education Law',
    description: 'Student rights, school discipline, special education, Title IX, and education disputes',
    icon: 'GraduationCap',
    route: '/legal-tools?type=education-law',
    color: 'blue',
  },
  {
    id: 'health-medical-law',
    name: 'Health/Medical Law',
    description: 'Patient rights, healthcare regulation, privacy, billing, provider disputes, and medical legal issues',
    icon: 'HeartPulse',
    route: '/legal-tools?type=health-medical-law',
    color: 'blue',
  },
  {
    id: 'landlord-tenant-law',
    name: 'Landlord-Tenant Law',
    description: 'Leases, eviction, deposits, habitability, rent disputes, and landlord-tenant rights',
    icon: 'KeyRound',
    route: '/legal-tools?type=landlord-tenant-law',
    color: 'blue',
  },
  {
    id: 'personal-injury-medical-malpractice-law',
    name: 'Personal Injury/Medical Malpractice Law',
    description: 'Injury claims, negligence, medical malpractice, causation, damages, and liability',
    icon: 'Stethoscope',
    route: '/legal-tools?type=personal-injury-medical-malpractice-law',
    color: 'blue',
  },
];

/**
 * Helper function to get law type by ID
 * Used in Stage 1B, 1C, and later stages
 */
export function getLawTypeById(id: string): LawTypeInfo | undefined {
  return LAW_TYPE_DATA.find(type => type.id === id);
}

/**
 * Helper function to check if law type is valid
 * Used for validation in Stage 2+
 */
export function isValidLawType(id: string): boolean {
  return LAW_TYPES.includes(id as LawType);
}
