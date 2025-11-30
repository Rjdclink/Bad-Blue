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

export default function OfficerSearch({ onBack }: OfficerSearchProps) {
  const { toast } = useToast();
  
  // NOTE: FAQ schema moved to page level to prevent duplicate FAQPage errors in Google Search Console
  // Each page should have only ONE FAQPage schema - components should not add their own

  const [officerName, setOfficerName] = useState("");
  const [state, setState] = useState("");
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
    mutationFn: async (data: { officerName: string; state?: string; searchId: string }) => {
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

    // Validate based on officer type
    if (!officerName.trim()) {
  toast({
    title: "Name required",
    description: "Enter an officer name to search.",
    variant: "destructive",
  });
  return;
    }

    if (!state) {
  toast({
    title: "State required",
    description: "Select a state for search.",
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
      state: state || undefined,
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
  <Label htmlFor="select-state">State</Label>
  <Select value={state} onValueChange={setState}>
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
                {/* Search Results - Briefer Format */}
                <div className="space-y-4">
                  {/* Officer Info Header */}
                  <div className="border-2 rounded-lg p-4 bg-card">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h3 className="text-xl font-bold" data-testid="text-officer-name">
                          {searchResults.name || officerName}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          {searchResults.rank && searchResults.rank !== 'Unknown' && (
                            <Badge variant="secondary" data-testid="badge-rank">
                              {searchResults.rank}
                            </Badge>
                          )}
                          {(searchResults.agency || searchResults.department) && (
                            <span className="text-sm text-muted-foreground" data-testid="text-agency">
                              {searchResults.agency || searchResults.department}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <MapPin className="w-4 h-4" />
                        <span>{state ? US_STATES.find(s => s.code === state)?.name || state : 'Unknown'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  {searchResults.summary && searchResults.summary !== 'None found' && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Shield className="w-4 h-4" />
                          Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm" data-testid="text-summary">{searchResults.summary}</p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Report Sections - Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Disciplinary Reports */}
                    {searchResults.disciplinaryReports && searchResults.disciplinaryReports !== 'None found' && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="w-4 h-4 text-destructive" />
                            Disciplinary Reports
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap" data-testid="text-disciplinary">{searchResults.disciplinaryReports}</p>
                        </CardContent>
                      </Card>
                    )}

                    {/* Lawsuits */}
                    {searchResults.lawsuits && searchResults.lawsuits !== 'None found' && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <DollarSign className="w-4 h-4 text-destructive" />
                            Lawsuits
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap" data-testid="text-lawsuits">{searchResults.lawsuits}</p>
                        </CardContent>
                      </Card>
                    )}

                    {/* Sanctions */}
                    {searchResults.sanctions && searchResults.sanctions !== 'None found' && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="w-4 h-4 text-orange-500" />
                            Sanctions
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap" data-testid="text-sanctions">{searchResults.sanctions}</p>
                        </CardContent>
                      </Card>
                    )}

                    {/* News Articles */}
                    {searchResults.newsArticles && searchResults.newsArticles !== 'None found' && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <Briefcase className="w-4 h-4" />
                            News Coverage
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap" data-testid="text-news">{searchResults.newsArticles}</p>
                        </CardContent>
                      </Card>
                    )}

                    {/* Training */}
                    {searchResults.training && searchResults.training !== 'None found' && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-sm">
                            <Award className="w-4 h-4 text-green-500" />
                            Training
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap" data-testid="text-training">{searchResults.training}</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* Sources */}
                  {searchResults.sources && searchResults.sources.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <ExternalLink className="w-4 h-4" />
                          Sources ({searchResults.sources.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          {searchResults.sources.slice(0, 5).map((source: string, index: number) => (
                            <a
                              key={index}
                              href={source}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs text-primary hover:underline truncate"
                              data-testid={`link-source-${index}`}
                            >
                              {source}
                            </a>
                          ))}
                          {searchResults.sources.length > 5 && (
                            <p className="text-xs text-muted-foreground">+{searchResults.sources.length - 5} more sources</p>
                          )}
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
                        setState("");
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
