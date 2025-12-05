import PeopleFinderSearch from "@/components/PeopleFinderSearch";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Shield, Users, Search, Globe, Database } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

export default function PeopleFinderPage() {
  const [, setLocation] = useLocation();

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
        <PeopleFinderSearch onBack={() => setLocation("/welcome")} />
      </div>
    </>
  );
}
