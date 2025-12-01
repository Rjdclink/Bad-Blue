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

type OfficerType = "city" | "county" | "state" | "federal" | "special_agent" | "corrections" | "custom";

export default function OfficerSearch({ onBack }: OfficerSearchProps) {
  const { toast } = useToast();
  const [officerType, setOfficerType] = useState<OfficerType>("custom");
  const [officerName, setOfficerName] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
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
    mutationFn: async (data: { officerName: string; officerType: OfficerType; state?: string; city?: string; county?: string; searchId: string }) => {
      const response = await apiRequest("/api/officer-search", "POST", data);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }

      return await response.json();
    },
    onSuccess: (data) => {
      if (!data || typeof data !== 'object') {
        toast({
          title: "Search Error",
          description: "Received invalid response from search service. Please try again.",
          variant: "destructive",
        });
        return;
      }
      setSearchResults(data);
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
        description: error.message || "Unable to search for officer. Please try again or contact support if the issue persists.",
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

    // Validate based on officer type
    if (officerType === "city" && (!state || !city.trim())) {
      toast({
        title: "City Officer Search",
        description: "Please provide both state and city for city officers",
        variant: "destructive",
      });
      return;
    }

    if (officerType === "county" && (!state || !county.trim())) {
      toast({
        title: "County Officer Search",
        description: "Please provide both state and county for county officers/sheriffs",
        variant: "destructive",
      });
      return;
    }

    if (officerType === "state" && !state) {
      toast({
        title: "State Officer Search",
        description: "Please select a state for state officers/agents",
        variant: "destructive",
      });
      return;
    }

    if (officerType === "custom" && !state && !city.trim() && !county.trim()) {
      toast({
        title: "Location Required",
        description: "Please provide at least state, city, or county",
        variant: "destructive",
      });
      return;
    }

    // Generate unique search ID
    const newSearchId = `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setSearchId(newSearchId);
    setProgress(null);

    searchMutation.mutate({ 
      officerName, 
      officerType,
      state: state || undefined,
      city: city.trim() || undefined,
      county: county.trim() || undefined,
      searchId: newSearchId
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
              <>
                <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Note:</strong> Comprehensive searches may take up to 2 minutes as we search multiple databases and sources...
                  </p>
                </div>
                {progress && (
                  <OfficerSearchProgress
                    stage={progress.stage}
                    totalStages={progress.totalStages}
                    stageName={progress.stageName}
                    message={progress.message}
                    percentage={progress.percentage}
                  />
                )}
              </>
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
                  <Label htmlFor="select-officer-type">Officer Type</Label>
                  <Select value={officerType} onValueChange={(value: OfficerType) => setOfficerType(value)}>
                    <SelectTrigger id="select-officer-type" data-testid="select-officer-type">
                      <SelectValue placeholder="Select officer type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="city">City Police Officer</SelectItem>
                      <SelectItem value="county">County Sheriff/Deputy</SelectItem>
                      <SelectItem value="state">State Trooper/Agent</SelectItem>
                      <SelectItem value="federal">Federal Agent (FBI, DEA, ATF, Marshal)</SelectItem>
                      <SelectItem value="special_agent">Special Agent</SelectItem>
                      <SelectItem value="corrections">Corrections Officer</SelectItem>
                      <SelectItem value="custom">Custom Search</SelectItem>
                    </SelectContent>
                  </Select>
                  {officerType === "city" && (
                    <p className="text-sm text-muted-foreground">
                      Requires: State + City
                    </p>
                  )}
                  {officerType === "county" && (
                    <p className="text-sm text-muted-foreground">
                      Requires: State + County
                    </p>
                  )}
                  {officerType === "state" && (
                    <p className="text-sm text-muted-foreground">
                      Requires: State only
                    </p>
                  )}
                  {officerType === "federal" && (
                    <p className="text-sm text-muted-foreground">
                      Optional: City (leave state/county blank for federal agencies)
                    </p>
                  )}
                  {officerType === "custom" && (
                    <p className="text-sm text-muted-foreground">
                      Requires: At least one location field (state, city, or county)
                    </p>
                  )}
                  {officerType === "corrections" && (
                    <p className="text-sm text-muted-foreground">
                      Requires: State (searches prisons, jails, and correctional facilities)
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="select-state">
                    State {officerType === "federal" || officerType === "custom" ? "(Optional)" : ""}
                  </Label>
                  <Select 
                    value={state} 
                    onValueChange={setState}
                    disabled={officerType === "federal"}
                  >
                    <SelectTrigger id="select-state" data-testid="select-state">
                      <SelectValue placeholder={
                        officerType === "federal" 
                          ? "Not applicable for federal officers" 
                          : "Select state"
                      } />
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

                {(officerType === "city" || officerType === "federal" || officerType === "custom") && (
                  <div className="space-y-2">
                    <Label htmlFor="input-city">
                      City {officerType === "custom" ? "(Optional)" : ""}
                    </Label>
                    <Input
                      id="input-city"
                      data-testid="input-city"
                      placeholder="Enter city (e.g., Los Angeles)"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                )}

                {(officerType === "county" || officerType === "custom") && (
                  <div className="space-y-2">
                    <Label htmlFor="input-county">
                      County {officerType === "custom" ? "(Optional)" : ""}
                    </Label>
                    <Input
                      id="input-county"
                      data-testid="input-county"
                      placeholder="Enter county (e.g., Los Angeles County)"
                      value={county}
                      onChange={(e) => setCounty(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex gap-4">
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
                {/* Search Results */}
                <div className="space-y-6">
                  {/* Officer Info Header */}
                  <div className="border-2 rounded-lg p-6 bg-card">
                    <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                      <div>
                        <h3 className="text-2xl font-bold" data-testid="text-officer-name">
                          {searchResults.name || officerName}
                        </h3>
                        {searchResults.rank && (
                          <Badge className="mt-2" data-testid="badge-rank">
                            {searchResults.rank}
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="w-4 h-4" />
                          <span>
                            {[
                              county,
                              city,
                              state ? US_STATES.find(s => s.code === state)?.name : null
                            ].filter(Boolean).join(', ') || 'Federal/Unknown Location'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  {searchResults.summary && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Shield className="w-5 h-5" />
                          Comprehensive Officer Report
                        </CardTitle>
                        <CardDescription>
                          Based on publicly available information from official sources
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="prose dark:prose-invert max-w-none">
                          <div className="whitespace-pre-wrap text-sm" data-testid="text-summary">
                            {searchResults.summary}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Sources */}
                  {searchResults.sources && searchResults.sources.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <ExternalLink className="w-5 h-5" />
                          Sources ({searchResults.sources.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {searchResults.sources.map((source: string, index: number) => (
                            <a
                              key={index}
                              href={source}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-sm text-primary hover:underline break-all"
                              data-testid={`link-source-${index}`}
                            >
                              {source}
                            </a>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearchResults(null);
                        setOfficerName("");
                        setOfficerType("custom");
                        setState("");
                        setCity("");
                        setCounty("");
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
