import { useMemo, useState, useCallback, useEffect } from "react";
import PeopleFinderSearch from "@/components/PeopleFinderSearch";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Users, Search, Globe, Database, Satellite, MapPin, Clock } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { GeoconsoleRadarDashboard } from "@/components/geoconsole";
import type { GPSPoint } from '@shared/geoconsoleTypes';

interface CityStateLocation {
  latitude: number;
  longitude: number;
  displayName: string;
}

function parseLatLng(input: string): [number, number] | null {
  const match = input.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return [latitude, longitude];
}

export default function PeopleFinderPage() {
  const [, setLocation] = useLocation();
  
  // PASS 3: Add missing state to prevent crash
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState({ name: '', location: '' });
  const [resolvedLocation, setResolvedLocation] = useState<CityStateLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State for SPECTRA GeoConsole integration
  const [geoConsoleTab, setGeoConsoleTab] = useState<'timeline' | 'map' | 'satellite'>('satellite');
  
  // PASS 3: Page boot log
  useEffect(() => {
    console.log('[PEOPLE FINDER] Page mounted', {
      timestamp: new Date().toISOString(),
      path: window.location.pathname,
    });
  }, []);
  
  // PASS 3: Handle search results
  const handleSearchResults = useCallback((results: any, query?: { name: string; location: string }) => {
    console.log('[PEOPLE FINDER] Results received', {
      hasResults: !!results,
      timestamp: new Date().toISOString(),
    });

    setSearchResults(results);
    setSearchQuery(query || { name: '', location: '' });
    setError(null);
    setIsLoading(false);
  }, []);
  
  useEffect(() => {
    if (!searchQuery.name || !searchQuery.location) {
      setResolvedLocation(null);
      return;
    }

    let cancelled = false;
    setResolvedLocation(null);

    void fetch('/api/geoconsole/geocode-city-state', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: searchQuery.location }),
    })
      .then(async response => ({ response, payload: await response.json().catch(() => null) }))
      .then(({ response, payload }) => {
        if (!cancelled && response.ok && payload?.success) {
          setResolvedLocation(payload.data as CityStateLocation);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  // Convert person location history to GPSPoints for GeoConsole
  const getGeoConsoleData = useCallback((): GPSPoint[] => {
    const manualPoint: GPSPoint[] = resolvedLocation ? [{
      latitude: resolvedLocation.latitude,
      longitude: resolvedLocation.longitude,
      timestamp: new Date(),
      source: 'manual_input',
      confidence: 0.7,
      metadata: {
        label: searchQuery.name || 'Subject',
        raw: searchQuery.location,
        displayName: resolvedLocation.displayName,
        locationKind: 'last_known_location',
      },
    }] : [];

    if (!searchResults?.locationHistory?.length) return manualPoint;

    const reportedPoints = searchResults.locationHistory
      .map((raw: string, idx: number) => {
        const coord = parseLatLng(raw);
        if (!coord) return null;
        return {
          latitude: coord[0],
          longitude: coord[1],
          timestamp: new Date(),
          source: 'public_record' as const,
          confidence: 0.8,
          metadata: { raw, index: idx },
        } as GPSPoint;
      })
      .filter((p: GPSPoint | null): p is GPSPoint => !!p);

    return [...manualPoint, ...reportedPoints];
  }, [resolvedLocation, searchQuery, searchResults]);

  const geoConsolePoints = useMemo(() => getGeoConsoleData(), [getGeoConsoleData]);
  const geoConsoleStatus: 'idle' | 'loading' | 'ready' =
    isLoading ? 'loading' : geoConsolePoints.length > 0 ? 'ready' : 'idle';

  return (
    <>
      <SEOHead
        title="People Finder - Global Identity Intelligence | LegalWhat"
        description="Advanced people search using AI-powered OSINT. Search public records, social media, professional networks, and online mentions to build comprehensive identity reports for legal research."
        keywords="people finder, people search, OSINT, identity intelligence, background check, public records search, person lookup, identity verification"
      />
      <div className="min-h-screen bg-background">
        {/* App Header with Back and Logout */}
        <AppHeader 
          title="People Finder"
          subtitle="Global Identity Intelligence"
          fallbackRoute="/welcome"
        />
        
        <div className="container max-w-7xl mx-auto px-4 py-4">

          {/* Feature Explanation Card */}
          <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Users className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-2xl">People Finder - Global Identity Intelligence</CardTitle>
                  <CardDescription className="text-base">
                    AI-Powered Open Source Intelligence (OSINT) Platform
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Our People Finder uses advanced AI models and sophisticated search algorithms to aggregate information
                from dozens of public sources, including court records, property databases, business registrations,
                social media, news archives, and professional networks.
              </p>
              
              {/* Capabilities Grid */}
              <div className="grid md:grid-cols-3 gap-4 pt-2">
                <div className="flex items-start gap-3 p-3 bg-background/50 rounded-lg">
                  <Search className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm mb-1">Multi-Source Aggregation</h4>
                    <p className="text-xs text-muted-foreground">
                      Searches public records, court filings, property databases, and business registrations
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-background/50 rounded-lg">
                  <Globe className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm mb-1">Social & Professional Networks</h4>
                    <p className="text-xs text-muted-foreground">
                      Analyzes social media presence, professional profiles, and online mentions
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-background/50 rounded-lg">
                  <Database className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm mb-1">AI Entity Resolution</h4>
                    <p className="text-xs text-muted-foreground">
                      Uses AI to correlate information across sources and resolve identity variations
                    </p>
                  </div>
                </div>
              </div>

              {/* Use Cases */}
              <div className="pt-2 border-t">
                <h4 className="font-semibold text-sm mb-2">Common Use Cases:</h4>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="text-xs">Legal Research & Discovery</Badge>
                  <Badge variant="secondary" className="text-xs">Witness & Expert Location</Badge>
                  <Badge variant="secondary" className="text-xs">Asset Investigation</Badge>
                  <Badge variant="secondary" className="text-xs">Due Diligence</Badge>
                  <Badge variant="secondary" className="text-xs">Background Verification</Badge>
                  <Badge variant="secondary" className="text-xs">Genealogy Research</Badge>
                </div>
              </div>

              {/* Legal Notice */}
              <div className="text-xs text-muted-foreground pt-2 border-t">
                <strong className="flex items-center gap-1 mb-1">
                  <Shield className="w-3 h-3" />
                  Legal & Ethical Use Only
                </strong>
                This tool aggregates publicly available information from lawful sources for legitimate purposes only.
                All searches are logged. Users are responsible for complying with applicable laws including FCRA, GLBA,
                and state privacy regulations. This is not a consumer reporting agency under the FCRA.
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Error Banner - PASS 3 */}
        {error && (
          <div className="container max-w-7xl mx-auto px-4 py-4">
            <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-red-400 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-400 mb-1">Search Failed</h3>
                  <p className="text-sm text-red-300">{error}</p>
                  <p className="text-xs text-red-400/70 mt-2">
                    The search service encountered an error. Please try again or contact support if the issue persists.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Main Search Component */}
        <PeopleFinderSearch 
          onBack={() => setLocation("/welcome")} 
          onResults={handleSearchResults}
        />

        {/* SPECTRA GeoConsole - Embedded below search results */}
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <Card className={`border-slate-700/50 bg-slate-900/50 ${geoConsolePoints.length ? 'opacity-100' : 'opacity-70'}`}>
            <CardHeader className="py-3 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Satellite className="w-5 h-5 text-cyan-400" />
                  <div>
                    <CardTitle className="text-lg text-slate-200">SPECTRA GeoConsole</CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      Location intelligence & satellite visualization
                    </CardDescription>
                  </div>
                </div>
                <Badge 
                  variant="outline" 
                  className={`text-xs ${
                    geoConsoleStatus === 'loading' 
                      ? 'bg-amber-900/50 text-amber-400 border-amber-600/30'
                      : geoConsolePoints.length
                        ? 'bg-green-900/50 text-green-400 border-green-600/30'
                        : geoConsoleStatus === 'ready'
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                          : 'bg-slate-700/50 text-slate-400 border-slate-600/30'
                  }`}
                >
                  {geoConsoleStatus === 'loading' 
                    ? 'Loading...' 
                    : geoConsolePoints.length
                      ? `${geoConsolePoints.length} Coordinates`
                      : geoConsoleStatus === 'ready'
                        ? 'Live'
                        : 'Idle'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Tab Navigation - visual indicators only (single dashboard instance below) */}
              <Tabs value={geoConsoleTab} onValueChange={(v) => setGeoConsoleTab(v as any)} className="w-full">
                <TabsList className="w-full justify-start bg-slate-800/50 rounded-none border-b border-slate-700/50">
                  <TabsTrigger value="timeline" className="flex items-center gap-1.5 data-[state=active]:bg-slate-700/50">
                    <Clock className="w-3.5 h-3.5" />
                    Timeline
                  </TabsTrigger>
                  <TabsTrigger value="map" className="flex items-center gap-1.5 data-[state=active]:bg-slate-700/50">
                    <MapPin className="w-3.5 h-3.5" />
                    Map
                  </TabsTrigger>
                  <TabsTrigger value="satellite" className="flex items-center gap-1.5 data-[state=active]:bg-slate-700/50">
                    <Satellite className="w-3.5 h-3.5" />
                    Satellite
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* GeoConsole Dashboard - render ONCE for stability - FULL VIEWPORT STRETCH */}
              <div className="w-full h-[calc(100vh-280px)] min-h-[600px]">
                <GeoconsoleRadarDashboard initialData={geoConsolePoints} navMode={geoConsoleTab} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
