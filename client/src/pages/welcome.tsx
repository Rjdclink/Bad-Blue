/**
 * LegalWhat Welcome Page - Law Library Bookshelf Design
 * 
 * Displays 30 law types as realistic law book spines on a bookshelf
 * Features Law Enforcement Accountability as highlighted option
 * Each book is directly clickable to navigate to the consultation page
 * Integrates with existing BadBlue functionality
 * 
 * Now includes Lexara Live consent modal for first-time consultation users
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

// Book spine component with vertical text and 3D effect - Now directly navigates on click
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
  const darkColor = adjustColorBrightness(color, 20);
  const lighterColor = adjustColorBrightness(color, -10);

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className={`
        relative cursor-pointer transition-all duration-300 flex-shrink-0
        hover:-translate-y-3 hover:scale-105 hover:z-10
        focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-black
        active:scale-95 active:translate-y-0
      `}
      style={{
        width: '55px',
        height: '280px',
        background: `linear-gradient(to right, ${darkColor} 0%, ${color} 40%, ${color} 60%, ${darkColor} 100%)`,
        borderRadius: '2px 6px 6px 2px',
        boxShadow: `2px 2px 4px rgba(0,0,0,0.4), inset -2px 0 4px rgba(0,0,0,0.2)`,
        border: 'none',
      }}
    >
      {/* Spine highlight for 3D effect */}
      <div
        className="absolute top-0 bottom-0 left-0 w-[2px]"
        style={{
          background: `linear-gradient(to bottom, ${lighterColor} 0%, transparent 50%, rgba(0,0,0,0.3) 100%)`,
        }}
      />
      
      {/* Text on spine */}
      <div
        className="absolute inset-0 flex items-center justify-center px-1"
        style={{
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          transform: 'rotate(180deg)',
        }}
      >
        <span
          className="font-bold text-center break-words"
          style={{
            color: '#D4AF37',
            textShadow: '1px 1px 2px rgba(0,0,0,0.8), 0 0 8px rgba(212,175,55,0.4)',
            fontSize: lawType.name.length > 25 ? '10px' : '11px',
            letterSpacing: '0.5px',
            lineHeight: '1.3',
          }}
        >
          {lawType.name.toUpperCase()}
        </span>
      </div>

      {/* Featured badge for Law Enforcement Accountability */}
      {lawType.featured && (
        <div 
          className="absolute -top-2 left-1/2 transform -translate-x-1/2 z-20"
          style={{ writingMode: 'horizontal-tb' }}
        >
          <Badge variant="destructive" className="text-[8px] px-1 py-0 shadow-lg">
            FEATURED
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
      // Navigate to consultation with live mode param
      setLocation(`/consultation/${pendingLawAreaId}?live=${enabled}`);
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
        setLocation(`/consultation/${selectedType.id}?live=${liveEnabled}`);
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
            <Badge variant="default" className="text-sm bg-gradient-to-r from-red-600 to-pink-600">
              🏛️ Advanced Intelligence Platform
            </Badge>
          </div>
          <div
            className="cursor-pointer transition-all hover:shadow-xl rounded-lg overflow-hidden"
            onClick={() => setLocation('/pantheon')}
            style={{
              background: 'linear-gradient(135deg, rgba(233, 69, 96, 0.15) 0%, rgba(15, 52, 96, 0.15) 100%)',
              backdropFilter: 'blur(10px)',
              border: '3px solid rgba(233, 69, 96, 0.5)',
            }}
          >
            <div className="p-6 flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-8 w-8 text-red-400" />
                  <h3 className="text-2xl font-bold text-white">
                    PANTHEON - Intelligence Platform
                  </h3>
                </div>
                <p className="text-base text-white/80 mb-2">
                  <strong>Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity</strong>
                </p>
                <p className="text-base text-white/80 mb-4">
                  Advanced intelligence platform for comprehensive identity profiling. Synthesizes data from 60+ sources 
                  to construct complete profiles including contacts, addresses, relationships, employment, and digital footprints. 
                  Uncovers information that even the most expensive services miss.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs bg-red-500/20 text-red-200 border-red-400/30">
                    👁️ EYE OF GOD Mode
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-red-500/20 text-red-200 border-red-400/30">
                    🌐 60+ Data Sources
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-red-500/20 text-red-200 border-red-400/30">
                    🔍 Deep Intelligence
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-red-500/20 text-red-200 border-red-400/30">
                    ⚡ Real-Time Resolution
                  </Badge>
                </div>
              </div>
              <ArrowRight className="h-8 w-8 text-red-400 flex-shrink-0 mt-2" />
            </div>
          </div>
        </div>

        {/* People Finder - Styled as Special Reference Book */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <Badge variant="default" className="text-sm bg-gradient-to-r from-blue-600 to-blue-700">
              Universal Research Tool
            </Badge>
          </div>
          <div
            className="cursor-pointer transition-all hover:shadow-xl rounded-lg overflow-hidden"
            onClick={() => setLocation('/people-finder')}
            style={{
              background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)',
              backdropFilter: 'blur(10px)',
              border: '3px solid rgba(59, 130, 246, 0.5)',
            }}
          >
            <div className="p-6 flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-8 w-8 text-blue-400" />
                  <h3 className="text-2xl font-bold text-white">
                    People Finder - Global Identity Intelligence
                  </h3>
                </div>
                <p className="text-base text-white/80 mb-4">
                  Advanced AI-powered people search tool. Find witnesses, experts, parties, or any individual 
                  relevant to your legal matter. Aggregates data from public records, court filings, social media, 
                  professional networks, and more. Works across all legal areas.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-200 border-blue-400/30">
                    🔍 Multi-Source Search
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-200 border-blue-400/30">
                    🤖 AI Entity Resolution
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-200 border-blue-400/30">
                    📊 Professional Dossiers
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-200 border-blue-400/30">
                    ⚖️ Legal Research Ready
                  </Badge>
                </div>
              </div>
              <ArrowRight className="h-8 w-8 text-blue-400 flex-shrink-0 mt-2" />
            </div>
          </div>
        </div>

        {/* United States Inmate Locator - Green Accent */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <Badge variant="default" className="text-sm bg-gradient-to-r from-green-600 to-green-700">
              Nationwide Corrections Search
            </Badge>
          </div>
          <div
            className="cursor-pointer transition-all hover:shadow-xl rounded-lg overflow-hidden"
            onClick={() => setLocation('/inmate-locator')}
            style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(22, 163, 74, 0.15) 100%)',
              backdropFilter: 'blur(10px)',
              border: '3px solid rgba(34, 197, 94, 0.5)',
            }}
          >
            <div className="p-6 flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="h-8 w-8 text-green-400" />
                  <h3 className="text-2xl font-bold text-white">
                    United States Inmate Locator
                  </h3>
                </div>
                <p className="text-base text-white/80 mb-4">
                  Nationwide inmate search across federal, state, private, and local facilities with detailed 
                  records and offense indicators. Search BOP federal prisons, state DOC systems, county jails, 
                  and private correctional facilities with comprehensive custody status and charge information.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-200 border-green-400/30">
                    🏛️ Federal BOP
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-200 border-green-400/30">
                    🗺️ 50-State Coverage
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-200 border-green-400/30">
                    ⚖️ Offense Details
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-200 border-green-400/30">
                    📊 Custody Status
                  </Badge>
                </div>
              </div>
              <ArrowRight className="h-8 w-8 text-green-400 flex-shrink-0 mt-2" />
            </div>
          </div>
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
