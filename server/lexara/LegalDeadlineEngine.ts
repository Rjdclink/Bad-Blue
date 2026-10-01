export type LegalDeadlineRuleId =
  | 'federal-civil-answer'
  | 'federal-civil-appeal'
  | 'federal-civil-appeal-us-party'
  | 'federal-criminal-appeal-defendant';

export interface LegalDeadlineRule {
  id: LegalDeadlineRuleId;
  label: string;
  days: number;
  ruleCitation: string;
  sourceUrl: string;
  triggerDescription: string;
}

export interface LegalDeadlineCalculation {
  rule: LegalDeadlineRule;
  triggerDate: string;
  dueDate: string;
  adjustedForWeekendOrHoliday: boolean;
  basis: string;
  limitations: string;
}

const FEDERAL_CIVIL_RULES_URL =
  'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-civil-procedure';
const FEDERAL_APPELLATE_RULES_URL =
  'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-appellate-procedure';

export const LEGAL_DEADLINE_RULES: Record<LegalDeadlineRuleId, LegalDeadlineRule> = {
  'federal-civil-answer': {
    id: 'federal-civil-answer',
    label: 'Federal civil answer after service of summons and complaint',
    days: 21,
    ruleCitation: 'Fed. R. Civ. P. 12(a)(1)(A)(i), computed under Fed. R. Civ. P. 6(a)',
    sourceUrl: FEDERAL_CIVIL_RULES_URL,
    triggerDescription: 'date the defendant was served with the summons and complaint',
  },
  'federal-civil-appeal': {
    id: 'federal-civil-appeal',
    label: 'Federal civil notice of appeal',
    days: 30,
    ruleCitation: 'Fed. R. App. P. 4(a)(1)(A)',
    sourceUrl: FEDERAL_APPELLATE_RULES_URL,
    triggerDescription: 'entry of the judgment or order appealed from',
  },
  'federal-civil-appeal-us-party': {
    id: 'federal-civil-appeal-us-party',
    label: 'Federal civil notice of appeal when the United States or qualifying federal officer/agency is a party',
    days: 60,
    ruleCitation: 'Fed. R. App. P. 4(a)(1)(B)',
    sourceUrl: FEDERAL_APPELLATE_RULES_URL,
    triggerDescription: 'entry of the judgment or order appealed from',
  },
  'federal-criminal-appeal-defendant': {
    id: 'federal-criminal-appeal-defendant',
    label: 'Federal criminal defendant notice of appeal',
    days: 14,
    ruleCitation: 'Fed. R. App. P. 4(b)(1)(A)',
    sourceUrl: FEDERAL_APPELLATE_RULES_URL,
    triggerDescription: 'the later of entry of the judgment/order appealed from or filing of the government notice of appeal',
  },
};

function isoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date : null;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function observedFixedHoliday(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) return isoDate(year, monthIndex, day - 1);
  if (weekday === 0) return isoDate(year, monthIndex, day + 1);
  return isoDate(year, monthIndex, day);
}

function nthWeekday(year: number, monthIndex: number, weekday: number, ordinal: number): string {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(year, monthIndex, 1 + offset + 7 * (ordinal - 1));
}

function lastWeekday(year: number, monthIndex: number, weekday: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return isoDate(year, monthIndex, last.getUTCDate() - offset);
}

export function federalObservedHolidays(year: number): Set<string> {
  return new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekday(year, 0, 1, 3),
    nthWeekday(year, 1, 1, 3),
    lastWeekday(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 9, 1, 2),
    observedFixedHoliday(year, 10, 11),
    nthWeekday(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
    // New Year's Day for the following year can be observed on December 31
    // of the current year when January 1 falls on a Saturday.
    observedFixedHoliday(year + 1, 0, 1),
  ]);
}

function isWeekendOrFederalHoliday(date: Date): boolean {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  return federalObservedHolidays(date.getUTCFullYear()).has(date.toISOString().slice(0, 10));
}

export function calculateLegalDeadline(ruleId: LegalDeadlineRuleId, triggerDate: string): LegalDeadlineCalculation | null {
  const rule = LEGAL_DEADLINE_RULES[ruleId];
  const trigger = parseIsoDate(triggerDate);
  if (!rule || !trigger) return null;

  let due = addDays(trigger, rule.days);
  const unadjusted = due.toISOString().slice(0, 10);
  while (isWeekendOrFederalHoliday(due)) due = addDays(due, 1);
  const dueDate = due.toISOString().slice(0, 10);

  return {
    rule,
    triggerDate,
    dueDate,
    adjustedForWeekendOrHoliday: dueDate !== unadjusted,
    basis: `${rule.ruleCitation}. The trigger day is excluded, intermediate calendar days are counted, and a last day falling on a Saturday, Sunday, or federal legal holiday rolls forward under the federal time-computation rules.`,
    limitations: 'This is the federal baseline. A statute, local rule, court order, post-judgment motion, service method, clerk inaccessibility, state holiday, or case-specific event can change the deadline and must be checked before filing.',
  };
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function extractDatesFromText(text: string): string[] {
  const dates = new Set<string>();

  for (const match of text.matchAll(/\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/g)) {
    if (parseIsoDate(match[0])) dates.add(match[0]);
  }

  for (const match of text.matchAll(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2}|19\d{2})\b/g)) {
    const value = `${match[3]}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
    if (parseIsoDate(value)) dates.add(value);
  }

  for (const match of text.matchAll(/\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept?|October|Oct|November|Nov|December|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2}|19\d{2})\b/gi)) {
    const month = MONTHS[match[1].toLowerCase()];
    const value = `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
    if (parseIsoDate(value)) dates.add(value);
  }

  return [...dates];
}

export function extractDateFromText(text: string): string | null {
  return extractDatesFromText(text)[0] || null;
}

export function inferLegalDeadlineFromPrompt(prompt: string, jurisdiction?: string): LegalDeadlineCalculation | null {
  const text = String(prompt || '');
  const federal = /\bfederal\b/i.test(text) || /\bfederal\b/i.test(String(jurisdiction || ''));
  if (!federal) return null;
  const triggerDates = extractDatesFromText(text);
  // If multiple distinct dates are present, the language layer must establish
  // which one is the legal trigger before deterministic arithmetic is allowed.
  if (triggerDates.length !== 1) return null;
  const triggerDate = triggerDates[0];

  const asksDeadline = /\b(?:deadline|due|when\s+(?:is|does|must|should)|how\s+long|time\s+to|days?\s+to)\b/i.test(text);
  if (!asksDeadline) return null;

  if (/\b(?:answer|respond|responsive pleading)\b/i.test(text)
    && /\b(?:served|service|summons|complaint)\b/i.test(text)) {
    // Rule 12 contains distinct periods for waived service and federal
    // defendants. Do not force the ordinary 21-day rule across those facts.
    if (/\b(?:waiv(?:e|ed|er)|rule\s*4\(d\)|united states|u\.s\.\s+(?:agency|officer|employee)|federal\s+(?:agency|officer|employee))\b/i.test(text)) {
      return null;
    }
    return calculateLegalDeadline('federal-civil-answer', triggerDate);
  }

  if (/\bappeal|notice of appeal\b/i.test(text)) {
    // Timely post-judgment motions can suspend the civil appeal clock.
    const tollingMotion = /\b(?:rule\s*(?:50\(b\)|52\(b\)|54|59|60)|post[- ]judgment motion|motion for new trial|alter or amend|relief from judgment)\b/i.test(text);
    if (/\b(?:criminal|conviction|sentence|sentenced|criminal defendant)\b/i.test(text)) {
      // If a government notice of appeal exists, Rule 4(b)(1)(A) uses the later
      // of that filing and judgment. Do not calculate unless that comparison is
      // already resolved by the supplied facts.
      if (/\bgovernment\s+(?:filed|files?)\s+(?:a\s+)?notice of appeal\b/i.test(text)) return null;
      const clearTrigger = /\b(?:judgment|order)\s+(?:was\s+)?entered\b/i.test(text);
      return clearTrigger
        ? calculateLegalDeadline('federal-criminal-appeal-defendant', triggerDate)
        : null;
    }
    if (/\b(?:civil|judgment|order)\b/i.test(text) && !tollingMotion) {
      if (/\b(?:another|other)\s+party\b[\s\S]{0,80}\bnotice of appeal\b/i.test(text)) return null;

      const federalGovernmentMarker = /\b(?:united states|u\.s\.\s+(?:agency|officer|employee)|federal\s+(?:agency|officer|employee))\b/i.test(text);
      const explicitFederalParty = federalGovernmentMarker && (
        /\b(?:party|plaintiff|defendant|appellant|appellee|sued)\b/i.test(text)
        || /\bUnited States\s+v\.|\bv\.\s+United States\b/i.test(text)
      );
      if (federalGovernmentMarker && !explicitFederalParty) return null;

      return calculateLegalDeadline(
        explicitFederalParty ? 'federal-civil-appeal-us-party' : 'federal-civil-appeal',
        triggerDate,
      );
    }
  }

  return null;
}

export function formatDeadlineCalculationForSystem(calculation: LegalDeadlineCalculation | null): string {
  if (!calculation) return '';
  return `\n\nAPPLICATION-CALCULATED LEGAL DEADLINE
LegalWhat deterministically calculated a federal baseline deadline from a recognized rule and an explicit trigger date in the user's text.
Deadline: ${calculation.dueDate}
Trigger date: ${calculation.triggerDate}
Rule: ${calculation.rule.ruleCitation}
Official rules source: ${calculation.rule.sourceUrl}
Basis: ${calculation.basis}
Limitations: ${calculation.limitations}
Use this date only for the specific recognized rule. State the deadline directly, identify the rule, and make the case-specific limitation concise. Do not recalculate it with the language model.`;
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function compactDate(value: string): string {
  return value.replace(/-/g, '');
}

export function buildDeadlineCalendar(calculation: LegalDeadlineCalculation): string {
  const start = compactDate(calculation.dueDate);
  const endDate = addDays(parseIsoDate(calculation.dueDate)!, 1).toISOString().slice(0, 10);
  const end = compactDate(endDate);
  const uid = `legalwhat-${calculation.rule.id}-${calculation.triggerDate}-${calculation.dueDate}@legalwhat.com`;
  const description = icsEscape(`${calculation.basis}\n${calculation.limitations}\nSource: ${calculation.rule.sourceUrl}`);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LegalWhat//Lexara Legal Deadline//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsEscape('Legal deadline: ' + calculation.rule.label)}`,
    `DESCRIPTION:${description}`,
    'BEGIN:VALARM',
    'TRIGGER:-P7D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Legal deadline in 7 days',
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Legal deadline tomorrow',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
