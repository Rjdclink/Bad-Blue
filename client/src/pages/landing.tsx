import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, Search, FileText, TrendingUp, Upload, Database, Bell, Check, Scale, ArrowRight, Users } from "lucide-react";
import { LanguageSelectorLight } from "@/components/LanguageSelectorLight";
// Use Constitution.webp from public/images as background
const heroImage = "/images/Constitution.webp";
import { SEOHead } from "@/components/SEOHead";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";
import { useLocation } from "wouter";
import SampleLexaraConsultation from "@/components/SampleLegalConsultation"; // Note: Will create dedicated SampleLexara component later
import { FULL_ACCESS_PRICING, LAWSUIT_DIY_PRICING, LAWSUIT_FULL_SERVICE_PRICING, COMPLAINT_PRICING, PETITION_PRICING, FOIA_REQUEST_PRICING } from "@shared/schema";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { AISystemShowcase } from "@/components/AISystemShowcase";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function Landing() {
  const [, setLocation] = useLocation();
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [lexaraImageError, setLexaraImageError] = useState(false);
  
  // Enhanced image error handler with logging
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>, imageName: string) => {
    console.error(`Image failed to load: ${imageName}`, e.currentTarget.src);
    console.error('Attempted path:', e.currentTarget.src);
    console.error('Current origin:', window.location.origin);
    e.currentTarget.style.display = 'none';
  };
  
  const baseUrl = import.meta.env.VITE_BASE_URL || "https://example.com";
  
  // Use PAGE_FAQ_CONFIG from seoConfig.ts for consistent, page-specific FAQs
  // Removed duplicate useFaqSchema() call that was creating two FAQ schemas
  usePageFaqSchema();
  
  // NOTE: WebSite schema is already defined in index.html - removed duplicate useWebsiteSchema call
  
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioAttempted, setAudioAttempted] = useState(false); // Added state for tracking audio attempt
  const audioRef = useRef<HTMLAudioElement>(null);

  // Enable audio on user interaction (unmute and play)
  const enableAudio = () => {
    if (!audioRef.current) {
      return;
    }
    
    // If audio is muted, unmute it and restart from beginning
    if (audioRef.current.muted) {
      audioRef.current.muted = false;
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => {
          setAudioPlaying(true);
        })
        .catch((error) => {
          console.log('Audio play prevented:', error);
        });
    }
  };

  // Add scroll and wheel listeners for audio unmute
  useEffect(() => {
    const handleInteraction = () => {
      if (audioRef.current && audioRef.current.muted) {
        audioRef.current.muted = false;
        audioRef.current.currentTime = 0;
        audioRef.current.play()
          .then(() => {
            setAudioPlaying(true);
          })
          .catch((error) => {
            console.log('Audio play prevented:', error);
          });
        
        // Remove listeners after unmuting
        document.removeEventListener('wheel', handleInteraction);
        document.removeEventListener('scroll', handleInteraction, true);
      }
    };
    
    document.addEventListener('wheel', handleInteraction, { passive: true });
    document.addEventListener('scroll', handleInteraction, { passive: true, capture: true });
    
    return () => {
      document.removeEventListener('wheel', handleInteraction);
      document.removeEventListener('scroll', handleInteraction, true);
    };
  }, []);

  // Start audio 1 second after page load (only once)
  useEffect(() => {
    if (audioAttempted) return; // Prevent multiple attempts

    const timer = setTimeout(() => {
      if (audioRef.current && !audioPlaying) { // Check if audio is already playing
        setAudioAttempted(true); // Mark attempt
        audioRef.current.play()
          .then(() => {
            setAudioPlaying(true);
          })
          .catch((error) => {
            console.log('Audio autoplay prevented by browser:', error);
            // Silently fail - audio will play on first scroll/interaction
          });
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [audioAttempted, audioPlaying]); // Dependencies include new state

  // Debug: Check if images exist (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      const imagesToCheck = [
        '/images/Legal%20What%20Icon.png',
        '/images/Constitution.webp',
        '/images/Tweed_Court.jpg',
        '/images/OIP.webp'
      ];
      
      imagesToCheck.forEach(src => {
        const img = new Image();
        img.onload = () => console.log(`✅ Image loaded: ${src}`);
        img.onerror = () => console.error(`❌ Image failed: ${src}`);
        img.src = src;
      });
    }
  }, []);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "LegalWhat",
    "alternateName": ["Legal What", "legal what"],
    "description": "Police accountability platform for filing complaints and civil rights lawsuits online",
    "url": baseUrl,
    "applicationCategory": "LegalService",
    "offers": {
      "@type": "Offer",
      "priceCurrency": "USD",
      "description": "Platform access with LEXARA Consultation and Officer Search"
    },
    "featureList": [
      "AI-powered officer badge identification",
      "Automated complaint routing to proper authorities",
      "Civil rights lawsuit document generation",
      "State-specific legal templates",
      "Secure evidence upload",
      "Legal actionability analysis"
    ]
  };

  return (
    <div className="min-h-screen" onClick={enableAudio}>
      {/* Background Audio from Login Video - plays once after page load */}
      <audio
        ref={audioRef}
        muted
        preload="auto"
        style={{ position: 'fixed', top: -1000, left: -1000, visibility: 'hidden', pointerEvents: 'none' }}
      >
        <source src="/audio/badblue-audio.mp3" type="audio/mpeg" />
        Your browser does not support the audio element.
      </audio>

      <SEOHead
        title="LegalWhat — AI Legal Platform for 30+ Practice Areas"
        description="AI-powered legal platform covering 30+ practice areas including Law Enforcement Accountability, Family Law, Immigration, Civil Rights, and more. Professional legal tools with AI consultation."
        keywords="BadBlue, Bad Blue, badblue, bad blue, AI legal consultation, legal AI, officer database, case search, police accountability, civil rights, officer information, police brutality, police assault, police lawsuit, police complaint, police grievance, FOIA police, police search, police information, police legal help, police documents, officer brutality, officer assault, officer lawsuit, officer complaint, officer grievance, FOIA officer, officer search, officer information, officer legal, officer documents, department lawsuit, department complaint, department grievance, department FOIA, file police complaint, file officer complaint, lawsuit against police, lawsuit against officer, complaint against police department, grievance against police, legal advice police brutality, legal advice police assault, help with police complaint, help with officer lawsuit, search police officer, find police officer, locate police officer, police officer information, officer resignation petition, petition police officer fired, police misconduct documents, officer misconduct FOIA, police brutality lawsuit, officer assault complaint, police department grievance, legal help police case, police civil rights lawsuit, officer excessive force complaint, police false arrest lawsuit, police harassment complaint, department internal affairs complaint, police accountability legal advice, file complaint police brutality, file lawsuit police assault, FOIA request police records, search officer background, find officer information, locate police department, petition officer resignation, police brutality legal help, officer assault documents, police lawsuit information, complaint police misconduct, grievance officer conduct, legal documents police case, police records FOIA request, officer search database, department complaint process, lawsuit police department, complaint officer brutality, police legal assistance, officer information search, FOIA police documents, petition police accountability, police brutality help, officer assault lawsuit, department grievance filing, legal advice officer misconduct, search police records, find officer details, AI powered legal research, automated legal document generation, state specific legal templates, civil rights violation lawsuit, Section 1983 lawsuit, 42 USC 1983, Bivens action, qualified immunity, police misconduct attorney, civil rights attorney alternative, legal AI assistant, officer badge identification, automated complaint routing, tort notice generator, legal precedent search, filing information search, jurisdiction specific legal help, police accountability tools, officer accountability platform, legal consultation AI, smart legal research, online civil rights lawsuit, online police complaint, online FOIA request, online officer petition, police reform, law enforcement accountability, constitutional rights violation, Fourth Amendment violation, excessive force legal help, false arrest attorney, wrongful arrest lawsuit, police brutality documentation, officer misconduct evidence, legal case management, automated legal forms, police lawsuit filing assistance, civil rights case research, legal AI technology, officer database nationwide, police roster search, department directory, law enforcement information, officer background check, police history search, misconduct record search, complaint history officer, legal help affordable, budget legal assistance, DIY lawsuit, self file lawsuit, pro se legal help, legal document preparation, court filing assistance, legal research tools, case law search, statute search, legal code database, precedent database, filing fee information, court procedures, legal process help, police accountability resources, civil rights resources, legal aid alternative, online legal platform, digital legal services, legal tech platform, AI legal tools, smart legal assistance, automated legal help, police complaint online filing, lawsuit document generator, FOIA letter generator, petition template, legal letter writing, complaint letter police, grievance letter department, legal forms police case, court documents civil rights, filing instructions legal case, how to sue police, how to file police complaint, how to get police records, how to petition officer, police accountability guide, civil rights lawsuit guide, FOIA request guide, legal process guide, police complaint process, lawsuit filing process, legal document process, court filing process, legal help step by step, police case assistance, officer case guidance, department case support, legal resources comprehensive, police accountability comprehensive, civil rights comprehensive, legal platform complete, all in one legal help, complete legal solution, comprehensive police tools, full service legal platform, integrated legal services, police accountability ecosystem, legal consultation platform, officer search platform, legal research platform, complaint filing platform, lawsuit filing platform, FOIA platform, petition platform"
        ogTitle="File Police Complaint Online | BadBlue - Professional Police Accountability Platform"
        ogDescription="Professional legal empowerment platform providing transparent complaint filing systems & civil rights protection services for police misconduct, brutality & excessive force cases."
        canonicalUrl={baseUrl}
        ogImage={`${baseUrl}/preview.png`}
        structuredData={structuredData}
      />
      {/* Hero Section */}
      <section className="relative min-h-[100vh] flex items-center justify-center py-12 overflow-hidden">
        {/* Background Image with Optimized Display */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ 
            backgroundImage: `url(${heroImage}), linear-gradient(to bottom, #1a1a2e, #16213e)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center'
          }}
        >
          {/* Dark overlay for text readability over constitutional background */}
          <div className="absolute inset-0 bg-black/40" />
        </div>

        {/* Language Selector - Fixed top right */}
        <div className="absolute top-6 right-6 z-20">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-1 border border-white/20">
            <LanguageSelectorLight />
          </div>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          {/* AI Badge */}
          <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Badge className="bg-primary/90 text-white border-white/20 px-6 py-2.5 text-sm font-medium backdrop-blur-md shadow-lg">
              🤖 Powered by 12 AI Models Working in Parallel
            </Badge>
          </div>

          {/* LegalWhat Icon - Medium-sized Prominent Display */}
          <div className="mb-8 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
            <div className="relative">
              {/* Glow effect behind icon */}
              <div className="absolute inset-0 bg-primary/30 blur-2xl rounded-full scale-125" />
              {/* Icon container with enhanced styling */}
              <div className="relative bg-white/10 backdrop-blur-md p-4 rounded-xl border-2 border-white/30 shadow-2xl hover:scale-105 transition-transform duration-300">
                {!iconError ? (
                  <img 
                    src="/images/Legal%20What%20Icon.png" 
                    alt="LegalWhat - AI Legal Platform" 
                    className="w-20 h-20 md:w-24 md:h-24 object-contain filter drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                    onError={(e) => {
                      handleImageError(e, 'LegalWhat Icon');
                      setIconError(true);
                    }}
                  />
                ) : (
                  <div className="w-20 h-20 md:w-24 md:h-24 flex items-center justify-center text-white text-3xl font-bold">
                    LW
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <h1 className="text-white text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 drop-shadow-2xl">
            AI-Powered Legal Platform for 30+ Practice Areas
          </h1>
          <p className="text-white/95 text-base md:text-lg mb-8 leading-relaxed max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 drop-shadow-lg">
            Comprehensive legal assistance across 30 practice areas, from Law Enforcement Accountability to Family Law, Immigration, Civil Rights, and beyond. AI-powered consultation, document generation, and expert guidance for every legal need.
          </p>
          
          {/* Trust Signals */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-10 text-sm text-white/95 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-700">
            <div className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>12 AI Models Analyze Every Search</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>Each AI Contributes Its Specialty</span>
            </div>
          </div>


          {/* Login/Get Started Card - Overlays background with glassmorphism */}
          <div className="max-w-5xl mx-auto bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
            {/* Three-Tier Pricing - Simplified */}
            <div className="mb-10">
              <div className="grid md:grid-cols-3 gap-6">
                {/* Tier 1: LEXARA & Officer Search */}
                <div className="bg-black/40 backdrop-blur-md rounded-lg p-4 border border-white/30">
                  <div className="text-white mb-3">
                    <div className="text-lg font-semibold mb-2">Core Services</div>
                    <div className="text-xs text-white/70">Legal consultation & officer search</div>
                  </div>
                  <div className="space-x-1">
                    <Badge className="bg-white/15 text-white border-white/20 text-xs">FREE with signup</Badge>
                  </div>
                </div>

                {/* Tier 2: Additional Services */}
                <div className="bg-black/40 backdrop-blur-md rounded-lg p-4 border border-white/30">
                  <div className="text-white mb-3">
                    <div className="text-lg font-semibold mb-2">Documents</div>
                    <div className="text-xs text-white/70">FOIA, complaints & petitions</div>
                  </div>
                  <Badge className="bg-white/15 text-white border-white/20 text-xs">Per document pricing</Badge>
                </div>

                {/* Tier 3: Civil Lawsuits */}
                <div className="bg-black/40 backdrop-blur-md rounded-lg p-4 border border-white/30">
                  <div className="text-white mb-3">
                    <div className="text-lg font-semibold mb-2">Lawsuits</div>
                    <div className="text-xs text-white/70">State-specific civil suits</div>
                  </div>
                  <Badge className="bg-white/15 text-white border-white/20 text-xs">DIY or full service</Badge>
                </div>
              </div>
            </div>

            {/* Legal Disclaimer Checkbox */}
            <div className="flex items-start gap-3 max-w-xl mx-auto text-left px-4 relative z-10 bg-black/30 backdrop-blur-sm rounded-lg p-4 border border-yellow-400/50">
              <Checkbox
                id="disclaimer"
                checked={disclaimerAccepted}
                onCheckedChange={(checked) => setDisclaimerAccepted(checked as boolean)}
                className="mt-0.5 border-2 border-yellow-400 bg-white data-[state=checked]:bg-yellow-400 data-[state=checked]:text-black shrink-0 w-5 h-5 min-w-[1.25rem]"
                data-testid="checkbox-disclaimer"
              />
              <label htmlFor="disclaimer" className="text-sm text-white/90 leading-relaxed cursor-pointer block">
                I understand that LegalWhat provides legal tools and AI assistance but does not constitute legal advice. I will use this platform responsibly.
              </label>
            </div>

            {/* CTA Button */}
            <div className="mt-6 flex justify-center px-4 relative z-10">
              <Button
                size="default"
                className="text-base px-6 bg-primary hover:bg-primary/90 backdrop-blur-sm border border-white/50 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-500"
                onClick={() => setLocation('/login')}
                disabled={!disclaimerAccepted}
                data-testid="button-get-started"
              >
                Get Started
              </Button>
            </div>

            {/* Trust Indicator */}
            <div className="mt-8">
              <Badge className="bg-white/15 backdrop-blur-md text-white border-white/20 px-4 py-2 text-sm">
                <Shield className="w-4 h-4 mr-2" />
                Powered by Public Records
              </Badge>
            </div>
          </div>

        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex items-start justify-center p-2">
            <div className="w-1.5 h-3 bg-white/70 rounded-full" />
          </div>
        </div>
      </section>

      {/* LEXARA Visual Showcase Section */}
      <section className="relative py-20 px-4 mt-16 overflow-hidden">
        {/* Background Image with Dark Overlay */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/images/Tweed_Court.jpg), linear-gradient(135deg, #1a1a2e 0%, #2a2a3e 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center center'
          }}
        >
          <div className="absolute inset-0 bg-black/60" />
        </div>

        {/* Content Container - Wider for three-column layout */}
        <div className="relative z-10 max-w-7xl mx-auto">
          {/* Overlay Text - Description of LEXARA */}
          <div className="text-center mb-12 px-4">
            <p className="text-white text-lg md:text-xl lg:text-2xl leading-relaxed max-w-4xl mx-auto font-medium" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
              Meet LEXARA - She's built on an orchestrated network of thirteen specialized AI models that operate in tandem. She provides you with advanced legal reasoning, analysis, in-depth research, cross-verified suggestions, and courtroom ready drafting, tailored to your filing jurisdiction. She can analyze evidence in a wide variety of formats and provide any format of legally compliant documentation.
            </p>
          </div>

          {/* Three-Column Layout: Left Features | ALEXARA Image | Right Features */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start px-4">
            {/* Left Column - Features 1-5 */}
            <div className="space-y-6">
              {/* Feature 1 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  1. Parallel Reasoning Engine
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — multiple specialized AIs analyze the same issue simultaneously.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Delivers faster, corroborated answers grounded in multi-angle reasoning.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  2. Cross-Validation Check
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — every legal conclusion is independently checked across multiple models.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Produces advice that is consistent, defensible, and resistant to oversight.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  3. Document Atelier
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — precision drafting of pleadings, motions, contracts, affidavits, and more.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Generates clean, structured documents that meet professional legal standards.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  4. Strategic Playbooks (Non-Risk Scoring)
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — generates clear procedural pathways without offering risk/reward scoring.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Gives you organized, step-by-step legal direction without making outcome predictions.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  5. Verifiable Reasoning Log
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — transparent, structured explanation of how each conclusion was formed.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Enables easy review, quality control, and compliance with professional expectations.
                </p>
              </div>
            </div>

            {/* Center Column - ALEXARA Floating Card */}
            <div className="flex justify-center">
              <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-6 md:p-8 border border-white/20 max-w-md w-full transform hover:scale-105 transition-transform duration-300 shadow-[0_0_40px_rgba(96,165,250,0.3),0_20px_60px_rgba(0,0,0,0.5)]">
                {/* LEXARA Image */}
                <div className="mb-6">
                  {!lexaraImageError ? (
                    <img
                      src="/images/OIP.webp"
                      alt="LEXARA - Legal Expert AI Resource Advisor"
                      className="w-full h-auto rounded-2xl object-cover shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
                      onError={(e) => {
                        console.error('LEXARA image failed to load:', e.currentTarget.src);
                        setLexaraImageError(true);
                      }}
                    />
                  ) : (
                    <div className="w-full h-64 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-[0_10px_40px_rgba(0,0,0,0.4)]">
                      <div className="text-white text-center">
                        <div className="text-6xl mb-2">⚖️</div>
                        <div className="text-sm font-semibold">LEXARA</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Label Text */}
                <div className="text-center">
                  <p className="text-white text-xs font-light tracking-tight whitespace-nowrap" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>
                    Legal X-(computational Autonomous Reasoning Architecture)
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column - Features 6-10 */}
            <div className="space-y-6">
              {/* Feature 6 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  6. Orchestrated Expert Modules
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — thirteen specialized engines work in synchronized, orchestrated coordination.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Produces unified legal insight that draws from multiple areas of expertise without contradiction.
                </p>
              </div>

              {/* Feature 7 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  7. Scoped Jurisdictional Filters
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — automatically narrows analysis to the proper scope of statutes, rules, and precedent.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Removes irrelevant material and improves accuracy for your specific jurisdiction.
                </p>
              </div>

              {/* Feature 8 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  8. Parallel Case Simulation Sandbox
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — evaluates alternative filings, procedural choices, and argument paths in parallel.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Helps you compare viable approaches using structured, side-by-side reasoning.
                </p>
              </div>

              {/* Feature 9 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  9. Legally Compliant Drafting
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — aligns all generated documents with statutory, formatting, and jurisdiction-specific requirements.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Ensures every piece of work is correct on its face, reducing revisions and avoiding rejection.
                </p>
              </div>

              {/* Feature 10 */}
              <div className="text-white">
                <h3 className="text-base md:text-lg font-semibold mb-2" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>
                  10. Secure Collaboration & Version Vault
                </h3>
                <p className="text-sm md:text-base text-white/90 mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  — encrypted storage with immutable versions and reviewer annotations linked to the Verifiable Reasoning Log.
                </p>
                <p className="text-sm text-white/80 italic" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                  Benefit: Simplifies team workflows and preserves a clean audit-ready history of edits and decisions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AI System Showcase Section */}
      <section className="py-20 px-4 bg-gradient-to-b from-background to-card">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Revolutionary 12-Model AI Orchestration Network</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Twelve specialized AI engines working in synchronized coordination to deliver unmatched legal intelligence.
            </p>
          </div>
          <AISystemShowcase variant="full" />
        </div>
      </section>

      {/* Interactive LEXARA Consultation Sample */}
      <section className="py-20 px-4 bg-background">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-4">Try LEXARA</h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              Experience BadBlue's AI-powered legal analysis with a free sample consultation. No signup required.
            </p>
          </div>
          <SampleLexaraConsultation />
        </div>
      </section>

      {/* Trust & Transparency - Simplified */}
      <section className="py-20 px-4 bg-card">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-6">Our Commitment</h2>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              LegalWhat provides AI-powered legal tools and consultation across 30+ practice areas. Our platform combines cutting-edge AI with professional legal frameworks to make legal services accessible and affordable.
            </p>
            <p>
              If you believe any information needs updating, please{" "}
              <a href="/contact" className="text-primary hover:underline">
                contact us
              </a>.
            </p>
            <p className="text-xs pt-4 text-muted-foreground/80">
              Use information responsibly and in accordance with applicable laws.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t bg-background">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5" />
                LegalWhat
              </h3>
              <p className="text-sm text-muted-foreground">
                AI-powered legal platform serving 30+ practice areas.
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/login" className="hover:text-foreground">How It Works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/privacy" className="hover:text-foreground">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-foreground">Terms of Service</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/contact" className="hover:text-foreground">Contact Us</a></li>
                <li><a href="mailto:contact.badblue@gmail.com" className="hover:text-foreground">contact.badblue@gmail.com</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">Follow Us</h4>
              <div className="flex gap-3">
                <a href="https://facebook.com/badblue" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Facebook">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
                <a href="https://twitter.com/badblue" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Twitter">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
                </a>
                <a href="https://linkedin.com/company/badblue" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="LinkedIn">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
              </div>
            </div>
          </div>

          {/* Legal Disclaimer */}
          <div className="pt-8 border-t">
            <div className="bg-muted/30 rounded-lg p-6 mb-6">
              <h4 className="font-semibold mb-3 text-sm">LIMITATION OF LIABILITY AND USER RESPONSIBILITY</h4>
              <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                <p>
                  <strong className="text-foreground">No Liability for User Conduct:</strong> BadBlue, its developers, owners, affiliates, and service providers are NOT liable for any fraudulent, false, misleading, or unlawful use of this platform by users. Users are solely responsible for the accuracy, truthfulness, and legality of all information they submit, including complaints, lawsuits, officer information, and evidence.
                </p>
                <p>
                  <strong className="text-foreground">User-Generated Content:</strong> Pursuant to 47 U.S.C. § 230(c)(1) (Section 230 of the Communications Decency Act), BadBlue is not liable for information provided by users. We do not endorse, verify, or assume responsibility for user-submitted content. Users who submit false or fraudulent information may be subject to criminal prosecution under federal law, including but not limited to:
                </p>
                <ul className="ml-4 space-y-1">
                  <li>• <strong>18 U.S.C. § 1001</strong> – False Statements to Government Agencies (up to 5 years imprisonment)</li>
                  <li>• <strong>18 U.S.C. § 1621</strong> – Perjury (up to 5 years imprisonment)</li>
                  <li>• <strong>18 U.S.C. § 1623</strong> – False Declarations Before Court or Grand Jury</li>
                  <li>• State-specific laws regarding filing false police reports and perjury</li>
                </ul>
                <p>
                  <strong className="text-foreground">Document Drafting Service Only:</strong> BadBlue provides document drafting and template generation services. We are NOT a law firm and do NOT provide legal advice, legal representation, or create an attorney-client relationship. All users should consult with licensed attorneys before filing complaints or lawsuits.
                </p>
                <p>
                  <strong className="text-foreground">No Guarantee of Outcomes:</strong> BadBlue makes no representations or warranties regarding the outcome of any complaint or lawsuit filed using our services. Legal proceedings are complex and outcomes depend on many factors beyond our control.
                </p>
                <p>
                  <strong className="text-foreground">Accuracy of Public Records:</strong> While we strive for accuracy, BadBlue cannot guarantee the completeness or accuracy of officer information obtained from public records databases. Users should independently verify all information before relying on it.
                </p>
                <p className="pt-2 border-t">
                  <strong className="text-foreground">BY USING THIS SERVICE, YOU ACKNOWLEDGE AND AGREE THAT:</strong> (1) You are solely responsible for the accuracy and legality of all information you submit; (2) Submitting false information may subject you to criminal prosecution; (3) BadBlue and its affiliates are not liable for your use or misuse of this platform; (4) You will indemnify and hold harmless BadBlue from any claims arising from your use of this service.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t text-center text-sm text-muted-foreground">
            <p className="flex items-center justify-center gap-1 flex-wrap">
              &copy; 2025 LegalWhat
              <img 
                src="/images/Legal%20What%20Icon.png" 
                alt="LegalWhat" 
                className="inline-block h-[1em] w-auto object-contain"
                onError={(e) => e.currentTarget.style.display = 'none'}
              />
              <span>by BadBlue. All rights reserved.</span>
            </p>
          </div>
        </div>
      </footer>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/landing" />

      <SupportEmailFooter />
    </div>
  );
}
