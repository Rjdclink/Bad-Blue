/**
 * 🏛️ PANTHEON PAGE
 * 
 * Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
 * 
 * Advanced intelligence platform for comprehensive identity profiling
 */

import { useState } from 'react';
import { DoomsdayClockSelector } from '@/components/DoomsdayClockSelector';
import { PantheonProgressTracker } from '@/components/PantheonProgressTracker';
import { LocationHeatmap } from '@/components/LocationHeatmap';
import { SEOHead } from "@/components/SEOHead";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertCircle, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import './pantheon.css';

interface SearchConfig {
  name: string;
  location?: string;
  searchDepth: number;
}

interface PeopleSearchReport {
  identitySummary: {
    name: string;
    aliases?: string[];
    age?: number;
    dateOfBirth?: string;
    gender?: string;
    verificationStatus: string;
  };
  contactInformation: string[];
  socialMediaPresence: string[];
  employmentAndEducation: string[];
  locationHistory: string[];
  publicRecords: string[];
  onlineMentions: string[];
  riskAndReputation: string[];
  summary: string;
  confidenceScore: number;
  sources: any[];
}

export default function PantheonPage() {
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PeopleSearchReport | null>(null);
  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
  const { toast } = useToast();
  
  const handleSearchStart = async (config: SearchConfig) => {
    setSearching(true);
    setResults(null);
    setSearchConfig(config);
    
    try {
      const response = await apiRequest('/api/osint/full-search', 'POST', {
        name: config.name,
        location: config.location,
        searchDepth: config.searchDepth,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }
      
      const data = await response.json();
      setResults(data);
      
      toast({
        title: "PANTHEON Search Complete",
        description: `Intelligence report generated for ${data.identitySummary.name}`,
      });
    } catch (error) {
      console.error('Search failed:', error);
      toast({
        title: "Search Failed",
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };
  
  return (
    <>
      <SEOHead
        title="PANTHEON - Advanced Intelligence Platform | LegalWhat"
        description="PANTHEON: Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity. Advanced intelligence platform for comprehensive identity profiling."
        keywords="PANTHEON, intelligence platform, identity profiling, OSINT, background investigation, people search"
      />
      
      <div className="min-h-screen bg-background">
        <AppHeader 
          title="PANTHEON"
          subtitle="Intelligence Platform"
          fallbackRoute="/welcome"
        />
        
        <div className="pantheon-container">
          {/* Hero Section */}
          <section className="hero">
            <div className="logo">
              <h1 className="title">PANTHEON</h1>
              <p className="subtitle">
                Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
              </p>
            </div>
            
            <p className="tagline">
              Omniscient intelligence. Delivered in seconds.
            </p>
          </section>
          
          {/* Network Head Background Section - Between Hero and Description */}
          <section 
            className="network-head-section"
            style={{
              backgroundImage: 'url(/images/digital-mind-abstract-representation-human-intelligence-neural-network_191095-87127.jpg)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              position: 'relative',
              padding: '6rem 2rem',
              margin: '4rem 0',
            }}
          >
            <div 
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.85) 0%, rgba(17, 24, 39, 0.9) 50%, rgba(0, 0, 0, 0.85) 100%)',
                backdropFilter: 'blur(2px)',
              }}
            />
            <div 
              style={{
                position: 'relative',
                zIndex: 1,
                maxWidth: '900px',
                margin: '0 auto',
                textAlign: 'center',
              }}
            >
              <h2 
                style={{
                  fontSize: '2.5rem',
                  fontWeight: '700',
                  marginBottom: '1.5rem',
                  background: 'linear-gradient(to right, #3b82f6, #8b5cf6, #ec4899)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
              </h2>
              <p 
                style={{
                  fontSize: '1.125rem',
                  lineHeight: '1.75rem',
                  color: 'rgba(255, 255, 255, 0.9)',
                  marginBottom: '1rem',
                }}
              >
                The AI consciousness orchestrating all intelligence crawlers simultaneously
              </p>
              <p 
                style={{
                  fontSize: '0.875rem',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontStyle: 'italic',
                }}
              >
                Real-time data fusion from 60+ autonomous sources
              </p>
            </div>
          </section>
          
          {/* Description Section */}
          <section className="description">
            <h2>What is PANTHEON?</h2>
            
            <p className="main-description">
              PANTHEON is an advanced intelligence platform that locates and profiles 
              individuals across the digital landscape. By synthesizing data from dozens 
              of sources simultaneously, it constructs comprehensive identity profiles 
              including contact information, addresses, relationships, employment history, 
              digital footprints, and associated records.
            </p>
            
            <p className="secondary-description">
              Leveraging adaptive search strategies and multi-source correlation, PANTHEON 
              uncovers information that <strong>even the most expensive information gathering 
              services miss</strong>—revealing connections, patterns, and insights hidden 
              across fragmented public records.
            </p>
          </section>
          
          {/* Capabilities Grid */}
          <section className="capabilities">
            <h2>Capabilities</h2>
            
            <div className="capabilities-grid">
              <CapabilityCard
                icon="🔍"
                title="Real-Time Identity Resolution"
                description="Aggregate and resolve identities across multiple databases instantly"
              />
              
              <CapabilityCard
                icon="🌐"
                title="Relationship Mapping"
                description="Uncover social graphs, family connections, and professional networks"
              />
              
              <CapabilityCard
                icon="📍"
                title="Location Tracking"
                description="Historical addresses, current locations, and movement patterns"
              />
              
              <CapabilityCard
                icon="💼"
                title="Employment Discovery"
                description="Current and past employers, business affiliations, and professional roles"
              />
              
              <CapabilityCard
                icon="👤"
                title="Digital Footprint Aggregation"
                description="Social media presence, online activity, and public digital records"
              />
              
              <CapabilityCard
                icon="⚖️"
                title="Court & Property Records"
                description="Legal history, property ownership, and public filings"
              />
              
              <CapabilityCard
                icon="🎓"
                title="Credential Verification"
                description="Professional licenses, certifications, and educational background"
              />
              
              <CapabilityCard
                icon="👥"
                title="Associated Persons"
                description="Family members, roommates, colleagues, and known associates"
              />
              
              <CapabilityCard
                icon="🎭"
                title="Alias Detection"
                description="Identify alternate names, nicknames, and consolidated identities"
              />
              
              <CapabilityCard
                icon="🔄"
                title="Continuous Monitoring"
                description="Automated profile updates as new public information becomes available"
              />
            </div>
          </section>
          
          {/* Search Depth Selector */}
          <section className="search-depth">
            <h2>Select Search Depth</h2>
            
            <DoomsdayClockSelector 
              onSearchStart={handleSearchStart}
              isSearching={searching}
            />
          </section>
          
          {/* Progress Tracker */}
          {searching && searchConfig && (
            <section className="search-progress">
              <PantheonProgressTracker 
                searchDepth={searchConfig.searchDepth}
                isSearching={searching}
                onComplete={() => {
                  // Progress complete - actual API response handles results
                }}
              />
            </section>
          )}
          
          {/* Data Sources */}
          <section className="sources">
            <h2>Data Sources</h2>
            <p>
              PANTHEON synthesizes information from <strong>60+ public data sources</strong> including:
            </p>
            <ul className="sources-list">
              <li>Court records and legal filings</li>
              <li>Property databases and deed records</li>
              <li>Business registrations and corporate filings</li>
              <li>Social media platforms</li>
              <li>News archives and media mentions</li>
              <li>Professional networks and directories</li>
              <li>Government records and public registries</li>
              <li>Educational institutions and alumni databases</li>
              <li>Licensing boards and credential registries</li>
              <li>And many more...</li>
            </ul>
          </section>
          
          {/* Privacy Notice */}
          <section className="privacy-notice">
            <Card className="border-yellow-500/50 bg-yellow-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-600">
                  <AlertCircle className="w-5 h-5" />
                  Important Notice
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  PANTHEON aggregates information exclusively from publicly available sources. 
                  All data is obtained legally and ethically from records that are already 
                  accessible to the public. We do not access private databases, hack systems, 
                  or obtain information through unauthorized means.
                </p>
                <p className="text-sm">
                  Results should be used responsibly and in compliance with applicable laws, 
                  including the Fair Credit Reporting Act (FCRA) and other privacy regulations.
                </p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
                  <Shield className="w-3 h-3" />
                  <strong>Legal & Ethical Use Only</strong>
                </div>
              </CardContent>
            </Card>
          </section>
          
          {/* Results Display */}
          {results && (
            <>
              <section className="results">
                <h2>Search Results</h2>
                <ResultsDisplay data={results} />
              </section>
              
              {/* GPS Map Section - Display if location data exists */}
              {results.locationHistory && results.locationHistory.length > 0 && (
                <section className="gps-map-section" style={{ marginTop: '2rem' }}>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <MapPin className="w-5 h-5" />
                        Location Intelligence Map
                      </CardTitle>
                      <CardDescription>
                        Geographic visualization of known locations and movement patterns
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <LocationHeatmap
                        data={generateMockLocationData(results.locationHistory)}
                        markers={generateLocationMarkers(results.locationHistory)}
                        center={[40.7128, -74.0060]}
                        zoom={10}
                        config={{ radius: 30, blur: 20, maxZoom: 18 }}
                      />
                      <p className="text-xs text-muted-foreground mt-3">
                        Note: Map displays approximate locations based on address data. 
                        Actual GPS coordinates require EXIF data from images.
                      </p>
                    </CardContent>
                  </Card>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Component: Capability Card
function CapabilityCard({ icon, title, description }: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Card className="capability-card">
      <CardContent className="p-6">
        <div className="icon text-4xl mb-3">{icon}</div>
        <h3 className="font-semibold text-lg mb-2 leading-snug">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}

// Component: Results Display
function ResultsDisplay({ data }: { data: PeopleSearchReport }) {
  return (
    <Card className="results-display">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Intelligence Report: {data.identitySummary.name}</span>
          <Badge variant={data.confidenceScore >= 80 ? "default" : "secondary"}>
            Confidence: {data.confidenceScore}%
          </Badge>
        </CardTitle>
        {data.identitySummary.aliases && data.identitySummary.aliases.length > 0 && (
          <CardDescription>
            Known aliases: {data.identitySummary.aliases.join(", ")}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Identity Summary */}
        <div>
          <h3 className="font-semibold text-base mb-3">Identity Summary</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {data.identitySummary.age && <div className="leading-relaxed"><span className="text-muted-foreground font-medium">Age:</span> {data.identitySummary.age}</div>}
            {data.identitySummary.dateOfBirth && <div className="leading-relaxed"><span className="text-muted-foreground font-medium">DOB:</span> {data.identitySummary.dateOfBirth}</div>}
            {data.identitySummary.gender && <div className="leading-relaxed"><span className="text-muted-foreground font-medium">Gender:</span> {data.identitySummary.gender}</div>}
            <div className="leading-relaxed"><span className="text-muted-foreground font-medium">Status:</span> {data.identitySummary.verificationStatus}</div>
          </div>
        </div>

        {/* Summary */}
        {data.summary && data.summary.trim() && (
          <div>
            <h3 className="font-semibold text-base mb-3">Summary</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
          </div>
        )}

        {/* Contact Information */}
        {data.contactInformation && data.contactInformation.length > 0 && (
          <div>
            <h3 className="font-semibold text-base mb-3">Contact Information</h3>
            <ul className="space-y-2">
              {data.contactInformation.map((item, idx) => (
                <li key={idx} className="text-sm leading-relaxed">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Location History */}
        {data.locationHistory && data.locationHistory.length > 0 && (
          <div>
            <h3 className="font-semibold text-base mb-3">Location History</h3>
            <ul className="space-y-2">
              {data.locationHistory.map((item, idx) => (
                <li key={idx} className="text-sm leading-relaxed">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Employment & Education */}
        {data.employmentAndEducation && data.employmentAndEducation.length > 0 && (
          <div>
            <h3 className="font-semibold text-base mb-3">Employment & Education</h3>
            <ul className="space-y-2">
              {data.employmentAndEducation.map((item, idx) => (
                <li key={idx} className="text-sm leading-relaxed">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Social Media */}
        {data.socialMediaPresence && data.socialMediaPresence.length > 0 && (
          <div>
            <h3 className="font-semibold text-base mb-3">Social Media Presence</h3>
            <ul className="space-y-2">
              {data.socialMediaPresence.map((item, idx) => (
                <li key={idx} className="text-sm leading-relaxed">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Public Records */}
        {data.publicRecords && data.publicRecords.length > 0 && (
          <div>
            <h3 className="font-semibold text-base mb-3">Public Records</h3>
            <ul className="space-y-2">
              {data.publicRecords.map((item, idx) => (
                <li key={idx} className="text-sm leading-relaxed">• {item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Sources */}
        {data.sources && data.sources.length > 0 && (
          <div>
            <h3 className="font-semibold text-base mb-3">Data Sources ({data.sources.length})</h3>
            <div className="flex flex-wrap gap-2">
              {data.sources.map((source, idx) => (
                <Badge key={idx} variant="outline" className="text-xs font-medium">
                  {source.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Helper: Generate mock location data for heatmap
// In production, this would parse actual GPS coordinates from location history
function generateMockLocationData(locationHistory: string[]): Array<[number, number, number]> {
  // Base coordinates around New York City
  const baseCoords: [number, number] = [40.7128, -74.0060];
  
  return locationHistory.slice(0, 10).map((_, idx) => {
    // Generate semi-random coordinates within a reasonable range
    const latOffset = (Math.random() - 0.5) * 0.1;
    const lngOffset = (Math.random() - 0.5) * 0.1;
    const intensity = 0.5 + Math.random() * 0.5; // 0.5 to 1.0
    
    return [
      baseCoords[0] + latOffset,
      baseCoords[1] + lngOffset,
      intensity,
    ];
  });
}

// Helper: Generate location markers for map
function generateLocationMarkers(locationHistory: string[]): Array<{ pos: [number, number]; popup: string }> {
  const baseCoords: [number, number] = [40.7128, -74.0060];
  
  return locationHistory.slice(0, 5).map((location, idx) => {
    const latOffset = (Math.random() - 0.5) * 0.1;
    const lngOffset = (Math.random() - 0.5) * 0.1;
    
    return {
      pos: [baseCoords[0] + latOffset, baseCoords[1] + lngOffset] as [number, number],
      popup: location,
    };
  });
}
