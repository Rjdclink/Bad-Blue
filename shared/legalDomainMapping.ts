import type { LawType as ProductLawType } from './lawTypes';
import type { LawType as ExpertLawType } from './legalCounselTypes';

/**
 * LegalWhat exposes a broader/differently-named set of product domains than the
 * legacy expert-profile engine. Keep only mappings that are materially
 * equivalent; an unmapped product domain is safer than forcing the wrong legal
 * specialty onto a user's matter.
 */
export const PRODUCT_TO_EXPERT_LAW_TYPE: Partial<Record<ProductLawType, ExpertLawType>> = {
  'law-enforcement-accountability': 'law-enforcement-accountability',
  'criminal-law': 'criminal-law',
  'family-law': 'family-law',
  'juvenile-law': 'juvenile-law',
  'constitutional-law': 'constitutional-law',
  'property-law': 'real-estate-law',
  'real-estate-law': 'real-estate-law',
  'contract-law': 'contract-law',
  'civil-rights-law': 'civil-rights',
  'tort-law': 'tort-law',
  'probate-estate-law': 'estate-planning',
  'administrative-law': 'administrative-law',
  'trusts-law': 'estate-planning',
  'immigration-law': 'immigration-law',
  'employment-labor-law': 'employment-law',
  'military-veterans-law': 'military-law',
  'foia-open-records-law': 'administrative-law',
  'intellectual-property-law': 'intellectual-property',
  'public-housing-law': 'landlord-tenant',
  'securities-law': 'business-law',
  'tax-law': 'tax-law',
  'environmental-law': 'environmental-law',
  'municipal-government-law': 'administrative-law',
};

export function mapProductLawTypeToExpert(lawType?: string): ExpertLawType | undefined {
  if (!lawType) return undefined;
  const normalized = lawType.trim().toLowerCase().replace(/\s+/g, '-') as ProductLawType;
  return PRODUCT_TO_EXPERT_LAW_TYPE[normalized];
}
