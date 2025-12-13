/**
 * LegalWhat Welcome Page - Law Library Bookshelf Design
 * 
 * Displays 30 law types as realistic law book spines on a bookshelf
 * Features Law Enforcement Accountability as highlighted option
 * Each book is directly clickable to navigate to the legal consultation page
 * Integrates with existing BadBlue functionality
 * 
 * Now includes Lexara Live consent modal for first-time legal consultation users
 */

import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Shield } from "lucide-react";
import { LAW_TYPE_DATA, type LawTypeInfo } from "@shared/lawTypes";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import LexaraLiveConsentModal, { 
  hasLexaraLiveConsent,
  getLexaraLiveEnabled 
} from "@/components/LexaraLiveConsentModal";

// Color palette - 30 distinct colors assigned to ensure no adjacent similar colors
const BOOK_COLORS = [
  { name: 'Administrative Law', color: '#E83D66' },           // Lipstick
  { name: 'Appellate Law', color: '#6699CC' },                // Mercedes Blue
  { name: 'Banking and Financing Law', color: '#32CD32' },    // Lime Green
  { name: 'Civil Law', color: '#6B3FA0' },                    // Grape
  { name: 'Civil Rights Law', color: '#71EEB8' },             // Seafoam
  { name: 'Constitutional Law', color: '#CD7F32' },           // Bronze
  { name: 'Contract Law', color: '#FFBF00' },                 // Amber
  { name: 'Criminal Law', color: '#301934' },                 // Dark Purple
  { name: 'Cyber Technology Law', color: '#007FFF' },         // Azure Blue
  { name: 'Employment and Labor Law', color: '#4CBB17' },     // Kelly Green
  { name: 'Environmental Law', color: '#E25822' },            // Flame
  { name: 'Family Law', color: '#E0FFFF' },                   // Light Cyan
  { name: 'FOIA/Open Records Law', color: '#0096FF' },        // Bright Blue
  { name: 'Immigration Law', color: '#996515' },              // Golden Brown
  { name: 'Insurance Law', color: '#FF0000' },                // Fire Red
  { name: 'Intellectual Property Law', color: '#E30B5C' },    // Raspberry
  { name: 'International Law', color: '#191970' },            // Midnight
  { name: 'Juvenile Law', color: '#008080' },                 // Teal
  { name: 'Law Enforcement Accountability', color: '#36454F' }, // Charcoal (Featured)
  { name: 'Military/Veterans Law', color: '#E6E6FA' },        // Lavender
  { name: 'Municipal/Government Law', color: '#E0B0FF' },     // Mauve
  { name: 'Probate and Estate Law', color: '#8DA399' },       // Morning Blue
  { name: 'Procedural Law', color: '#FFCBA4' },               // Peach
  { name: 'Property Law', color: '#B5651D' },                 // Light Brown
  { name: 'Public Housing Law', color: '#DA70D6' },           // Orchid
  { name: 'Real Estate Law', color: '#87CEEB' },              // Sky Blue
  { name: 'Securities Law', color: '#005F69' },               // Peacock
  { name: 'Tax Law', color: '#98FF98' },                      // Mint Green
  { name: 'Tort Law', color: '#DE3163' },                     // Cherry Red
  { name: 'Trusts Law', color: '#FFD700' },                   // Gold
];

// Default color for books without a matched color
const DEFAULT_BOOK_COLOR = '#666666';

/**
 * Darkens or lightens a hex color by a given percentage
 * @param hex - Hex color string (e.g., '#FF0000')
 * @param percent - Percentage to darken (positive) or lighten (negative)
 * @returns Adjusted hex color string
 */
const adjustColorBrightness = (hex: string, percent: number): string => {
  // Parse hex color to RGB components
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  
  // Extract R, G, B components using bit shifting
  const R = (num >> 16) - amt;
  const G = (num >> 8 & 0x00FF) - amt;
  const B = (num & 0x0000FF) - amt;
  
  // Clamp each component to 0-255 range and reconstruct hex
  return '#' + (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  ).toString(16).slice(1);
};

/**
 * Converts hex color to RGB object for rgba usage
 * @param hex - Hex color string (e.g., '#FF0000')
 * @returns RGB object with r, g, b components
 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 100, g: 100, b: 100 };
}

// Book spine component with "Quiet 3D" premium design - depth, light, and material
const BookSpine = ({ 
  lawType, 
  color, 
  onClick,
  ariaLabel
}: { 
  lawType: LawTypeInfo; 
  color: string; 
  onClick: () => void;
  ariaLabel: string;
}) => {
  const rgb = hexToRgb(color);
  const accentRgba = `${rgb.r}, ${rgb.g}, ${rgb.b}`;

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="book-spine-quiet3d relative cursor-pointer flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:ring-offset-2 focus:ring-offset-black group"
      style={{
        width: '55px',
        height: '280px',
        // Neutral dark base with subtle gradient for material feel
        background: `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.15))`,
        backgroundColor: '#1a1a1f',
        borderRadius: '14px',
        // 3D depth: top light, bottom occlusion, object lift
        boxShadow: `
          inset 0 1px 0 rgba(255,255,255,0.15),
          inset 0 -1px 0 rgba(0,0,0,0.25),
          0 8px 20px rgba(0,0,0,0.35)
        `,
        border: 'none',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      {/* Color as light source - left accent rim */}
      <div
        className="absolute top-0 bottom-0 left-0 w-[3px] rounded-l-[14px]"
        style={{
          background: `linear-gradient(to bottom, rgba(${accentRgba}, 0.6) 0%, rgba(${accentRgba}, 0.3) 50%, rgba(${accentRgba}, 0.1) 100%)`,
        }}
      />
      
      {/* Hover glow effect - color as light, not paint */}
      <div
        className="absolute inset-0 rounded-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out pointer-events-none"
        style={{
          boxShadow: `0 0 24px rgba(${accentRgba}, 0.35)`,
        }}
      />
      
      {/* Text on spine - horizontal, sentence case, medium weight */}
      <div className="absolute inset-0 flex items-center justify-center px-2">
        <span
          className="book-spine-label text-center break-words"
          style={{
            fontFamily: "'Inter', 'SF Pro', system-ui, sans-serif",
            fontSize: lawType.name.length > 25 ? '9px' : '10px',
            fontWeight: 500,
            letterSpacing: '0.015em',
            lineHeight: '1.3',
            color: 'rgba(255,255,255,0.9)',
            // Subtle text depth for edge definition
            textShadow: `
              0 1px 1px rgba(0,0,0,0.4),
              0 -1px 0 rgba(255,255,255,0.05)
            `,
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            transform: 'rotate(180deg)',
          }}
        >
          {lawType.name}
        </span>
      </div>

      {/* Featured badge for Law Enforcement Accountability */}
      {lawType.featured && (
        <div 
          className="absolute -top-2 left-1/2 transform -translate-x-1/2 z-20"
          style={{ writingMode: 'horizontal-tb' }}
        >
          <Badge variant="secondary" className="text-[8px] px-1.5 py-0.5 bg-white/10 text-white/90 border border-white/20 backdrop-blur-sm shadow-lg">
            Featured
          </Badge>
        </div>
      )}
    </button>
  );
};

export default function WelcomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  
  // Consent modal state
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [pendingLawAreaId, setPendingLawAreaId] = useState<string | null>(null);

  // Sort law types alphabetically by name
  const sortedLawTypes = [...LAW_TYPE_DATA].sort((a, b) => 
    a.name.localeCompare(b.name)
  );

  // Create color map for each law type
  const colorMap = new Map(
    BOOK_COLORS.map(item => {
      const lawType = sortedLawTypes.find(lt => lt.name === item.name);
      // Only add to map if law type is found
      if (lawType) {
        return [lawType.id, item.color];
      }
      return null;
    }).filter(Boolean) as [string, string][]
  );

  // Handle consent completion
  const handleConsentComplete = useCallback((enabled: boolean) => {
    setShowConsentModal(false);
    
    if (pendingLawAreaId) {
      // Navigate to legal consultation with live mode param
      setLocation(`/legal-consultation/${pendingLawAreaId}?live=${enabled}`);
      setPendingLawAreaId(null);
    }
  }, [pendingLawAreaId, setLocation]);

  // Handle book click - show consent modal if needed, otherwise navigate
  const handleBookClick = useCallback((lawTypeId: string) => {
    const selectedType = LAW_TYPE_DATA.find(type => type.id === lawTypeId);
    if (selectedType) {
      // Force Law Enforcement to go directly to BadBlue tools
      if (selectedType.id === 'law-enforcement-accountability') {
        setLocation('/badblue');
        return;
      }
      
      // Check if user has already made a consent choice
      if (hasLexaraLiveConsent()) {
        // Already consented - navigate with their preference
        const liveEnabled = getLexaraLiveEnabled() === 'true';
        setLocation(`/legal-consultation/${selectedType.id}?live=${liveEnabled}`);
      } else {
        // Show consent modal for first-time users
        setPendingLawAreaId(selectedType.id);
        setShowConsentModal(true);
      }
    }
  }, [setLocation]);

  return (
    <div className="min-h-screen relative">
      {/* Background Image with Overlay */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat -z-10"
        style={{ backgroundImage: "url(/images/premium_photo-.jpg)" }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/70" />
      </div>

      <SEOHead
        title="Welcome to LegalWhat - AI Legal Platform"
        description="Select your legal area to get started with AI-powered legal assistance"
      />

      {/* Header with Back and Logout buttons */}
      <AppHeader 
        title="LegalWhat" 
        subtitle="AI Legal Platform" 
        fallbackRoute="/login"
        className="bg-black/50 backdrop-blur-md border-b border-white/20"
      />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 sm:py-12">
        {/* Welcome Section */}
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-white flex items-center justify-center flex-wrap gap-2">
            Law Library - Choose Your Legal Area
            <img 
              src="/images/Legal What Icon.png" 
              alt="?" 
              className="inline-block h-[1em] w-auto object-contain"
              style={{ marginBottom: '-0.08em' }}
            />
          </h2>
          <p className="text-lg text-white/90 max-w-2xl mx-auto">
            Select a law book to get started with AI-powered legal assistance
          </p>
        </div>

        {/* Bookshelf Section */}
        <div className="mb-8">
          {/* Bookshelf container with wood-like background */}
          <div 
            className="rounded-lg p-6 relative"
            style={{
              background: 'linear-gradient(to bottom, rgba(139, 69, 19, 0.3) 0%, rgba(101, 67, 33, 0.3) 100%)',
              backdropFilter: 'blur(10px)',
              border: '2px solid rgba(139, 69, 19, 0.5)',
            }}
          >
            {/* Books displayed in rows - each book is directly clickable */}
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {sortedLawTypes.map((lawType) => {
                const color = colorMap.get(lawType.id) || DEFAULT_BOOK_COLOR;
                
                return (
                  <BookSpine
                    key={lawType.id}
                    lawType={lawType}
                    color={color}
                    onClick={() => handleBookClick(lawType.id)}
                    ariaLabel={`Open ${lawType.name} consultation`}
                  />
                );
              })}
            </div>

            {/* Shelf surface visual effect */}
            <div 
              className="h-2 rounded-sm mt-2"
              style={{
                background: 'linear-gradient(to bottom, rgba(101, 67, 33, 0.4) 0%, rgba(139, 69, 19, 0.2) 100%)',
              }}
            />
          </div>
        </div>

        {/* PANTHEON - Advanced Intelligence Platform */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <Badge variant="secondary" className="text-sm bg-white/10 text-white/90 border border-white/20 backdrop-blur-sm px-4 py-1">
              Advanced Intelligence Platform
            </Badge>
          </div>
          <button
            className="feature-card-quiet3d w-full text-left relative cursor-pointer rounded-2xl overflow-hidden group focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-black"
            onClick={() => setLocation('/pantheon')}
            style={{
              // Neutral dark base with material gradient
              background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.15))',
              backgroundColor: '#1a1a1f',
              backdropFilter: 'blur(10px)',
              // 3D depth simulation
              boxShadow: `
                inset 0 1px 0 rgba(255,255,255,0.15),
                inset 0 -1px 0 rgba(0,0,0,0.25),
                0 8px 20px rgba(0,0,0,0.35)
              `,
              border: '1px solid rgba(255,255,255,0.1)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            {/* Color as rim light - left accent */}
            <div
              className="absolute top-0 bottom-0 left-0 w-[4px] rounded-l-2xl"
              style={{
                background: 'linear-gradient(to bottom, rgba(233, 69, 96, 0.7) 0%, rgba(233, 69, 96, 0.4) 50%, rgba(233, 69, 96, 0.2) 100%)',
              }}
            />
            
            {/* Hover glow effect */}
            <div
              className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out pointer-events-none"
              style={{
                boxShadow: '0 0 24px rgba(233, 69, 96, 0.35)',
              }}
            />
            
            <div className="p-6 flex items-start gap-4 relative z-10">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-8 w-8 text-white/70" />
                  <h3 className="quiet3d-heading text-2xl text-white/90">
                    Pantheon - Intelligence Platform
                  </h3>
                </div>
                <p className="quiet3d-label text-base text-white/70 mb-2">
                  Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
                </p>
                <p className="text-base text-white/60 mb-4">
                  Advanced intelligence platform for comprehensive identity profiling. Synthesizes data from 60+ sources 
                  to construct complete profiles including contacts, addresses, relationships, employment, and digital footprints.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Eye of God Mode
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    60+ Data Sources
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Deep Intelligence
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Real-Time Resolution
                  </Badge>
                </div>
              </div>
              <ArrowRight className="h-8 w-8 text-white/50 flex-shrink-0 mt-2 group-hover:text-white/70 transition-colors duration-200" />
            </div>
          </button>
        </div>

        {/* People Finder - Styled with Quiet 3D */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <Badge variant="secondary" className="text-sm bg-white/10 text-white/90 border border-white/20 backdrop-blur-sm px-4 py-1">
              Universal Research Tool
            </Badge>
          </div>
          <button
            className="feature-card-quiet3d w-full text-left relative cursor-pointer rounded-2xl overflow-hidden group focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-black"
            onClick={() => setLocation('/people-finder')}
            style={{
              // Neutral dark base with material gradient
              background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.15))',
              backgroundColor: '#1a1a1f',
              backdropFilter: 'blur(10px)',
              // 3D depth simulation
              boxShadow: `
                inset 0 1px 0 rgba(255,255,255,0.15),
                inset 0 -1px 0 rgba(0,0,0,0.25),
                0 8px 20px rgba(0,0,0,0.35)
              `,
              border: '1px solid rgba(255,255,255,0.1)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            {/* Color as rim light - left accent (blue) */}
            <div
              className="absolute top-0 bottom-0 left-0 w-[4px] rounded-l-2xl"
              style={{
                background: 'linear-gradient(to bottom, rgba(59, 130, 246, 0.7) 0%, rgba(59, 130, 246, 0.4) 50%, rgba(59, 130, 246, 0.2) 100%)',
              }}
            />
            
            {/* Hover glow effect */}
            <div
              className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out pointer-events-none"
              style={{
                boxShadow: '0 0 24px rgba(59, 130, 246, 0.35)',
              }}
            />
            
            <div className="p-6 flex items-start gap-4 relative z-10">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-8 w-8 text-white/70" />
                  <h3 className="quiet3d-heading text-2xl text-white/90">
                    People Finder - Global Identity Intelligence
                  </h3>
                </div>
                <p className="text-base text-white/60 mb-4">
                  Advanced AI-powered people search tool. Find witnesses, experts, parties, or any individual 
                  relevant to your legal matter. Aggregates data from public records, court filings, social media, 
                  professional networks, and more. Works across all legal areas.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Multi-Source Search
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    AI Entity Resolution
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Professional Dossiers
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Legal Research Ready
                  </Badge>
                </div>
              </div>
              <ArrowRight className="h-8 w-8 text-white/50 flex-shrink-0 mt-2 group-hover:text-white/70 transition-colors duration-200" />
            </div>
          </button>
        </div>

        {/* United States Inmate Locator - Quiet 3D with green accent */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <Badge variant="secondary" className="text-sm bg-white/10 text-white/90 border border-white/20 backdrop-blur-sm px-4 py-1">
              Nationwide Corrections Search
            </Badge>
          </div>
          <button
            className="feature-card-quiet3d w-full text-left relative cursor-pointer rounded-2xl overflow-hidden group focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-black"
            onClick={() => setLocation('/inmate-locator')}
            style={{
              // Neutral dark base with material gradient
              background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.15))',
              backgroundColor: '#1a1a1f',
              backdropFilter: 'blur(10px)',
              // 3D depth simulation
              boxShadow: `
                inset 0 1px 0 rgba(255,255,255,0.15),
                inset 0 -1px 0 rgba(0,0,0,0.25),
                0 8px 20px rgba(0,0,0,0.35)
              `,
              border: '1px solid rgba(255,255,255,0.1)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            {/* Color as rim light - left accent (green) */}
            <div
              className="absolute top-0 bottom-0 left-0 w-[4px] rounded-l-2xl"
              style={{
                background: 'linear-gradient(to bottom, rgba(34, 197, 94, 0.7) 0%, rgba(34, 197, 94, 0.4) 50%, rgba(34, 197, 94, 0.2) 100%)',
              }}
            />
            
            {/* Hover glow effect */}
            <div
              className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out pointer-events-none"
              style={{
                boxShadow: '0 0 24px rgba(34, 197, 94, 0.35)',
              }}
            />
            
            <div className="p-6 flex items-start gap-4 relative z-10">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-8 w-8 text-white/70" />
                  <h3 className="quiet3d-heading text-2xl text-white/90">
                    United States Inmate Locator
                  </h3>
                </div>
                <p className="text-base text-white/60 mb-4">
                  Nationwide inmate search across federal, state, private, and local facilities with detailed 
                  records and offense indicators. Search BOP federal prisons, state DOC systems, county jails, 
                  and private correctional facilities with comprehensive custody status and charge information.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Federal BOP
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    50-State Coverage
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Offense Details
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-white/5 text-white/70 border border-white/10">
                    Custody Status
                  </Badge>
                </div>
              </div>
              <ArrowRight className="h-8 w-8 text-white/50 flex-shrink-0 mt-2 group-hover:text-white/70 transition-colors duration-200" />
            </div>
          </button>
        </div>

        {/* Helper Text - Always visible */}
        <div className="text-center mt-8 text-white/80">
          <p className="text-sm">Click any law book above to start your consultation</p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 py-6 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p className="flex items-center justify-center gap-1 flex-wrap">
            © 2024 LegalWhat
            <img 
              src="/images/Legal What Icon.png" 
              alt="?" 
              className="inline-block h-[0.9em] w-auto object-contain"
              style={{ marginBottom: '-0.05em' }}
            />
            AI-powered legal platform.
          </p>
          <p className="mt-1">Featuring Law Enforcement Accountability and 29 other legal areas.</p>
        </div>
      </footer>
      
      {/* Lexara Live Consent Modal */}
      <LexaraLiveConsentModal
        isOpen={showConsentModal}
        onClose={() => {
          setShowConsentModal(false);
          setPendingLawAreaId(null);
        }}
        onConsent={handleConsentComplete}
        targetLawArea={pendingLawAreaId || undefined}
      />
    </div>
  );
}
