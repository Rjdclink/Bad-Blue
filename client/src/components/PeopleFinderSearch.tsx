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
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Loader2,
  User,
  MapPin,
  Briefcase,
  Mail,
  Phone,
  Link as LinkIcon,
  Building,
  Calendar,
  Shield,
  Globe,
  FileText,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

// StrictMode/dev can mount -> unmount -> mount, which can double-fire "auto search".
// We guard against immediate duplicate auto-search triggers (same URL) within a short window.
let lastAutoSearchKey: string | null = null;
let lastAutoSearchAt = 0;

interface PeopleFinderSearchProps {
  onBack?: () => void;
  onResults?: (results: PeopleSearchReport | null) => void;
}

interface OSINTSource {
  name: string;
  data: any;
  confidence: number;
  timestamp: string;
}

export interface PeopleSearchReport {
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
  sources: OSINTSource[];
}

type PeopleFinderEmptyStateCode = 'no_seed' | 'no_data_found' | 'invalid_request' | 'unavailable';

interface PeopleFinderEmptyState {
  code: PeopleFinderEmptyStateCode;
  message: string;
}

interface SeedFirstResponse {
  success: boolean;
  data: PeopleSearchReport | null;
  emptyState?: PeopleFinderEmptyState;
  meta?: {
    correlationId?: string;
    seedUrl?: string | null;
    seedType?: string | null;
    itemsFound?: number;
    durationMs?: number;
  };
}

export default function PeopleFinderSearch({ onBack, onResults }: PeopleFinderSearchProps) {
  const { toast } = useToast();
  
  // Check for URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const nameParam = urlParams.get('name') || '';
  const locationParam = urlParams.get('location') || '';
  
  const [name, setName] = useState(nameParam);
  const [location, setLocation] = useState(locationParam);
  const [department, setDepartment] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [results, setResults] = useState<PeopleSearchReport | null>(null);
  const [emptyState, setEmptyState] = useState<PeopleFinderEmptyState | null>(null);

  // Guard against state updates after unmount (e.g., delayed auto-search)
  const mountedRef = useRef(true);
  const autoSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoSearchTimeoutRef.current) {
        clearTimeout(autoSearchTimeoutRef.current);
        autoSearchTimeoutRef.current = null;
      }
    };
  }, []);
  
  // PASS 3: Component boot log
  useEffect(() => {
    console.log('[PEOPLE FINDER SEARCH] Component mounted', {
      timestamp: new Date().toISOString(),
      hasNameParam: !!nameParam,
      hasLocationParam: !!locationParam,
    });
  }, []);

  // Stability rule: do NOT auto-run searches on mount (refresh must not re-fire searches).
  // We still prefill from query params to support deep-linking, but execution must be explicit.

  const searchMutation = useMutation({
    mutationFn: async (searchData: { name: string; location?: string; department?: string; domain?: string; profileUrl?: string }) => {
      const requestStart = Date.now();
      console.log('[PEOPLE FINDER SEARCH] Request started', {
        timestamp: new Date().toISOString(),
        searchData,
      });

      // UI UNBLOCK: Always resolve to a controlled response object (never throw to the UI).
      let payload: SeedFirstResponse | null = null;
      try {
        const response = await fetch("/api/osint/full-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(searchData),
          credentials: "include",
        });
        payload = (await response.json().catch(() => null)) as SeedFirstResponse | null;
      } catch (e: any) {
        payload = {
          success: true,
          data: null,
          emptyState: {
            code: 'unavailable',
            message: 'Search service is temporarily unavailable. Please try again.',
          },
        };
      }

      const requestEnd = Date.now();
      console.log('[PEOPLE FINDER SEARCH] Request finished', {
        timestamp: new Date().toISOString(),
        duration: requestEnd - requestStart,
        success: !!payload?.success,
        hasData: !!payload?.data,
      });

      // Ensure we always return a normalized envelope
      if (!payload || typeof payload !== 'object') {
        return {
          success: true,
          data: null,
          emptyState: { code: 'unavailable', message: 'Search returned an unexpected response.' },
        } as SeedFirstResponse;
      }

      return payload;
    },
    onSuccess: (data: SeedFirstResponse) => {
      if (!mountedRef.current) return;
      console.log('[PEOPLE FINDER SEARCH] Search successful', {
        timestamp: new Date().toISOString(),
        hasResults: !!data,
      });
      
      const report = data?.data ?? null;
      setResults(report);
      setEmptyState(data?.emptyState ?? null);
      
      // Notify parent component of results
      if (onResults) {
        onResults(report);
      }
      
      if (report) {
        toast({
          title: "Search Complete",
          description: `Found intelligence report for ${report.identitySummary?.name || 'subject'}`,
        });
      } else {
        toast({
          title: "Search Complete",
          description: data?.emptyState?.message || "No results found.",
        });
      }
    },
    onError: (error: Error) => {
      if (!mountedRef.current) return;
      // UI UNBLOCK: Even on unexpected react-query errors, keep UI stable with empty-state.
      console.warn('[PEOPLE FINDER SEARCH] Search failed (mapped to empty-state)', {
        timestamp: new Date().toISOString(),
        error: error.message,
      });
      setResults(null);
      setEmptyState({
        code: 'unavailable',
        message: 'Search service is temporarily unavailable. Please try again.',
      });
      if (onResults) onResults(null);
    },
  });

  const handleSearch = () => {
    if (!name.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a name to search",
        variant: "destructive",
      });
      return;
    }

    searchMutation.mutate({
      name: name.trim(),
      location: location.trim() || undefined,
      department: department.trim() || undefined,
      domain: additionalInfo.trim() || undefined,
      profileUrl: profileUrl.trim() || undefined,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const renderConfidenceScore = (score: number) => {
    if (score >= 80) return <Badge variant="default" className="bg-green-600">High Confidence: {score}%</Badge>;
    if (score >= 50) return <Badge variant="secondary">Medium Confidence: {score}%</Badge>;
    return <Badge variant="destructive">Low Confidence: {score}%</Badge>;
  };

  return (
    <div className="container max-w-6xl mx-auto px-4 py-8">
      {/* Search Form */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-6 h-6" />
            People Finder - Global Identity Intelligence
          </CardTitle>
          <CardDescription>
            Search public records, social media, professional networks, and online mentions to build comprehensive identity reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                placeholder="e.g., John Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="location">Location (Optional)</Label>
              <Input
                id="location"
                placeholder="e.g., New York, NY"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="department">Organization/Employer (Optional)</Label>
              <Input
                id="department"
                placeholder="e.g., Company name, agency, organization"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profileUrl">Profile URL Seed (Recommended)</Label>
              <Input
                id="profileUrl"
                placeholder="https://example.com/profile or https://linkedin.com/in/..."
                value={profileUrl}
                onChange={(e) => setProfileUrl(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <p className="text-xs text-muted-foreground">
                Seed-first mode: Provide a single canonical profile URL to crawl (one-pass, 10s max).
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="additionalInfo">Verified Domain Homepage (Optional)</Label>
              <Input
                id="additionalInfo"
                placeholder="https://example.com"
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <p className="text-xs text-muted-foreground">
                Used only if no explicit profile URL seed is supplied. Must include scheme (https://).
              </p>
            </div>

            <Button
              onClick={handleSearch}
              disabled={searchMutation.isPending}
              className="w-full"
              size="lg"
            >
              {searchMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Searching Intelligence Sources...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Search
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Models Info */}
      <Card className="mb-6 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            Multi-Model AI Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            This People Finder uses advanced AI models to aggregate, correlate, and analyze information from dozens of public sources.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-xs">🧠 Gemini - Data Correlation</Badge>
            <Badge variant="secondary" className="text-xs">⚖️ Claude - Pattern Analysis</Badge>
            <Badge variant="secondary" className="text-xs">🚀 Groq - Entity Resolution</Badge>
            <Badge variant="secondary" className="text-xs">✓ Mistral - Information Fusion</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Results Display */}
      {(results || emptyState) && (
        <div className="space-y-6">
          {emptyState && !results && (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  {emptyState.code === 'no_seed' ? 'No Seed Provided' : 'No Data Found'}
                </CardTitle>
                <CardDescription>
                  {emptyState.message}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Seed-first mode requires exactly one canonical seed. Provide either:
                </p>
                <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  <li>Explicit profile URL (recommended)</li>
                  <li>Verified domain homepage</li>
                </ul>
              </CardContent>
            </Card>
          )}
          {/* Identity Summary */}
          {results && <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Identity Summary
                </CardTitle>
                {renderConfidenceScore(results.confidenceScore)}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg">{results.identitySummary.name}</h3>
                {results.identitySummary.aliases && results.identitySummary.aliases.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Aliases: {results.identitySummary.aliases.join(", ")}
                  </p>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                {results.identitySummary.age && (
                  <div>
                    <span className="text-muted-foreground">Age: </span>
                    <span className="font-medium">{results.identitySummary.age}</span>
                  </div>
                )}
                {results.identitySummary.dateOfBirth && (
                  <div>
                    <span className="text-muted-foreground">DOB: </span>
                    <span className="font-medium">{results.identitySummary.dateOfBirth}</span>
                  </div>
                )}
                {results.identitySummary.gender && (
                  <div>
                    <span className="text-muted-foreground">Gender: </span>
                    <span className="font-medium">{results.identitySummary.gender}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Verification: </span>
                  <span className="font-medium">{results.identitySummary.verificationStatus}</span>
                </div>
              </div>

              {results.summary && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-semibold mb-2">Executive Summary</h4>
                    <p className="text-sm text-muted-foreground">{results.summary}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>}

          {/* Contact Information */}
          {results && results.contactInformation.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.contactInformation.map((contact, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Mail className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <span>{contact}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Location History */}
          {results && results.locationHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Location History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.locationHistory.map((loc, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <Calendar className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <span>{loc}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Employment & Education */}
          {results && results.employmentAndEducation.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5" />
                  Employment & Education
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.employmentAndEducation.map((item, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <Building className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Social Media Presence */}
          {results && results.socialMediaPresence.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Social Media & Online Presence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.socialMediaPresence.map((social, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <LinkIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <span>{social}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Public Records */}
          {results && results.publicRecords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Public Records
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.publicRecords.map((record, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <Shield className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <span>{record}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Online Mentions */}
          {results && results.onlineMentions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Online Mentions & News
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <ul className="space-y-3">
                    {results.onlineMentions.map((mention, idx) => (
                      <li key={idx} className="text-sm border-l-2 border-muted pl-3">
                        {mention}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Risk & Reputation */}
          {results && results.riskAndReputation.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
                  <AlertCircle className="w-5 h-5" />
                  Risk & Reputation Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.riskAndReputation.map((item, idx) => (
                    <li key={idx} className="text-sm">{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Data Sources */}
          {results && <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Data Sources ({results.sources.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {results.sources.map((source, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm font-medium">{source.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {source.confidence}% confidence
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(source.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>}

          {/* Legal Disclaimer */}
          <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">
                <strong>Legal Notice:</strong> This report aggregates publicly available information from lawful sources.
                All data should be verified independently. This service is intended for legal, professional, and personal use only.
                Users are responsible for ensuring their use complies with all applicable laws and regulations.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
