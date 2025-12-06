import { unifiedSearch, searchLegalStatutes } from './webSearchService';
import { sendEmail } from './emailService';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { performEnhancedLegalSearch, type LegalSearchResult } from './enhancedLegalSearch';
import { 
  emailDiscoveryService,
  type FOIAContact,
  semanticLegalExtractor,
  contentFilter,
  markdownConverter
} from './services/legalIntelligence';

const ADMIN_FALLBACK_EMAIL = 'contact.badblue@gmail.com';

export interface FOIAAuthority {
  name: string;
  title: string;
  email?: string;
  phone?: string;
  address?: string;
  department?: string;
  type: 'foia_officer' | 'records_custodian' | 'transparency_office' | 'public_info_officer' | 'general_contact';
  verified: boolean;
  source?: string;
}

export interface FOIAAuthorityLookupResult {
  primaryAuthority?: FOIAAuthority;
  alternateAuthorities: FOIAAuthority[];
  agencyInfo: {
    name: string;
    type: string;
    state: string;
    city?: string;
    county?: string;
    website?: string;
  };
  foiaPortal?: string;
  onlineSubmissionUrl?: string;
  fallbackRequired: boolean;
  lookupNotes: string[];
}

export interface FOIAData {
  agencyName: string;
  agencyType: 'police' | 'sheriff' | 'state_agency' | 'federal_agency' | 'city_government' | 'county_government' | 'other';
  state: string;
  city?: string;
  county?: string;
  officerName?: string;
  recordsDescription: string;
  incidentDate?: Date;
  incidentLocation?: string;
  requesterName: string;
  requesterEmail: string;
  requesterAddress: string;
  requesterPhone?: string;
}

export interface GeneratedFOIA {
  document: string;
  authority: FOIAAuthorityLookupResult;
  stateStatute: string;
  statutoryDeadline: string;
  submissionMethod: 'email' | 'portal' | 'mail' | 'fax';
  submissionAddress: string;
}

export interface FOIARoutingResult {
  success: boolean;
  method: 'direct_email' | 'portal_link' | 'admin_fallback';
  recipientInfo: {
    name: string;
    email?: string;
    type: string;
  };
  confirmationId?: string;
  message: string;
  nextSteps: string[];
}

const STATE_FOIA_INFO: Record<string, { 
  statute: string; 
  deadline: string; 
  name: string;
  exemptionReference: string;
}> = {
  'AL': { statute: 'Ala. Code § 36-12-40', deadline: '10 business days', name: 'Alabama Open Records Act', exemptionReference: 'Ala. Code § 36-12-40' },
  'AK': { statute: 'Alaska Stat. § 40.25.110-.220', deadline: '10 working days', name: 'Alaska Public Records Act', exemptionReference: 'AS 40.25.120' },
  'AZ': { statute: 'Ariz. Rev. Stat. § 39-121', deadline: 'promptly', name: 'Arizona Public Records Law', exemptionReference: 'A.R.S. § 39-121.01' },
  'AR': { statute: 'Ark. Code Ann. § 25-19-101', deadline: '3 working days', name: 'Arkansas Freedom of Information Act', exemptionReference: 'Ark. Code Ann. § 25-19-105' },
  'CA': { statute: 'Cal. Gov\'t Code § 6250-6270', deadline: '10 days', name: 'California Public Records Act', exemptionReference: 'Cal. Gov\'t Code § 6254' },
  'CO': { statute: 'Colo. Rev. Stat. § 24-72-201', deadline: '3 working days', name: 'Colorado Open Records Act', exemptionReference: 'C.R.S. § 24-72-204' },
  'CT': { statute: 'Conn. Gen. Stat. § 1-200', deadline: '4 business days', name: 'Connecticut Freedom of Information Act', exemptionReference: 'C.G.S. § 1-210(b)' },
  'DE': { statute: '29 Del. C. § 10001', deadline: '15 business days', name: 'Delaware Freedom of Information Act', exemptionReference: '29 Del. C. § 10002' },
  'FL': { statute: 'Fla. Stat. § 119.01-.15', deadline: 'reasonable time', name: 'Florida Public Records Act', exemptionReference: 'Fla. Stat. § 119.071' },
  'GA': { statute: 'O.C.G.A. § 50-18-70', deadline: '3 business days', name: 'Georgia Open Records Act', exemptionReference: 'O.C.G.A. § 50-18-72' },
  'HI': { statute: 'Haw. Rev. Stat. § 92F-1', deadline: '10 working days', name: 'Hawaii Uniform Information Practices Act', exemptionReference: 'HRS § 92F-13' },
  'ID': { statute: 'Idaho Code § 74-101', deadline: '3 working days', name: 'Idaho Public Records Act', exemptionReference: 'Idaho Code § 74-105' },
  'IL': { statute: '5 ILCS 140/1', deadline: '5 working days', name: 'Illinois Freedom of Information Act', exemptionReference: '5 ILCS 140/7' },
  'IN': { statute: 'Ind. Code § 5-14-3-1', deadline: '7 calendar days', name: 'Indiana Access to Public Records Act', exemptionReference: 'IC 5-14-3-4' },
  'IA': { statute: 'Iowa Code § 22.1-.14', deadline: '10 business days', name: 'Iowa Open Records Act', exemptionReference: 'Iowa Code § 22.7' },
  'KS': { statute: 'K.S.A. § 45-215', deadline: '3 business days', name: 'Kansas Open Records Act', exemptionReference: 'K.S.A. § 45-221' },
  'KY': { statute: 'KRS § 61.870-.884', deadline: '5 business days', name: 'Kentucky Open Records Act', exemptionReference: 'KRS § 61.878' },
  'LA': { statute: 'La. R.S. 44:1-41', deadline: '3 business days', name: 'Louisiana Public Records Act', exemptionReference: 'La. R.S. 44:4' },
  'ME': { statute: '1 M.R.S.A. § 400-414', deadline: '5 working days', name: 'Maine Freedom of Access Act', exemptionReference: '1 M.R.S.A. § 402(3)' },
  'MD': { statute: 'Md. Code, Gen. Prov. § 4-101', deadline: '30 days', name: 'Maryland Public Information Act', exemptionReference: 'GP § 4-301' },
  'MA': { statute: 'M.G.L. c. 66 § 10', deadline: '10 business days', name: 'Massachusetts Public Records Law', exemptionReference: 'M.G.L. c. 4 § 7(26)' },
  'MI': { statute: 'MCL § 15.231-.246', deadline: '5 business days', name: 'Michigan Freedom of Information Act', exemptionReference: 'MCL § 15.243' },
  'MN': { statute: 'Minn. Stat. § 13.01-.90', deadline: 'reasonable time', name: 'Minnesota Government Data Practices Act', exemptionReference: 'Minn. Stat. § 13.02' },
  'MS': { statute: 'Miss. Code Ann. § 25-61-1', deadline: '7 working days', name: 'Mississippi Public Records Act', exemptionReference: 'Miss. Code Ann. § 25-61-11' },
  'MO': { statute: 'RSMo § 610.010-.035', deadline: '3 business days', name: 'Missouri Sunshine Law', exemptionReference: 'RSMo § 610.021' },
  'MT': { statute: 'Mont. Code Ann. § 2-6-1001', deadline: 'reasonable time', name: 'Montana Constitution Art. II § 9', exemptionReference: 'MCA § 2-6-102' },
  'NE': { statute: 'Neb. Rev. Stat. § 84-712', deadline: '4 business days', name: 'Nebraska Public Records Act', exemptionReference: 'Neb. Rev. Stat. § 84-712.05' },
  'NV': { statute: 'NRS § 239.001-.030', deadline: '5 business days', name: 'Nevada Public Records Act', exemptionReference: 'NRS § 239.010' },
  'NH': { statute: 'RSA § 91-A:1-8', deadline: '5 business days', name: 'New Hampshire Right-to-Know Law', exemptionReference: 'RSA § 91-A:5' },
  'NJ': { statute: 'N.J.S.A. 47:1A-1', deadline: '7 business days', name: 'New Jersey Open Public Records Act', exemptionReference: 'N.J.S.A. 47:1A-1.1' },
  'NM': { statute: 'NMSA § 14-2-1', deadline: '15 days', name: 'New Mexico Inspection of Public Records Act', exemptionReference: 'NMSA § 14-2-1(A)' },
  'NY': { statute: 'N.Y. Pub. Off. Law § 84-90', deadline: '5 business days', name: 'New York Freedom of Information Law', exemptionReference: 'Pub. Off. Law § 87(2)' },
  'NC': { statute: 'N.C.G.S. § 132-1', deadline: 'reasonable time', name: 'North Carolina Public Records Act', exemptionReference: 'N.C.G.S. § 132-1.1' },
  'ND': { statute: 'N.D.C.C. § 44-04-18', deadline: 'reasonable time', name: 'North Dakota Open Records Law', exemptionReference: 'N.D.C.C. § 44-04-18.1' },
  'OH': { statute: 'ORC § 149.43', deadline: 'reasonable time', name: 'Ohio Public Records Act', exemptionReference: 'ORC § 149.43(A)(1)' },
  'OK': { statute: '51 O.S. § 24A.1-.29', deadline: 'promptly', name: 'Oklahoma Open Records Act', exemptionReference: '51 O.S. § 24A.5' },
  'OR': { statute: 'ORS § 192.311-.478', deadline: '5 business days', name: 'Oregon Public Records Law', exemptionReference: 'ORS § 192.345' },
  'PA': { statute: '65 P.S. § 67.101', deadline: '5 business days', name: 'Pennsylvania Right-to-Know Law', exemptionReference: '65 P.S. § 67.708' },
  'RI': { statute: 'R.I. Gen. Laws § 38-2-1', deadline: '10 business days', name: 'Rhode Island Access to Public Records Act', exemptionReference: 'R.I. Gen. Laws § 38-2-2' },
  'SC': { statute: 'S.C. Code Ann. § 30-4-10', deadline: '15 business days', name: 'South Carolina Freedom of Information Act', exemptionReference: 'S.C. Code Ann. § 30-4-40' },
  'SD': { statute: 'SDCL § 1-27-1', deadline: 'reasonable time', name: 'South Dakota Open Records Law', exemptionReference: 'SDCL § 1-27-1.5' },
  'TN': { statute: 'Tenn. Code Ann. § 10-7-503', deadline: '7 business days', name: 'Tennessee Public Records Act', exemptionReference: 'Tenn. Code Ann. § 10-7-504' },
  'TX': { statute: 'Tex. Gov\'t Code Ch. 552', deadline: '10 business days', name: 'Texas Public Information Act', exemptionReference: 'Tex. Gov\'t Code § 552.101' },
  'UT': { statute: 'Utah Code § 63G-2-101', deadline: '10 business days', name: 'Utah Government Records Access and Management Act', exemptionReference: 'Utah Code § 63G-2-302' },
  'VT': { statute: '1 V.S.A. § 315-320', deadline: '3 business days', name: 'Vermont Access to Public Records Law', exemptionReference: '1 V.S.A. § 317' },
  'VA': { statute: 'Va. Code § 2.2-3700', deadline: '5 working days', name: 'Virginia Freedom of Information Act', exemptionReference: 'Va. Code § 2.2-3705.1' },
  'WA': { statute: 'RCW § 42.56.001-.904', deadline: '5 business days', name: 'Washington Public Records Act', exemptionReference: 'RCW § 42.56.210' },
  'WV': { statute: 'W. Va. Code § 29B-1-1', deadline: '5 days', name: 'West Virginia Freedom of Information Act', exemptionReference: 'W. Va. Code § 29B-1-4' },
  'WI': { statute: 'Wis. Stat. § 19.31-.39', deadline: '10 business days', name: 'Wisconsin Public Records Law', exemptionReference: 'Wis. Stat. § 19.36' },
  'WY': { statute: 'Wyo. Stat. § 16-4-201-.205', deadline: 'reasonable time', name: 'Wyoming Public Records Act', exemptionReference: 'Wyo. Stat. § 16-4-203' },
  'DC': { statute: 'D.C. Code § 2-531', deadline: '15 business days', name: 'District of Columbia Freedom of Information Act', exemptionReference: 'D.C. Code § 2-534' },
};

/**
 * Scrape FOIA portal for contact information and submission details
 * Uses semantic extraction for structured data
 */
export async function scrapeFOIAPortal(url: string): Promise<{
  contactInfo?: FOIAAuthority;
  submissionUrl?: string;
  instructions?: string;
} | null> {
  try {
    console.log('[FOIA] Scraping FOIA portal:', url);
    
    // Retrieve and filter content
    const shadowRetrieval = await import('./services/shadowRetrieval');
    const engine = new shadowRetrieval.ShadowRetrievalEngine({ enabled: true });
    
    const result = await engine.smartRetrieve(url, {
      waitForContent: true,
      extractLinks: true,
    });

    if (!result.success || !result.html) {
      console.warn('[FOIA] Failed to retrieve portal:', result.error);
      return null;
    }

    // Filter and convert content
    const filteredHtml = await contentFilter.filterContent(result.html);
    const markdown = markdownConverter.convert(filteredHtml);

    // Extract contact information using pattern matching
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    const phonePattern = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    
    const emails = markdown.match(emailPattern) || [];
    const phones = markdown.match(phonePattern) || [];

    // Look for FOIA-specific terms
    const foiaOfficerMatch = markdown.match(/(?:FOIA|Public Records|Transparency)\s+(?:Officer|Coordinator|Contact)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
    
    if (emails.length > 0 || foiaOfficerMatch) {
      const contactInfo: FOIAAuthority = {
        name: foiaOfficerMatch?.[1] || 'FOIA Officer',
        title: 'FOIA Officer',
        email: emails[0],
        phone: phones[0],
        type: 'foia_officer',
        verified: false,
        source: url,
      };

      // Extract submission URL from links
      const submissionUrl = result.links?.find(link => 
        link.toLowerCase().includes('submit') || 
        link.toLowerCase().includes('request') ||
        link.toLowerCase().includes('portal')
      );

      return {
        contactInfo,
        submissionUrl,
        instructions: markdown.substring(0, 500), // First 500 chars as instructions
      };
    }

    return null;
  } catch (error: any) {
    console.error('[FOIA] Error scraping portal:', error);
    return null;
  }
}

export async function lookupFOIAAuthority(
  agencyName: string,
  agencyType: string,
  state: string,
  city?: string,
  county?: string
): Promise<FOIAAuthorityLookupResult> {
  const lookupNotes: string[] = [];
  const alternateAuthorities: FOIAAuthority[] = [];
  let primaryAuthority: FOIAAuthority | undefined;
  let foiaPortal: string | undefined;
  let onlineSubmissionUrl: string | undefined;

  try {
    const cachedResult = await checkFOIAAuthorityCache(agencyName, state);
    if (cachedResult) {
      lookupNotes.push('Retrieved from cache');
      return cachedResult;
    }

    const searchQueries = [
      `${agencyName} FOIA officer records request email ${state}`,
      `${agencyName} public records request transparency office ${city || ''} ${state}`,
      `${agencyName} records custodian public information officer contact`,
    ];

    if (agencyType === 'police' || agencyType === 'sheriff') {
      searchQueries.push(`${agencyName} police records division FOIA request ${state}`);
    }

    for (const query of searchQueries) {
      try {
        const searchResults = await unifiedSearch(query, { 
          limit: 5, 
          useBing: true,
        });

        for (const result of searchResults) {
          const authority = extractFOIAAuthorityFromResult(result, agencyName);
          if (authority) {
            if (authority.type === 'foia_officer' || authority.type === 'records_custodian') {
              if (!primaryAuthority) {
                primaryAuthority = authority;
                lookupNotes.push(`Found FOIA officer from: ${result.url}`);
              }
            } else {
              alternateAuthorities.push(authority);
            }
          }

          if (result.url && (
            result.url.includes('foia') || 
            result.url.includes('records') || 
            result.url.includes('transparency')
          )) {
            if (!foiaPortal) {
              foiaPortal = result.url;
              lookupNotes.push(`Found FOIA portal: ${result.url}`);
            }
          }

          if (result.snippet) {
            const portalMatch = result.snippet.match(/submit.*online.*(?:at|through)\s+(https?:\/\/[^\s]+)/i);
            if (portalMatch && !onlineSubmissionUrl) {
              onlineSubmissionUrl = portalMatch[1];
            }
          }
        }

        if (primaryAuthority) break;
      } catch (searchError) {
        console.log(`[FOIA Lookup] Search query failed: ${query}`, searchError);
      }
    }

    if (!primaryAuthority && agencyType === 'police') {
      primaryAuthority = {
        name: 'Records Division',
        title: 'Records Custodian',
        department: agencyName,
        type: 'records_custodian',
        verified: false,
        address: `${agencyName}\nRecords Division\n${city ? city + ', ' : ''}${state}`,
      };
      lookupNotes.push('Using standard police records division address');
    }

    // Enhanced: Use email discovery service to find FOIA officer emails
    if (!primaryAuthority?.email) {
      try {
        // Extract domain from agency name if possible
        const agencyDomain = foiaPortal ? new URL(foiaPortal).hostname : undefined;
        
        const discoveredContacts = await emailDiscoveryService.discoverFOIAOfficerEmails(
          agencyName,
          agencyDomain
        );

        if (discoveredContacts.length > 0) {
          const topContact = discoveredContacts[0];
          
          if (primaryAuthority) {
            // Enhance existing primary authority with discovered email
            primaryAuthority.email = topContact.email;
            primaryAuthority.verified = true;
            lookupNotes.push(`Enhanced with email discovery: ${topContact.email} (confidence: ${topContact.confidence}%)`);
          } else {
            // Create new primary authority from discovered contact
            primaryAuthority = {
              name: topContact.name || 'FOIA Officer',
              title: 'FOIA Officer',
              email: topContact.email,
              phone: topContact.phone,
              department: topContact.department,
              type: 'foia_officer',
              verified: true,
              source: `Email Discovery (${topContact.sources.join(', ')})`,
            };
            lookupNotes.push(`Found via email discovery: ${topContact.email} (confidence: ${topContact.confidence}%)`);
          }

          // Add additional discovered contacts as alternates
          for (let i = 1; i < Math.min(discoveredContacts.length, 4); i++) {
            const contact = discoveredContacts[i];
            alternateAuthorities.push({
              name: contact.name || 'Records Contact',
              title: 'Records Contact',
              email: contact.email,
              phone: contact.phone,
              department: contact.department,
              type: 'general_contact',
              verified: true,
              source: `Email Discovery (${contact.sources.join(', ')})`,
            });
          }
        }
      } catch (emailDiscoveryError) {
        console.error('[FOIA Lookup] Email discovery failed:', emailDiscoveryError);
        lookupNotes.push('Email discovery unavailable - using standard lookup only');
      }
    }

    const result: FOIAAuthorityLookupResult = {
      primaryAuthority,
      alternateAuthorities,
      agencyInfo: {
        name: agencyName,
        type: agencyType,
        state,
        city,
        county,
        website: foiaPortal,
      },
      foiaPortal,
      onlineSubmissionUrl,
      fallbackRequired: !primaryAuthority?.email && !onlineSubmissionUrl,
      lookupNotes,
    };

    await cacheFOIAAuthority(result);

    return result;
  } catch (error) {
    console.error('[FOIA Lookup] Error:', error);
    return {
      alternateAuthorities: [],
      agencyInfo: {
        name: agencyName,
        type: agencyType,
        state,
        city,
        county,
      },
      fallbackRequired: true,
      lookupNotes: ['Lookup failed - will route to admin for manual processing'],
    };
  }
}

function extractFOIAAuthorityFromResult(result: any, agencyName: string): FOIAAuthority | null {
  const snippet = result.snippet || '';
  const title = result.title || '';
  const combined = `${title} ${snippet}`.toLowerCase();

  if (!combined.includes('foia') && 
      !combined.includes('records') && 
      !combined.includes('public information') &&
      !combined.includes('transparency')) {
    return null;
  }

  const emailMatch = snippet.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  const phoneMatch = snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);

  let authorityType: FOIAAuthority['type'] = 'general_contact';
  
  if (combined.includes('foia officer') || combined.includes('foia coordinator')) {
    authorityType = 'foia_officer';
  } else if (combined.includes('records custodian') || combined.includes('records manager')) {
    authorityType = 'records_custodian';
  } else if (combined.includes('transparency') || combined.includes('open government')) {
    authorityType = 'transparency_office';
  } else if (combined.includes('public information officer') || combined.includes('pio')) {
    authorityType = 'public_info_officer';
  }

  const nameMatch = snippet.match(/(?:contact|reach|email)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  
  return {
    name: nameMatch ? nameMatch[1] : 'FOIA/Records Office',
    title: authorityType === 'foia_officer' ? 'FOIA Officer' : 
           authorityType === 'records_custodian' ? 'Records Custodian' :
           authorityType === 'transparency_office' ? 'Transparency Office' :
           authorityType === 'public_info_officer' ? 'Public Information Officer' : 'Records Contact',
    email: emailMatch ? emailMatch[0] : undefined,
    phone: phoneMatch ? phoneMatch[0] : undefined,
    department: agencyName,
    type: authorityType,
    verified: !!emailMatch,
    source: result.url,
  };
}

export function generateEnhancedFOIARequest(data: FOIAData): GeneratedFOIA {
  const stateInfo = STATE_FOIA_INFO[data.state.toUpperCase()] || {
    statute: `${data.state} Open Records Act`,
    deadline: 'statutory deadline',
    name: 'State Public Records Law',
    exemptionReference: 'applicable exemptions',
  };

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const document = `
═══════════════════════════════════════════════════════════════════════════════
                         PUBLIC RECORDS REQUEST
                    Under ${stateInfo.name}
                         ${stateInfo.statute}
═══════════════════════════════════════════════════════════════════════════════

Date: ${today}

TO:     ${data.agencyName}
        FOIA Officer / Records Custodian
        ${data.city ? data.city + ', ' : ''}${data.state}

FROM:   ${data.requesterName}
        ${data.requesterAddress}
        ${data.requesterEmail}
        ${data.requesterPhone || ''}

RE:     PUBLIC RECORDS REQUEST - ${stateInfo.statute}

═══════════════════════════════════════════════════════════════════════════════

Dear FOIA Officer or Records Custodian:

Pursuant to ${stateInfo.statute} (${stateInfo.name}), I am requesting access to 
and copies of the following public records:

───────────────────────────────────────────────────────────────────────────────
                           RECORDS REQUESTED
───────────────────────────────────────────────────────────────────────────────

${data.recordsDescription}

${data.officerName ? `
───────────────────────────────────────────────────────────────────────────────
                         OFFICER INFORMATION
───────────────────────────────────────────────────────────────────────────────

Officer Name: ${data.officerName}
Department: ${data.agencyName}
${data.incidentDate ? `Incident Date: ${data.incidentDate.toLocaleDateString()}` : ''}
${data.incidentLocation ? `Incident Location: ${data.incidentLocation}` : ''}

Specifically regarding this officer, I am requesting:
• All complaints filed against the named officer
• Use of force reports involving the named officer
• Disciplinary records for the named officer
• Training and certification records
• Body camera footage from any relevant incidents
• Incident reports and associated documentation
` : ''}

───────────────────────────────────────────────────────────────────────────────
                          FORMAT PREFERENCE
───────────────────────────────────────────────────────────────────────────────

I prefer to receive the requested records in electronic format via email at:
${data.requesterEmail}

If electronic delivery is not available, please send physical copies to:
${data.requesterName}
${data.requesterAddress}

───────────────────────────────────────────────────────────────────────────────
                        FEE WAIVER REQUEST
───────────────────────────────────────────────────────────────────────────────

I request a waiver of all fees associated with this request. The disclosure of 
the requested information is in the public interest and will contribute 
significantly to public understanding of government operations and police 
accountability. This request is not for commercial purposes.

If fees cannot be waived, please provide an estimate before proceeding if costs 
will exceed $25.00.

───────────────────────────────────────────────────────────────────────────────
                         LEGAL REQUIREMENTS
───────────────────────────────────────────────────────────────────────────────

Pursuant to ${stateInfo.statute}, you are required to respond to this request 
within ${stateInfo.deadline}.

If my request is denied in whole or part, I ask that you justify all denials or 
redactions by specific reference to the exemptions under ${stateInfo.exemptionReference}. 
I also request that you release all segregable portions of any otherwise exempt 
records.

I reserve my right to appeal any denial of this request.

───────────────────────────────────────────────────────────────────────────────
                           SIGNATURE
───────────────────────────────────────────────────────────────────────────────

Sincerely,

${data.requesterName}
${data.requesterEmail}
${data.requesterPhone || ''}
${data.requesterAddress}

Date: ${today}

═══════════════════════════════════════════════════════════════════════════════
                        IMPORTANT NOTICES
═══════════════════════════════════════════════════════════════════════════════

This request is submitted under the ${stateInfo.name} (${stateInfo.statute}).

Response Deadline: ${stateInfo.deadline}

If you have questions about this request, please contact the requester at the 
email address provided above.

═══════════════════════════════════════════════════════════════════════════════
`.trim();

  return {
    document,
    authority: {
      alternateAuthorities: [],
      agencyInfo: {
        name: data.agencyName,
        type: data.agencyType,
        state: data.state,
        city: data.city,
        county: data.county,
      },
      fallbackRequired: true,
      lookupNotes: [],
    },
    stateStatute: stateInfo.statute,
    statutoryDeadline: stateInfo.deadline,
    submissionMethod: 'email',
    submissionAddress: `${data.agencyName} - Records Division`,
  };
}

export async function routeFOIARequest(
  foiaData: FOIAData,
  generatedFOIA: GeneratedFOIA,
  authority: FOIAAuthorityLookupResult,
  foiaId?: string
): Promise<FOIARoutingResult> {
  const routingAttempt = {
    foiaId,
    agencyName: foiaData.agencyName,
    state: foiaData.state,
    attemptedAt: new Date(),
  };

  try {
    if (authority.onlineSubmissionUrl) {
      await recordFOIARoutingHistory({
        ...routingAttempt,
        method: 'portal_link',
        success: true,
        recipientType: 'portal',
        notes: `Online portal available: ${authority.onlineSubmissionUrl}`,
      });

      return {
        success: true,
        method: 'portal_link',
        recipientInfo: {
          name: authority.agencyInfo.name,
          type: 'Online Portal',
        },
        message: 'FOIA request generated. Please submit through the agency\'s online portal.',
        nextSteps: [
          `Visit: ${authority.onlineSubmissionUrl}`,
          'Copy your FOIA request document',
          'Follow the portal\'s submission instructions',
          'Save your confirmation number',
        ],
      };
    }

    if (authority.primaryAuthority?.email) {
      const emailResult = await sendFOIAEmail(
        authority.primaryAuthority.email,
        foiaData,
        generatedFOIA.document,
        authority.primaryAuthority.name
      );

      await recordFOIARoutingHistory({
        ...routingAttempt,
        method: 'direct_email',
        success: emailResult.success,
        recipientEmail: authority.primaryAuthority.email,
        recipientType: authority.primaryAuthority.type,
        notes: emailResult.message,
      });

      if (emailResult.success) {
        return {
          success: true,
          method: 'direct_email',
          recipientInfo: {
            name: authority.primaryAuthority.name,
            email: authority.primaryAuthority.email,
            type: authority.primaryAuthority.type,
          },
          confirmationId: emailResult.messageId,
          message: `FOIA request sent to ${authority.primaryAuthority.name} at ${authority.primaryAuthority.email}`,
          nextSteps: [
            `Expect a response within ${generatedFOIA.statutoryDeadline}`,
            'Keep this confirmation for your records',
            'Follow up if you don\'t receive acknowledgment within 5 business days',
          ],
        };
      }
    }

    const adminResult = await sendFOIAToAdmin(foiaData, generatedFOIA, authority);

    await recordFOIARoutingHistory({
      ...routingAttempt,
      method: 'admin_fallback',
      success: adminResult.success,
      recipientEmail: ADMIN_FALLBACK_EMAIL,
      recipientType: 'admin_fallback',
      notes: 'Routed to admin for manual submission',
    });

    return {
      success: adminResult.success,
      method: 'admin_fallback',
      recipientInfo: {
        name: 'BadBlue Support Team',
        email: ADMIN_FALLBACK_EMAIL,
        type: 'Admin Review',
      },
      confirmationId: adminResult.messageId,
      message: 'Your FOIA request has been forwarded to our team for manual submission to the appropriate agency.',
      nextSteps: [
        'Our team will locate the correct FOIA officer for your agency',
        'We will submit your request within 1-2 business days',
        'You will receive a confirmation email once submitted',
        'The agency\'s response will be forwarded to you',
      ],
    };
  } catch (error) {
    console.error('[FOIA Routing] Error:', error);
    
    await recordFOIARoutingHistory({
      ...routingAttempt,
      method: 'admin_fallback',
      success: false,
      notes: `Routing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });

    return {
      success: false,
      method: 'admin_fallback',
      recipientInfo: {
        name: 'Error occurred',
        type: 'Failed',
      },
      message: 'An error occurred while routing your FOIA request. Please try again or contact support.',
      nextSteps: [
        'Try submitting again in a few minutes',
        'Contact support if the problem persists',
        'You can also submit the request manually to the agency',
      ],
    };
  }
}

async function sendFOIAEmail(
  toEmail: string,
  foiaData: FOIAData,
  document: string,
  recipientName: string
): Promise<{ success: boolean; message: string; messageId?: string }> {
  try {
    const subject = `Public Records Request - ${foiaData.agencyName} - ${foiaData.requesterName}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #1a365d;">Public Records Request</h2>
        <p>Dear ${recipientName},</p>
        <p>Please find attached a public records request submitted under the ${STATE_FOIA_INFO[foiaData.state.toUpperCase()]?.name || 'applicable state public records law'}.</p>
        
        <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #2d3748;">Request Summary</h3>
          <p><strong>Requester:</strong> ${foiaData.requesterName}</p>
          <p><strong>Email:</strong> ${foiaData.requesterEmail}</p>
          <p><strong>Agency:</strong> ${foiaData.agencyName}</p>
          ${foiaData.officerName ? `<p><strong>Officer:</strong> ${foiaData.officerName}</p>` : ''}
        </div>

        <h3 style="color: #2d3748;">Full Request Document</h3>
        <pre style="background: #f7fafc; border: 1px solid #e2e8f0; padding: 20px; white-space: pre-wrap; font-family: monospace; font-size: 12px;">${document}</pre>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #718096; font-size: 12px;">
          This request was submitted through BadBlue Police Accountability Platform.<br>
          Please respond directly to the requester at ${foiaData.requesterEmail}.
        </p>
      </div>
    `;

    const success = await sendEmail({
      to: toEmail,
      subject,
      html: htmlBody,
    });

    return {
      success,
      message: success ? 'Email sent successfully' : 'Failed to send email',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function sendFOIAToAdmin(
  foiaData: FOIAData,
  generatedFOIA: GeneratedFOIA,
  authority: FOIAAuthorityLookupResult
): Promise<{ success: boolean; messageId?: string }> {
  try {
    const subject = `[FOIA ROUTING NEEDED] ${foiaData.agencyName} - ${foiaData.state}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #92400e;">⚠️ Manual FOIA Submission Required</h3>
          <p style="margin: 10px 0 0 0; color: #92400e;">No verified FOIA officer email was found for this agency. Please locate the correct contact and submit this request.</p>
        </div>

        <h2 style="color: #1a365d;">FOIA Request Details</h2>
        
        <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #2d3748;">Agency Information</h3>
          <p><strong>Agency:</strong> ${foiaData.agencyName}</p>
          <p><strong>Type:</strong> ${foiaData.agencyType}</p>
          <p><strong>Location:</strong> ${foiaData.city ? foiaData.city + ', ' : ''}${foiaData.county ? foiaData.county + ' County, ' : ''}${foiaData.state}</p>
          ${authority.foiaPortal ? `<p><strong>Possible FOIA Portal:</strong> <a href="${authority.foiaPortal}">${authority.foiaPortal}</a></p>` : ''}
        </div>

        <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #2d3748;">Requester Information</h3>
          <p><strong>Name:</strong> ${foiaData.requesterName}</p>
          <p><strong>Email:</strong> ${foiaData.requesterEmail}</p>
          <p><strong>Address:</strong> ${foiaData.requesterAddress}</p>
          ${foiaData.requesterPhone ? `<p><strong>Phone:</strong> ${foiaData.requesterPhone}</p>` : ''}
        </div>

        <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #2d3748;">Lookup Notes</h3>
          <ul>
            ${authority.lookupNotes.map(note => `<li>${note}</li>`).join('')}
          </ul>
          ${authority.alternateAuthorities.length > 0 ? `
            <h4>Alternate Contacts Found:</h4>
            <ul>
              ${authority.alternateAuthorities.map(alt => `
                <li>${alt.name} (${alt.type})${alt.email ? ` - ${alt.email}` : ''}${alt.phone ? ` - ${alt.phone}` : ''}</li>
              `).join('')}
            </ul>
          ` : ''}
        </div>

        <h3 style="color: #2d3748;">Complete FOIA Request Document</h3>
        <pre style="background: #1a202c; color: #e2e8f0; padding: 20px; white-space: pre-wrap; font-family: monospace; font-size: 11px; border-radius: 8px;">${generatedFOIA.document}</pre>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #718096; font-size: 12px;">
          <strong>Action Required:</strong> Please locate the correct FOIA officer or records custodian for ${foiaData.agencyName} and submit this request on behalf of the user. Send confirmation to ${foiaData.requesterEmail}.
        </p>
      </div>
    `;

    const success = await sendEmail({
      to: ADMIN_FALLBACK_EMAIL,
      subject,
      html: htmlBody,
    });

    return {
      success,
    };
  } catch (error) {
    console.error('[FOIA Admin Email] Error:', error);
    return { success: false };
  }
}

async function checkFOIAAuthorityCache(agencyName: string, state: string): Promise<FOIAAuthorityLookupResult | null> {
  try {
    const result = await db.execute(sql`
      SELECT * FROM authority_contacts_cache 
      WHERE agency_name = ${agencyName} 
      AND state = ${state}
      AND authority_type = 'foia_officer'
      AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    if (result.rows && result.rows.length > 0) {
      const cached = result.rows[0] as any;
      return {
        primaryAuthority: {
          name: cached.contact_name,
          title: cached.title || 'FOIA Officer',
          email: cached.email,
          phone: cached.phone,
          department: agencyName,
          type: 'foia_officer',
          verified: cached.verified,
        },
        alternateAuthorities: [],
        agencyInfo: {
          name: agencyName,
          type: 'unknown',
          state,
        },
        fallbackRequired: !cached.email,
        lookupNotes: ['Retrieved from cache'],
      };
    }
    return null;
  } catch (error) {
    console.log('[FOIA Cache] Cache lookup failed:', error);
    return null;
  }
}

async function cacheFOIAAuthority(result: FOIAAuthorityLookupResult): Promise<void> {
  if (!result.primaryAuthority) return;

  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.execute(sql`
      INSERT INTO authority_contacts_cache (
        agency_name,
        state,
        city,
        authority_type,
        contact_name,
        title,
        email,
        phone,
        verified,
        source_url,
        expires_at
      ) VALUES (
        ${result.agencyInfo.name},
        ${result.agencyInfo.state},
        ${result.agencyInfo.city || null},
        'foia_officer',
        ${result.primaryAuthority.name},
        ${result.primaryAuthority.title},
        ${result.primaryAuthority.email || null},
        ${result.primaryAuthority.phone || null},
        ${result.primaryAuthority.verified},
        ${result.primaryAuthority.source || null},
        ${expiresAt.toISOString()}
      )
      ON CONFLICT (agency_name, state, authority_type) 
      DO UPDATE SET
        contact_name = EXCLUDED.contact_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        verified = EXCLUDED.verified,
        updated_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `);
  } catch (error) {
    console.log('[FOIA Cache] Failed to cache authority:', error);
  }
}

async function recordFOIARoutingHistory(data: {
  foiaId?: string;
  agencyName: string;
  state: string;
  attemptedAt: Date;
  method: string;
  success: boolean;
  recipientEmail?: string;
  recipientType?: string;
  notes?: string;
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO foia_routing_history (
        foia_id,
        agency_name,
        state,
        routing_method,
        success,
        recipient_email,
        recipient_type,
        notes,
        attempted_at
      ) VALUES (
        ${data.foiaId || null},
        ${data.agencyName},
        ${data.state},
        ${data.method},
        ${data.success},
        ${data.recipientEmail || null},
        ${data.recipientType || null},
        ${data.notes || null},
        ${data.attemptedAt.toISOString()}
      )
    `);
  } catch (error) {
    console.log('[FOIA Routing History] Failed to record:', error);
  }
}

export function getStateFOIAInfo(state: string): {
  statute: string;
  deadline: string;
  name: string;
  exemptionReference: string;
} {
  return STATE_FOIA_INFO[state.toUpperCase()] || {
    statute: `${state} Open Records Act`,
    deadline: 'statutory deadline',
    name: 'State Public Records Law',
    exemptionReference: 'applicable exemptions',
  };
}

/**
 * ENHANCED FOIA REQUEST GENERATION WITH LEGAL SEARCH
 * Uses ultra-enhanced legal search to find relevant statutes, precedents, and requirements
 */
export async function generateEnhancedFOIAWithSearch(data: FOIAData): Promise<{
  foia: GeneratedFOIA;
  legalResearch: LegalSearchResult;
}> {
  console.log('[FOIA Enhanced] Starting enhanced FOIA generation with legal search');

  try {
    // Step 1: Perform enhanced legal search for FOIA statutes and precedents
    const searchQuery = `FOIA and public records law for ${data.state}, including state statute, deadlines, exemptions, and requirements for requesting ${data.recordsDescription}`;
    
    const legalResearch = await performEnhancedLegalSearch(searchQuery, {
      jurisdiction: data.state,
      context: `Agency: ${data.agencyName}, Agency Type: ${data.agencyType}`,
      requireSources: true,
    });

    console.log(`[FOIA Enhanced] Legal research completed with ${legalResearch.attributedFacts.length} verified facts`);

    // Step 2: Extract relevant statutes and deadlines from research
    const statutes = legalResearch.attributedFacts
      .filter(fact => fact.entities.some(e => e.type === 'statute'))
      .map(fact => ({
        fact: fact.fact,
        sources: fact.sources,
      }));

    const deadlines = legalResearch.attributedFacts
      .filter(fact => fact.fact.toLowerCase().includes('deadline') || fact.fact.toLowerCase().includes('days'))
      .map(fact => ({
        fact: fact.fact,
        sources: fact.sources,
      }));

    // Step 3: Generate standard FOIA document
    const standardFOIA = generateEnhancedFOIARequest(data);

    // Step 4: Enhance FOIA with research findings
    const enhancedDocument = `${standardFOIA.document}

═══════════════════════════════════════════════════════════════════════════════
                    ENHANCED LEGAL RESEARCH FINDINGS
═══════════════════════════════════════════════════════════════════════════════

VERIFIED STATUTES AND LEGAL BASIS:
${statutes.map((s, i) => `${i + 1}. ${s.fact}
   Sources: ${s.sources.join(', ')}`).join('\n\n')}

VERIFIED DEADLINES AND TIME REQUIREMENTS:
${deadlines.map((d, i) => `${i + 1}. ${d.fact}
   Sources: ${d.sources.join(', ')}`).join('\n\n')}

DISCREPANCIES IDENTIFIED:
${legalResearch.discrepancies.length > 0 
  ? legalResearch.discrepancies.map(d => `[${d.severity.toUpperCase()}] ${d.type}: ${d.description}`).join('\n')
  : 'No discrepancies identified'}

TIMELINE OF RELEVANT EVENTS:
${legalResearch.timeline && legalResearch.timeline.length > 0
  ? legalResearch.timeline.map(event => `${event.date.toLocaleDateString()}: ${event.description}`).join('\n')
  : 'No timeline available'}

═══════════════════════════════════════════════════════════════════════════════

Note: This enhanced FOIA request includes comprehensive legal research to support
your request and ensure compliance with all applicable statutes and requirements.
`;

    console.log('[FOIA Enhanced] Enhanced FOIA document generated');

    return {
      foia: {
        ...standardFOIA,
        document: enhancedDocument,
      },
      legalResearch,
    };
  } catch (error: any) {
    console.error('[FOIA Enhanced] Error in enhanced FOIA generation:', error);
    
    // Fallback to standard FOIA if enhanced search fails
    console.log('[FOIA Enhanced] Falling back to standard FOIA generation');
    const standardFOIA = generateEnhancedFOIARequest(data);
    
    return {
      foia: standardFOIA,
      legalResearch: {
        query: '',
        aggregatedResponse: '',
        attributedFacts: [],
        timeline: [],
        categorization: {
          byRelevance: [],
          byRecency: [],
          byAuthority: [],
          byJurisdiction: new Map(),
          byParty: new Map(),
          byDocumentType: new Map(),
        },
        discrepancies: [],
        modelResponses: [],
        metadata: {
          searchedAt: new Date(),
          modelsUsed: ['Fallback'],
          totalSources: 0,
          verifiedFactsCount: 0,
          discardedFactsCount: 0,
        },
      },
    };
  }
}
