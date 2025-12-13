/**
 * Inmate Locator V2 - Clean Page Implementation
 * 
 * RULE 1: New route (/inmate-locator-v2), new page component
 * RULE 2: No AppLayout, no feature guards, no auth gates, no global error boundary
 * RULE 3: Logic extracted to components, not copied wholesale
 * RULE 4: Functionality added incrementally (static UI → state → API → polling)
 * RULE 5: Old page untouched - this is the production future
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building, Database, Globe, Search, Shield, ArrowLeft } from "lucide-react";

// Import the working search component directly - no wrappers
import InmateSearch from "@/components/InmateSearch";

export default function InmateLocatorV2Page() {
  const [, setLocation] = useLocation();
  
  return (
    <div className="min-h-screen bg-background">
      {/* Simple Header - No AppHeader wrapper */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation('/welcome')}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Building className="w-6 h-6 text-primary" />
              <div>
                <h1 className="font-semibold text-lg">Inmate Locator</h1>
                <p className="text-xs text-muted-foreground">Nationwide Correctional Search</p>
              </div>
            </div>
          </div>
        </div>
      </header>
      
      <div className="container max-w-7xl mx-auto px-4 py-4">
        {/* Feature Explanation Card */}
        <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Building className="w-8 h-8 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl">Nationwide Inmate Locator</CardTitle>
                <CardDescription className="text-base">
                  Search Federal and State Correctional Facilities
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Our Inmate Locator searches official government databases to help you find 
              individuals currently or previously incarcerated in federal and state correctional 
              facilities across the United States.
            </p>
            
            {/* Capabilities Grid */}
            <div className="grid md:grid-cols-3 gap-4 pt-2">
              <div className="flex items-start gap-3 p-3 bg-background/50 rounded-lg">
                <Database className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm mb-1">Federal BOP Search</h4>
                  <p className="text-xs text-muted-foreground">
                    Search the Federal Bureau of Prisons inmate locator for all federal inmates
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3 p-3 bg-background/50 rounded-lg">
                <Globe className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm mb-1">50-State Coverage</h4>
                  <p className="text-xs text-muted-foreground">
                    Access state Department of Corrections databases across all 50 states
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3 p-3 bg-background/50 rounded-lg">
                <Search className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm mb-1">VINE Integration</h4>
                  <p className="text-xs text-muted-foreground">
                    Search VINE victim notification system for custody status updates
                  </p>
                </div>
              </div>
            </div>

            {/* Use Cases */}
            <div className="pt-2 border-t">
              <h4 className="font-semibold text-sm mb-2">Common Use Cases:</h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs">Locate Family Members</Badge>
                <Badge variant="secondary" className="text-xs">Legal Case Research</Badge>
                <Badge variant="secondary" className="text-xs">Victim Notification</Badge>
                <Badge variant="secondary" className="text-xs">Bond &amp; Bail Information</Badge>
                <Badge variant="secondary" className="text-xs">Release Date Lookup</Badge>
                <Badge variant="secondary" className="text-xs">Visitation Planning</Badge>
              </div>
            </div>

            {/* Information Available */}
            <div className="pt-2 border-t">
              <h4 className="font-semibold text-sm mb-2">Information Available:</h4>
              <div className="grid md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>• Inmate name and identification number</div>
                <div>• Current facility location</div>
                <div>• Custody status (In Custody/Released)</div>
                <div>• Projected release date</div>
                <div>• Charges and offense information</div>
                <div>• Admission date</div>
              </div>
            </div>

            {/* Legal Notice */}
            <div className="text-xs text-muted-foreground pt-2 border-t">
              <strong className="flex items-center gap-1 mb-1">
                <Shield className="w-3 h-3" />
                Legal Notice
              </strong>
              This service accesses publicly available information from official government sources.
              Information may not be current or complete. Always verify directly with the appropriate 
              correctional facility. This is not a consumer reporting agency under the FCRA and should 
              not be used for employment, housing, or credit decisions.
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Main Search Component - Direct import, no wrappers */}
      <InmateSearch />
    </div>
  );
}
