/**
 * F.M.I. NLP Worker
 * 
 * Specialized NLP worker for Forensic Media Intelligence (F.M.I.) that performs:
 * - Entity extraction (people, organizations, locations, dates, statutes, courts, agencies)
 * - Relationship extraction (actor-action-target, subject-verb-object)
 * - Timeline reconstruction from events and dates
 * - Keyphrase extraction
 * - Legal/evidentiary tagging (threats, admissions, inconsistencies, corroborations)
 */

import nlp from 'compromise';
import { TfIdf, PorterStemmer, WordTokenizer } from 'natural';
import { createLogger } from '../../logger';

const log = createLogger('FMINLPWorker');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface FMITextInput {
  text: string;
  source: 'ocr' | 'transcript' | 'upload' | 'email';
  metadata?: {
    fileName?: string;
    fileType?: string;
    uploadDate?: Date;
    caseId?: string;
  };
}

export interface ExtractedEntity {
  type: 'person' | 'organization' | 'location' | 'date' | 'statute' | 'court' | 'agency' | 'email' | 'phone';
  value: string;
  role?: 'victim' | 'respondent' | 'officer' | 'witness' | 'judge' | 'attorney' | 'agency-rep';
  context: string; // surrounding text
  confidence: number; // 0-1
}

export interface ExtractedRelationship {
  subject: string;
  action: string;
  target: string;
  context: string;
  type: 'action' | 'possession' | 'communication' | 'location' | 'temporal';
  confidence: number;
}

export interface TimelineEvent {
  date: string;
  event: string;
  entities: string[];
  importance: 'high' | 'medium' | 'low';
  eventType: 'incident' | 'communication' | 'filing' | 'hearing' | 'decision' | 'action';
}

export interface Keyphrase {
  phrase: string;
  relevance: number; // 0-1
  category: 'fact' | 'legal-issue' | 'evidence' | 'claim' | 'defense';
}

export interface EvidentiaryTag {
  type: 'threat' | 'admission' | 'inconsistency' | 'corroboration' | 'contradiction' | 
        'exculpatory' | 'inculpatory' | 'hearsay' | 'impeachment';
  content: string;
  context: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}

export interface FMINLPResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  timeline: TimelineEvent[];
  keyphrases: Keyphrase[];
  evidentiaryTags: EvidentiaryTag[];
  summary: {
    totalEntities: number;
    totalRelationships: number;
    totalEvents: number;
    keyIssues: string[];
    legalConcerns: string[];
  };
}

// ============================================================================
// ENTITY EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract named entities from text
 */
function extractNamedEntities(text: string): ExtractedEntity[] {
  const doc = nlp(text);
  const entities: ExtractedEntity[] = [];

  // Extract people
  doc.people().forEach((person: any) => {
    const name = person.text();
    entities.push({
      type: 'person',
      value: name,
      context: extractContext(text, name),
      confidence: 0.85
    });
  });

  // Extract organizations
  doc.organizations().forEach((org: any) => {
    const name = org.text();
    entities.push({
      type: 'organization',
      value: name,
      context: extractContext(text, name),
      confidence: 0.80
    });
  });

  // Extract locations
  doc.places().forEach((place: any) => {
    const location = place.text();
    entities.push({
      type: 'location',
      value: location,
      context: extractContext(text, location),
      confidence: 0.75
    });
  });

  // Extract dates
  doc.dates().forEach((date: any) => {
    const dateStr = date.text();
    entities.push({
      type: 'date',
      value: dateStr,
      context: extractContext(text, dateStr),
      confidence: 0.90
    });
  });

  return entities;
}

/**
 * Extract legal entities (statutes, courts, agencies)
 */
function extractLegalEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Extract statute references
  const statutePatterns = [
    /\b(?:§|Section|Sec\.|§§)\s*(\d+(?:\.\d+)?(?:[A-Za-z])?)/gi,
    /\b(\d+\s+U\.?S\.?C\.?\s+§?\s*\d+)/gi,
    /\b(Title\s+\d+[^.]{0,50})/gi
  ];

  statutePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({
        type: 'statute',
        value: match[0].trim(),
        context: extractContext(text, match[0]),
        confidence: 0.95
      });
    }
  });

  // Extract court references
  const courtPatterns = [
    /\b(Supreme Court|District Court|Circuit Court|Court of Appeals|Municipal Court|County Court)/gi,
    /\b([A-Z][a-z]+\s+(?:Superior|District|Circuit)\s+Court)/gi
  ];

  courtPatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({
        type: 'court',
        value: match[0].trim(),
        context: extractContext(text, match[0]),
        confidence: 0.90
      });
    }
  });

  // Extract agency references
  const agencyPatterns = [
    /\b(FBI|CIA|DEA|ATF|ICE|DHS|DOJ|EEOC|OSHA|EPA|FTC|SEC)/gi,
    /\b(Police Department|Sheriff'?s? Office|Department of [A-Z][a-z]+)/gi
  ];

  agencyPatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({
        type: 'agency',
        value: match[0].trim(),
        context: extractContext(text, match[0]),
        confidence: 0.85
      });
    }
  });

  return entities;
}

/**
 * Extract contact information
 */
function extractContactEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Extract emails
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = text.matchAll(emailPattern);
  for (const match of emails) {
    entities.push({
      type: 'email',
      value: match[0],
      context: extractContext(text, match[0]),
      confidence: 1.0
    });
  }

  // Extract phone numbers
  const phonePattern = /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
  const phones = text.matchAll(phonePattern);
  for (const match of phones) {
    entities.push({
      type: 'phone',
      value: match[0],
      context: extractContext(text, match[0]),
      confidence: 0.95
    });
  }

  return entities;
}

/**
 * Extract context around a term
 */
function extractContext(text: string, term: string, windowSize: number = 50): string {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return '';

  const start = Math.max(0, index - windowSize);
  const end = Math.min(text.length, index + term.length + windowSize);
  
  return '...' + text.substring(start, end).trim() + '...';
}

// ============================================================================
// RELATIONSHIP EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract relationships from text
 */
function extractRelationships(text: string): ExtractedRelationship[] {
  const doc = nlp(text);
  const relationships: ExtractedRelationship[] = [];

  // Extract verb phrases with subjects and objects
  const sentences = doc.sentences().out('array');
  
  sentences.forEach((sentence: string) => {
    const sentenceDoc = nlp(sentence);
    
    // Simple subject-verb-object extraction
    const subjects = sentenceDoc.match('#Noun+').out('array');
    const verbs = sentenceDoc.verbs().out('array');
    const objects = sentenceDoc.match('(#Verb+) #Noun+').out('array');

    if (subjects.length > 0 && verbs.length > 0) {
      const subject = subjects[0];
      const verb = verbs[0];
      const target = objects.length > 0 ? objects[0].replace(verb, '').trim() : '';

      if (subject && verb && target) {
        relationships.push({
          subject,
          action: verb,
          target,
          context: sentence,
          type: classifyRelationship(verb),
          confidence: 0.7
        });
      }
    }
  });

  return relationships;
}

/**
 * Classify relationship type based on verb
 */
function classifyRelationship(verb: string): ExtractedRelationship['type'] {
  const lowerVerb = verb.toLowerCase();
  
  if (/send|email|call|text|message|communicate/.test(lowerVerb)) {
    return 'communication';
  }
  if (/have|own|possess|hold/.test(lowerVerb)) {
    return 'possession';
  }
  if (/at|in|near|from/.test(lowerVerb)) {
    return 'location';
  }
  if (/before|after|during|when/.test(lowerVerb)) {
    return 'temporal';
  }
  
  return 'action';
}

// ============================================================================
// TIMELINE RECONSTRUCTION
// ============================================================================

/**
 * Build timeline from dates and events
 */
function buildTimeline(text: string, entities: ExtractedEntity[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const sentences = nlp(text).sentences().out('array');
  
  // Find dates
  const dates = entities.filter(e => e.type === 'date');
  
  sentences.forEach((sentence: string, index: number) => {
    // Check if sentence contains a date
    const containsDate = dates.some(d => sentence.includes(d.value));
    
    if (containsDate) {
      const date = dates.find(d => sentence.includes(d.value));
      const involvedEntities = entities
        .filter(e => sentence.includes(e.value) && e.type !== 'date')
        .map(e => e.value);

      events.push({
        date: date?.value || 'Unknown date',
        event: sentence,
        entities: involvedEntities,
        importance: classifyEventImportance(sentence),
        eventType: classifyEventType(sentence)
      });
    }
  });

  // Sort by date (simple chronological order)
  return events;
}

/**
 * Classify event importance
 */
function classifyEventImportance(event: string): TimelineEvent['importance'] {
  const highImportanceTerms = /arrest|charge|convicted|sentenced|filed|lawsuit|complaint|hearing|trial|verdict/i;
  const mediumImportanceTerms = /incident|report|investigation|interview|statement|document/i;
  
  if (highImportanceTerms.test(event)) return 'high';
  if (mediumImportanceTerms.test(event)) return 'medium';
  return 'low';
}

/**
 * Classify event type
 */
function classifyEventType(event: string): TimelineEvent['eventType'] {
  if (/filed|submit|serve/.test(event)) return 'filing';
  if (/hearing|trial|proceeding/.test(event)) return 'hearing';
  if (/decision|ruling|order|verdict/.test(event)) return 'decision';
  if (/email|call|text|message/.test(event)) return 'communication';
  if (/incident|assault|attack|threaten/.test(event)) return 'incident';
  return 'action';
}

// ============================================================================
// KEYPHRASE EXTRACTION
// ============================================================================

/**
 * Extract keyphrases using TF-IDF
 */
function extractKeyphrases(text: string): Keyphrase[] {
  const tfidf = new TfIdf();
  const tokenizer = new WordTokenizer();
  
  // Add document
  tfidf.addDocument(text);
  
  const keyphrases: Keyphrase[] = [];
  
  // Get top terms
  tfidf.listTerms(0).slice(0, 20).forEach((item: any) => {
    const category = categorizeTerm(item.term);
    
    keyphrases.push({
      phrase: item.term,
      relevance: item.tfidf,
      category
    });
  });

  // Extract noun phrases
  const doc = nlp(text);
  const nounPhrases = doc.match('#Adjective? #Noun+').out('array');
  
  nounPhrases.slice(0, 10).forEach(phrase => {
    if (!keyphrases.some(k => k.phrase === phrase)) {
      keyphrases.push({
        phrase,
        relevance: 0.7,
        category: categorizeTerm(phrase)
      });
    }
  });

  return keyphrases;
}

/**
 * Categorize term
 */
function categorizeTerm(term: string): Keyphrase['category'] {
  const lowerTerm = term.toLowerCase();
  
  if (/evidence|document|photo|video|recording|testimony/.test(lowerTerm)) {
    return 'evidence';
  }
  if (/claim|allege|assert|contend|argue/.test(lowerTerm)) {
    return 'claim';
  }
  if (/defense|deny|refute|counter|explain/.test(lowerTerm)) {
    return 'defense';
  }
  if (/statute|law|regulation|rule|code/.test(lowerTerm)) {
    return 'legal-issue';
  }
  
  return 'fact';
}

// ============================================================================
// EVIDENTIARY TAGGING
// ============================================================================

/**
 * Tag text with evidentiary markers
 */
function tagEvidence(text: string): EvidentiaryTag[] {
  const tags: EvidentiaryTag[] = [];
  const sentences = nlp(text).sentences().out('array');

  sentences.forEach((sentence: string) => {
    // Check for threats
    if (/\b(threaten|kill|harm|hurt|destroy|ruin)\b/i.test(sentence)) {
      tags.push({
        type: 'threat',
        content: sentence,
        context: sentence,
        severity: 'high',
        explanation: 'Contains language indicating threats or intimidation'
      });
    }

    // Check for admissions
    if (/\b(I did|I said|I admit|I confess|I acknowledge|yes I)\b/i.test(sentence)) {
      tags.push({
        type: 'admission',
        content: sentence,
        context: sentence,
        severity: 'high',
        explanation: 'Contains admission or acknowledgment of actions'
      });
    }

    // Check for inconsistencies
    if (/\b(but|however|actually|contrary|instead|different)\b/i.test(sentence) &&
        /\b(said|stated|claimed|testified)\b/i.test(sentence)) {
      tags.push({
        type: 'inconsistency',
        content: sentence,
        context: sentence,
        severity: 'medium',
        explanation: 'May indicate inconsistent statements'
      });
    }

    // Check for corroboration
    if (/\b(confirm|verify|corroborate|support|consistent with)\b/i.test(sentence)) {
      tags.push({
        type: 'corroboration',
        content: sentence,
        context: sentence,
        severity: 'medium',
        explanation: 'Provides corroborating information'
      });
    }

    // Check for contradictions
    if (/\b(contradict|deny|false|untrue|incorrect)\b/i.test(sentence)) {
      tags.push({
        type: 'contradiction',
        content: sentence,
        context: sentence,
        severity: 'high',
        explanation: 'Contains contradictory information'
      });
    }

    // Check for exculpatory evidence
    if (/\b(innocent|not guilty|alibi|elsewhere|couldn't have)\b/i.test(sentence)) {
      tags.push({
        type: 'exculpatory',
        content: sentence,
        context: sentence,
        severity: 'high',
        explanation: 'May contain exculpatory evidence'
      });
    }

    // Check for inculpatory evidence
    if (/\b(guilty|responsible|at fault|caused|committed)\b/i.test(sentence)) {
      tags.push({
        type: 'inculpatory',
        content: sentence,
        context: sentence,
        severity: 'high',
        explanation: 'May contain inculpatory evidence'
      });
    }

    // Check for hearsay
    if (/\b(he said|she said|they told me|I heard|someone said)\b/i.test(sentence)) {
      tags.push({
        type: 'hearsay',
        content: sentence,
        context: sentence,
        severity: 'medium',
        explanation: 'Possible hearsay - out-of-court statement'
      });
    }
  });

  return tags;
}

// ============================================================================
// MAIN WORKER FUNCTIONS
// ============================================================================

/**
 * Process text through F.M.I. NLP pipeline
 */
export async function processFMIText(input: FMITextInput): Promise<FMINLPResult> {
  log.info('Processing F.M.I. text', { 
    source: input.source, 
    length: input.text.length 
  });

  const startTime = Date.now();

  // Extract entities
  const namedEntities = extractNamedEntities(input.text);
  const legalEntities = extractLegalEntities(input.text);
  const contactEntities = extractContactEntities(input.text);
  const entities = [...namedEntities, ...legalEntities, ...contactEntities];

  // Extract relationships
  const relationships = extractRelationships(input.text);

  // Build timeline
  const timeline = buildTimeline(input.text, entities);

  // Extract keyphrases
  const keyphrases = extractKeyphrases(input.text);

  // Tag evidence
  const evidentiaryTags = tagEvidence(input.text);

  // Generate summary
  const keyIssues = keyphrases
    .filter(k => k.category === 'legal-issue' || k.category === 'claim')
    .slice(0, 5)
    .map(k => k.phrase);

  const legalConcerns = evidentiaryTags
    .filter(t => t.severity === 'high')
    .map(t => `${t.type}: ${t.explanation}`)
    .slice(0, 5);

  const result: FMINLPResult = {
    entities,
    relationships,
    timeline,
    keyphrases,
    evidentiaryTags,
    summary: {
      totalEntities: entities.length,
      totalRelationships: relationships.length,
      totalEvents: timeline.length,
      keyIssues,
      legalConcerns
    }
  };

  const processingTime = Date.now() - startTime;
  log.info('F.M.I. text processing complete', {
    entities: entities.length,
    relationships: relationships.length,
    events: timeline.length,
    tags: evidentiaryTags.length,
    processingTime: `${processingTime}ms`
  });

  return result;
}

/**
 * Batch process multiple texts
 */
export async function batchProcessFMITexts(inputs: FMITextInput[]): Promise<FMINLPResult[]> {
  log.info('Batch processing F.M.I. texts', { count: inputs.length });

  const results: FMINLPResult[] = [];

  for (const input of inputs) {
    try {
      const result = await processFMIText(input);
      results.push(result);
    } catch (error) {
      log.error('Failed to process F.M.I. text', error);
    }
  }

  log.info('Batch processing complete', { successCount: results.length });

  return results;
}

/**
 * Health check for F.M.I. NLP worker
 */
export async function healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
  try {
    const testInput: FMITextInput = {
      text: 'On January 1, 2024, Officer John Smith of the NYPD arrested Jane Doe. She said "I didn\'t do it".',
      source: 'upload'
    };

    const result = await processFMIText(testInput);

    if (result.entities.length > 0 && result.summary.totalEntities > 0) {
      return { status: 'healthy', message: 'F.M.I. NLP Worker is operational' };
    }

    return { status: 'unhealthy', message: 'NLP processing produced no results' };
  } catch (error) {
    log.error('Health check failed', error);
    return { status: 'unhealthy', message: `Health check failed: ${error}` };
  }
}
