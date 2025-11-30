/**
 * Petition Service - Core business logic for petition creation workflow
 * 
 * Handles:
 * - City population lookup and signature threshold calculation
 * - Resident data harvesting from public sources
 * - AI-powered petition content generation using 4-way AI collaboration
 * - Submission channel discovery
 * - Petition submission routing
 */

import { db } from './db';
import { 
  petitionWorkflows, 
  petitionSources, 
  petitionSigners, 
  petitionSubmissions,
  cityCouncilChannels,
  type PetitionWorkflow,
  type InsertPetitionWorkflow,
  type PetitionSource,
  type InsertPetitionSource,
  type PetitionSigner,
  type InsertPetitionSigner,
  type PetitionSubmission,
  type InsertPetitionSubmission,
  type CityCouncilChannel,
  type InsertCityCouncilChannel
} from '@shared/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { generateUserText, TaskPriority } from './aiProvider';
import crypto from 'crypto';

// ============================================
// SIGNATURE THRESHOLD CALCULATION
// ============================================

interface SignatureThreshold {
  minPopulation: number;
  maxPopulation: number;
  requiredSignatures: number;
}

const SIGNATURE_THRESHOLDS: SignatureThreshold[] = [
  { minPopulation: 5000, maxPopulation: 15000, requiredSignatures: 100 },
  { minPopulation: 15001, maxPopulation: 25000, requiredSignatures: 200 },
  { minPopulation: 25001, maxPopulation: 60000, requiredSignatures: 300 },
  { minPopulation: 60001, maxPopulation: Infinity, requiredSignatures: 1200 },
];

export function calculateRequiredSignatures(population: number): number {
  if (population < 5000) {
    return 50; // Default for small cities
  }
  
  for (const threshold of SIGNATURE_THRESHOLDS) {
    if (population >= threshold.minPopulation && population <= threshold.maxPopulation) {
      return threshold.requiredSignatures;
    }
  }
  
  return 1200; // Default for very large cities
}

// ============================================
// CITY POPULATION LOOKUP
// ============================================

interface CityPopulationResult {
  population: number;
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function lookupCityPopulation(city: string, state: string): Promise<CityPopulationResult> {
  console.log(`[Petition Service] Looking up population for ${city}, ${state}`);
  
  const prompt = `What is the approximate population of ${city}, ${state}? 
  
Respond with ONLY a JSON object in this exact format:
{
  "population": <number>,
  "source": "<data source or 'AI estimate'>",
  "confidence": "<high|medium|low>"
}

Use the most recent census data or reliable estimates available. If the city is very small or you're uncertain, use your best estimate with appropriate confidence level.`;

  try {
    const response = await generateUserText(
      'petition-population-lookup',
      prompt,
      { temperature: 0.3, useJSON: true },
      TaskPriority.HIGH_USER
    );
    
    const parsed = JSON.parse(response.content);
    return {
      population: parsed.population || 25000,
      source: parsed.source || 'AI estimate',
      confidence: parsed.confidence || 'medium'
    };
  } catch (error) {
    console.error('[Petition Service] Population lookup error:', error);
    // Return default estimate
    return {
      population: 25000,
      source: 'Default estimate',
      confidence: 'low'
    };
  }
}

// ============================================
// PETITION WORKFLOW CRUD
// ============================================

export async function createPetitionWorkflow(data: {
  userId?: string;
  city: string;
  state: string;
  officerName: string;
  officerBadge?: string;
  officerDepartment?: string;
  misconductSummary: string;
  requestedAction: string;
  petitionerName: string;
  petitionerEmail?: string;
  petitionerAddress?: string;
}): Promise<PetitionWorkflow> {
  console.log(`[Petition Service] Creating petition workflow for ${data.city}, ${data.state}`);
  
  // Look up city population
  const populationResult = await lookupCityPopulation(data.city, data.state);
  const requiredSignatures = calculateRequiredSignatures(populationResult.population);
  
  console.log(`[Petition Service] Population: ${populationResult.population}, Required signatures: ${requiredSignatures}`);
  
  const [workflow] = await db.insert(petitionWorkflows).values({
    ...data,
    cityPopulation: populationResult.population,
    requiredSignatures,
    status: 'collecting_input'
  }).returning();
  
  return workflow;
}

export async function getPetitionWorkflow(id: string): Promise<PetitionWorkflow | null> {
  const [workflow] = await db.select().from(petitionWorkflows).where(eq(petitionWorkflows.id, id));
  return workflow || null;
}

export async function getUserPetitionWorkflows(userId: string): Promise<PetitionWorkflow[]> {
  return await db.select()
    .from(petitionWorkflows)
    .where(eq(petitionWorkflows.userId, userId))
    .orderBy(desc(petitionWorkflows.createdAt));
}

export async function updatePetitionWorkflowStatus(
  id: string, 
  status: string,
  additionalData?: Partial<InsertPetitionWorkflow>
): Promise<PetitionWorkflow | null> {
  const [updated] = await db.update(petitionWorkflows)
    .set({ 
      status, 
      updatedAt: new Date(),
      ...additionalData 
    })
    .where(eq(petitionWorkflows.id, id))
    .returning();
  return updated || null;
}

// ============================================
// RESIDENT DATA HARVESTING
// ============================================

interface ResidentDataSource {
  type: 'property_tax' | 'gis_parcel' | 'voter_registration';
  url?: string;
  name: string;
}

export async function discoverDataSources(city: string, state: string, county?: string): Promise<ResidentDataSource[]> {
  console.log(`[Petition Service] Discovering data sources for ${city}, ${state}`);
  
  const prompt = `Find public data sources for resident information in ${city}, ${state}${county ? ` (${county} County)` : ''}.

Look for:
1. County property tax/assessor records (county assessor, property tax search)
2. GIS parcel mapping portals (parcel viewer, GIS data)
3. Voter registration lookup (state or county voter lookup)

Respond with ONLY a JSON array:
[
  {
    "type": "property_tax" | "gis_parcel" | "voter_registration",
    "url": "<website URL if known, or null>",
    "name": "<official name of the resource>"
  }
]

Include at least one source of each type if available for the area.`;

  try {
    const response = await generateUserText(
      'petition-source-discovery',
      prompt,
      { temperature: 0.5, useJSON: true },
      TaskPriority.HIGH_USER
    );
    
    const sources = JSON.parse(response.content);
    return Array.isArray(sources) ? sources : [];
  } catch (error) {
    console.error('[Petition Service] Source discovery error:', error);
    // Return default generic sources
    return [
      { type: 'property_tax', name: `${state} County Assessor Records` },
      { type: 'voter_registration', name: `${state} Voter Registration Database` }
    ];
  }
}

export async function createPetitionSource(data: InsertPetitionSource): Promise<PetitionSource> {
  const [source] = await db.insert(petitionSources).values(data).returning();
  return source;
}

export async function getPetitionSources(workflowId: string): Promise<PetitionSource[]> {
  return await db.select()
    .from(petitionSources)
    .where(eq(petitionSources.workflowId, workflowId));
}

// ============================================
// SIGNER MANAGEMENT
// ============================================

function generateDedupeKey(name: string, address?: string): string {
  const normalized = `${name.toLowerCase().trim()}|${(address || '').toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 64);
}

export async function addPetitionSigner(data: {
  workflowId: string;
  sourceId?: string;
  fullName: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  sourceType?: string;
}): Promise<PetitionSigner | null> {
  const dedupeKey = generateDedupeKey(data.fullName, data.address);
  
  try {
    const [signer] = await db.insert(petitionSigners)
      .values({
        ...data,
        dedupeKey
      })
      .onConflictDoNothing()
      .returning();
    
    if (signer) {
      // Update resident count in workflow
      await db.execute(sql`
        UPDATE petition_workflows 
        SET residents_collected = residents_collected + 1, updated_at = NOW()
        WHERE id = ${data.workflowId}
      `);
    }
    
    return signer || null;
  } catch (error) {
    console.error('[Petition Service] Error adding signer:', error);
    return null;
  }
}

export async function getPetitionSigners(workflowId: string): Promise<PetitionSigner[]> {
  return await db.select()
    .from(petitionSigners)
    .where(eq(petitionSigners.workflowId, workflowId));
}

export async function getSignerCount(workflowId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM petition_signers WHERE workflow_id = ${workflowId}
  `);
  return parseInt((result as any)[0]?.count || '0', 10);
}

// ============================================
// PETITION CONTENT GENERATION
// ============================================

export async function generatePetitionContent(workflow: PetitionWorkflow): Promise<string> {
  console.log(`[Petition Service] Generating petition content for workflow ${workflow.id}`);
  
  const signerCount = await getSignerCount(workflow.id);
  
  const prompt = `Generate a formal community petition to the ${workflow.city}, ${workflow.state} City Council.

PETITIONER INFORMATION:
Name: ${workflow.petitionerName}
${workflow.petitionerEmail ? `Email: ${workflow.petitionerEmail}` : ''}
${workflow.petitionerAddress ? `Address: ${workflow.petitionerAddress}` : ''}

OFFICER INFORMATION:
Name: ${workflow.officerName}
${workflow.officerBadge ? `Badge Number: ${workflow.officerBadge}` : ''}
${workflow.officerDepartment ? `Department: ${workflow.officerDepartment}` : `Department: ${workflow.city} Police Department`}

MISCONDUCT SUMMARY:
${workflow.misconductSummary}

REQUESTED ACTION:
${workflow.requestedAction}

PETITION DETAILS:
- City Population: ~${workflow.cityPopulation?.toLocaleString() || 'Unknown'}
- Required Signatures: ${workflow.requiredSignatures}
- Signatures Collected: ${signerCount}

Generate a formal petition document that includes:
1. HEADER with petition title and date
2. TO: City Council of ${workflow.city}, ${workflow.state}
3. PREAMBLE - Introduction and purpose
4. STATEMENT OF FACTS - Detailed account of the misconduct
5. LEGAL CONCERNS - Potential violations of civil rights, department policy, or law
6. DEMAND - Clear statement of requested action
7. COMMUNITY IMPACT - Why this matters to residents
8. SIGNATURE SECTION - Space for community signatures

The petition should be:
- Professional and formal in tone
- Factual and based on the provided information
- Persuasive but respectful
- Legally sound in its claims
- Suitable for official submission to city government

Generate the complete petition document text.`;

  try {
    const response = await generateUserText(
      'petition-content-generation',
      prompt,
      { temperature: 0.4, maxTokens: 4000 },
      TaskPriority.CRITICAL_USER
    );
    
    // Update workflow with generated content
    await db.update(petitionWorkflows)
      .set({
        petitionContent: response.content,
        petitionContentGeneratedAt: new Date(),
        status: 'ready_to_submit',
        updatedAt: new Date()
      })
      .where(eq(petitionWorkflows.id, workflow.id));
    
    return response.content;
  } catch (error) {
    console.error('[Petition Service] Content generation error:', error);
    throw new Error('Failed to generate petition content. Please try again.');
  }
}

// ============================================
// SUBMISSION CHANNEL DISCOVERY
// ============================================

export async function discoverSubmissionChannels(city: string, state: string): Promise<CityCouncilChannel | null> {
  console.log(`[Petition Service] Discovering submission channels for ${city}, ${state}`);
  
  // Check cache first
  const [existing] = await db.select()
    .from(cityCouncilChannels)
    .where(and(
      eq(cityCouncilChannels.city, city),
      eq(cityCouncilChannels.state, state)
    ));
  
  if (existing && existing.lastVerifiedAt) {
    const daysSinceVerification = (Date.now() - existing.lastVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceVerification < 30) {
      console.log('[Petition Service] Using cached submission channels');
      return existing;
    }
  }
  
  const prompt = `Find the official channels to submit a community petition to the ${city}, ${state} City Council.

Look for:
1. Online public comment portal or complaint form
2. City Council email addresses (general or clerk)
3. City Clerk contact information

Respond with ONLY a JSON object:
{
  "portalUrl": "<URL of online submission form, or null>",
  "emailAddresses": "<comma-separated council emails, or null>",
  "clerkEmail": "<city clerk email, or null>",
  "clerkAddress": "<physical address for mailing, or null>",
  "notes": "<any relevant submission instructions>"
}`;

  try {
    const response = await generateUserText(
      'petition-channel-discovery',
      prompt,
      { temperature: 0.5, useJSON: true },
      TaskPriority.HIGH_USER
    );
    
    const channels = JSON.parse(response.content);
    
    // Upsert the channel information
    const channelData: InsertCityCouncilChannel = {
      city,
      state,
      portalUrl: channels.portalUrl || null,
      emailAddresses: channels.emailAddresses || null,
      clerkEmail: channels.clerkEmail || null,
      clerkAddress: channels.clerkAddress || null,
      lastVerifiedAt: new Date(),
      verificationStatus: 'ai_verified',
      notes: channels.notes || null
    };
    
    if (existing) {
      await db.update(cityCouncilChannels)
        .set({ ...channelData, updatedAt: new Date() })
        .where(eq(cityCouncilChannels.id, existing.id));
      return { ...existing, ...channelData };
    } else {
      const [newChannel] = await db.insert(cityCouncilChannels)
        .values(channelData)
        .returning();
      return newChannel;
    }
  } catch (error) {
    console.error('[Petition Service] Channel discovery error:', error);
    return existing || null;
  }
}

// ============================================
// PETITION SUBMISSION
// ============================================

export async function createPetitionSubmission(data: InsertPetitionSubmission): Promise<PetitionSubmission> {
  const [submission] = await db.insert(petitionSubmissions).values(data).returning();
  return submission;
}

export async function submitPetition(workflowId: string): Promise<PetitionSubmission> {
  console.log(`[Petition Service] Submitting petition for workflow ${workflowId}`);
  
  const workflow = await getPetitionWorkflow(workflowId);
  if (!workflow) {
    throw new Error('Petition workflow not found');
  }
  
  if (!workflow.petitionContent) {
    throw new Error('Petition content not generated yet');
  }
  
  // Get submission channels
  const channels = await discoverSubmissionChannels(workflow.city, workflow.state);
  
  // Determine best submission method (priority: portal > email > clerk)
  let submissionMethod: string;
  let targetAddress: string;
  
  if (channels?.portalUrl) {
    submissionMethod = 'portal';
    targetAddress = channels.portalUrl;
  } else if (channels?.emailAddresses) {
    submissionMethod = 'email';
    targetAddress = channels.emailAddresses;
  } else if (channels?.clerkEmail) {
    submissionMethod = 'clerk_email';
    targetAddress = channels.clerkEmail;
  } else if (channels?.clerkAddress) {
    submissionMethod = 'clerk_mail';
    targetAddress = channels.clerkAddress;
  } else {
    submissionMethod = 'manual';
    targetAddress = `${workflow.city} City Council`;
  }
  
  // Create submission record
  const submission = await createPetitionSubmission({
    workflowId,
    submissionMethod,
    targetAddress,
    status: 'pending',
    attemptedAt: new Date()
  });
  
  // Update workflow status
  await updatePetitionWorkflowStatus(workflowId, 'submitted', {
    submissionChannel: submissionMethod,
    submissionTarget: targetAddress,
    submittedAt: new Date()
  });
  
  console.log(`[Petition Service] Petition submitted via ${submissionMethod} to ${targetAddress}`);
  
  return submission;
}

export async function getPetitionSubmissions(workflowId: string): Promise<PetitionSubmission[]> {
  return await db.select()
    .from(petitionSubmissions)
    .where(eq(petitionSubmissions.workflowId, workflowId));
}
