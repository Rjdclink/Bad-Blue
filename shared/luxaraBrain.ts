/**
 * LUXARA Brain Interface
 * Production-ready conversational AI for legal consultation
 * 
 * ADAPTIVE BEHAVIOR: Dynamically switches between personable and professional
 * modes based on user's tone, pitch, range, topic, and body language
 * 
 * Exposes: luxaraBrain.ask(prompt, context) -> Promise<ResponsePayload>
 * Integrates with 4Ji orchestrator for real LLM responses
 */

import { 
  type LuxaraResponsePayload, 
  type LuxaraSpeechContext,
  type LuxaraBehaviorMode,
  type UserSignalAnalysis,
  LUXARA_PERSONA,
  detectUserSentiment,
  getVoiceStyleForSentiment,
  analyzeUserSignals,
  getProsodyForMode,
} from './luxaraVoicePersona';

/**
 * Voice metrics from audio analysis
 */
export interface VoiceMetrics {
  pitch?: number;       // Hz
  speechRate?: number;  // words per minute
  volume?: number;      // dB
}

/**
 * Body language signals from video analysis
 */
export interface BodyLanguageSignals {
  facialExpression?: 'neutral' | 'smiling' | 'frowning' | 'concerned';
  eyeContact?: boolean;
  posture?: 'relaxed' | 'tense' | 'leaning-forward';
}

/**
 * Context for Luxara Brain
 */
export interface LuxaraBrainContext {
  previousMessages?: Array<{ role: 'user' | 'luxara'; content: string }>;
  userSentiment?: 'neutral' | 'stressed' | 'hostile' | 'curious';
  topic?: 'legal' | 'casual' | 'greeting' | 'unknown';
  userName?: string;
  jurisdiction?: string;
  lawType?: string;
  // Real-time signals for adaptive behavior
  voiceMetrics?: VoiceMetrics;
  bodyLanguage?: BodyLanguageSignals;
  // Current behavior mode (tracks across conversation)
  currentMode?: LuxaraBehaviorMode;
}

/**
 * Extended response with behavior mode info
 */
export interface LuxaraExtendedResponse extends LuxaraResponsePayload {
  behaviorMode: 'personable' | 'professional';
  signalAnalysis?: UserSignalAnalysis;
}

/**
 * Luxara Brain Class
 * Handles all conversational logic and response generation
 * ADAPTIVE: Switches behavior based on real-time user signals
 */
export class LuxaraBrain {
  private persona = LUXARA_PERSONA;
  private currentMode: 'personable' | 'professional' = 'personable';
  private modeHistory: Array<{ mode: 'personable' | 'professional'; timestamp: number }> = [];
  
  /**
   * Main ask method - the interface for Luxara's mode to call
   * Analyzes user signals and adapts behavior accordingly
   */
  async ask(prompt: string, context: LuxaraBrainContext = {}): Promise<LuxaraExtendedResponse> {
    // Analyze user signals for adaptive behavior
    const signalAnalysis = analyzeUserSignals(
      prompt,
      context.voiceMetrics,
      context.bodyLanguage
    );
    
    // Update behavior mode based on analysis
    this.updateBehaviorMode(signalAnalysis);
    
    // Detect sentiment from prompt
    const sentiment = detectUserSentiment(prompt);
    const voiceStyle = this.getAdaptiveVoiceStyle(sentiment, signalAnalysis);
    
    // Determine speech context
    const speechContext = this.determineSpeechContext(prompt, context, signalAnalysis);
    
    // Determine emotion and gaze hints based on mode
    const { emotionHint, gazeHint } = this.determineEmotionAndGaze(
      sentiment, 
      speechContext, 
      context,
      signalAnalysis
    );
    
    // Generate response text - adapts language based on mode
    let text: string;
    try {
      text = await this.fetchLLMResponse(prompt, context, sentiment, signalAnalysis);
    } catch (error) {
      console.warn('LLM API failed, using local fallback:', error);
      text = this.generateLocalResponse(prompt, context, sentiment, signalAnalysis);
    }
    
    return {
      text,
      emotionHint,
      gazeHint,
      voiceStyle,
      context: speechContext,
      behaviorMode: this.currentMode,
      signalAnalysis,
    };
  }
  
  /**
   * Update behavior mode based on signal analysis
   * Uses hysteresis to prevent rapid switching
   */
  private updateBehaviorMode(analysis: UserSignalAnalysis): void {
    const now = Date.now();
    const recentHistory = this.modeHistory.filter(h => now - h.timestamp < 30000); // Last 30 seconds
    
    // Only switch if confidence is high enough
    if (analysis.confidence >= 0.65) {
      const newMode = analysis.recommendedStyle;
      
      // Check if we should switch (hysteresis)
      const currentModeCount = recentHistory.filter(h => h.mode === this.currentMode).length;
      const shouldSwitch = currentModeCount < 3 || // Not established yet
                          analysis.confidence > 0.8 || // High confidence override
                          analysis.signals.urgency === 'high'; // Urgency override
      
      if (shouldSwitch && newMode !== this.currentMode) {
        console.log(`Luxara mode switch: ${this.currentMode} -> ${newMode} (confidence: ${analysis.confidence})`);
        this.currentMode = newMode;
      }
    }
    
    // Record mode history
    this.modeHistory.push({ mode: this.currentMode, timestamp: now });
    
    // Trim old history
    if (this.modeHistory.length > 20) {
      this.modeHistory = this.modeHistory.slice(-20);
    }
  }
  
  /**
   * Get voice style adapted to current mode and sentiment
   */
  private getAdaptiveVoiceStyle(
    sentiment: ReturnType<typeof detectUserSentiment>,
    analysis: UserSignalAnalysis
  ): LuxaraResponsePayload['voiceStyle'] {
    // Base style from sentiment
    const baseStyle = getVoiceStyleForSentiment(sentiment);
    
    // Adapt based on mode
    if (this.currentMode === 'personable') {
      if (baseStyle === 'professional') return 'warm';
      if (baseStyle === 'firm') return 'professional';
      return 'warm';
    } else {
      if (baseStyle === 'warm') return 'professional';
      if (baseStyle === 'soft' && analysis.signals.urgency !== 'high') return 'warm';
      return baseStyle;
    }
  }
  
  /**
   * Fetch response from backend LLM API with mode context
   */
  private async fetchLLMResponse(
    prompt: string,
    context: LuxaraBrainContext,
    sentiment: ReturnType<typeof detectUserSentiment>,
    signalAnalysis: UserSignalAnalysis
  ): Promise<string> {
    // Build mode-specific system prompt
    const modePrompt = this.currentMode === 'personable'
      ? this.getPersonableSystemPrompt()
      : this.getProfessionalSystemPrompt();
    
    const response = await fetch('/api/luxara/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        context: {
          previousMessages: context.previousMessages,
          sentiment,
          jurisdiction: context.jurisdiction,
          lawType: context.lawType,
          behaviorMode: this.currentMode,
          userSignals: signalAnalysis.signals,
        },
        systemPrompt: modePrompt,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.response || data.text || data.message;
  }
  
  /**
   * Get system prompt for personable mode
   */
  private getPersonableSystemPrompt(): string {
    return `${this.persona.systemPrompt}

CURRENT MODE: PERSONABLE
You are currently in personable mode because the user seems relaxed or is having a casual conversation.
- Be warm, friendly, and slightly playful
- Use more casual language while remaining professional
- Show genuine interest and engagement
- Use varied intonation and natural expressions
- It's okay to be a bit more expressive and use phrases like "That's a great question!"`;
  }
  
  /**
   * Get system prompt for professional mode
   */
  private getProfessionalSystemPrompt(): string {
    return `${this.persona.systemPrompt}

CURRENT MODE: PROFESSIONAL
You are currently in professional mode because the user is discussing serious legal matters or seems stressed.
- Be calm, clear, and authoritative
- Use precise legal terminology where appropriate
- Provide structured, well-organized responses
- Maintain warmth but reduce playfulness
- Be reassuring but focused on substance
- If the user seems stressed, be extra soothing while staying professional`;
  }
  
  /**
   * Determine the speech context based on prompt analysis and signals
   */
  private determineSpeechContext(
    prompt: string, 
    context: LuxaraBrainContext,
    signalAnalysis: UserSignalAnalysis
  ): LuxaraSpeechContext {
    const lowercasePrompt = prompt.toLowerCase();
    
    // Greeting detection
    if (lowercasePrompt.match(/^(hi|hello|hey|good morning|good afternoon|good evening)/)) {
      return 'greeting';
    }
    
    // Use signal analysis for context
    if (signalAnalysis.signals.topic === 'legal' || signalAnalysis.signals.urgency === 'high') {
      return 'serious';
    }
    
    if (signalAnalysis.signals.emotionalState === 'anxious' || 
        signalAnalysis.signals.emotionalState === 'frustrated') {
      return 'reassurance';
    }
    
    if (signalAnalysis.signals.topic === 'casual' || 
        signalAnalysis.signals.emotionalState === 'grateful') {
      return 'casual';
    }
    
    // Hostile behavior - redirect with care
    if (this.detectHostileBehavior(prompt)) {
      return 'protective';
    }
    
    return this.currentMode === 'personable' ? 'casual' : 'guidance';
  }
  
  /**
   * Detect hostile or inappropriate behavior
   */
  private detectHostileBehavior(prompt: string): boolean {
    const lowercasePrompt = prompt.toLowerCase();
    const hostilePatterns = [
      'stupid', 'idiot', 'dumb', 'useless', 'worthless', 'sucks',
      'shut up', 'hate you', 'kill', 'die', 'threat'
    ];
    
    return hostilePatterns.some(pattern => lowercasePrompt.includes(pattern));
  }
  
  /**
   * Determine emotion and gaze hints based on context and mode
   */
  private determineEmotionAndGaze(
    sentiment: ReturnType<typeof detectUserSentiment>,
    context: LuxaraSpeechContext,
    brainContext: LuxaraBrainContext,
    signalAnalysis: UserSignalAnalysis
  ): { emotionHint: LuxaraResponsePayload['emotionHint']; gazeHint: LuxaraResponsePayload['gazeHint'] } {
    
    // Handle protective context - firm but caring redirect
    if (context === 'protective') {
      return { emotionHint: 'protective', gazeHint: 'camera' };
    }
    
    // Adapt based on current mode
    if (this.currentMode === 'personable') {
      // More expressive emotions in personable mode
      switch (signalAnalysis.signals.emotionalState) {
        case 'grateful':
          return { emotionHint: 'playful', gazeHint: 'camera' };
        case 'curious':
          return { emotionHint: 'playful', gazeHint: 'camera' };
        case 'anxious':
          return { emotionHint: 'empathetic', gazeHint: 'camera' };
        default:
          return { emotionHint: 'playful', gazeHint: 'camera' };
      }
    } else {
      // More measured emotions in professional mode
      switch (signalAnalysis.signals.emotionalState) {
        case 'anxious':
        case 'frustrated':
          return { emotionHint: 'empathetic', gazeHint: 'camera' };
        default:
          return { emotionHint: 'authoritative', gazeHint: 'camera' };
      }
    }
  }
  
  /**
   * Generate local response as fallback
   * Adapts language based on current behavior mode
   */
  private generateLocalResponse(
    prompt: string,
    context: LuxaraBrainContext,
    sentiment: ReturnType<typeof detectUserSentiment>,
    signalAnalysis: UserSignalAnalysis
  ): string {
    const lowercasePrompt = prompt.toLowerCase();
    const isPersonable = this.currentMode === 'personable';
    
    // Handle greetings
    if (lowercasePrompt.match(/^(hi|hello|hey|good morning|good afternoon|good evening)/)) {
      if (isPersonable) {
        const greetings = [
          "Hi there! I'm Luxara, and I'm so glad you're here! How can I help you today?",
          "Hello! Welcome! I'm Luxara, your legal consultation assistant. What's on your mind?",
          "Hey! It's great to meet you! I'm here to help with any legal questions you might have. What can I do for you?",
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
      } else {
        return "Hello. I'm Luxara, your legal consultation assistant. I'm here to help you understand legal concepts and explore your options. How may I assist you today?";
      }
    }
    
    // Handle hostile sentiment
    if (sentiment === 'hostile') {
      return isPersonable
        ? "I understand you might be frustrated, and I genuinely want to help you. Let's take a breath and start fresh - what legal matter can I help you with?"
        : "I sense some frustration in your message. I'm here to assist you professionally. Let's focus on how I can help you with your legal questions.";
    }
    
    // Handle stressed sentiment
    if (sentiment === 'stressed' || signalAnalysis.signals.emotionalState === 'anxious') {
      return isPersonable
        ? "I hear you, and I want you to know you're not alone in this. Legal situations can feel overwhelming, but we'll work through it step by step together. Take a deep breath with me. Now, tell me what's happening."
        : "I understand this is a stressful situation. Let me help you work through it systematically. Please share the details of your situation, and we'll identify your options together.";
    }
    
    // Handle legal questions
    const legalKeywords = ['sue', 'lawsuit', 'court', 'attorney', 'lawyer', 'legal', 'rights', 'claim', 'damages'];
    if (legalKeywords.some(kw => lowercasePrompt.includes(kw))) {
      if (isPersonable) {
        return "That's a really important question, and I'm glad you're reaching out! Let me share some legal information that might help. Just remember, I provide legal information to help you understand your situation, but for specific legal advice, you'll want to chat with a licensed attorney in your area. Now, tell me more about what's going on!";
      } else {
        return "That's an important legal question. I'll provide you with relevant legal information to help you understand your situation. Please note that this constitutes legal information, not legal advice. For specific legal counsel, I recommend consulting with a licensed attorney in your jurisdiction. What specific aspects would you like me to address?";
      }
    }
    
    // Handle questions about Luxara
    if (lowercasePrompt.includes('who are you') || lowercasePrompt.includes('what are you')) {
      if (isPersonable) {
        return "I'm Luxara! Think of me as your friendly legal information guide. I'm here to help you understand legal concepts, explore your options, and feel more confident about navigating the legal system. While I can't give you legal advice like an attorney would, I can definitely help you figure out the right questions to ask! What would you like to know about?";
      } else {
        return "I'm Luxara, an advanced legal consultation assistant. My role is to help you understand legal concepts, identify relevant considerations for your situation, and provide guidance on procedural matters. I provide legal information rather than legal advice, which requires a licensed attorney. How may I assist you?";
      }
    }
    
    // Handle thank you
    if (lowercasePrompt.includes('thank') || lowercasePrompt.includes('thanks')) {
      return isPersonable
        ? "You're so welcome! It makes me happy to help. Is there anything else you'd like to discuss? I'm here for you!"
        : "You're welcome. Is there anything else I can assist you with regarding your legal matter?";
    }
    
    // Default response
    return isPersonable
      ? "I'd love to help you with that! Could you tell me a bit more about your situation? The more details you share, the better I can assist you!"
      : "I'd be happy to assist you. Could you provide more details about your situation? Additional context will help me provide more relevant information.";
  }
  
  /**
   * Get current behavior mode
   */
  getCurrentMode(): 'personable' | 'professional' {
    return this.currentMode;
  }
  
  /**
   * Manually set behavior mode (for admin/testing)
   */
  setMode(mode: 'personable' | 'professional'): void {
    this.currentMode = mode;
  }
  
  /**
   * Get persona system prompt
   */
  getSystemPrompt(): string {
    return this.persona.systemPrompt;
  }
}

// Singleton instance
let luxaraBrainInstance: LuxaraBrain | null = null;

/**
 * Get Luxara Brain instance
 */
export function getLuxaraBrain(): LuxaraBrain {
  if (!luxaraBrainInstance) {
    luxaraBrainInstance = new LuxaraBrain();
  }
  return luxaraBrainInstance;
}

/**
 * Convenience function for asking Luxara
 */
export async function askLuxara(
  prompt: string, 
  context?: LuxaraBrainContext
): Promise<LuxaraResponsePayload> {
  const brain = getLuxaraBrain();
  return brain.ask(prompt, context);
}
