import assert from 'node:assert/strict';
import { PANTHEON_REPORT_CATEGORY_LABELS, getPantheonCategoryExtractionSchema } from '../server/services/pantheon/PantheonCrawlerCapabilityMatrix';
import {
  classifyPantheonSemanticCategories,
  PANTHEON_REPORT_CATEGORY_TO_BACKGROUND_CATEGORIES,
} from '../server/lexara/LexaraPantheonSemanticIntent';
import { resolveLexaraBackgroundSubject } from '../server/lexara/LexaraBackgroundSubject';
import { planLexaraSequence } from '../server/lexara/LexaraSequenceRouter';
import { investigatePersonQuestion } from '../server/lexara/LexaraPantheonInvestigation';

const categoryPrompts: Array<[string, string]> = [
  ['Who is Jane Doe, and what names has she used?', 'Identity & Identity Verification'],
  ['Is Jane Doe’s telephone number public?', 'Phone Numbers'],
  ['Where can Jane Doe be reached by e-mail?', 'Email Addresses'],
  ['What is Jane Doe’s present residence?', 'Current Address'],
  ['Where did Jane Doe live before?', 'Address History'],
  ['Who are Jane Doe’s next of kin?', 'Relatives & Family'],
  ['Is Jane Doe linked to any associates?', 'Associates & Household Connections'],
  ['Show Jane Doe’s Instagram presence.', 'Social-Media Profiles'],
  ['What screen name does Jane Doe use?', 'Usernames & Online Accounts'],
  ['Do any public photos show Jane Doe?', 'Photos & Public Images'],
  ['Where is Jane Doe employed now?', 'Employment History'],
  ['Which degrees did Jane Doe earn?', 'Education'],
  ['Is Jane Doe professionally licensed?', 'Professional Licenses & Credentials'],
  ['What are Jane Doe’s business interests?', 'Business Ownership & Affiliations'],
  ['Does Jane Doe own real property?', 'Property & Real Estate'],
  ['Can we find Jane Doe’s VIN?', 'Vehicles & Transportation Records'],
  ['What is the docket for Jane Doe?', 'Court Records'],
  ['Any convictions for Jane Doe?', 'Criminal Records'],
  ['Did the police book Jane Doe?', 'Arrest & Police Records'],
  ['Is Jane Doe currently detained?', 'Incarceration & Corrections'],
  ['Is Jane Doe under community supervision?', 'Probation & Parole Information'],
  ['Is there an outstanding warrant for Jane Doe?', 'Warrants & Wanted-Person Records'],
  ['Does Jane Doe appear on the sexual offender registry?', 'Sex-Offender Registries'],
  ['Has Jane Doe been sued?', 'Civil Litigation & Judgments'],
  ['Has Jane Doe filed for bankruptcy?', 'Bankruptcies, Liens & Financial Public Records'],
  ['Does Jane Doe have a spouse?', 'Marriage, Divorce & Vital-Record Information'],
  ['Any press coverage on Jane Doe?', 'News & Media Mentions'],
  ['What is Jane Doe’s digital footprint?', 'Internet & Web Footprint'],
  ['Has Jane Doe held public office?', 'Government, Political & Public-Service Records'],
  ['Trace the event sequence for Jane Doe.', 'Relationship & Timeline Intelligence'],
];

assert.equal(PANTHEON_REPORT_CATEGORY_LABELS.length, 30);
for (const [prompt, expected] of categoryPrompts) {
  const matches = classifyPantheonSemanticCategories(prompt);
  assert.equal(matches[0]?.label, expected, `natural wording resolves ${expected}: ${prompt}`);
  assert.ok(matches.length >= 1);
  assert.ok(PANTHEON_REPORT_CATEGORY_TO_BACKGROUND_CATEGORIES[expected as keyof typeof PANTHEON_REPORT_CATEGORY_TO_BACKGROUND_CATEGORIES].length > 0,
    `${expected} maps into executable Pantheon source categories`);
  assert.ok(getPantheonCategoryExtractionSchema(expected).objectiveFields.length > 0,
    `${expected} has its evidence extraction contract`);
  const plan = planLexaraSequence(prompt);
  assert.equal(plan.usePantheon, true, `${expected} enters Pantheon from natural language`);
  assert.equal(plan.classifyPantheon, true, `${expected} requests category-aware retrieval`);
  const investigation = await investigatePersonQuestion(prompt);
  assert.equal(investigation?.endpoint, 'clarification-required',
    `${expected} reaches Pantheon without requiring an external retrieval provider`);
  assert.equal(investigation?.reportCategoryLabels?.[0], expected,
    `${expected} survives the investigation handoff and identity clarification`);
}

const multiIntent = classifyPantheonSemanticCategories(
  'Check the phone number, school degrees, and any criminal convictions for Jane Doe in Iowa.',
);
assert.deepEqual(new Set(multiIntent.map(match => match.label)), new Set([
  'Phone Numbers',
  'Education',
  'Criminal Records',
]));

const contextualHistory = [
  'Could you identify Jane Doe, born in 1985, in Des Moines, Iowa?',
  'What is known about her employment history?',
];
const followup = 'And what about her professional license and where she lived before?';
const followupMatches = classifyPantheonSemanticCategories(followup, contextualHistory);
assert.deepEqual(new Set(followupMatches.map(match => match.label)), new Set([
  'Professional Licenses & Credentials',
  'Address History',
]));
const followupPlan = planLexaraSequence(followup, contextualHistory);
assert.equal(followupPlan.usePantheon, true, 'contextual follow-up continues through Pantheon');
const inheritedSubject = resolveLexaraBackgroundSubject(followup, contextualHistory, 'Iowa');
assert.equal(inheritedSubject?.name, 'Jane Doe', 'follow-up keeps the previous identifiable subject');
assert.equal(inheritedSubject?.location, 'Iowa', 'follow-up keeps the established jurisdiction');

const impliedFollowup = 'What about that?';
assert.equal(
  classifyPantheonSemanticCategories(impliedFollowup, ['Jane Doe professional license status']).at(0)?.label,
  'Professional Licenses & Credentials',
  'a context-only reference inherits a recent category rather than losing its subject',
);
assert.equal(
  planLexaraSequence(impliedFollowup, ['Jane Doe professional license status']).usePantheon,
  true,
  'a context-only reference reaches Pantheon to resolve or clarify its subject',
);

assert.equal(classifyPantheonSemanticCategories('Explain general contract law.').length, 0,
  'ordinary legal analysis does not accidentally enter a Pantheon category');
assert.equal(planLexaraSequence('Explain general contract law.').usePantheon, false);
const repeat = planLexaraSequence('What did you say?', ['My neighbor damaged my lawn.']);
assert.equal(repeat.sequence, 'conversation-only', 'conversation recall cannot launch Pantheon');
assert.equal(repeat.usePantheon, false);
const demand = planLexaraSequence('I live in Spirit Lake, Iowa. My neighbor’s dog keeps fouling my lawn. Draft me a demand letter.');
assert.equal(demand.documentAction, true);
assert.equal(demand.useLegalResearch, true, 'legal drafting retains the legal lane');
assert.equal(demand.usePantheon, false, 'a legal demand letter does not imply a neighbor investigation');
const mixed = planLexaraSequence('Find Jane Doe’s court records in Iowa and explain the legal options they establish.');
assert.equal(mixed.usePantheon, true, 'explicit background records use Pantheon');
assert.equal(mixed.useLegalResearch, true, 'mixed turn also runs legal analysis');

const ambiguousIdentity = await investigatePersonQuestion('What is Jane Doe’s professional license status?');
assert.equal(ambiguousIdentity?.endpoint, 'clarification-required',
  'an ambiguous person identity asks for more identifying detail instead of guessing');
assert.equal(ambiguousIdentity?.reportCategoryLabels?.[0], 'Professional Licenses & Credentials',
  'clarification preserves the selected category for the eventual investigation');

console.log(`Lexara semantic intent routing passed (${categoryPrompts.length}/30 categories, multi-intent, follow-ups and safe clarification).`);
