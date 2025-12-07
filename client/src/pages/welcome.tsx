/**
 * LegalWhat Welcome Page - Law Library Bookshelf Design
 * 
 * Displays 30 law types as realistic law book spines on a bookshelf
 * Features Law Enforcement Accountability as highlighted option
 * Integrates with existing BadBlue functionality
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Shield } from "lucide-react";
import { LAW_TYPE_DATA, type LawTypeInfo } from "@shared/lawTypes";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";

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

// Book spine component with vertical text and 3D effect
const BookSpine = ({ 
  lawType, 
  color, 
  isSelected, 
  onClick 
}: { 
  lawType: LawTypeInfo; 
  color: string; 
  isSelected: boolean; 
  onClick: () => void 
}) => {
  const darkColor = adjustColorBrightness(color, 20);
  const lighterColor = adjustColorBrightness(color, -10);

  return (
    <div
      onClick={onClick}
      className={`
        relative cursor-pointer transition-all duration-300 flex-shrink-0
        ${isSelected ? 'scale-105 z-10' : 'hover:-translate-y-3'}
      `}
      style={{
        width: '55px',
        height: '280px',
        background: `linear-gradient(to right, ${darkColor} 0%, ${color} 40%, ${color} 60%, ${darkColor} 100%)`,
        borderRadius: '2px 6px 6px 2px',
        boxShadow: isSelected 
          ? `0 0 30px rgba(212, 175, 55, 0.8), 2px 4px 8px rgba(0,0,0,0.5), inset -2px 0 6px rgba(0,0,0,0.3)`
          : `2px 2px 4px rgba(0,0,0,0.4), inset -2px 0 4px rgba(0,0,0,0.2)`,
        border: isSelected ? '2px solid #D4AF37' : 'none',
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
    </div>
  );
};

export default function WelcomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedLawType, setSelectedLawType] = useState<string | null>(null);

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

  // Handle law type selection (only one at a time)
  const handleSelection = (lawTypeId: string) => {
    setSelectedLawType(selectedLawType === lawTypeId ? null : lawTypeId);
  };

  // Handle "Let's Go" button click
  const handleLetsGo = () => {
    if (!selectedLawType) return;
    
    const selectedType = LAW_TYPE_DATA.find(type => type.id === selectedLawType);
    if (selectedType) {
      // Force Law Enforcement to go directly to BadBlue tools
      if (selectedType.id === 'law-enforcement-accountability') {
        setLocation('/badblue');
      } else {
        setLocation(selectedType.route);
      }
    }
  };

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
            {/* Books displayed in rows */}
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {sortedLawTypes.map((lawType) => {
                const color = colorMap.get(lawType.id) || DEFAULT_BOOK_COLOR;
                const isSelected = selectedLawType === lawType.id;
                
                return (
                  <BookSpine
                    key={lawType.id}
                    lawType={lawType}
                    color={color}
                    isSelected={isSelected}
                    onClick={() => handleSelection(lawType.id)}
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

          {/* Let's Go Button - Displayed below bookshelf when selection is made */}
          {selectedLawType && (
            <div className="mt-6 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-300">
              <Button
                size="lg"
                onClick={handleLetsGo}
                className="shadow-xl hover:shadow-2xl transition-all text-lg bg-gradient-to-r from-primary to-primary/90 animate-pulse"
              >
                <img 
                  src="/images/Law-book.webp" 
                  alt="" 
                  className="w-5 h-5 mr-2 object-contain"
                />
                Let's Go with {LAW_TYPE_DATA.find(t => t.id === selectedLawType)?.name}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          )}
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

        {/* Helper Text */}
        {!selectedLawType && (
          <div className="text-center mt-8 text-white/80">
            <p className="text-sm">Select a law book from the shelf above to continue</p>
          </div>
        )}
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
    </div>
  );
}
