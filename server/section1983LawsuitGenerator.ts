/**
 * Section 1983 Lawsuit Generation System
 * 
 * Generates federal civil rights lawsuits for U.S. District Courts
 * Based on 42 U.S.C. § 1983 with proper formatting, structure, and legal reasoning
 * from historically successful federal pleadings.
 */

import { generateUserText, TaskPriority } from './aiProvider';

export interface Section1983LawsuitData {
  plaintiff: PlaintiffInfo;
  defendants: DefendantInfo[];
  incident: IncidentInfo;
  claims: ClaimInfo[];
  damages: DamagesInfo;
  jurisdiction: JurisdictionInfo;
  attorney?: AttorneyInfo;
}

export interface PlaintiffInfo {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone?: string;
  email?: string;
  isProSe: boolean;
}

export interface DefendantInfo {
  name: string;
  title?: string;
  badgeNumber?: string;
  department: string;
  address?: string;
  capacity: 'individual' | 'official' | 'both';
  role: string;
}

export interface IncidentInfo {
  date: Date;
  time?: string;
  location: string;
  city: string;
  county: string;
  state: string;
  description: string;
  witnesses?: string[];
  injuries?: string;
  propertyDamage?: string;
  priorHistory?: string;
}

export interface ClaimInfo {
  claimNumber: number;
  constitutionalProvision: string;
  statute: string;
  description: string;
  defendantsInvolved: string[];
  factualBasis: string;
}

export interface DamagesInfo {
  compensatory: {
    medicalExpenses?: number;
    lostWages?: number;
    painAndSuffering?: number;
    emotionalDistress?: number;
    other?: number;
    description?: string;
  };
  punitive: boolean;
  punitiveDescription?: string;
  injunctiveRelief?: string;
  declaratoryRelief?: string;
  attorneysFees: boolean;
}

export interface JurisdictionInfo {
  districtCourt: string;
  division?: string;
  state: string;
  venueReason: string;
}

export interface AttorneyInfo {
  name: string;
  barNumber: string;
  firmName?: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  fax?: string;
  email: string;
}

export interface LocalRules {
  fontFamily: string;
  fontSize: number;
  lineSpacing: 'single' | 'double' | '1.5';
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  lineNumbering: boolean;
  maxLinesPerPage?: number;
  captionFormat: 'standard' | 'california' | 'california-central';
  paperSize: '8.5x11';
  footerRequired: boolean;
  signatureBlock: 'right' | 'left' | 'center';
}

export interface GeneratedLawsuit {
  document: string;
  localRules: LocalRules;
  filingInstructions: string[];
  requiredDocuments: string[];
  estimatedFilingFee: number;
  ifrRequirements?: string;
  serviceRequirements: string[];
}

const DISTRICT_LOCAL_RULES: Record<string, LocalRules> = {
  'default': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
  'C.D. Cal.': {
    fontFamily: 'Times New Roman',
    fontSize: 14,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: true,
    maxLinesPerPage: 28,
    captionFormat: 'california-central',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'left',
  },
  'N.D. Cal.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: true,
    maxLinesPerPage: 28,
    captionFormat: 'california',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'left',
  },
  'S.D.N.Y.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: true,
    signatureBlock: 'right',
  },
  'E.D.N.Y.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: true,
    signatureBlock: 'right',
  },
  'N.D. Ill.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
  'S.D. Tex.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
  'D. Md.': {
    fontFamily: 'Times New Roman',
    fontSize: 13,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
  'M.D. Fla.': {
    fontFamily: 'Times New Roman',
    fontSize: 14,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
  'M.D. Pa.': {
    fontFamily: 'Times New Roman',
    fontSize: 14,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: true,
    signatureBlock: 'right',
  },
  'D. Or.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
  'W.D. Tex.': {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 'double',
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    lineNumbering: false,
    captionFormat: 'standard',
    paperSize: '8.5x11',
    footerRequired: false,
    signatureBlock: 'right',
  },
};

const CONSTITUTIONAL_PROVISIONS: Record<string, {
  amendment: string;
  rights: string;
  elements: string[];
  caselaw: string[];
}> = {
  'fourth-amendment-excessive-force': {
    amendment: 'Fourth Amendment',
    rights: 'Protection against unreasonable seizures; prohibition on excessive force',
    elements: [
      'Plaintiff was seized by defendant(s)',
      'Force used was objectively unreasonable under the circumstances',
      'Defendant(s) acted under color of state law',
      'Plaintiff suffered injury as a result',
    ],
    caselaw: [
      'Graham v. Connor, 490 U.S. 386 (1989)',
      'Tennessee v. Garner, 471 U.S. 1 (1985)',
      'Scott v. Harris, 550 U.S. 372 (2007)',
    ],
  },
  'fourth-amendment-false-arrest': {
    amendment: 'Fourth Amendment',
    rights: 'Protection against unreasonable seizures; requirement of probable cause for arrest',
    elements: [
      'Defendant(s) caused plaintiff to be detained/arrested',
      'Detention/arrest was without probable cause',
      'Defendant(s) acted under color of state law',
      'Plaintiff suffered damages as a result',
    ],
    caselaw: [
      'Malley v. Briggs, 475 U.S. 335 (1986)',
      'Devenpeck v. Alford, 543 U.S. 146 (2004)',
      'Atwater v. City of Lago Vista, 532 U.S. 318 (2001)',
    ],
  },
  'fourth-amendment-illegal-search': {
    amendment: 'Fourth Amendment',
    rights: 'Protection against unreasonable searches; warrant requirement',
    elements: [
      'Defendant(s) conducted a search of plaintiff\'s person, property, or effects',
      'Search was without a valid warrant or applicable exception',
      'Defendant(s) acted under color of state law',
      'Plaintiff had a reasonable expectation of privacy',
    ],
    caselaw: [
      'Mapp v. Ohio, 367 U.S. 643 (1961)',
      'Terry v. Ohio, 392 U.S. 1 (1968)',
      'Kyllo v. United States, 533 U.S. 27 (2001)',
    ],
  },
  'fourteenth-amendment-due-process': {
    amendment: 'Fourteenth Amendment',
    rights: 'Due Process Clause; protection of life, liberty, and property',
    elements: [
      'Plaintiff has a protected liberty or property interest',
      'Defendant(s) deprived plaintiff of that interest',
      'Deprivation was without due process of law',
      'Defendant(s) acted under color of state law',
    ],
    caselaw: [
      'Mathews v. Eldridge, 424 U.S. 319 (1976)',
      'County of Sacramento v. Lewis, 523 U.S. 833 (1998)',
      'Zinermon v. Burch, 494 U.S. 113 (1990)',
    ],
  },
  'fourteenth-amendment-equal-protection': {
    amendment: 'Fourteenth Amendment',
    rights: 'Equal Protection Clause; prohibition on discriminatory treatment',
    elements: [
      'Plaintiff is a member of a protected class or was treated differently than similarly situated persons',
      'Defendant(s) intentionally discriminated against plaintiff',
      'No rational basis (or compelling interest for suspect classes) existed for the differential treatment',
      'Defendant(s) acted under color of state law',
    ],
    caselaw: [
      'Village of Willowbrook v. Olech, 528 U.S. 562 (2000)',
      'Whren v. United States, 517 U.S. 806 (1996)',
      'Personnel Administrator of Massachusetts v. Feeney, 442 U.S. 256 (1979)',
    ],
  },
  'first-amendment-retaliation': {
    amendment: 'First Amendment',
    rights: 'Freedom of speech; right to petition government for redress of grievances',
    elements: [
      'Plaintiff engaged in constitutionally protected speech or conduct',
      'Defendant(s) took adverse action against plaintiff',
      'Adverse action was motivated by plaintiff\'s protected speech/conduct',
      'Defendant(s) acted under color of state law',
    ],
    caselaw: [
      'Hartman v. Moore, 547 U.S. 250 (2006)',
      'Crawford-El v. Britton, 523 U.S. 574 (1998)',
      'Lozman v. City of Riviera Beach, 138 S. Ct. 1945 (2018)',
    ],
  },
  'eighth-amendment-medical': {
    amendment: 'Eighth Amendment',
    rights: 'Prohibition on cruel and unusual punishment; right to adequate medical care',
    elements: [
      'Plaintiff had a serious medical need',
      'Defendant(s) knew of and disregarded an excessive risk to plaintiff\'s health',
      'Defendant(s) was deliberately indifferent to plaintiff\'s medical needs',
      'Defendant(s) acted under color of state law',
    ],
    caselaw: [
      'Estelle v. Gamble, 429 U.S. 97 (1976)',
      'Farmer v. Brennan, 511 U.S. 825 (1994)',
      'Wilson v. Seiter, 501 U.S. 294 (1991)',
    ],
  },
};

function getLocalRules(districtCourt: string): LocalRules {
  return DISTRICT_LOCAL_RULES[districtCourt] || DISTRICT_LOCAL_RULES['default'];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function generateDefendantCaption(defendants: DefendantInfo[]): string {
  return defendants.map((d, i) => {
    let caption = d.name.toUpperCase();
    if (d.title) caption += `, ${d.title}`;
    if (d.capacity === 'individual') {
      caption += ', in his/her individual capacity';
    } else if (d.capacity === 'official') {
      caption += ', in his/her official capacity';
    } else {
      caption += ', in his/her individual and official capacities';
    }
    if (i < defendants.length - 1) {
      caption += ';';
    }
    return caption;
  }).join('\n                              ');
}

/**
 * Generate a §1983 lawsuit complaint for U.S. District Court
 */
export function generateSection1983Lawsuit(data: Section1983LawsuitData): GeneratedLawsuit {
  const localRules = getLocalRules(data.jurisdiction.districtCourt);
  const filingDate = formatDate(new Date());
  const incidentDate = formatDate(data.incident.date);
  
  const plaintiffCaption = data.plaintiff.name.toUpperCase();
  const defendantCaption = generateDefendantCaption(data.defendants);

  const filerInfo = data.attorney ? 
    `${data.attorney.name}
${data.attorney.barNumber ? `Bar No. ${data.attorney.barNumber}` : ''}
${data.attorney.firmName || ''}
${data.attorney.address}
${data.attorney.city}, ${data.attorney.state} ${data.attorney.zipCode}
Telephone: ${data.attorney.phone}
${data.attorney.fax ? `Facsimile: ${data.attorney.fax}` : ''}
Email: ${data.attorney.email}

Attorney for Plaintiff` :
    `${data.plaintiff.name}
${data.plaintiff.address}
${data.plaintiff.city}, ${data.plaintiff.state} ${data.plaintiff.zipCode}
${data.plaintiff.phone ? `Telephone: ${data.plaintiff.phone}` : ''}
${data.plaintiff.email ? `Email: ${data.plaintiff.email}` : ''}

Plaintiff, Pro Se`;

  const lineNumbers = localRules.lineNumbering ? 
    Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, ' ')).join('\n') : '';

  const document = `
${localRules.lineNumbering ? `
 1
 2
 3
 4
 5
 6
 7
 8
 9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
` : ''}
${filerInfo}


                    UNITED STATES DISTRICT COURT

                    ${data.jurisdiction.districtCourt.toUpperCase()}
${data.jurisdiction.division ? `                    ${data.jurisdiction.division.toUpperCase()}` : ''}


${plaintiffCaption},            )
                              )
            Plaintiff,        )   Case No. ________________
                              )
        v.                    )   COMPLAINT FOR VIOLATION OF
                              )   CIVIL RIGHTS PURSUANT TO
${defendantCaption},          )   42 U.S.C. § 1983
                              )
            Defendants.       )   JURY TRIAL DEMANDED
______________________________)



                    COMPLAINT FOR VIOLATION OF CIVIL RIGHTS
                         PURSUANT TO 42 U.S.C. § 1983


                              INTRODUCTION

    1.  This is a civil rights action brought pursuant to 42 U.S.C. § 1983

and the Fourth, Eighth, and Fourteenth Amendments to the United States 

Constitution. Plaintiff ${data.plaintiff.name} brings this action against the 

above-named Defendants for violations of Plaintiff's constitutional rights 

arising from events that occurred on ${incidentDate}.


                         JURISDICTION AND VENUE

    2.  This Court has original jurisdiction over this action pursuant to

28 U.S.C. § 1331 (federal question jurisdiction) and 28 U.S.C. § 1343(a)(3)

and (4) (civil rights jurisdiction).

    3.  Venue is proper in this judicial district pursuant to 28 U.S.C.

§ 1391(b) because ${data.jurisdiction.venueReason}.

    4.  This action is brought pursuant to 42 U.S.C. § 1983, which provides

a remedy for the deprivation of rights, privileges, and immunities secured by

the Constitution and laws of the United States by persons acting under color

of state law.


                                PARTIES

    5.  Plaintiff ${data.plaintiff.name.toUpperCase()} is a citizen of the 

United States and a resident of ${data.plaintiff.city}, ${data.plaintiff.state}.

At all times relevant to this Complaint, Plaintiff was within the territorial

jurisdiction of Defendants.

${data.defendants.map((d, i) => `
    ${6 + i}.  Defendant ${d.name.toUpperCase()} is, and was at all times 

relevant to this Complaint, ${d.title ? `${d.title} and ` : ''}an employee of 

${d.department}${d.badgeNumber ? `, Badge Number ${d.badgeNumber}` : ''}. 

Defendant ${d.name} is sued in ${
  d.capacity === 'individual' ? 'his/her individual capacity' :
  d.capacity === 'official' ? 'his/her official capacity' :
  'both his/her individual and official capacities'
}. At all times relevant to this Complaint, Defendant ${d.name} was acting 

under color of state law. Defendant ${d.name}'s specific role in the events 

giving rise to this Complaint was: ${d.role}.
`).join('\n')}


                          STATEMENT OF FACTS

${data.incident.description.split('\n').map((para, i) => `
    ${6 + data.defendants.length + i}.  ${para}
`).join('\n')}

${data.incident.injuries ? `
    ${6 + data.defendants.length + data.incident.description.split('\n').length}.  

As a direct and proximate result of Defendants' conduct, Plaintiff sustained 

the following injuries: ${data.incident.injuries}.
` : ''}

${data.incident.witnesses && data.incident.witnesses.length > 0 ? `
    The following individuals witnessed the events described herein and may

provide testimony supporting Plaintiff's claims:

${data.incident.witnesses.map((w, i) => `        ${String.fromCharCode(97 + i)}.  ${w}`).join('\n')}
` : ''}


                     CAUSES OF ACTION

${data.claims.map(claim => {
  const provision = Object.values(CONSTITUTIONAL_PROVISIONS).find(p => 
    claim.constitutionalProvision.toLowerCase().includes(p.amendment.toLowerCase())
  );

  return `
                              COUNT ${toRomanNumeral(claim.claimNumber)}
                    (${claim.statute} - ${claim.constitutionalProvision})
                    (Against ${claim.defendantsInvolved.join(', ')})

    ${claim.claimNumber * 10 + 1}.  Plaintiff repeats and realleges each and every allegation 

contained in the foregoing paragraphs as if fully set forth herein.

    ${claim.claimNumber * 10 + 2}.  At all times relevant hereto, Defendants ${claim.defendantsInvolved.join(', ')}

acted under color of state law within the meaning of 42 U.S.C. § 1983.

    ${claim.claimNumber * 10 + 3}.  ${claim.description}

    ${claim.claimNumber * 10 + 4}.  ${claim.factualBasis}

${provision ? `
    ${claim.claimNumber * 10 + 5}.  The ${provision.amendment} to the United States Constitution

protects against ${provision.rights}.

    ${claim.claimNumber * 10 + 6}.  The elements of a ${provision.amendment} claim under 42 U.S.C. § 1983 are:

${provision.elements.map((e, i) => `        ${String.fromCharCode(97 + i)}.  ${e};`).join('\n')}

    ${claim.claimNumber * 10 + 7}.  Controlling precedent for this claim includes:

${provision.caselaw.map((c, i) => `        ${String.fromCharCode(97 + i)}.  ${c};`).join('\n')}
` : ''}

    ${claim.claimNumber * 10 + 8}.  As a direct and proximate result of Defendants' actions,

Plaintiff has suffered and continues to suffer damages including, but not limited

to, physical injury, emotional distress, mental anguish, humiliation, and

deprivation of civil rights.
`;
}).join('\n')}


                          DAMAGES

    ${data.claims.length * 10 + 10}.  As a direct and proximate result of the conduct of Defendants 

as alleged herein, Plaintiff has suffered and continues to suffer the following 

damages:

        a.  Compensatory damages, including:
${data.damages.compensatory.medicalExpenses ? `            (i)   Medical expenses in an amount to be proven at trial;` : ''}
${data.damages.compensatory.lostWages ? `            (ii)  Lost wages and loss of earning capacity;` : ''}
${data.damages.compensatory.painAndSuffering ? `            (iii) Pain and suffering;` : ''}
${data.damages.compensatory.emotionalDistress ? `            (iv)  Emotional distress and mental anguish;` : ''}
${data.damages.compensatory.description ? `            (v)   ${data.damages.compensatory.description};` : ''}

${data.damages.punitive ? `
        b.  Punitive damages in an amount sufficient to punish Defendants for

their willful, wanton, and reckless conduct, and to deter similar conduct in

the future${data.damages.punitiveDescription ? `, based on: ${data.damages.punitiveDescription}` : ''};
` : ''}

${data.damages.injunctiveRelief ? `
        c.  Injunctive relief, including: ${data.damages.injunctiveRelief};
` : ''}

${data.damages.declaratoryRelief ? `
        d.  Declaratory relief, including: ${data.damages.declaratoryRelief};
` : ''}

${data.damages.attorneysFees ? `
        e.  Reasonable attorneys' fees and costs of suit pursuant to 42 U.S.C.

§ 1988;
` : ''}

        f.  Such other and further relief as this Court deems just and proper.


                        JURY DEMAND

    Plaintiff hereby demands a trial by jury on all issues so triable.


                        PRAYER FOR RELIEF

    WHEREFORE, Plaintiff ${data.plaintiff.name.toUpperCase()} respectfully 

requests that this Court:

    A.  Accept jurisdiction over this matter;

    B.  Enter judgment in favor of Plaintiff and against Defendants;

    C.  Award Plaintiff compensatory damages in an amount to be determined

at trial;

${data.damages.punitive ? `
    D.  Award Plaintiff punitive damages in an amount sufficient to punish

Defendants and deter similar conduct;
` : ''}

${data.damages.attorneysFees ? `
    E.  Award Plaintiff reasonable attorneys' fees and costs pursuant to

42 U.S.C. § 1988;
` : ''}

    F.  Grant such other and further relief as the Court deems just and proper.


Dated: ${filingDate}

                              Respectfully submitted,


                              _________________________________
                              ${data.attorney ? data.attorney.name : data.plaintiff.name}
                              ${data.attorney ? `Attorney for Plaintiff` : `Plaintiff, Pro Se`}
                              ${data.attorney ? data.attorney.address : data.plaintiff.address}
                              ${data.attorney ? `${data.attorney.city}, ${data.attorney.state} ${data.attorney.zipCode}` : `${data.plaintiff.city}, ${data.plaintiff.state} ${data.plaintiff.zipCode}`}
                              ${data.attorney ? `Tel: ${data.attorney.phone}` : data.plaintiff.phone ? `Tel: ${data.plaintiff.phone}` : ''}
                              ${data.attorney ? `Email: ${data.attorney.email}` : data.plaintiff.email ? `Email: ${data.plaintiff.email}` : ''}
`;

  const filingInstructions = [
    `File this complaint with the Clerk of the ${data.jurisdiction.districtCourt}`,
    'Complete and attach the Civil Cover Sheet (Form JS 44)',
    'Prepare a Summons for each Defendant (Form AO 440)',
    `Pay the filing fee of $402.00 OR submit an Application to Proceed In Forma Pauperis`,
    'Make at least 3 copies of all documents for your records',
    'Serve each Defendant within 90 days of filing pursuant to FRCP Rule 4',
    'File Proof of Service with the Court after service is complete',
  ];

  const requiredDocuments = [
    'Original Complaint (this document)',
    'Civil Cover Sheet (Form JS 44)',
    `Summons (Form AO 440) - ${data.defendants.length} copies`,
    'Filing fee ($402) OR In Forma Pauperis Application',
    'Proposed Summons for each Defendant',
  ];

  const serviceRequirements = [
    'Service must be completed within 90 days of filing',
    'Service must be made by a person who is at least 18 years old and not a party to the lawsuit',
    'Personal service: Deliver a copy to the Defendant personally',
    'Substitute service: Leave a copy at Defendant\'s dwelling with a person of suitable age',
    'Service on government entity: Follow procedures in FRCP Rule 4(j)',
    'File Proof of Service (Form AO 440) with the Court after service is complete',
  ];

  return {
    document,
    localRules,
    filingInstructions,
    requiredDocuments,
    estimatedFilingFee: 402,
    ifrRequirements: 'If you cannot afford the filing fee, you may apply to proceed in forma pauperis. Complete the Application to Proceed Without Prepayment of Fees and submit financial documentation.',
    serviceRequirements,
  };
}

function toRomanNumeral(num: number): string {
  const romanNumerals: [number, string][] = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let result = '';
  for (const [value, symbol] of romanNumerals) {
    while (num >= value) {
      result += symbol;
      num -= value;
    }
  }
  return result;
}

/**
 * Generate claims based on incident type
 */
export function generateClaims(
  incidentType: string,
  defendants: DefendantInfo[],
  factualDescription: string
): ClaimInfo[] {
  const claims: ClaimInfo[] = [];
  const defendantNames = defendants.map(d => d.name);
  let claimNumber = 1;

  const incidentTypeLower = incidentType.toLowerCase();

  if (incidentTypeLower.includes('force') || incidentTypeLower.includes('assault')) {
    claims.push({
      claimNumber: claimNumber++,
      constitutionalProvision: 'Fourth Amendment - Excessive Force',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants used excessive force against Plaintiff in violation of the Fourth Amendment\'s prohibition against unreasonable seizures.',
      defendantsInvolved: defendantNames,
      factualBasis: `The force used by Defendants was objectively unreasonable under the circumstances. Specifically: ${factualDescription}`,
    });
  }

  if (incidentTypeLower.includes('arrest') || incidentTypeLower.includes('detention')) {
    claims.push({
      claimNumber: claimNumber++,
      constitutionalProvision: 'Fourth Amendment - False Arrest/Unlawful Detention',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants arrested and/or detained Plaintiff without probable cause in violation of the Fourth Amendment.',
      defendantsInvolved: defendantNames,
      factualBasis: `Defendants lacked probable cause or any lawful justification to arrest or detain Plaintiff. ${factualDescription}`,
    });
  }

  if (incidentTypeLower.includes('search') || incidentTypeLower.includes('seizure')) {
    claims.push({
      claimNumber: claimNumber++,
      constitutionalProvision: 'Fourth Amendment - Illegal Search and Seizure',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants conducted an unlawful search and/or seizure in violation of the Fourth Amendment.',
      defendantsInvolved: defendantNames,
      factualBasis: `Defendants searched Plaintiff and/or Plaintiff's property without a warrant, consent, or applicable exception. ${factualDescription}`,
    });
  }

  if (incidentTypeLower.includes('discrimination') || incidentTypeLower.includes('racial')) {
    claims.push({
      claimNumber: claimNumber++,
      constitutionalProvision: 'Fourteenth Amendment - Equal Protection',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants subjected Plaintiff to discriminatory treatment in violation of the Equal Protection Clause of the Fourteenth Amendment.',
      defendantsInvolved: defendantNames,
      factualBasis: `Defendants intentionally discriminated against Plaintiff based on protected characteristics. ${factualDescription}`,
    });
  }

  if (incidentTypeLower.includes('retaliation') || incidentTypeLower.includes('speech')) {
    claims.push({
      claimNumber: claimNumber++,
      constitutionalProvision: 'First Amendment - Retaliation',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants retaliated against Plaintiff for exercising constitutionally protected rights.',
      defendantsInvolved: defendantNames,
      factualBasis: `Defendants took adverse action against Plaintiff in response to Plaintiff's exercise of First Amendment rights. ${factualDescription}`,
    });
  }

  if (incidentTypeLower.includes('medical') || incidentTypeLower.includes('health')) {
    claims.push({
      claimNumber: claimNumber++,
      constitutionalProvision: 'Fourteenth Amendment - Due Process (Deliberate Indifference)',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants exhibited deliberate indifference to Plaintiff\'s serious medical needs.',
      defendantsInvolved: defendantNames,
      factualBasis: `Defendants knew of and disregarded Plaintiff's serious medical needs. ${factualDescription}`,
    });
  }

  if (claims.length === 0) {
    claims.push({
      claimNumber: 1,
      constitutionalProvision: 'Fourteenth Amendment - Due Process',
      statute: '42 U.S.C. § 1983',
      description: 'Defendants violated Plaintiff\'s rights to due process under the Fourteenth Amendment.',
      defendantsInvolved: defendantNames,
      factualBasis: factualDescription,
    });
  }

  return claims;
}

export {
  DISTRICT_LOCAL_RULES,
  CONSTITUTIONAL_PROVISIONS,
  getLocalRules,
};
