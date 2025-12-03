/**
 * Enhanced Complaint Drafting System
 * 
 * Modeled after the most successful and high-impact complaint formats historically produced.
 * Incorporates structural patterns, rhetorical framing, and organizational flow from
 * successful public complaint documents.
 * 
 * Now integrated with ultra-enhanced legal search for verified facts and source attribution.
 */

import { generateUserText, TaskPriority } from './aiProvider';
import { unifiedSearch, searchOfficerRecords, SearchResult } from './webSearchService';
import { sendMail } from './mailer';
import { performEnhancedLegalSearch, type LegalSearchResult, type AttributedFact } from './enhancedLegalSearch';

const ADMIN_FALLBACK_EMAIL = 'contact.badblue@gmail.com';

export interface ComplaintData {
  complainantName: string;
  complainantAddress: string;
  complainantPhone: string;
  complainantEmail: string;
  
  officerName: string;
  officerBadge?: string;
  officerRank?: string;
  officerDepartment: string;
  
  incidentDate: Date;
  incidentTime?: string;
  incidentLocation: string;
  city: string;
  county?: string;
  state: string;
  
  incidentDescription: string;
  complaintType: string;
  
  witnesses?: WitnessInfo[];
  injuries?: string;
  propertyDamage?: string;
  evidenceDescription?: string;
  
  priorComplaints?: string;
  immediateActions?: string;
}

export interface WitnessInfo {
  name: string;
  contact?: string;
  relationship?: string;
}

export interface AuthorityContact {
  name: string;
  title: string;
  department: string;
  email?: string;
  phone?: string;
  address?: string;
  type: 'internal_affairs' | 'oversight' | 'command_staff' | 'professional_standards' | 'civilian_review';
  confidence: 'high' | 'medium' | 'low';
  source?: string;
}

export interface ComplaintRouting {
  primaryAuthority?: AuthorityContact;
  secondaryAuthorities: AuthorityContact[];
  fallbackRequired: boolean;
  routingNotes: string[];
}

export interface GeneratedComplaint {
  document: string;
  routing: ComplaintRouting;
  legalBasis: string[];
  recommendedActions: string[];
  documentFormat: 'text' | 'html';
}

const COMPLAINT_TYPE_DETAILS: Record<string, { 
  title: string; 
  legalBasis: string[]; 
  description: string;
  federalStatutes: string[];
  severity: 'critical' | 'serious' | 'moderate';
}> = {
  'excessive-force': {
    title: 'EXCESSIVE USE OF FORCE',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourth Amendment - Protection against unreasonable seizures',
      'Fourteenth Amendment - Due process and equal protection',
    ],
    description: 'Use of force beyond what is objectively reasonable under the circumstances',
    federalStatutes: ['42 U.S.C. § 1983', '18 U.S.C. § 242'],
    severity: 'critical',
  },
  'false-arrest': {
    title: 'FALSE ARREST / UNLAWFUL DETENTION',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourth Amendment - Protection against unreasonable seizure of person',
      'Fourteenth Amendment - Due process violation',
    ],
    description: 'Arrest or detention without probable cause or legal justification',
    federalStatutes: ['42 U.S.C. § 1983', '18 U.S.C. § 242'],
    severity: 'critical',
  },
  'illegal-search': {
    title: 'ILLEGAL SEARCH AND SEIZURE',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourth Amendment - Protection against unreasonable searches and seizures',
      'Fourteenth Amendment - Due process violation',
    ],
    description: 'Search or seizure conducted without warrant, consent, or legal exception',
    federalStatutes: ['42 U.S.C. § 1983', '18 U.S.C. § 242'],
    severity: 'critical',
  },
  'discrimination': {
    title: 'DISCRIMINATORY TREATMENT',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourteenth Amendment - Equal Protection Clause',
      'Title VI of the Civil Rights Act of 1964',
      '42 U.S.C. § 1981 - Equal rights under the law',
    ],
    description: 'Differential treatment based on race, ethnicity, religion, gender, or other protected class',
    federalStatutes: ['42 U.S.C. § 1983', '42 U.S.C. § 1981', '42 U.S.C. § 2000d'],
    severity: 'critical',
  },
  'harassment': {
    title: 'HARASSMENT / INTIMIDATION',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'First Amendment - Freedom from retaliation for protected speech',
      'Fourteenth Amendment - Due process violation',
    ],
    description: 'Pattern of conduct designed to annoy, threaten, or intimidate',
    federalStatutes: ['42 U.S.C. § 1983', '18 U.S.C. § 242'],
    severity: 'serious',
  },
  'misconduct': {
    title: 'OFFICIAL MISCONDUCT / ABUSE OF AUTHORITY',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourteenth Amendment - Due process violation',
      'State misconduct statutes',
    ],
    description: 'Abuse of official position or violation of department policy',
    federalStatutes: ['42 U.S.C. § 1983', '18 U.S.C. § 242'],
    severity: 'serious',
  },
  'assault': {
    title: 'ASSAULT BY PEACE OFFICER',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourth Amendment - Excessive force during seizure',
      'Fourteenth Amendment - Substantive due process',
      'State assault statutes',
    ],
    description: 'Physical attack or threat of imminent physical harm by officer',
    federalStatutes: ['42 U.S.C. § 1983', '18 U.S.C. § 242', '18 U.S.C. § 245'],
    severity: 'critical',
  },
  'retaliation': {
    title: 'FIRST AMENDMENT RETALIATION',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'First Amendment - Freedom of speech and right to petition',
      'Fourteenth Amendment - Due process',
    ],
    description: 'Adverse action taken in response to exercise of constitutional rights',
    federalStatutes: ['42 U.S.C. § 1983'],
    severity: 'serious',
  },
  'failure-to-intervene': {
    title: 'FAILURE TO INTERVENE',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourteenth Amendment - Due process',
      'Bystander liability doctrine',
    ],
    description: 'Officer witnessed constitutional violation and failed to intervene',
    federalStatutes: ['42 U.S.C. § 1983'],
    severity: 'serious',
  },
  'denial-of-medical-care': {
    title: 'DENIAL OF MEDICAL CARE',
    legalBasis: [
      '42 U.S.C. § 1983 - Civil action for deprivation of rights',
      'Fourteenth Amendment - Deliberate indifference to medical needs',
      'Eighth Amendment (if arrested) - Cruel and unusual punishment',
    ],
    description: 'Failure to provide or allow necessary medical treatment',
    federalStatutes: ['42 U.S.C. § 1983'],
    severity: 'critical',
  },
};

/**
 * Format date for official documents
 */
function formatOfficialDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format date for document headers
 */
function formatHeaderDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Search for officer authority and oversight contacts
 */
export async function searchOfficerAuthority(
  officerName: string,
  department: string,
  city: string,
  county: string | undefined,
  state: string
): Promise<ComplaintRouting> {
  const routing: ComplaintRouting = {
    secondaryAuthorities: [],
    fallbackRequired: false,
    routingNotes: [],
  };

  try {
    const searchQueries = [
      `${department} internal affairs email contact`,
      `${city} ${state} police internal affairs division contact`,
      `${department} professional standards bureau email`,
      `${city} civilian police oversight board contact email`,
      `${department} command staff chief email`,
    ];

    if (county) {
      searchQueries.push(`${county} County sheriff internal affairs contact`);
    }

    const searchPromises = searchQueries.map(query => 
      unifiedSearch(query, { limit: 3, category: 'officer' })
    );

    const searchResults = await Promise.allSettled(searchPromises);

    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        routing.routingNotes.push(`Found ${result.value.length} results for: ${searchQueries[i]}`);
        
        for (const searchResult of result.value) {
          const emailMatch = extractEmailFromResult(searchResult);
          if (emailMatch) {
            const authorityType = determineAuthorityType(searchQueries[i]);
            const authority: AuthorityContact = {
              name: extractNameFromResult(searchResult, department),
              title: authorityType === 'internal_affairs' ? 'Internal Affairs Division' : 
                     authorityType === 'oversight' ? 'Civilian Oversight' : 
                     authorityType === 'command_staff' ? 'Command Staff' : 'Professional Standards',
              department: department,
              email: emailMatch,
              type: authorityType,
              confidence: 'medium',
              source: searchResult.url,
            };

            if (!routing.primaryAuthority && authorityType === 'internal_affairs') {
              routing.primaryAuthority = authority;
              authority.confidence = 'high';
            } else {
              routing.secondaryAuthorities.push(authority);
            }
          }
        }
      }
    }

    if (!routing.primaryAuthority) {
      routing.fallbackRequired = true;
      routing.routingNotes.push('No verified internal affairs contact found - will route to admin for manual review');
    }

  } catch (error: any) {
    console.error('[Complaint Routing] Authority search error:', error);
    routing.fallbackRequired = true;
    routing.routingNotes.push(`Authority search failed: ${error.message}`);
  }

  return routing;
}

function extractEmailFromResult(result: SearchResult): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const textToSearch = `${result.title} ${result.snippet || ''}`;
  const matches = textToSearch.match(emailRegex);
  
  if (matches) {
    for (const email of matches) {
      if (email.includes('gov') || email.includes('police') || email.includes('sheriff')) {
        return email;
      }
    }
    return matches[0];
  }
  return null;
}

function extractNameFromResult(result: SearchResult, defaultDept: string): string {
  return result.title?.split(' - ')[0] || `${defaultDept} Internal Affairs`;
}

function determineAuthorityType(query: string): AuthorityContact['type'] {
  const queryLower = query.toLowerCase();
  if (queryLower.includes('internal affairs')) return 'internal_affairs';
  if (queryLower.includes('civilian') || queryLower.includes('oversight')) return 'oversight';
  if (queryLower.includes('command') || queryLower.includes('chief')) return 'command_staff';
  if (queryLower.includes('professional standards')) return 'professional_standards';
  return 'internal_affairs';
}

/**
 * Generate a professionally formatted complaint document
 * Based on successful complaint formats and best practices
 */
export async function generateEnhancedComplaint(data: ComplaintData): Promise<GeneratedComplaint> {
  const complaintDetails = COMPLAINT_TYPE_DETAILS[data.complaintType] || {
    title: data.complaintType.toUpperCase().replace(/-/g, ' '),
    legalBasis: ['42 U.S.C. § 1983'],
    description: 'Violation of civil rights under color of law',
    federalStatutes: ['42 U.S.C. § 1983'],
    severity: 'serious' as const,
  };

  const routing = await searchOfficerAuthority(
    data.officerName,
    data.officerDepartment,
    data.city,
    data.county,
    data.state
  );

  const incidentDateFormatted = formatOfficialDate(data.incidentDate);
  const headerDate = formatHeaderDate(new Date());

  const witnessSection = data.witnesses && data.witnesses.length > 0 
    ? `
WITNESS INFORMATION:

The following individuals witnessed the incident and may be contacted for corroboration:

${data.witnesses.map((w, i) => `${i + 1}. ${w.name}${w.contact ? ` - Contact: ${w.contact}` : ''}${w.relationship ? ` (${w.relationship})` : ''}`).join('\n')}
`
    : '';

  const injurySection = data.injuries 
    ? `
INJURIES SUSTAINED:

${data.injuries}
`
    : '';

  const propertySection = data.propertyDamage 
    ? `
PROPERTY DAMAGE:

${data.propertyDamage}
`
    : '';

  const evidenceSection = data.evidenceDescription 
    ? `
EVIDENCE AVAILABLE:

${data.evidenceDescription}
`
    : '';

  const primaryRecipient = routing.primaryAuthority 
    ? `${routing.primaryAuthority.title}\n${routing.primaryAuthority.department}`
    : `Internal Affairs Division\n${data.officerDepartment}`;

  const document = `
================================================================================
                              FORMAL COMPLAINT
                    REGARDING POLICE OFFICER MISCONDUCT
================================================================================

DATE OF FILING: ${headerDate}
COMPLAINT TYPE: ${complaintDetails.title}
SEVERITY: ${complaintDetails.severity.toUpperCase()}

--------------------------------------------------------------------------------
                              FILING INFORMATION
--------------------------------------------------------------------------------

TO:
${primaryRecipient}
${data.city}, ${data.state}

FROM:
${data.complainantName}
${data.complainantAddress}
Phone: ${data.complainantPhone}
Email: ${data.complainantEmail}

RE: FORMAL COMPLAINT AGAINST ${data.officerName.toUpperCase()}
    ${data.officerDepartment}
    ${data.officerBadge ? `Badge Number: ${data.officerBadge}` : ''}
    ${data.officerRank ? `Rank: ${data.officerRank}` : ''}

--------------------------------------------------------------------------------
                           PRELIMINARY STATEMENT
--------------------------------------------------------------------------------

I, ${data.complainantName}, hereby submit this formal complaint against Officer 
${data.officerName} of the ${data.officerDepartment}. This complaint documents 
serious misconduct that occurred on ${incidentDateFormatted}, which I believe 
constitutes a violation of my constitutional rights and warrants immediate 
investigation and appropriate disciplinary action.

--------------------------------------------------------------------------------
                            LEGAL FRAMEWORK
--------------------------------------------------------------------------------

This complaint is filed pursuant to and alleges violations of:

${complaintDetails.legalBasis.map((basis, i) => `${i + 1}. ${basis}`).join('\n')}

${complaintDetails.description}

--------------------------------------------------------------------------------
                          OFFICER INFORMATION
--------------------------------------------------------------------------------

ACCUSED OFFICER:
• Full Name: ${data.officerName}
• Department: ${data.officerDepartment}
${data.officerBadge ? `• Badge/ID Number: ${data.officerBadge}` : '• Badge/ID Number: [Unknown - Request Investigation]'}
${data.officerRank ? `• Rank: ${data.officerRank}` : ''}
• Location of Assignment: ${data.city}, ${data.state}

--------------------------------------------------------------------------------
                          INCIDENT DETAILS
--------------------------------------------------------------------------------

DATE OF INCIDENT: ${incidentDateFormatted}
${data.incidentTime ? `TIME OF INCIDENT: ${data.incidentTime}` : ''}
LOCATION: ${data.incidentLocation}
         ${data.city}${data.county ? `, ${data.county} County` : ''}, ${data.state}

--------------------------------------------------------------------------------
                         STATEMENT OF FACTS
--------------------------------------------------------------------------------

The following is a detailed account of the events that transpired:

${data.incidentDescription}

${witnessSection}
${injurySection}
${propertySection}
${evidenceSection}

--------------------------------------------------------------------------------
                       CONSTITUTIONAL VIOLATIONS
--------------------------------------------------------------------------------

Based on the facts described above, the conduct of Officer ${data.officerName} 
constitutes violations of the following constitutional and statutory provisions:

${complaintDetails.federalStatutes.map((statute, i) => `${i + 1}. ${statute}`).join('\n')}

The officer's actions were taken under color of state law and deprived the 
complainant of rights, privileges, and immunities secured by the Constitution 
and laws of the United States.

--------------------------------------------------------------------------------
                         RELIEF REQUESTED
--------------------------------------------------------------------------------

I respectfully request that this complaint be thoroughly investigated and that 
the following actions be taken:

1. IMMEDIATE INVESTIGATION: Conduct a complete and impartial investigation of 
   the allegations contained in this complaint.

2. PRESERVATION OF EVIDENCE: Preserve all body camera footage, dashboard camera 
   footage, dispatch recordings, and any other evidence related to this incident.

3. WITNESS INTERVIEWS: Interview all witnesses identified in this complaint as 
   well as any additional witnesses discovered during the investigation.

4. DISCIPLINARY ACTION: Impose appropriate disciplinary measures against Officer 
   ${data.officerName} if the investigation sustains these allegations.

5. POLICY REVIEW: Review department policies and training procedures to prevent 
   similar incidents in the future.

6. WRITTEN RESPONSE: Provide me with a written response regarding the outcome of 
   this investigation within the time period required by applicable law.

--------------------------------------------------------------------------------
                            VERIFICATION
--------------------------------------------------------------------------------

I, ${data.complainantName}, hereby declare under penalty of perjury that the 
foregoing statements are true and correct to the best of my knowledge, 
information, and belief.

I understand that filing a false complaint is a violation of law and may result 
in criminal prosecution.

I am willing to cooperate fully with any investigation and to provide additional 
information or testimony as needed.


_______________________________________
Signature: [ELECTRONIC SIGNATURE]
Print Name: ${data.complainantName}
Date: ${headerDate}

Contact Information:
${data.complainantAddress}
Phone: ${data.complainantPhone}
Email: ${data.complainantEmail}

--------------------------------------------------------------------------------
                         SUBMISSION INSTRUCTIONS
--------------------------------------------------------------------------------

This complaint should be submitted to:

${routing.primaryAuthority ? 
  `PRIMARY: ${routing.primaryAuthority.title}
   ${routing.primaryAuthority.department}
   ${routing.primaryAuthority.email ? `Email: ${routing.primaryAuthority.email}` : ''}
   ${routing.primaryAuthority.address || ''}`
  : 
  `PRIMARY: Internal Affairs Division - ${data.officerDepartment}
   ${data.city}, ${data.state}
   [Note: Specific contact information was not found - complaint will be routed 
   to contact.badblue@gmail.com for manual forwarding]`
}

${routing.secondaryAuthorities.length > 0 ? `
ADDITIONAL RECIPIENTS (CC):
${routing.secondaryAuthorities.map(auth => 
  `• ${auth.title} - ${auth.department}${auth.email ? ` (${auth.email})` : ''}`
).join('\n')}
` : ''}

--------------------------------------------------------------------------------
                              NOTICE
--------------------------------------------------------------------------------

This complaint has been generated by BadBlue Police Accountability Platform.

DISCLAIMER: This document provides a framework for filing a formal complaint. 
It does not constitute legal advice. Complainants are encouraged to consult 
with an attorney regarding their specific situation and any potential legal 
claims. Deadlines for filing civil rights lawsuits vary by state.

================================================================================
                          END OF COMPLAINT DOCUMENT
================================================================================
`;

  const recommendedActions = [
    'Keep a copy of this complaint for your records',
    'Request a confirmation of receipt from the receiving agency',
    'Document any additional incidents or retaliation',
    'Consult with a civil rights attorney about potential legal claims',
    `Note: Statute of limitations for § 1983 claims in ${data.state} - consult an attorney`,
    'Request body camera and dash camera footage via FOIA/public records request',
    'Preserve all evidence including photos, medical records, and witness statements',
  ];

  return {
    document,
    routing,
    legalBasis: complaintDetails.legalBasis,
    recommendedActions,
    documentFormat: 'text',
  };
}

/**
 * Route and send complaint to appropriate authority
 * Falls back to admin email if no authority found
 */
export async function routeComplaint(
  complaint: GeneratedComplaint,
  data: ComplaintData,
  complaintId?: string
): Promise<{
  success: boolean;
  sentTo: string[];
  fallbackUsed: boolean;
  message: string;
}> {
  const sentTo: string[] = [];
  let fallbackUsed = false;

  const subject = `Formal Complaint Against Officer ${data.officerName} - ${data.officerDepartment}`;
  const emailBody = `
<html>
<body>
<h2>Formal Complaint Submission</h2>
<p>Please find attached a formal complaint regarding Officer ${data.officerName} of the ${data.officerDepartment}.</p>

<h3>Complaint Summary</h3>
<ul>
  <li><strong>Complainant:</strong> ${data.complainantName}</li>
  <li><strong>Officer:</strong> ${data.officerName}</li>
  <li><strong>Department:</strong> ${data.officerDepartment}</li>
  <li><strong>Incident Date:</strong> ${formatHeaderDate(data.incidentDate)}</li>
  <li><strong>Complaint Type:</strong> ${data.complaintType.replace(/-/g, ' ').toUpperCase()}</li>
</ul>

<p>This complaint has been submitted through the BadBlue Police Accountability Platform.</p>

${complaintId ? `<p><small>Reference ID: ${complaintId}</small></p>` : ''}
</body>
</html>
`;

  const complaintAttachment = {
    filename: `Formal_Complaint_${data.officerName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`,
    content: Buffer.from(complaint.document).toString('base64'),
    contentType: 'text/plain',
  };

  if (complaint.routing.primaryAuthority?.email) {
    try {
      const sent = await sendMail(
        complaint.routing.primaryAuthority.email,
        subject,
        emailBody,
        complaint.document,
        undefined,
        [complaintAttachment]
      );
      if (sent) {
        sentTo.push(complaint.routing.primaryAuthority.email);
      }
    } catch (error: any) {
      console.error(`[Complaint Routing] Failed to send to primary: ${error.message}`);
    }
  }

  for (const auth of complaint.routing.secondaryAuthorities.slice(0, 2)) {
    if (auth.email) {
      try {
        const sent = await sendMail(
          auth.email,
          subject,
          emailBody,
          complaint.document,
          undefined,
          [complaintAttachment]
        );
        if (sent) {
          sentTo.push(auth.email);
        }
      } catch (error: any) {
        console.error(`[Complaint Routing] Failed to send to secondary: ${error.message}`);
      }
    }
  }

  if (sentTo.length === 0 || complaint.routing.fallbackRequired) {
    fallbackUsed = true;
    try {
      const adminSubject = `[MANUAL ROUTING REQUIRED] ${subject}`;
      const adminBody = `
<html>
<body>
<h2>⚠️ Manual Routing Required</h2>
<p>The following complaint could not be automatically routed to the appropriate authority. 
Please review and forward to the correct internal affairs or oversight division.</p>

<h3>Target Department</h3>
<ul>
  <li><strong>Department:</strong> ${data.officerDepartment}</li>
  <li><strong>City:</strong> ${data.city}</li>
  <li><strong>State:</strong> ${data.state}</li>
</ul>

<h3>Routing Notes</h3>
${complaint.routing.routingNotes.map(note => `<p>• ${note}</p>`).join('')}

<hr>

${emailBody}
</body>
</html>
`;

      const sent = await sendMail(
        ADMIN_FALLBACK_EMAIL,
        adminSubject,
        adminBody,
        complaint.document,
        undefined,
        [complaintAttachment]
      );
      if (sent) {
        sentTo.push(ADMIN_FALLBACK_EMAIL);
      }
    } catch (error: any) {
      console.error(`[Complaint Routing] Failed to send to admin fallback: ${error.message}`);
    }
  }

  return {
    success: sentTo.length > 0,
    sentTo,
    fallbackUsed,
    message: fallbackUsed 
      ? `Complaint sent to admin for manual routing to ${data.officerDepartment}`
      : `Complaint successfully routed to ${sentTo.length} recipient(s)`,
  };
}

/**
 * Generate AI-enhanced complaint narrative
 * Uses AI to improve the incident description while maintaining accuracy
 */
export async function enhanceComplaintNarrative(
  incidentDescription: string,
  complaintType: string,
  state: string
): Promise<string> {
  try {
    const response = await generateUserText(
      'complaint-narrative-enhancement',
      `Improve the following incident description for a formal police complaint. 
Make it more detailed, specific, and professionally written while maintaining 
complete factual accuracy. Do not add any facts not present in the original.
Focus on clarity, chronological order, and specific details.

Complaint Type: ${complaintType}
State: ${state}

Original Description:
${incidentDescription}

Provide an enhanced version that:
1. Uses clear, professional language
2. Maintains chronological order
3. Emphasizes constitutional violations
4. Is suitable for official complaint submission`,
      {
        systemPrompt: `You are a legal writing assistant specializing in civil rights complaints. 
Your task is to improve incident narratives while maintaining complete factual accuracy. 
Never add facts not present in the original. Focus on clarity and professional presentation.`,
        temperature: 0.3,
        maxTokens: 2000,
      },
      TaskPriority.CRITICAL_USER
    );

    return response.content;
  } catch (error: any) {
    console.error('[Complaint Enhancement] AI enhancement failed:', error);
    return incidentDescription;
  }
}

/**
 * ENHANCED COMPLAINT GENERATION WITH INTEGRATED LEGAL SEARCH
 * Uses ultra-enhanced legal search for verified legal basis and precedents
 */
export async function generateEnhancedComplaintWithSearch(data: ComplaintData): Promise<{
  complaint: GeneratedComplaint;
  legalResearch: LegalSearchResult;
  verifiedFacts: AttributedFact[];
}> {
  console.log('[Complaint Enhanced] Starting enhanced complaint generation with legal search');

  try {
    // Step 1: Perform enhanced legal search for relevant laws and precedents
    const searchQuery = `Legal basis for ${data.complaintType} complaint against ${data.officerName} of ${data.officerDepartment} in ${data.state}. Incident: ${data.incidentDescription}`;
    
    const legalResearch = await performEnhancedLegalSearch(searchQuery, {
      jurisdiction: data.state,
      context: `Officer: ${data.officerName}, Department: ${data.officerDepartment}, Type: ${data.complaintType}`,
      requireSources: true,
    });

    console.log(`[Complaint Enhanced] Legal research completed with ${legalResearch.attributedFacts.length} verified facts`);

    // Step 2: Extract verified legal basis
    const verifiedStatutes = legalResearch.attributedFacts
      .filter(fact => fact.entities.some(e => e.type === 'statute'))
      .map(fact => ({
        fact: fact.fact,
        sources: fact.sources,
        statute: fact.entities.find(e => e.type === 'statute'),
      }));

    const verifiedPrecedents = legalResearch.attributedFacts
      .filter(fact => fact.entities.some(e => e.type === 'citation'))
      .map(fact => ({
        fact: fact.fact,
        sources: fact.sources,
        citation: fact.entities.find(e => e.type === 'citation'),
      }));

    // Step 3: Generate standard complaint
    const standardComplaint = await generateEnhancedComplaint(data);

    // Step 4: Enhance complaint with verified legal research
    const enhancedDocument = `${standardComplaint.document}

================================================================================
                   VERIFIED LEGAL RESEARCH AND PRECEDENTS
================================================================================

This complaint is supported by comprehensive legal research with verified sources:

APPLICABLE STATUTES (VERIFIED):
${verifiedStatutes.map((s, i) => `${i + 1}. ${s.fact}
   Citation: ${s.statute?.value}
   Sources: ${s.sources.join(', ')}`).join('\n\n')}

RELEVANT CASE LAW (VERIFIED):
${verifiedPrecedents.map((p, i) => `${i + 1}. ${p.fact}
   Citation: ${p.citation?.value}
   Sources: ${p.sources.join(', ')}`).join('\n\n')}

TIMELINE OF EVENTS:
${legalResearch.timeline && legalResearch.timeline.length > 0
  ? legalResearch.timeline.map(event => `${event.date.toLocaleDateString()}: ${event.description}`).join('\n')
  : 'See incident details above'}

DISCREPANCIES IDENTIFIED:
${legalResearch.discrepancies.length > 0 
  ? legalResearch.discrepancies.map(d => `[${d.severity.toUpperCase()}] ${d.type}: ${d.description}`).join('\n')
  : 'No discrepancies identified'}

================================================================================

Note: This complaint incorporates comprehensive legal research to strengthen
the legal basis and ensure all relevant statutes and precedents are properly
cited with verified sources.
`;

    console.log('[Complaint Enhanced] Enhanced complaint document generated');

    return {
      complaint: {
        ...standardComplaint,
        document: enhancedDocument,
        legalBasis: [
          ...standardComplaint.legalBasis,
          ...verifiedStatutes.map(s => s.statute?.value || '').filter(Boolean),
        ],
      },
      legalResearch,
      verifiedFacts: legalResearch.attributedFacts,
    };
  } catch (error: any) {
    console.error('[Complaint Enhanced] Error in enhanced complaint generation:', error);
    
    // Fallback to standard complaint if enhanced search fails
    console.log('[Complaint Enhanced] Falling back to standard complaint generation');
    const standardComplaint = await generateEnhancedComplaint(data);
    
    return {
      complaint: standardComplaint,
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
      verifiedFacts: [],
    };
  }
}

export {
  COMPLAINT_TYPE_DETAILS,
  ADMIN_FALLBACK_EMAIL,
};
