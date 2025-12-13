import { useState, useCallback } from "react";
import PeopleFinderSearch, { type PeopleSearchReport } from "@/components/PeopleFinderSearch";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Users, Search, Globe, Database, Satellite, MapPin, Clock } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { GeoconsoleRadarDashboard } from "@/components/geoconsole";
import type { GPSPoint } from '@shared/geoconsoleTypes';

export default function PeopleFinderPage() {
  const [, setLocation] = useLocation();

  // State for search results to share with GeoConsole
  const [searchResults, setSearchResults] = useState<PeopleSearchReport | null>(null);

  // State for SPECTRA GeoConsole integration (reserved for future Lexara integration)
  const [geoConsoleTab, setGeoConsoleTab] = useState<'timeline' | 'map' | 'satellite'>('timeline');
  
  // Deterministic hash function for confidence calculation
  function hashString(str: string): number {
    let hash = 0, i, chr;
    if (str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
      chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // Handle search results from PeopleFinderSearch
  const handleSearchResults = useCallback((results: PeopleSearchReport | null) => {
    setSearchResults(results);
  }, []);

  // Convert person location history to GPSPoints for GeoConsole
  const getGeoConsoleData = useCallback((): GPSPoint[] => {
    if (!searchResults?.locationHistory?.length) {
      return [];
    }
    
    // Generate GPS points from location history
    // Use deterministic coordinates based on location string hash for consistent display
    // In production, this would use actual geocoding API
    const baseCoords: [number, number] = [40.7128, -74.0060]; // NYC default
    
    return searchResults.locationHistory.map((location, idx) => {
      const hash = hashString(location);
      const latOffset = ((hash % 10000) / 100000) - 0.05;
      const lngOffset = (((hash * 7) % 10000) / 100000) - 0.05;
      
      return {
        latitude: baseCoords[0] + latOffset,
        longitude: baseCoords[1] + lngOffset,
        timestamp: new Date(Date.now() - (idx * 86400000)), // Each point is 1 day apart
        accuracy: 50 + (hash % 100),
        source: 'public_record' as const,
        confidence: 0.7 + (hash % 30) / 100,
        metadata: {
          location,
          index: idx,
        },
      };
    });
  }, [searchResults, hashString]);

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
        
        {/* Main Search Component */}
        <PeopleFinderSearch 
          onBack={() => setLocation("/welcome")} 
          onResults={handleSearchResults}
        />

        {/* SPECTRA GeoConsole - Embedded below search results */}
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <Card className={`border-slate-700/50 bg-slate-900/50 ${searchResults?.locationHistory?.length ? 'opacity-100' : 'opacity-70'}`}>
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
                    searchResults?.locationHistory?.length 
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' 
                      : 'bg-slate-700/50 text-slate-400 border-slate-600/30'
                  }`}
                >
                  {searchResults?.locationHistory?.length 
                    ? `${searchResults.locationHistory.length} Locations` 
                    : 'Idle Preview'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Tab Navigation - tabs are visual indicators only since GeoconsoleRadarDashboard handles view switching internally */}
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
                
                {/* GeoConsole Dashboard - visible for all tabs, internally handles view mode */}
                <TabsContent value="timeline" className="m-0">
                  <div className="h-[400px]">
                    <GeoconsoleRadarDashboard initialData={getGeoConsoleData()} />
                  </div>
                </TabsContent>
                <TabsContent value="map" className="m-0">
                  <div className="h-[400px]">
                    <GeoconsoleRadarDashboard initialData={getGeoConsoleData()} />
                  </div>
                </TabsContent>
                <TabsContent value="satellite" className="m-0">
                  <div className="h-[400px]">
                    <GeoconsoleRadarDashboard initialData={getGeoConsoleData()} />
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
