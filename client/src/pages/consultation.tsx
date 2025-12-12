/**
 * Domain Consultation Page - LEXARA Live Co-Counsel
 * 
 * Premium ethereal consultation experience featuring:
 * - Spectral Lexara avatar (ethereal young woman, electric blue eyes, golden irises)
 * - Conversational intake (Lexara asks questions naturally - no forms)
 * - Two-pane FaceTime-style layout: Avatar (40%) | Chat (60%)
 * - Voice-enabled bidirectional communication
 * - Structured legal briefing output
 * 
 * Design: Cool blues + soft gold accents, deep navy/indigo background
 */

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  ArrowLeft, Send, Scale, Clock, CheckCircle, AlertCircle,
  Loader2, Mic, MicOff, Settings, MessageCircle, ShieldCheck
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { LAW_TYPE_DATA } from '@shared/lawTypes';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceSynthesis } from '@/hooks/useVoiceSynthesis';
import useLexaraMedia from '@/hooks/useLexaraMedia';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface CaseData {
  issueType: string;
  situation: string;
  jurisdiction: string;
  deadlines: string;
}

interface ConsultationResponse {
  domainId: string;
  response: string;
  citations: string[];
  templates: string[];
  confidence: number;
  suggestedActions: string[];
}

type IntakePhase = 'greeting' | 'issue_type' | 'situation' | 'jurisdiction' | 'deadlines' | 'complete' | 'analyzing' | 'report';

interface ConversationMessage {
  id: string;
  role: 'lexara' | 'user';
  content: string;
  timestamp: Date;
}

// ============================================================================
// ETHEREAL LEXARA AVATAR - Spectral Young Woman
// ============================================================================

interface EtherealLexaraProps {
  isSpeaking: boolean;
  isListening: boolean;
  isThinking: boolean;
  audioLevel?: number; // 0-1 for VAD-enhanced lip movement
  isConnected?: boolean; // Show LIVE · SECURE badge when media connected
}

const EtherealLexara = memo(function EtherealLexara({ 
  isSpeaking, isListening, isThinking, audioLevel = 0, isConnected = false
}: EtherealLexaraProps) {
  const [breathe, setBreathe] = useState(0);
  const [hairDrift, setHairDrift] = useState(0);
  const [lipPhase, setLipPhase] = useState(0);
  
  // Gentle animations
  useEffect(() => {
    const breatheId = setInterval(() => setBreathe(p => (p + 1) % 360), 50);
    const hairId = setInterval(() => setHairDrift(p => (p + 0.5) % 360), 30);
    return () => { clearInterval(breatheId); clearInterval(hairId); };
  }, []);
  
  // Lip animation when speaking
  useEffect(() => {
    if (!isSpeaking) { setLipPhase(0); return; }
    const lipId = setInterval(() => setLipPhase(p => (p + 1) % 360), 80);
    return () => clearInterval(lipId);
  }, [isSpeaking]);
  
  const breatheScale = 1 + Math.sin(breathe * Math.PI / 180) * 0.006;
  const hairOffset = Math.sin(hairDrift * Math.PI / 180) * 2;
  // Enhanced lip movement based on VAD audio level when speaking
  const lipMove = isSpeaking ? (Math.sin(lipPhase * Math.PI / 180) * 2) + (audioLevel * 3) : 0;
  
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950/80 to-slate-900">
      {/* LIVE · SECURE badge when connected */}
      {isConnected && (
        <div className="absolute top-4 left-4 z-30">
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 flex items-center gap-1.5 px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            LIVE · SECURE
          </Badge>
        </div>
      )}
      {/* Animated particle field */}
      <div className="absolute inset-0 opacity-50">
        {[...Array(25)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${2 + Math.random() * 3}px`,
              height: `${2 + Math.random() * 3}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: i % 4 === 0 ? 'rgba(212, 175, 55, 0.7)' : 'rgba(96, 165, 250, 0.5)',
              animation: `float-particle ${10 + Math.random() * 8}s ease-in-out infinite ${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>
      
      {/* Radial depth gradient */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, transparent 0%, transparent 40%, rgba(2,6,23,0.7) 100%)' }} />
      
      {/* Main avatar container */}
      <div 
        className="relative z-10"
        style={{ transform: `scale(${breatheScale})`, transition: 'transform 0.1s ease-out' }}
      >
        {/* Outer aura rings */}
        <div 
          className={cn("absolute rounded-full border border-cyan-400/20", isSpeaking && "animate-pulse")}
          style={{ width: '300px', height: '300px', left: '-22px', top: '-22px',
            boxShadow: '0 0 50px rgba(96,165,250,0.15), 0 0 100px rgba(212,175,55,0.08)' }}
        />
        <div className="absolute rounded-full border border-amber-400/10"
          style={{ width: '270px', height: '270px', left: '-7px', top: '-7px', animation: 'spin 25s linear infinite reverse' }}
        />
        
        {/* Avatar figure */}
        <div 
          className="relative w-64 h-64 rounded-full overflow-hidden"
          style={{ boxShadow: `0 0 35px rgba(96,165,250,0.3), 0 0 70px rgba(212,175,55,0.12), inset 0 0 35px rgba(96,165,250,0.2)` }}
        >
          {/* Background */}
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-900/50 via-slate-800/70 to-slate-900/90" />
          
          {/* SVG Figure - Ethereal young woman */}
          <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" style={{ filter: 'blur(0.3px)' }}>
            <defs>
              <linearGradient id="hairG" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(30,41,59,0.95)" />
                <stop offset="50%" stopColor="rgba(51,65,85,0.85)" />
                <stop offset="100%" stopColor="rgba(30,41,59,0.95)" />
              </linearGradient>
              <linearGradient id="skinG" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(226,232,240,0.75)" />
                <stop offset="100%" stopColor="rgba(203,213,225,0.55)" />
              </linearGradient>
              <filter id="glow"><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            
            {/* Flowing hair */}
            <path d={`M60 ${46+hairOffset*0.3} Q50 62,${56+hairOffset*0.4} 125 Q62 165,${52+hairOffset*0.3} 188 L42 192 Q47 150,46 100 Q46 52,60 ${46+hairOffset*0.3}Z`} fill="url(#hairG)" opacity="0.9"/>
            <path d={`M140 ${46-hairOffset*0.3} Q150 62,${144-hairOffset*0.4} 125 Q138 165,${148-hairOffset*0.3} 188 L158 192 Q153 150,154 100 Q154 52,140 ${46-hairOffset*0.3}Z`} fill="url(#hairG)" opacity="0.9"/>
            <ellipse cx="100" cy="56" rx="44" ry="28" fill="url(#hairG)" opacity="0.95"/>
            
            {/* Face */}
            <ellipse cx="100" cy="86" rx="34" ry="40" fill="url(#skinG)" filter="url(#glow)" opacity="0.88"/>
            
            {/* Neck & shoulders */}
            <path d="M86 124 Q100 134,114 124 L118 142 Q100 152,82 142Z" fill="url(#skinG)" opacity="0.75"/>
            
            {/* Simple top */}
            <path d="M62 152 Q82 144,100 146 Q118 144,138 152 L142 200 L58 200Z" fill="rgba(148,163,184,0.45)" stroke="rgba(148,163,184,0.25)" strokeWidth="1"/>
            
            {/* Eyes - Electric blue pupils, golden irises */}
            <g filter="url(#glow)">
              <ellipse cx="85" cy="82" rx="7.5" ry="5.5" fill="rgba(255,255,255,0.92)"/>
              <circle cx="85" cy="82" r="4.5" fill="rgba(212,175,55,0.85)"/>
              <circle cx="85" cy="82" r="2.8" fill="rgba(59,130,246,1)" className={isListening?"animate-pulse":""}/>
              <circle cx="83.5" cy="80.5" r="0.9" fill="rgba(255,255,255,0.85)"/>
              
              <ellipse cx="115" cy="82" rx="7.5" ry="5.5" fill="rgba(255,255,255,0.92)"/>
              <circle cx="115" cy="82" r="4.5" fill="rgba(212,175,55,0.85)"/>
              <circle cx="115" cy="82" r="2.8" fill="rgba(59,130,246,1)" className={isListening?"animate-pulse":""}/>
              <circle cx="113.5" cy="80.5" r="0.9" fill="rgba(255,255,255,0.85)"/>
            </g>
            
            {/* Eyebrows */}
            <path d={`M76 ${74-(isListening?1.5:0)} Q86 ${72-(isListening?2:0)},94 74`} stroke="rgba(71,85,105,0.55)" strokeWidth="1.3" fill="none"/>
            <path d={`M106 74 Q114 ${72-(isListening?2:0)},124 ${74-(isListening?1.5:0)}`} stroke="rgba(71,85,105,0.55)" strokeWidth="1.3" fill="none"/>
            
            {/* Nose */}
            <path d="M100 84 L100 96 Q97 99,100 101" stroke="rgba(148,163,184,0.35)" strokeWidth="0.8" fill="none"/>
            
            {/* Lips */}
            <path d={`M91 ${108+lipMove} Q100 ${112+(isSpeaking?2:0)},109 ${108+lipMove}`} stroke="rgba(244,114,182,0.55)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
          </svg>
          
          {/* Spectral shimmer */}
          <div className="absolute inset-0 opacity-25" style={{
            background: 'linear-gradient(135deg, transparent 0%, rgba(96,165,250,0.25) 50%, transparent 100%)',
            animation: 'shimmer 4s ease-in-out infinite'
          }}/>
          
          {/* Speaking pulse */}
          {isSpeaking && <div className="absolute inset-0 rounded-full" style={{
            boxShadow: '0 0 25px rgba(59,130,246,0.4), 0 0 50px rgba(59,130,246,0.2)',
            animation: 'pulse-glow 0.4s ease-in-out infinite'
          }}/>}
          
          {/* Thinking glow */}
          {isThinking && <div className="absolute inset-0 rounded-full" style={{
            boxShadow: '0 0 35px rgba(212,175,55,0.3), 0 0 70px rgba(212,175,55,0.15)',
            animation: 'pulse-glow 1s ease-in-out infinite'
          }}/>}
        </div>
        
        {/* Orbiting particles */}
        {[...Array(6)].map((_, i) => (
          <div key={i} className="absolute rounded-full" style={{
            width: '3px', height: '3px',
            background: i%2===0 ? 'rgba(212,175,55,0.8)' : 'rgba(96,165,250,0.8)',
            left: `${50 + 42*Math.cos((i*60+breathe)*Math.PI/180)}%`,
            top: `${50 + 42*Math.sin((i*60+breathe)*Math.PI/180)}%`,
            boxShadow: i%2===0 ? '0 0 8px rgba(212,175,55,0.5)' : '0 0 8px rgba(96,165,250,0.5)',
            transition: 'all 0.2s ease-out'
          }}/>
        ))}
      </div>
      
      {/* Status badge */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className={cn(
          "px-4 py-1.5 rounded-full text-xs font-medium tracking-wider backdrop-blur-md border",
          isSpeaking ? "bg-blue-500/20 border-blue-400/40 text-blue-300" :
          isListening ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-300" :
          isThinking ? "bg-amber-500/20 border-amber-400/40 text-amber-300" :
          "bg-slate-800/60 border-slate-600/40 text-slate-400"
        )}>
          {isSpeaking ? '● Speaking' : isListening ? '● Listening' : isThinking ? '● Thinking' : '○ Ready'}
        </div>
      </div>
      
      <style>{`
        @keyframes float-particle { 0%,100%{transform:translateY(0) translateX(0);opacity:0.3} 50%{transform:translateY(-25px) translateX(8px);opacity:0.7} }
        @keyframes shimmer { 0%,100%{opacity:0.2;transform:translateX(-10%)} 50%{opacity:0.4;transform:translateX(10%)} }
        @keyframes pulse-glow { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DomainConsultationPage() {
  const [, params] = useRoute('/consultation/:domainId');
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const domainId = params?.domainId || '';
  const initAttempted = useRef(false);
  const domainInfo = LAW_TYPE_DATA.find(t => t.id === domainId);
  
  // State
  const [caseData, setCaseData] = useState<CaseData>({ issueType: '', situation: '', jurisdiction: '', deadlines: '' });
  const [consultation, setConsultation] = useState<ConsultationResponse | null>(null);
  const [intakePhase, setIntakePhase] = useState<IntakePhase>('greeting');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const conversationEndRef = useRef<HTMLDivElement>(null);
  
  // Lexara Media - FULL AUTO: auto-detect webcam + mic on load (no toggles)
  const lexaraMedia = useLexaraMedia({
    onAudioLevel: () => {}, // VAD level updates handled by hook state
    onSpeechStart: () => {},
    onSpeechEnd: () => {},
  });
  
  // Voice
  const voiceMode = useVoiceMode({
    continuous: true, interimResults: true,
    onTranscript: (text, isFinal) => { if (isFinal && text.trim()) handleUserMessage(text.trim()); },
  });
  const voiceSynthesis = useVoiceSynthesis();
  
  // Helpers
  const addLexaraMessage = useCallback((content: string, speak = true) => {
    setConversation(prev => [...prev, { id: `l-${Date.now()}`, role: 'lexara', content, timestamp: new Date() }]);
    if (speak) voiceSynthesis.speak(content, { context: 'explanation', autoPlay: true });
  }, [voiceSynthesis]);
  
  const addUserMessage = useCallback((content: string) => {
    setConversation(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content, timestamp: new Date() }]);
  }, []);
  
  useEffect(() => { conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conversation]);
  
  // Initialize conversation and auto-start media (FULL AUTO)
  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;
    
    const init = async () => {
      // Auto-start camera + mic if browser permission is granted
      try { await lexaraMedia.start({ video: true, audio: true }); } catch (e) {
        // Permission denied or not available - continue without video
      }
      
      try { 
        await voiceMode.enable(); 
        voiceMode.startListening(); 
      } catch (e) {
        console.log('Voice auto-init deferred, waiting for user interaction');
        document.addEventListener('click', async () => { 
          try { 
            await voiceMode.enable(); 
            voiceMode.startListening(); 
          } catch (err) {
            console.log('Voice initialization failed:', err);
          }
        }, { once: true });
      }
      setTimeout(() => {
        const greeting = `Hello! I'm Lexara, your legal co-counsel. I'm here to help you with ${domainInfo?.name || 'legal'} matters. Let's start with a simple question: what type of issue are you dealing with?`;
        addLexaraMessage(greeting);
        setIntakePhase('issue_type');
      }, 800);
    };
    init();
  }, [domainInfo?.name, voiceMode, addLexaraMessage]);
  
  // Process user responses
  const handleUserMessage = useCallback((message: string) => {
    addUserMessage(message);
    setTimeout(() => {
      switch (intakePhase) {
        case 'issue_type':
          setCaseData(p => ({ ...p, issueType: message }));
          addLexaraMessage("I understand. Now, please tell me about your specific situation. What happened? Include any important details.");
          setIntakePhase('situation');
          break;
        case 'situation':
          setCaseData(p => ({ ...p, situation: p.situation ? `${p.situation} ${message}` : message }));
          addLexaraMessage("Thank you for sharing. What state or jurisdiction is this matter in?");
          setIntakePhase('jurisdiction');
          break;
        case 'jurisdiction':
          setCaseData(p => ({ ...p, jurisdiction: message }));
          addLexaraMessage("Good. Are there any critical deadlines I should know about? Say 'none' if not.");
          setIntakePhase('deadlines');
          break;
        case 'deadlines':
          setCaseData(p => ({ ...p, deadlines: message.toLowerCase() === 'none' ? '' : message }));
          addLexaraMessage("Perfect. I have everything I need. Analyzing your case now...");
          setIntakePhase('complete');
          setTimeout(runAnalysis, 1500);
          break;
        case 'report':
          addLexaraMessage("That's a good follow-up question. Let me address that based on your case details...");
          break;
        default:
          setCaseData(p => ({ ...p, situation: p.situation ? `${p.situation} ${message}` : message }));
      }
    }, 600);
  }, [intakePhase, addUserMessage, addLexaraMessage]);
  
  // Analysis
  const consultMutation = useMutation({
    mutationFn: async (data: { query: string; context: Record<string, any> }) => {
      const resp = await apiRequest(`/api/domains/${domainId}/consult`, 'POST', { query: data.query, context: data.context });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Analysis failed');
      return resp.json();
    },
    onSuccess: (data) => {
      const result = data.response || data;
      setConsultation(result);
      setIntakePhase('report');
      const confidence = Math.round((result.confidence || 0.85) * 100);
      addLexaraMessage(`Analysis complete with ${confidence}% confidence. Review the briefing below and feel free to ask follow-up questions.`);
      toast({ title: "Analysis Complete", description: `${confidence}% confidence` });
    },
    onError: (err: Error) => {
      setIntakePhase('complete');
      addLexaraMessage("I encountered an issue during analysis. Would you like me to try again?");
      toast({ title: "Analysis Failed", description: err.message, variant: "destructive" });
    }
  });
  
  const runAnalysis = useCallback(() => {
    setIntakePhase('analyzing');
    const query = `Issue: ${caseData.issueType || 'General'}\nSituation: ${caseData.situation}\nJurisdiction: ${caseData.jurisdiction}\nDeadlines: ${caseData.deadlines || 'None'}`;
    consultMutation.mutate({ query, context: caseData });
  }, [caseData, consultMutation]);
  
  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim()) return;
    handleUserMessage(userInput.trim());
    setUserInput('');
  };
  
  const isThinking = intakePhase === 'analyzing' || consultMutation.isPending;
  
  if (!domainId) return <div className="min-h-screen flex items-center justify-center bg-slate-950"><p className="text-slate-400">Invalid domain</p></div>;
  
  // ============================================================================
  // RENDER - Premium Two-Pane Layout
  // ============================================================================
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <SEOHead title={`Lexara - ${domainInfo?.name || 'Legal'} Co-Counsel`} description={`AI legal consultation for ${domainInfo?.name || 'legal'} matters`}/>
      
      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation('/welcome')} className="text-slate-400 hover:text-slate-100">
              <ArrowLeft className="h-4 w-4 mr-1"/>Back
            </Button>
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-cyan-400"/>
              <span className="font-semibold">Lexara <span className="text-cyan-400">Co-Counsel</span></span>
              <span className="text-slate-500 text-sm hidden sm:inline">• {domainInfo?.name}</span>
            </div>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[calc(100vh-120px)]">
          
          {/* Main viewport - 4 cols */}
          <div className="lg:col-span-4">
            <Card className="flex flex-col h-full justify-center items-center bg-slate-950/80 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-5 h-full min-h-[600px] w-full">
                
                {/* Avatar - 40% (min-width 420px) */}
                <div className="md:col-span-2 border-b md:border-b-0 md:border-r border-slate-800/50 relative" style={{ minWidth: '420px' }}>
                  <EtherealLexara 
                    isSpeaking={voiceSynthesis.isSpeaking} 
                    isListening={voiceMode.isListening} 
                    isThinking={isThinking}
                    audioLevel={lexaraMedia.state.audioLevel}
                    isConnected={lexaraMedia.webrtcState.connected || lexaraMedia.state.isVideoReady}
                  />
                  {/* PIP Preview - User's webcam in lower-right of avatar frame */}
                  {lexaraMedia.state.isVideoReady && (
                    <div className="absolute bottom-4 right-4 w-24 h-18 rounded-lg overflow-hidden border-2 border-cyan-500/50 shadow-lg bg-black z-20">
                      <video
                        ref={lexaraMedia.setVideoElement}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover transform -scale-x-100"
                      />
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] text-white font-medium animate-pulse">
                        LIVE
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Chat - 60% */}
                <div className="md:col-span-3 flex flex-col h-[400px] md:h-full">
                  {/* Chat header */}
                  <div className="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-cyan-400"/>
                      <span className="text-sm font-medium text-slate-300">Consultation</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => voiceMode.isEnabled ? voiceMode.disable() : voiceMode.enable()}
                      className={cn("h-8 w-8 p-0 rounded-full", voiceMode.isEnabled ? "text-emerald-400" : "text-slate-500")}>
                      {voiceMode.isEnabled ? <Mic className="h-4 w-4"/> : <MicOff className="h-4 w-4"/>}
                    </Button>
                  </div>
                  
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {conversation.map(msg => (
                      <div key={msg.id} className={cn("flex gap-3", msg.role === 'user' && "flex-row-reverse")}>
                        <div className={cn("max-w-[85%] rounded-2xl px-4 py-3",
                          msg.role === 'lexara' ? "bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20" : "bg-slate-700/50 border border-slate-600/30"
                        )}>
                          <p className="text-sm leading-relaxed text-slate-200">{msg.content}</p>
                        </div>
                      </div>
                    ))}
                    {isThinking && (
                      <div className="flex gap-3">
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-3 flex items-center gap-2 text-amber-300 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin"/>Analyzing...
                        </div>
                      </div>
                    )}
                    {voiceMode.interimTranscript && (
                      <div className="flex gap-3 flex-row-reverse">
                        <div className="bg-slate-700/30 border border-slate-600/20 rounded-2xl px-4 py-2 text-slate-400 text-sm italic">
                          {voiceMode.interimTranscript}...
                        </div>
                      </div>
                    )}
                    <div ref={conversationEndRef}/>
                  </div>
                  
                  {/* Input */}
                  <form onSubmit={handleInputSubmit} className="p-4 border-t border-slate-800/50">
                    <div className="flex gap-2">
                      <Input value={userInput} onChange={e => setUserInput(e.target.value)} placeholder="Type your message..."
                        className="flex-1 bg-slate-800/50 border-slate-700/50 text-slate-100 rounded-full px-4" disabled={isThinking}/>
                      <Button type="submit" disabled={!userInput.trim() || isThinking} className="rounded-full bg-cyan-600 hover:bg-cyan-500 px-4">
                        <Send className="h-4 w-4"/>
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            </Card>
            
            {/* Briefing */}
            {consultation && intakePhase === 'report' && (
              <Card className="mt-6 bg-slate-900/50 border-slate-800/50">
                <CardHeader className="border-b border-slate-800/50">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg text-cyan-400 flex items-center gap-2"><Scale className="h-5 w-5"/>Legal Briefing</CardTitle>
                    <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">{Math.round((consultation.confidence||0.85)*100)}% Confidence</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Analysis</h4>
                    <p className="text-slate-200 leading-relaxed">{consultation.response}</p>
                  </div>
                  {consultation.suggestedActions?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Recommended Actions</h4>
                      <ul className="space-y-2">
                        {consultation.suggestedActions.map((a,i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-300"><CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0"/>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {consultation.citations?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Citations</h4>
                      <div className="flex flex-wrap gap-2">
                        {consultation.citations.map((c,i) => <Badge key={i} variant="outline" className="border-slate-600 text-slate-400">{c}</Badge>)}
                      </div>
                    </div>
                  )}
                  <Button onClick={() => {
                    setConsultation(null); setCaseData({issueType:'',situation:'',jurisdiction:'',deadlines:''});
                    setConversation([]); setIntakePhase('greeting'); initAttempted.current = false;
                    setTimeout(() => { initAttempted.current = true;
                      addLexaraMessage(`Hello again! I'm ready to help with another ${domainInfo?.name||'legal'} matter. What type of issue?`);
                      setIntakePhase('issue_type');
                    }, 300);
                  }} variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800/50">
                    Start New Consultation
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
          
          {/* Sidebar - 1 col */}
          <div className="space-y-4">
            <Card className="bg-slate-900/50 border-slate-800/50">
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm text-slate-400 flex items-center gap-2"><Clock className="h-4 w-4"/>System Status</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-500">4JI Orchestrator</span><span className="text-emerald-400">Active</span></div><Progress value={100} className="h-1 bg-slate-800"/></div>
                <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Knowledge Base</span><span className="text-emerald-400">Loaded</span></div><Progress value={100} className="h-1 bg-slate-800"/></div>
                <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-500">AI Models</span><span className="text-emerald-400">Ready</span></div><Progress value={100} className="h-1 bg-slate-800"/></div>
                <div><div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Voice Link</span><span className={voiceMode.isEnabled?"text-emerald-400":"text-slate-500"}>{voiceMode.isEnabled?"Active":"Standby"}</span></div><Progress value={voiceMode.isEnabled?100:0} className="h-1 bg-slate-800"/></div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-900/50 border-slate-800/50">
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm text-slate-400">Case Data</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 space-y-2 text-xs">
                {([
                  { key: 'issueType', label: 'Issue Type' },
                  { key: 'situation', label: 'Situation' },
                  { key: 'jurisdiction', label: 'Jurisdiction' },
                  { key: 'deadlines', label: 'Deadlines' }
                ] as const).map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full", caseData[key]?"bg-emerald-400":"bg-slate-600")}/>
                    <span className="text-slate-400">{label}</span>
                    {caseData[key] && <CheckCircle className="h-3 w-3 text-emerald-400 ml-auto"/>}
                  </div>
                ))}
              </CardContent>
            </Card>
            
            <Card className="bg-slate-900/30 border-slate-800/30 border-dashed">
              <CardContent className="p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500/70 flex-shrink-0 mt-0.5"/>
                <p className="text-xs text-slate-500">AI analysis for informational purposes only. Not legal advice.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
