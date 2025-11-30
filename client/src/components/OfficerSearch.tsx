import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Loader2,
  Shield,
  MapPin,
  Briefcase,
  Award,
  AlertTriangle,
  DollarSign,
  Users,
  ExternalLink,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import OfficerSearchProgress from "./OfficerSearchProgress";

const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

interface OfficerSearchProps {
  onBack?: () => void;
}

export default function OfficerSearch({ onBack }: OfficerSearchProps) {
  const { toast } = useToast();
  
  // NOTE: FAQ schema moved to page level to prevent duplicate FAQPage errors in Google Search Console
  // Each page should have only ONE FAQPage schema - components should not add their own

  const [officerName, setOfficerName] = useState("");
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [city, setCity] = useState("");
  const [includeGovernment, setIncludeGovernment] = useState(false);
  const [includeCorrections, setIncludeCorrections] = useState(false);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    stage: number;
    totalStages: number;
    stageName: string;
    message: string;
    percentage: number;
  } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to SSE for progress updates
  useEffect(() => {
    if (!searchId) return;

    console.log(`[SSE] Connecting to progress stream: ${searchId}`);
    const eventSource = new EventSource(`/api/officer-search/progress/${searchId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Progress update:', data);
        if (data.stage > 0) {
          setProgress(data);
        }
      } catch (error) {
        console.error('[SSE] Error parsing progress data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      eventSource.close();
    };

    return () => {
      console.log('[SSE] Cleaning up connection');
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [searchId]);

  const searchMutation = useMutation({
    mutationFn: async (data: { 
      officerName: string; 
      state: string; 
      county?: string;
      city?: string;
      includeGovernment?: boolean;
      includeCorrections?: boolean;
      searchId: string 
    }) => {
      const response = await apiRequest("/api/officer-search", "POST", data);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }

      return await response.json();
    },
    onSuccess: (responseData) => {
      if (!responseData || typeof responseData !== 'object') {
        toast({
          title: "Search Error",
          description: "Received invalid response from search service. Please try again.",
          variant: "destructive",
        });
        return;
      }
      
      // API returns { success: true, data: officerResult, meta: ... }
      // Extract the actual officer data from the nested structure
      const officerData = responseData.data || responseData.result || responseData;
      
      if (!officerData || (!officerData.name && !officerData.summary)) {
        toast({
          title: "No Results Found",
          description: "No officer records found matching your search criteria. Try different search parameters.",
          variant: "destructive",
        });
        return;
      }
      
      console.log('[OfficerSearch] Setting results:', officerData);
      setSearchResults(officerData);
      setProgress(null);
      setSearchId(null);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    },
    onError: (error: Error) => {
      console.error("Officer search error:", error);
      toast({
        title: "Search Failed",
        description: error.message || "Either the name is misspelled, the state is wrong, or the officer is no longer on the force.",
        variant: "destructive",
      });
      setProgress(null);
      setSearchId(null);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    },
  });

  const handleSubmit = () => {
    if (!officerName.trim()) {
      toast({
        title: "Officer Name Required",
        description: "Please enter an officer's name",
        variant: "destructive",
      });
      return;
    }

    if (!state) {
      toast({
        title: "State Required",
        description: "Please select a state to search",
        variant: "destructive",
      });
      return;
    }
    
    // Generate unique search ID
    const newSearchId = `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setSearchId(newSearchId);
    setProgress(null);

    searchMutation.mutate({ 
      officerName: officerName.trim(), 
      state,
      county: county.trim() || undefined,
      city: city.trim() || undefined,
      includeGovernment: includeGovernment || undefined,
      includeCorrections: includeCorrections || undefined,
      searchId: newSearchId,
    });
  };
  
  return (
    <div className="min-h-screen bg-background">
      <main className="container max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <Search className="w-8 h-8" />
              Comprehensive Officer Search
            </CardTitle>
            <CardDescription className="text-base">
              Search public records for officer information including rank, training, incidents, and career history
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {searchMutation.isPending && (
              <div className="space-y-4" data-testid="search-loading-container">
                <div className="p-4 bg-blue-50 dark:bg-blue-950 border-2 border-blue-300 dark:border-blue-700 rounded-lg" data-testid="search-hang-tight-notification">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
                    <div>
                      <p className="font-semibold text-blue-800 dark:text-blue-200">
                        Hang tight! Comprehensive search in progress...
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                        This may take up to 2 minutes as we search multiple databases and public records.
                      </p>
                    </div>
                  </div>
                </div>
                {progress ? (
                  <OfficerSearchProgress
                    stage={progress.stage}
                    totalStages={progress.totalStages}
                    stageName={progress.stageName}
                    message={progress.message}
                    percentage={progress.percentage}
                  />
                ) : (
                  <div className="flex items-center justify-center py-6" data-testid="search-initial-loading">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Initializing search...</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!searchResults ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="input-officer-name">Officer Name</Label>
                  <Input
                    id="input-officer-name"
                    data-testid="input-officer-name"
                    placeholder="Enter officer's full name"
                    value={officerName}
                    onChange={(e) => setOfficerName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="select-state">State <span className="text-destructive">*</span></Label>
                  <Select value={state} onValueChange={(value) => {
                    setState(value);
                    setCounty("");
                    setCity("");
                  }}>
                    <SelectTrigger id="select-state" data-testid="select-state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {state && (
                  <div className="space-y-4 p-4 border rounded-lg bg-card/50" data-testid="location-refinement-section">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <Label className="text-base font-semibold">Refine Location <span className="text-muted-foreground font-normal text-sm">(optional)</span></Label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="input-county">County</Label>
                        <Input
                          id="input-county"
                          data-testid="input-county"
                          placeholder="e.g., Cook, Los Angeles"
                          value={county}
                          onChange={(e) => setCounty(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="input-city">City</Label>
                        <Input
                          id="input-city"
                          data-testid="input-city"
                          placeholder="e.g., Chicago, Los Angeles"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      Leave both County and City blank to search for State-level officers
                    </p>
                  </div>
                )}

                <div className="space-y-3 pt-4 border-t" data-testid="officer-categories-section">
                  <Label className="text-base font-semibold">Officer Categories <span className="text-muted-foreground font-normal text-sm">(optional)</span></Label>
                  <p className="text-sm text-muted-foreground">Include additional officer types in your search:</p>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex items-center space-x-3 p-2 rounded-md border bg-card hover-elevate cursor-pointer" onClick={() => setIncludeGovernment(!includeGovernment)} data-testid="checkbox-government-container">
                      <Checkbox
                        id="checkbox-government"
                        data-testid="checkbox-government"
                        checked={includeGovernment}
                        onCheckedChange={(checked) => setIncludeGovernment(checked === true)}
                        className="border-2"
                      />
                      <Label htmlFor="checkbox-government" className="font-normal cursor-pointer flex-1">
                        Government Officers
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 p-2 rounded-md border bg-card hover-elevate cursor-pointer" onClick={() => setIncludeCorrections(!includeCorrections)} data-testid="checkbox-corrections-container">
                      <Checkbox
                        id="checkbox-corrections"
                        data-testid="checkbox-corrections"
                        checked={includeCorrections}
                        onCheckedChange={(checked) => setIncludeCorrections(checked === true)}
                        className="border-2"
                      />
                      <Label htmlFor="checkbox-corrections" className="font-normal cursor-pointer flex-1">
                        Corrections Officers
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={searchMutation.isPending}
                    className="flex-1"
                    size="lg"
                    data-testid="button-search"
                  >
                    {searchMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {progress ? `${progress.stageName}...` : "Searching..."}
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 mr-2" />
                        Search Officer Records
                      </>
                    )}
                  </Button>
                  {onBack && (
                    <Button
                      variant="outline"
                      onClick={onBack}
                      data-testid="button-back"
                    >
                      Go Back
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Professional Officer Report */}
                <div className="space-y-6 print:space-y-4" data-testid="officer-report">
                  {/* Report Header - Professional Letterhead Style */}
                  <div className="border-b-2 border-primary pb-4">
                    <div className="text-center mb-4">
                      <h2 className="text-2xl font-bold uppercase tracking-wide text-primary">Officer Background Report</h2>
                      <p className="text-sm text-muted-foreground mt-1">Generated by BadBlue Police Accountability Platform</p>
                      <p className="text-xs text-muted-foreground">Report Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    </div>
                  </div>

                  {/* Subject Information Section */}
                  <div className="bg-muted/30 border rounded-lg p-4">
                    <h3 className="text-sm font-bold uppercase text-muted-foreground mb-3 border-b pb-2">Subject Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Full Name</p>
                        <p className="text-lg font-semibold" data-testid="text-officer-name">{searchResults.name || officerName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Jurisdiction</p>
                        <p className="font-medium">{state ? US_STATES.find(s => s.code === state)?.name || state : 'Unknown'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Rank/Title</p>
                        <p className="font-medium" data-testid="badge-rank">{searchResults.rank && searchResults.rank !== 'Unknown' ? searchResults.rank : 'Not Available'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase">Agency/Department</p>
                        <p className="font-medium" data-testid="text-agency">{searchResults.agency || searchResults.department || 'Not Available'}</p>
                      </div>
                      {searchResults.badgeNumber && searchResults.badgeNumber !== 'Not found' && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase">Badge Number</p>
                          <p className="font-medium">{searchResults.badgeNumber}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Executive Summary */}
                  {searchResults.summary && searchResults.summary !== 'None found' && (
                    <div className="border rounded-lg p-4">
                      <h3 className="text-sm font-bold uppercase text-muted-foreground mb-3 border-b pb-2 flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        Executive Summary
                      </h3>
                      <p className="text-sm leading-relaxed" data-testid="text-summary">{searchResults.summary}</p>
                    </div>
                  )}

                  {/* Detailed Findings - Professional Table Format */}
                  <div className="border rounded-lg overflow-hidden">
                    <h3 className="text-sm font-bold uppercase bg-muted/50 text-muted-foreground p-3 border-b">Detailed Findings</h3>
                    
                    {/* Disciplinary History */}
                    <div className="border-b last:border-b-0">
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm mb-1">Disciplinary Records</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-disciplinary">
                            {searchResults.disciplinaryReports && searchResults.disciplinaryReports !== 'None found' 
                              ? searchResults.disciplinaryReports 
                              : 'No disciplinary records found in public databases.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Civil Litigation */}
                    <div className="border-b last:border-b-0">
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-destructive" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm mb-1">Civil Litigation / Lawsuits</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-lawsuits">
                            {searchResults.lawsuits && searchResults.lawsuits !== 'None found' 
                              ? searchResults.lawsuits 
                              : 'No civil litigation or lawsuits found in public records.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Administrative Sanctions */}
                    <div className="border-b last:border-b-0">
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm mb-1">Administrative Sanctions</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-sanctions">
                            {searchResults.sanctions && searchResults.sanctions !== 'None found' 
                              ? searchResults.sanctions 
                              : 'No administrative sanctions found in public records.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Media Coverage */}
                    <div className="border-b last:border-b-0">
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                          <Briefcase className="w-4 h-4 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm mb-1">News / Media Coverage</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-news">
                            {searchResults.newsArticles && searchResults.newsArticles !== 'None found' 
                              ? searchResults.newsArticles 
                              : 'No relevant news coverage found.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Training & Certifications */}
                    <div className="border-b last:border-b-0">
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                          <Award className="w-4 h-4 text-green-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm mb-1">Training & Certifications</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-training">
                            {searchResults.training && searchResults.training !== 'None found' 
                              ? searchResults.training 
                              : 'No training records found in public databases.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sources & References */}
                  <div className="border rounded-lg p-4">
                    <h3 className="text-sm font-bold uppercase text-muted-foreground mb-3 border-b pb-2 flex items-center gap-2">
                      <ExternalLink className="w-4 h-4" />
                      Sources & References
                    </h3>
                    {searchResults.sources && searchResults.sources.length > 0 ? (
                      <div className="space-y-2">
                        {searchResults.sources.map((source: string, index: number) => (
                          <div key={index} className="flex items-start gap-2">
                            <span className="text-xs text-muted-foreground font-mono">[{index + 1}]</span>
                            <a
                              href={source}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline break-all"
                              data-testid={`link-source-${index}`}
                            >
                              {source}
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No external sources cited for this report.</p>
                    )}
                  </div>

                  {/* Report Disclaimer */}
                  <div className="bg-muted/20 border border-dashed rounded-lg p-4">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <strong>Disclaimer:</strong> This report is compiled from publicly available sources and databases. 
                      Information may be incomplete or outdated. This report does not constitute legal advice. 
                      For official records, please file a FOIA request with the relevant department or consult with an attorney.
                    </p>
                  </div>

                  {/* No detailed data fallback message */}
                  {(() => {
                    const hasData = 
                      (searchResults.summary && searchResults.summary !== 'None found') ||
                      (searchResults.disciplinaryReports && searchResults.disciplinaryReports !== 'None found') ||
                      (searchResults.lawsuits && searchResults.lawsuits !== 'None found') ||
                      (searchResults.sanctions && searchResults.sanctions !== 'None found') ||
                      (searchResults.newsArticles && searchResults.newsArticles !== 'None found') ||
                      (searchResults.training && searchResults.training !== 'None found') ||
                      (searchResults.sources && searchResults.sources.length > 0);
                    
                    if (!hasData) {
                      return (
                        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="font-semibold text-amber-800 dark:text-amber-200" data-testid="text-no-records-title">
                                  Limited Public Records Found
                                </p>
                                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1" data-testid="text-no-records-message">
                                  Our search found limited publicly available information for this officer. This may mean:
                                </p>
                                <ul className="text-sm text-amber-700 dark:text-amber-300 mt-2 space-y-1 list-disc pl-4">
                                  <li>The officer has a clean public record</li>
                                  <li>Records are sealed or not publicly accessible</li>
                                  <li>The officer name/location may need refinement</li>
                                  <li>Try adding city or county for more specific results</li>
                                </ul>
                                <p className="text-sm text-amber-700 dark:text-amber-300 mt-3">
                                  Consider filing a <strong>FOIA request</strong> for official department records.
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    }
                    return null;
                  })()}

                  {/* Action Buttons */}
                  <div className="flex gap-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearchResults(null);
                        setOfficerName("");
                        setState("");
                        setCounty("");
                        setCity("");
                        setIncludeGovernment(false);
                        setIncludeCorrections(false);
                        setProgress(null);
                        setSearchId(null);
                        if (eventSourceRef.current) {
                          eventSourceRef.current.close();
                          eventSourceRef.current = null;
                        }
                      }}
                      data-testid="button-new-search"
                    >
                      New Search
                    </Button>
                    {onBack && (
                      <Button
                        variant="outline"
                        onClick={onBack}
                        data-testid="button-back-results"
                      >
                        Back to Home
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
  }
