/**
 * 🏛️ PANTHEON PAGE
 * 
 * Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
 * 
 * Advanced intelligence platform for comprehensive identity profiling
 */

import { useMemo, useState } from 'react';
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

// Constants
const NETWORK_HEAD_IMAGE = '/images/digital-mind-abstract-representation-human-intelligence-neural-network_191095-87127.jpg';
const MAX_HEATMAP_POINTS = 10; // Maximum number of points to display on heatmap
const MAX_MAP_MARKERS = 5; // Maximum number of markers to display on map

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
  const [searchAbortController, setSearchAbortController] = useState<AbortController | null>(null);
  const { toast } = useToast();

  const locationMap = useMemo(() => {
    if (!results?.locationHistory?.length) {
      return { heatmap: [] as Array<[number, number, number]>, markers: [] as Array<{ pos: [number, number]; popup: string }>, center: [0, 0] as [number, number] };
    }
    return buildCoordinateMapData(results.locationHistory);
  }, [results?.locationHistory]);
  
  // Timeout durations in milliseconds based on search depth
  const DEPTH_TIMEOUTS: Record<number, number> = {
    1: 50000,   // 50 seconds (5 second buffer for 45s search)
    2: 95000,   // 95 seconds (5 second buffer for 90s search)
    3: 185000,  // 185 seconds (5 second buffer for 180s search)
    4: 310000,  // 310 seconds (10 second buffer for 300s search)
  };
  
  const handleSearchStart = async (config: SearchConfig) => {
    setSearching(true);
    setResults(null);
    setSearchConfig(config);
    
    // Create abort controller for timeout
    const abortController = new AbortController();
    setSearchAbortController(abortController);
    
    // Set timeout based on search depth
    const timeout = DEPTH_TIMEOUTS[config.searchDepth] || 35000;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);
    
    try {
      const response = await fetch('/api/osint/full-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: config.name,
          location: config.location,
          searchDepth: config.searchDepth,
        }),
        signal: abortController.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      setResults(data);
      
      toast({
        title: "PANTHEON Search Complete",
        description: `Intelligence report generated for ${data.identitySummary?.name || config.name}`,
      });
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        // Timer ran out - generate partial report
        const partialReport: PeopleSearchReport = {
          identitySummary: {
            name: config.name,
            verificationStatus: 'Timeout - No Data Collected',
          },
          contactInformation: [],
          socialMediaPresence: [],
          employmentAndEducation: [],
          locationHistory: config.location ? [config.location] : [],
          publicRecords: [],
          onlineMentions: [],
          riskAndReputation: [],
          summary: `Search timed out after ${Math.floor(timeout / 1000)} seconds before any data could be collected. No data was retrieved due to the timeout. Consider running a deeper search level with more time for comprehensive results.`,
          confidenceScore: 0,
          sources: [{
            name: 'Timeout - No Data',
            data: { timeout: timeout, searchDepth: config.searchDepth, dataCollected: false },
            confidence: 0,
            timestamp: new Date(),
          }],
        };
        
        setResults(partialReport);
        
        toast({
          title: "Search Timed Out",
          description: "No data was collected before the timeout. Try a longer search duration.",
          variant: "default",
        });
      } else {
        console.error('Search failed:', error);
        toast({
          title: "Search Failed",
          description: error instanceof Error ? error.message : 'An error occurred',
          variant: "destructive",
        });
      }
    } finally {
      setSearching(false);
      setSearchAbortController(null);
    }
  };
  
  // Handler for when the Doomsday Clock timer completes
  const handleTimerComplete = () => {
    if (searchAbortController && searching) {
      // Abort the ongoing search
      searchAbortController.abort();
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
              backgroundImage: `url(${NETWORK_HEAD_IMAGE})`,
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
                onComplete={handleTimerComplete}
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
              {locationMap.heatmap.length > 0 && (
                <section className="gps-map-section" style={{ marginTop: '2rem' }}>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <MapPin className="w-5 h-5" />
                        Location Intelligence Map
                      </CardTitle>
                      <CardDescription>
                        Geographic visualization of known coordinates
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <LocationHeatmap
                        data={locationMap.heatmap}
                        markers={locationMap.markers}
                        center={locationMap.center}
                        zoom={10}
                        config={{ radius: 30, blur: 20, maxZoom: 18 }}
                      />
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

function parseLatLng(input: string): [number, number] | null {
  // Accept decimal degrees in the form: "lat, lng" anywhere in the string
  const m = input.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function buildCoordinateMapData(locationHistory: string[]): {
  heatmap: Array<[number, number, number]>;
  markers: Array<{ pos: [number, number]; popup: string }>;
  center: [number, number];
} {
  const coords = locationHistory
    .map((s) => ({ raw: s, coord: parseLatLng(s) }))
    .filter((x): x is { raw: string; coord: [number, number] } => !!x.coord)
    .slice(0, MAX_HEATMAP_POINTS);

  const heatmap: Array<[number, number, number]> = coords.map(({ coord }) => [coord[0], coord[1], 0.8]);
  const markers = coords.slice(0, MAX_MAP_MARKERS).map(({ raw, coord }) => ({ pos: coord, popup: raw }));

  const center: [number, number] =
    heatmap.length > 0
      ? ([
          heatmap.reduce((sum, p) => sum + p[0], 0) / heatmap.length,
          heatmap.reduce((sum, p) => sum + p[1], 0) / heatmap.length,
        ] as [number, number])
      : ([0, 0] as [number, number]);

  return { heatmap, markers, center };
}
