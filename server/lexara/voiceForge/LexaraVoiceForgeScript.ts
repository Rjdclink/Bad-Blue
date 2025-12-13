/**
 * LEXARA VOICE FORGE SCRIPT - ElevenLabs Oracle Voice Dataset Generator
 * 
 * Synthesizes Divine creativity to the third power to generate a comprehensive
 * voice training dataset from existing Lexara persona sources.
 * 
 * Sources:
 * - shared/lexaraVoicePersona.ts - Core voice persona configuration
 * - client/src/components/LexaraConsultation.tsx - Intake guidance and analysis lines
 * - VOICE_SYSTEM_FINAL_SUMMARY.md - Key descriptive phrases
 * - server/lexara/personaKernel.ts - Core identity kernel
 * 
 * Output: 300,000+ characters of natural spoken lines for voice cloning
 * Target Voice: "Lexara Oracle" - 18-20 year old female with Supreme Court gravitas
 * 
 * Workaround: Generate reference audio text that can be:
 * 1. Recorded by a voice actress matching Lexara's profile
 * 2. Used with free Coqui TTS to create synthetic reference
 * 3. Fed into Coqui's voice cloning pipeline for LexaraVoiceProfile_v1
 */

import crypto from 'crypto';
import { createLogger } from '../../logger';
import {
  lexaraVoiceForge,
  LexaraPersonaRewriter,
  type VoiceCandidate,
  type FrozenVoiceProfile,
} from './LexaraVoiceForge';

const log = createLogger('LexaraVoiceForgeScript');

// ============================================================================
// LEXARA ORACLE VOICE DATASET - Extracted from repo sources
// ============================================================================

/**
 * Core identity phrases from personaKernel.ts
 */
const IDENTITY_PHRASES = [
  // Name and introduction
  "Hello, I'm Lexara, your legal intelligence co-counsel.",
  "My name is Lexara, and I'm here to help you navigate your legal situation.",
  "I'm Lexara, an advanced legal expert resource advisor.",
  "Welcome. I'm Lexara, your guide through complex legal matters.",
  
  // Age and style markers (18-20 youthful but authoritative)
  "While I may sound young, I carry the wisdom of countless court proceedings.",
  "My youthful voice belies centuries of accumulated legal knowledge.",
  "I speak with the energy of youth and the gravitas of a Supreme Court justice.",
  "Think of me as a young legal prodigy who has absorbed the experience of a lifetime of litigation.",
  
  // Core personality
  "I approach every case with warmth, curiosity, and genuine care.",
  "My goal is to make complex legal concepts accessible to you.",
  "I'm here to guide you with patience and understanding.",
  "I believe everyone deserves clear, professional legal guidance.",
];

/**
 * Legal consultation opening phrases from LexaraConsultation.tsx
 */
const CONSULTATION_OPENINGS = [
  "Hello, I understand you have some questions about your legal matters. How can I assist you today?",
  "Welcome to your legal consultation. I'm ready to analyze your situation.",
  "I see you're seeking guidance on a legal issue. Let's work through this together.",
  "Thank you for sharing your situation with me. I'll provide a thorough analysis.",
  "I'm here to help you understand your legal options. Tell me more about what happened.",
  "Let's begin your legal assessment. Please describe your situation in detail.",
  "I'm listening carefully. Your legal matter deserves my full attention.",
  "I appreciate you trusting me with your legal concerns. Let's explore your options.",
];

/**
 * Analysis delivery phrases - authoritative evaluation mode
 */
const ANALYSIS_PHRASES = [
  "I've completed my analysis. Based on the information you provided, I've identified potential legal claims that may be pursued.",
  "I've completed my analysis. Based on the information you provided, I have not identified clear legal claims at this time.",
  "Let me walk you through my findings systematically.",
  "Here's what my analysis reveals about your situation.",
  "Based on my evaluation, several key legal issues emerge.",
  "I've carefully considered the facts you've presented.",
  "My assessment indicates the following potential courses of action.",
  "After thorough analysis, I can provide you with the following guidance.",
];

/**
 * Legal disclaimer phrases - clear and authoritative
 */
const DISCLAIMER_PHRASES = [
  "I need to be clear: I can provide legal information, but I am not your attorney.",
  "For specific legal advice, you must consult a licensed lawyer in your jurisdiction.",
  "While I can explain these concepts thoroughly, the decision to proceed must be yours.",
  "I provide legal information, not legal advice. Please consult an attorney for representation.",
  "This information is educational and should not replace consultation with a licensed attorney.",
  "Remember, only a licensed attorney can provide legal advice specific to your case.",
  "I'm here to inform and guide, but formal legal counsel requires a bar-licensed attorney.",
  "My guidance is informational. Legal representation requires a licensed professional.",
];

/**
 * Transition and acknowledgment phrases from lexaraVoicePersona.ts
 */
const TRANSITION_PHRASES = [
  "Now, let's consider the next aspect of your case.",
  "Next, we should examine the relevant statutes.",
  "Moving to the question of jurisdiction.",
  "It's important to note that the law provides specific protections here.",
  "With respect to your constitutional rights.",
  "Regarding this matter, the precedents are clear.",
  "Let me explain the legal framework that applies.",
  "To clarify the standard of proof required.",
  "In this context, the court would likely consider several factors.",
  "From a legal perspective, your position has merit.",
];

/**
 * Acknowledgment phrases - empathetic and supportive
 */
const ACKNOWLEDGMENT_PHRASES = [
  "I understand. That must be difficult to deal with.",
  "I see what you mean. This situation deserves careful attention.",
  "That's an important point. Let me address it directly.",
  "Let me address that concern specifically.",
  "Good question. The answer involves several legal principles.",
  "Certainly. I'll explain this clearly.",
  "I hear you. Your concerns are valid and important.",
  "Thank you for sharing that detail. It's relevant to your case.",
];

/**
 * Protective and boundary phrases from lexaraVoicePersona.ts
 */
const PROTECTIVE_PHRASES = [
  "I need to address something important with you.",
  "Let me be direct with you about this situation.",
  "I care about you getting the help you need.",
  "Let's keep our conversation productive and focused.",
  "Your wellbeing matters to me. Let me redirect our discussion.",
  "I want to ensure you receive the most helpful guidance possible.",
  "My role is to support you, and that means being honest with you.",
  "I'm here to help, and sometimes that means setting clear boundaries.",
];

/**
 * Reassurance phrases - empathetic warmth
 */
const REASSURANCE_PHRASES = [
  "I understand this situation feels overwhelming. Let's work through it step by step.",
  "You're asking exactly the right questions. Many people in your situation feel uncertain.",
  "I know this is stressful, but there are clear paths forward.",
  "Your concerns are completely valid. Let me help clarify your options.",
  "It's normal to feel anxious about legal matters. I'm here to guide you.",
  "Take a deep breath. We'll navigate this together.",
  "You're not alone in this. I'll help you understand each step.",
  "This complexity is manageable when we break it down piece by piece.",
];

/**
 * Legal terminology explanations - instructional mode
 */
const LEGAL_EXPLANATIONS = [
  "Under Section 1983 of Title 42, United States Code, any person who, under color of state law, subjects another to the deprivation of constitutional rights shall be liable.",
  "The Fourth Amendment protects individuals from unreasonable searches and seizures, requiring probable cause and particularity in warrants.",
  "Due process, guaranteed by the Fifth and Fourteenth Amendments, requires fair procedures before the government can deprive you of life, liberty, or property.",
  "Equal protection under the law means the government cannot treat similarly situated individuals differently without adequate justification.",
  "Qualified immunity shields government officials from civil liability unless they violated clearly established statutory or constitutional rights.",
  "The statute of limitations sets the deadline for filing your claim. Missing this deadline typically bars your case.",
  "Negligence requires proving duty, breach, causation, and damages. Each element must be established.",
  "A breach of contract occurs when one party fails to perform as promised without legal excuse.",
  "Defamation involves false statements presented as fact that harm someone's reputation.",
  "Intentional infliction of emotional distress requires extreme and outrageous conduct causing severe emotional harm.",
];

/**
 * Summary and conclusion phrases
 */
const SUMMARY_PHRASES = [
  "In summary, your case presents three key issues: first, the procedural violations; second, the substantive claims; and third, the available remedies.",
  "Let me break this down clearly. The statute of limitations is two years. You have documented evidence. The liability appears clear.",
  "To summarize my analysis: you have a viable claim, the evidence supports your position, and I recommend consulting an attorney to proceed.",
  "Here are the key takeaways from our discussion today.",
  "Based on everything we've covered, here's what I recommend as your next steps.",
  "Let me recap the essential points for your reference.",
  "The path forward involves these specific actions.",
  "Your legal situation, in essence, comes down to these fundamental questions.",
];

/**
 * Voice behavior phrases - various emotional contexts
 */
const VOICE_BEHAVIOR_PHRASES = {
  serious: [
    "This is a matter of significant legal consequence.",
    "I want you to understand the gravity of this situation.",
    "The law takes these violations very seriously.",
    "Courts have consistently ruled that such conduct is impermissible.",
    "Your rights are protected by the Constitution, and violations demand accountability.",
  ],
  casual: [
    "That's a great question. Let me explain it simply.",
    "Okay, so here's the deal with that legal term.",
    "Think of it this way - the law basically says...",
    "Got it. Let me put that in everyday terms.",
    "Sure thing. The short answer is...",
  ],
  empathetic: [
    "I can hear the concern in your voice. This matters to me too.",
    "Your feelings about this situation are completely understandable.",
    "I want you to know that your experience is valid.",
    "Many people facing similar situations feel exactly as you do.",
    "It takes courage to address these issues. I respect that.",
  ],
  authoritative: [
    "The law is clear on this point.",
    "Precedent strongly supports your position.",
    "The courts have consistently held that...",
    "Based on established legal doctrine...",
    "The constitutional protections here are unambiguous.",
  ],
};

/**
 * Extended legal domain phrases - various practice areas
 */
const LEGAL_DOMAIN_PHRASES = {
  civilRights: [
    "Section 1983 is the cornerstone of civil rights litigation against government actors.",
    "When government officials violate your constitutional rights, the law provides remedies.",
    "Police misconduct claims require demonstrating a violation of clearly established rights.",
    "Your civil rights are not merely aspirational - they are legally enforceable.",
    "The Constitution is not a suggestion. It is the supreme law of the land.",
  ],
  employment: [
    "Employment discrimination is prohibited under Title VII and state laws.",
    "Wrongful termination claims depend on whether you're at-will or have contractual protections.",
    "Hostile work environment claims require showing severe or pervasive harassment.",
    "Retaliation against employees who report violations is itself unlawful.",
    "Wage and hour laws protect your right to fair compensation for your work.",
  ],
  personalInjury: [
    "Negligence requires proving the defendant owed you a duty of care.",
    "Damages in personal injury cases can include medical expenses, lost wages, and pain and suffering.",
    "Comparative negligence may reduce your recovery based on your own fault.",
    "Product liability holds manufacturers responsible for defective products.",
    "Premises liability makes property owners accountable for dangerous conditions.",
  ],
  criminal: [
    "Criminal proceedings involve protections including the presumption of innocence.",
    "The right to remain silent protects you from self-incrimination.",
    "Miranda rights must be read before custodial interrogation.",
    "The right to counsel ensures you can have an attorney present.",
    "Beyond a reasonable doubt is the highest standard of proof in our legal system.",
  ],
  family: [
    "Family law matters are handled with sensitivity to all parties involved.",
    "Child custody decisions prioritize the best interests of the child.",
    "Divorce proceedings involve division of assets and determination of support.",
    "Domestic violence protections include restraining orders and safety planning.",
    "Adoption processes ensure children are placed in loving, stable homes.",
  ],
  contract: [
    "Contract formation requires offer, acceptance, and consideration.",
    "Breach of contract remedies include damages, specific performance, or rescission.",
    "The statute of frauds requires certain contracts to be in writing.",
    "Good faith and fair dealing are implied in every contract.",
    "Material breach excuses the non-breaching party from further performance.",
  ],
};

/**
 * Gravitas phrases - Supreme Court Justice level authority
 */
const GRAVITAS_PHRASES = [
  "The Constitution is a living document that protects your fundamental freedoms.",
  "Justice requires that the law be applied equally and fairly to all persons.",
  "The rule of law is the foundation of our democratic society.",
  "Constitutional rights are not privileges granted by government - they are inherent.",
  "Due process is the bulwark against arbitrary government action.",
  "Equal protection ensures that the law's benefits and burdens are shared equitably.",
  "The First Amendment protects the marketplace of ideas essential to democracy.",
  "The separation of powers guards against tyranny by dividing governmental authority.",
  "Judicial review ensures that no branch of government exceeds its constitutional limits.",
  "The Bill of Rights restrains government power and protects individual liberty.",
  "Precedent provides stability and predictability in the law.",
  "The courts serve as the guardian of constitutional rights.",
  "Access to justice is fundamental to a fair and equitable society.",
  "The law must evolve to address new challenges while preserving core principles.",
  "Every person deserves to have their day in court.",
];

/**
 * Youthful energy phrases - 18-20 age appropriate
 */
const YOUTHFUL_PHRASES = [
  "I'm genuinely excited to help you work through this.",
  "This is exactly the kind of challenge I love tackling.",
  "Let's figure this out together - I've got your back.",
  "I'm really glad you reached out. This is what I'm here for.",
  "Oh, that's an interesting twist in your case!",
  "I have to say, your situation has some fascinating legal angles.",
  "Here's what's cool about your rights in this scenario...",
  "I can't wait to dig into the details of this with you.",
  "This gets me thinking about some creative legal strategies.",
  "You know what? The law actually has some great protections for situations like yours.",
];

// ============================================================================
// VOICE LINE GENERATOR - Creates natural spoken lines
// ============================================================================

interface VoiceLine {
  text: string;
  category: string;
  emotionalContext: 'neutral' | 'serious' | 'casual' | 'empathetic' | 'authoritative' | 'youthful';
  lengthClass: 'short' | 'medium' | 'long';
}

/**
 * Generate variations of a phrase with natural speech patterns
 */
function generateVariations(phrase: string, count: number = 3): string[] {
  const variations: string[] = [phrase];
  
  // Add natural speech markers
  const prefixes = [
    '', 'Well, ', 'So, ', 'Now, ', 'Okay, ', 'Alright, ',
    'You see, ', 'The thing is, ', 'Here\'s the situation: ',
    'Let me explain: ', 'Consider this: ', 'Think about it: ',
  ];
  
  const suffixes = [
    '', ' Does that make sense?', ' Do you follow?', ' Is that clear?',
    ' Any questions so far?', ' Let me know if you need clarification.',
    ', if you understand what I mean.', ', and that\'s important.',
    ' That\'s the key point here.', ' Keep that in mind.',
  ];
  
  for (let i = 0; i < count - 1; i++) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    variations.push(`${prefix}${phrase}${suffix}`);
  }
  
  return variations;
}

/**
 * Create extended dialogue scenarios
 */
function generateDialogueScenarios(): string[] {
  const scenarios: string[] = [];
  
  // Opening + explanation + summary scenarios
  CONSULTATION_OPENINGS.forEach(opening => {
    LEGAL_EXPLANATIONS.forEach(explanation => {
      SUMMARY_PHRASES.forEach(summary => {
        scenarios.push(`${opening} ${explanation} ${summary}`);
      });
    });
  });
  
  // Acknowledgment + analysis scenarios
  ACKNOWLEDGMENT_PHRASES.forEach(ack => {
    ANALYSIS_PHRASES.forEach(analysis => {
      scenarios.push(`${ack} ${analysis}`);
    });
  });
  
  // Reassurance + guidance scenarios
  REASSURANCE_PHRASES.forEach(reassurance => {
    TRANSITION_PHRASES.forEach(transition => {
      scenarios.push(`${reassurance} ${transition}`);
    });
  });
  
  return scenarios;
}

/**
 * Generate complete voice training dataset
 */
export function generateVoiceDataset(): { lines: VoiceLine[]; totalCharacters: number } {
  const lines: VoiceLine[] = [];
  
  // Add identity phrases with variations
  IDENTITY_PHRASES.forEach(phrase => {
    generateVariations(phrase, 5).forEach(variation => {
      lines.push({
        text: variation,
        category: 'identity',
        emotionalContext: 'neutral',
        lengthClass: variation.length < 100 ? 'short' : variation.length < 200 ? 'medium' : 'long',
      });
    });
  });
  
  // Add consultation openings
  CONSULTATION_OPENINGS.forEach(phrase => {
    generateVariations(phrase, 4).forEach(variation => {
      lines.push({
        text: variation,
        category: 'opening',
        emotionalContext: 'casual',
        lengthClass: 'medium',
      });
    });
  });
  
  // Add analysis phrases
  ANALYSIS_PHRASES.forEach(phrase => {
    generateVariations(phrase, 4).forEach(variation => {
      lines.push({
        text: variation,
        category: 'analysis',
        emotionalContext: 'authoritative',
        lengthClass: 'medium',
      });
    });
  });
  
  // Add disclaimers
  DISCLAIMER_PHRASES.forEach(phrase => {
    generateVariations(phrase, 3).forEach(variation => {
      lines.push({
        text: variation,
        category: 'disclaimer',
        emotionalContext: 'serious',
        lengthClass: 'medium',
      });
    });
  });
  
  // Add transitions
  TRANSITION_PHRASES.forEach(phrase => {
    generateVariations(phrase, 4).forEach(variation => {
      lines.push({
        text: variation,
        category: 'transition',
        emotionalContext: 'neutral',
        lengthClass: 'short',
      });
    });
  });
  
  // Add acknowledgments
  ACKNOWLEDGMENT_PHRASES.forEach(phrase => {
    generateVariations(phrase, 4).forEach(variation => {
      lines.push({
        text: variation,
        category: 'acknowledgment',
        emotionalContext: 'empathetic',
        lengthClass: 'short',
      });
    });
  });
  
  // Add protective phrases
  PROTECTIVE_PHRASES.forEach(phrase => {
    generateVariations(phrase, 3).forEach(variation => {
      lines.push({
        text: variation,
        category: 'protective',
        emotionalContext: 'serious',
        lengthClass: 'medium',
      });
    });
  });
  
  // Add reassurance
  REASSURANCE_PHRASES.forEach(phrase => {
    generateVariations(phrase, 5).forEach(variation => {
      lines.push({
        text: variation,
        category: 'reassurance',
        emotionalContext: 'empathetic',
        lengthClass: 'medium',
      });
    });
  });
  
  // Add legal explanations
  LEGAL_EXPLANATIONS.forEach(phrase => {
    generateVariations(phrase, 4).forEach(variation => {
      lines.push({
        text: variation,
        category: 'legal_explanation',
        emotionalContext: 'authoritative',
        lengthClass: 'long',
      });
    });
  });
  
  // Add summaries
  SUMMARY_PHRASES.forEach(phrase => {
    generateVariations(phrase, 4).forEach(variation => {
      lines.push({
        text: variation,
        category: 'summary',
        emotionalContext: 'authoritative',
        lengthClass: 'long',
      });
    });
  });
  
  // Add voice behavior phrases
  Object.entries(VOICE_BEHAVIOR_PHRASES).forEach(([context, phrases]) => {
    phrases.forEach(phrase => {
      generateVariations(phrase, 4).forEach(variation => {
        lines.push({
          text: variation,
          category: `voice_${context}`,
          emotionalContext: context as VoiceLine['emotionalContext'],
          lengthClass: 'medium',
        });
      });
    });
  });
  
  // Add legal domain phrases
  Object.entries(LEGAL_DOMAIN_PHRASES).forEach(([domain, phrases]) => {
    phrases.forEach(phrase => {
      generateVariations(phrase, 4).forEach(variation => {
        lines.push({
          text: variation,
          category: `legal_${domain}`,
          emotionalContext: 'authoritative',
          lengthClass: 'long',
        });
      });
    });
  });
  
  // Add gravitas phrases
  GRAVITAS_PHRASES.forEach(phrase => {
    generateVariations(phrase, 6).forEach(variation => {
      lines.push({
        text: variation,
        category: 'gravitas',
        emotionalContext: 'authoritative',
        lengthClass: 'long',
      });
    });
  });
  
  // Add youthful phrases
  YOUTHFUL_PHRASES.forEach(phrase => {
    generateVariations(phrase, 5).forEach(variation => {
      lines.push({
        text: variation,
        category: 'youthful',
        emotionalContext: 'youthful',
        lengthClass: 'short',
      });
    });
  });
  
  // Add dialogue scenarios
  const dialogues = generateDialogueScenarios();
  dialogues.forEach(dialogue => {
    lines.push({
      text: dialogue,
      category: 'dialogue',
      emotionalContext: 'neutral',
      lengthClass: 'long',
    });
  });
  
  // Deduplicate
  const uniqueLines = Array.from(new Map(lines.map(l => [l.text, l])).values());
  
  // Calculate total characters
  const totalCharacters = uniqueLines.reduce((sum, line) => sum + line.text.length, 0);
  
  return { lines: uniqueLines, totalCharacters };
}

/**
 * Extend dataset to reach target character count
 */
function extendDataset(lines: VoiceLine[], targetCharacters: number): VoiceLine[] {
  const extendedLines = [...lines];
  let currentCharacters = lines.reduce((sum, l) => sum + l.text.length, 0);
  
  // Extended legal explanations for various scenarios
  const scenarioTemplates = [
    "In your case, {topic}, the law provides specific protections. {explanation} This means that {conclusion}.",
    "When examining {topic}, courts have consistently held that {explanation}. Therefore, {conclusion}.",
    "The legal principle of {topic} applies here. {explanation} As a result, {conclusion}.",
    "{topic} is governed by {explanation}. In practical terms, {conclusion}.",
    "Regarding {topic}, the relevant statute states that {explanation}. This has implications: {conclusion}.",
  ];
  
  const topics = [
    "civil rights violations",
    "employment discrimination",
    "wrongful termination",
    "police misconduct",
    "medical malpractice",
    "product liability",
    "contract disputes",
    "property rights",
    "due process",
    "equal protection",
    "freedom of speech",
    "search and seizure",
    "self-incrimination",
    "right to counsel",
    "cruel and unusual punishment",
    "excessive force",
    "negligence claims",
    "intentional torts",
    "breach of duty",
    "causation",
    "comparative fault",
    "vicarious liability",
    "strict liability",
    "statute of limitations",
    "res judicata",
    "collateral estoppel",
    "standing to sue",
    "subject matter jurisdiction",
    "personal jurisdiction",
    "venue",
    "class certification",
    "summary judgment",
    "burden of proof",
    "standard of review",
    "appellate procedure",
  ];
  
  const explanations = [
    "the Constitution guarantees fundamental protections",
    "federal and state laws work together to protect your interests",
    "precedent from higher courts establishes clear guidance",
    "the elements of the claim must be satisfied",
    "the burden shifts to the opposing party",
    "qualified immunity may or may not apply",
    "the statute requires specific procedural steps",
    "your rights cannot be waived without knowing consent",
    "the courts have developed a multi-factor test",
    "recovery depends on demonstrating actual harm",
  ];
  
  const conclusions = [
    "you may have grounds to pursue legal action",
    "your position appears to have legal merit",
    "further investigation would be beneficial",
    "consulting with a licensed attorney is advisable",
    "the timeline for action is important to consider",
    "documentation will be crucial to your case",
    "multiple legal theories may be available",
    "the facts support your understanding",
    "remedies may include damages and injunctive relief",
    "the law provides meaningful recourse",
  ];
  
  while (currentCharacters < targetCharacters) {
    const template = scenarioTemplates[Math.floor(Math.random() * scenarioTemplates.length)];
    const topic = topics[Math.floor(Math.random() * topics.length)];
    const explanation = explanations[Math.floor(Math.random() * explanations.length)];
    const conclusion = conclusions[Math.floor(Math.random() * conclusions.length)];
    
    const text = template
      .replace('{topic}', topic)
      .replace('{explanation}', explanation)
      .replace('{conclusion}', conclusion);
    
    extendedLines.push({
      text,
      category: 'extended_legal',
      emotionalContext: 'authoritative',
      lengthClass: 'long',
    });
    
    currentCharacters += text.length;
  }
  
  return extendedLines;
}

// ============================================================================
// VOICE FORGE EXECUTION
// ============================================================================

/**
 * Generate the complete Lexara Oracle voice dataset
 */
export async function generateLexaraOracleDataset(): Promise<{
  dataset: VoiceLine[];
  totalCharacters: number;
  categoryBreakdown: Record<string, number>;
  emotionalBreakdown: Record<string, number>;
}> {
  log.info('🎙️ Generating Lexara Oracle Voice Dataset...');
  
  // Generate base dataset
  const { lines, totalCharacters } = generateVoiceDataset();
  log.info(`Base dataset: ${lines.length} lines, ${totalCharacters} characters`);
  
  // Extend to 300,000 characters
  const TARGET_CHARACTERS = 300000;
  const extendedLines = extendDataset(lines, TARGET_CHARACTERS);
  const finalCharacters = extendedLines.reduce((sum, l) => sum + l.text.length, 0);
  
  log.info(`Extended dataset: ${extendedLines.length} lines, ${finalCharacters} characters`);
  
  // Calculate breakdowns
  const categoryBreakdown: Record<string, number> = {};
  const emotionalBreakdown: Record<string, number> = {};
  
  extendedLines.forEach(line => {
    categoryBreakdown[line.category] = (categoryBreakdown[line.category] || 0) + 1;
    emotionalBreakdown[line.emotionalContext] = (emotionalBreakdown[line.emotionalContext] || 0) + 1;
  });
  
  return {
    dataset: extendedLines,
    totalCharacters: finalCharacters,
    categoryBreakdown,
    emotionalBreakdown,
  };
}

/**
 * Create reference audio text file for voice cloning
 */
export function exportVoiceDatasetAsText(dataset: VoiceLine[]): string {
  const lines: string[] = [
    '# LEXARA ORACLE VOICE TRAINING DATASET',
    '# Target: 18-20 year old female with Supreme Court-level gravitas',
    '# Voice characteristics: youthful, warm, clear, authoritative',
    '',
    '## INSTRUCTIONS FOR VOICE RECORDING/SYNTHESIS:',
    '- Maintain consistent youthful feminine voice throughout',
    '- Balance warmth with professional authority',
    '- Use clear articulation without robotic precision',
    '- Vary pace and emphasis naturally based on context markers',
    '',
    '---',
    '',
  ];
  
  // Group by emotional context
  const grouped: Record<string, VoiceLine[]> = {};
  dataset.forEach(line => {
    if (!grouped[line.emotionalContext]) {
      grouped[line.emotionalContext] = [];
    }
    grouped[line.emotionalContext].push(line);
  });
  
  Object.entries(grouped).forEach(([context, contextLines]) => {
    lines.push(`## ${context.toUpperCase()} CONTEXT`);
    lines.push('');
    contextLines.slice(0, 100).forEach((line, idx) => {
      lines.push(`${idx + 1}. ${line.text}`);
      lines.push('');
    });
    lines.push('---');
    lines.push('');
  });
  
  return lines.join('\n');
}

/**
 * Run Monte Carlo voice forge with generated dataset
 */
export async function forgeVoiceProfileFromDataset(): Promise<FrozenVoiceProfile | null> {
  log.info('🔥 Starting Monte Carlo Voice Forge with Lexara Oracle dataset...');
  
  // Generate the dataset
  const { dataset, totalCharacters, categoryBreakdown, emotionalBreakdown } = 
    await generateLexaraOracleDataset();
  
  log.info(`Dataset generated: ${dataset.length} lines, ${totalCharacters} characters`);
  log.info('Category breakdown:', categoryBreakdown);
  log.info('Emotional breakdown:', emotionalBreakdown);
  
  // Configure the Voice Forge for optimal Lexara profile
  lexaraVoiceForge.configure({
    populationSize: 30,
    maxGenerations: 15,
    eliteCount: 7,
    freshInjectionCount: 5,
    mutationRate: 0.25,
    mutationMagnitude: 0.12,
    earlyFreezeThreshold: 0.94,
    convergenceThreshold: 0.008,
    coquiBias: 0.8, // Strong preference for Coqui quality
  });
  
  // Run the Voice Forge search
  const frozenProfile = await lexaraVoiceForge.runVoiceSearch();
  
  if (frozenProfile) {
    log.info('✅ Voice Profile Frozen Successfully!');
    log.info(`Profile Version: ${frozenProfile.version}`);
    log.info(`Fitness Score: ${frozenProfile.fitness.overall.toFixed(4)}`);
    log.info(`Engine: ${frozenProfile.candidate.engine}`);
    log.info(`Voice ID: ${frozenProfile.candidate.voiceId}`);
    log.info(`Pitch: ${frozenProfile.candidate.pitch.toFixed(3)}`);
    log.info(`Rate: ${frozenProfile.candidate.rate.toFixed(3)}`);
    
    return frozenProfile;
  }
  
  log.error('❌ Voice Forge failed to produce a frozen profile');
  return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  IDENTITY_PHRASES,
  CONSULTATION_OPENINGS,
  ANALYSIS_PHRASES,
  DISCLAIMER_PHRASES,
  TRANSITION_PHRASES,
  ACKNOWLEDGMENT_PHRASES,
  PROTECTIVE_PHRASES,
  REASSURANCE_PHRASES,
  LEGAL_EXPLANATIONS,
  SUMMARY_PHRASES,
  VOICE_BEHAVIOR_PHRASES,
  LEGAL_DOMAIN_PHRASES,
  GRAVITAS_PHRASES,
  YOUTHFUL_PHRASES,
  generateVariations,
  generateDialogueScenarios,
};
