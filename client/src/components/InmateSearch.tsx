import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  User,
  MapPin,
  Building,
  Calendar,
  AlertTriangle,
  ExternalLink,
  Hash,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCcw,
  AlertCircle,
  Shield,
  Gavel,
  Database,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

interface InmateSearchProps {
  onBack?: () => void;
}

interface ChargeInfo {
  description: string;
  statute?: string;
  classification?: string;
  severity?: string;
}

interface InmateRecord {
  id: string;
  source: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  inmateNumber: string;
  facilityName: string;
  facilityType: string;
  facilityLocation: {
    city?: string;
    state?: string;
    address?: string;
  };
  custodyStatus: string;
  releaseDate?: string;
  admissionDate?: string;
  arrestDate?: string;
  convictionDate?: string;
  age?: number;
  sex?: string;
  race?: string;
  charges?: string[];
  chargeDetails?: ChargeInfo[];
  isViolentOffender?: boolean;
  isSexualOffender?: boolean;
  offenseClassifications?: string[];
  confidence: number;
  sourceUrl?: string;
}

interface SourceSearchStatus {
  source: string;
  searched: boolean;
  resultsCount: number;
  error?: string;
  searchTimeMs?: number;
  status: 'pending' | 'searching' | 'completed' | 'error' | 'timeout';
}

interface InmateSearchResult {
  query: any;
  totalResults: number;
  inmates: InmateRecord[];
  sources: SourceSearchStatus[];
  searchDuration: number;
  cached: boolean;
  partial: boolean;
  disclaimer: string;
}

interface StateInfo {
  state: string;
  stateName: string;
  departmentName: string;
  searchUrl?: string;
}

export default function InmateSearch({ onBack }: InmateSearchProps) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [state, setState] = useState("");
  const [inmateId, setInmateId] = useState("");
  const [searchScope, setSearchScope] = useState<string>("all");
  const [results, setResults] = useState<InmateSearchResult | null>(null);
  const [searchProgress, setSearchProgress] = useState(0);

  // Fetch state list
  const { data: statesData } = useQuery<{ success: boolean; data: StateInfo[] }>({
    queryKey: ['/api/inmate-search/states'],
  });

  const searchMutation = useMutation({
    mutationFn: async (searchData: {
      firstName?: string;
      lastName?: string;
      middleName?: string;
      dateOfBirth?: string;
      state?: string;
      inmateId?: string;
      searchScope?: string;
    }) => {
      const response = await apiRequest("/api/inmate-search", "POST", searchData);
      return response.json();
    },
    onSuccess: (data: { success: boolean; data: InmateSearchResult; error?: string }) => {
      setSearchProgress(100);
      if (data.success) {
        setResults(data.data);
        const partialMsg = data.data.partial ? ' (partial results - timeout reached)' : '';
        toast({
          title: "Search Complete",
          description: `Found ${data.data.totalResults} result(s) in ${data.data.searchDuration}ms${partialMsg}`,
        });
      } else {
        toast({
          title: "Search Failed",
          description: data.error || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      setSearchProgress(0);
      toast({
        title: "Search Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Animate progress during search
  useEffect(() => {
    if (searchMutation.isPending) {
      const interval = setInterval(() => {
        setSearchProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 15;
        });
      }, 500);
      return () => clearInterval(interval);
    } else {
      setSearchProgress(0);
    }
  }, [searchMutation.isPending]);

  const handleSearch = () => {
    if (!firstName && !lastName && !inmateId) {
      toast({
        title: "Input Required",
        description: "Please enter a name or inmate ID to search",
        variant: "destructive",
      });
      return;
    }

    setSearchProgress(5);
    searchMutation.mutate({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      middleName: middleName.trim() || undefined,
      dateOfBirth: dateOfBirth || undefined,
      state: state || undefined,
      inmateId: inmateId.trim() || undefined,
      searchScope,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getCustodyStatusBadge = (status: string) => {
    switch (status) {
      case 'In Custody':
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="w-3 h-3" /> In Custody</Badge>;
      case 'Released':
        return <Badge variant="default" className="bg-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Released</Badge>;
      case 'Transferred':
        return <Badge variant="secondary" className="flex items-center gap-1"><RefreshCcw className="w-3 h-3" /> Transferred</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      'BOP': 'bg-blue-600',
      'STATE_DOC': 'bg-purple-600',
      'COUNTY_JAIL': 'bg-orange-600',
      'VINE': 'bg-green-600',
      'ICE': 'bg-red-600',
      'PRIVATE': 'bg-slate-600',
    };
    return <Badge className={colors[source] || 'bg-gray-600'}>{source.replace('_', ' ')}</Badge>;
  };

  const getFacilityTypeBadge = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      'Federal Prison': 'default',
      'State Prison': 'secondary',
      'County Jail': 'outline',
      'Immigration Detention': 'destructive',
      'Private Facility': 'outline',
    };
    return <Badge variant={variants[type] || 'outline'}>{type}</Badge>;
  };

  const getSourceStatusBadge = (status: SourceSearchStatus) => {
    switch (status.status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-600 text-xs">{status.source}: {status.resultsCount}</Badge>;
      case 'searching':
        return <Badge variant="secondary" className="text-xs animate-pulse">{status.source}: Searching...</Badge>;
      case 'error':
        return <Badge variant="destructive" className="text-xs">{status.source}: Error</Badge>;
      case 'timeout':
        return <Badge variant="outline" className="text-xs text-yellow-600">{status.source}: Timeout</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status.source}: Pending</Badge>;
    }
  };

  return (
    <div className="container max-w-6xl mx-auto px-4 py-8">
      {/* Search Form */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-6 h-6" />
            United States Inmate Locator
          </CardTitle>
          <CardDescription>
            Search federal, state, and local correctional facilities across the United States
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {/* Name Fields Row */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middleName">Middle Name (Optional)</Label>
                <Input
                  id="middleName"
                  placeholder="William"
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
            </div>

            {/* Additional Fields Row */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Date of Birth (Optional)</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State (Optional)</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger id="state">
                    <SelectValue placeholder="All States" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All States</SelectItem>
                    {statesData?.data?.map((s) => (
                      <SelectItem key={s.state} value={s.state}>
                        {s.stateName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inmateId">Inmate/Register Number</Label>
                <Input
                  id="inmateId"
                  placeholder="12345-678 or DOC#"
                  value={inmateId}
                  onChange={(e) => setInmateId(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
            </div>

            {/* Search Scope */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="searchScope">Search Scope</Label>
                <Select value={searchScope} onValueChange={setSearchScope}>
                  <SelectTrigger id="searchScope">
                    <SelectValue placeholder="All Systems" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Systems (Federal + State + Local)</SelectItem>
                    <SelectItem value="federal">Federal BOP Only</SelectItem>
                    <SelectItem value="state">State DOC Only</SelectItem>
                    <SelectItem value="county">County Jails Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleSearch}
                  disabled={searchMutation.isPending}
                  className="w-full"
                  size="lg"
                >
                  {searchMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Searching Facilities...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-2" />
                      Search Inmates
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Search Progress */}
            {searchMutation.isPending && (
              <div className="space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Searching multiple facilities and data sources...
                  </span>
                  <span>{Math.round(searchProgress)}%</span>
                </div>
                <Progress value={searchProgress} className="h-2" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results Section */}
      {results && (
        <div className="space-y-4">
          {/* Results Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  Search Results
                  {results.cached && (
                    <Badge variant="outline" className="text-xs">Cached</Badge>
                  )}
                  {results.partial && (
                    <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Partial Results
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {results.searchDuration}ms
                </div>
              </div>
              <CardDescription>
                Found {results.totalResults} inmate(s) matching your search
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Sources searched with status */}
              <div className="flex flex-wrap gap-2 mb-4">
                {results.sources.map((source, idx) => (
                  <div key={idx}>
                    {getSourceStatusBadge(source)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Inmate Records */}
          {results.inmates.length > 0 ? (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                {results.inmates.map((inmate) => (
                  <Card key={inmate.id} className={`border-l-4 ${
                    inmate.isViolentOffender ? 'border-l-red-500' :
                    inmate.isSexualOffender ? 'border-l-yellow-500' :
                    'border-l-primary'
                  }`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <User className="w-5 h-5" />
                            {inmate.firstName} {inmate.middleName} {inmate.lastName}
                            {/* Offense Classification Badges */}
                            {inmate.isViolentOffender && (
                              <Badge variant="destructive" className="text-xs font-bold">
                                <Shield className="w-3 h-3 mr-1" />
                                VIOLENT
                              </Badge>
                            )}
                            {inmate.isSexualOffender && (
                              <Badge className="text-xs font-bold bg-yellow-500 text-black">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                SEXUAL
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <Hash className="w-4 h-4" />
                            {inmate.inmateNumber}
                          </CardDescription>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {getCustodyStatusBadge(inmate.custodyStatus)}
                          {getSourceBadge(inmate.source)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Facility Info */}
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <Building className="w-4 h-4 mt-1 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{inmate.facilityName}</p>
                              <p className="text-sm text-muted-foreground">
                                {inmate.facilityLocation.city && `${inmate.facilityLocation.city}, `}
                                {inmate.facilityLocation.state}
                              </p>
                              {getFacilityTypeBadge(inmate.facilityType)}
                            </div>
                          </div>
                        </div>

                        {/* Personal Info & Dates */}
                        <div className="space-y-2">
                          {inmate.age && (
                            <div className="flex items-center gap-2 text-sm">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              Age: {inmate.age}
                            </div>
                          )}
                          {inmate.sex && (
                            <div className="flex items-center gap-2 text-sm">
                              <User className="w-4 h-4 text-muted-foreground" />
                              {inmate.sex}
                            </div>
                          )}
                          {inmate.arrestDate && (
                            <div className="flex items-center gap-2 text-sm">
                              <Gavel className="w-4 h-4 text-muted-foreground" />
                              Arrested: {inmate.arrestDate}
                            </div>
                          )}
                          {inmate.convictionDate && (
                            <div className="flex items-center gap-2 text-sm">
                              <Gavel className="w-4 h-4 text-muted-foreground" />
                              Convicted: {inmate.convictionDate}
                            </div>
                          )}
                          {inmate.releaseDate && (
                            <div className="flex items-center gap-2 text-sm">
                              <Clock className="w-4 h-4 text-muted-foreground" />
                              Projected Release: {inmate.releaseDate}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Charges */}
                      {inmate.charges && inmate.charges.length > 0 && (
                        <div className="mt-4">
                          <Separator className="mb-3" />
                          <p className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Gavel className="w-4 h-4" />
                            Charges/Offenses:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {inmate.charges.map((charge, idx) => {
                              // Safely access chargeDetails with bounds checking
                              const chargeDetail = inmate.chargeDetails && 
                                idx < inmate.chargeDetails.length 
                                ? inmate.chargeDetails[idx] 
                                : null;
                              const isViolent = chargeDetail?.classification === 'VIOLENT';
                              const isSexual = chargeDetail?.classification === 'SEXUAL';
                              
                              return (
                                <Badge 
                                  key={idx} 
                                  variant="outline" 
                                  className={`text-xs ${
                                    isViolent ? 'border-red-500 text-red-600' :
                                    isSexual ? 'border-yellow-500 text-yellow-600' :
                                    ''
                                  }`}
                                >
                                  {charge}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Source Link */}
                      {inmate.sourceUrl && (
                        <div className="mt-4">
                          <a
                            href={inmate.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <ExternalLink className="w-4 h-4" />
                            View on official site
                          </a>
                        </div>
                      )}

                      {/* Confidence Score */}
                      <div className="mt-4 flex items-center gap-2">
                        <div className="text-xs text-muted-foreground">
                          Confidence: {inmate.confidence}%
                        </div>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              inmate.confidence >= 80
                                ? 'bg-green-500'
                                : inmate.confidence >= 50
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${inmate.confidence}%` }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <Card>
              <CardContent className="py-8">
                <div className="text-center mb-6">
                  <AlertTriangle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">No Inmates Found</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    No matching records found in the searched systems.
                    Try adjusting your search criteria or search directly on official sources below.
                  </p>
                </div>
                
                {/* Manual Search Links */}
                <div className="border-t pt-6">
                  <p className="text-sm font-medium mb-4 text-center">Search Official Sources Directly:</p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <a
                      href="https://www.bop.gov/inmateloc/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted transition-colors"
                    >
                      <Database className="w-5 h-5 text-blue-600" />
                      <div>
                        <p className="text-sm font-medium">Federal BOP</p>
                        <p className="text-xs text-muted-foreground">Bureau of Prisons</p>
                      </div>
                      <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
                    </a>
                    
                    <a
                      href="https://www.vinelink.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted transition-colors"
                    >
                      <Shield className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-sm font-medium">VINE Link</p>
                        <p className="text-xs text-muted-foreground">Victim Notification</p>
                      </div>
                      <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
                    </a>
                    
                    <a
                      href="https://www.ice.gov/detain/detention-facilities"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted transition-colors"
                    >
                      <Building className="w-5 h-5 text-red-600" />
                      <div>
                        <p className="text-sm font-medium">ICE Locator</p>
                        <p className="text-xs text-muted-foreground">Immigration Detention</p>
                      </div>
                      <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
                    </a>
                  </div>
                  
                  {state && statesData?.data && (
                    <div className="mt-4">
                      {statesData.data.filter(s => s.state === state).map(stateInfo => (
                        stateInfo.searchUrl && (
                          <a
                            key={stateInfo.state}
                            href={stateInfo.searchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-3 rounded-lg border hover:bg-muted transition-colors"
                          >
                            <MapPin className="w-5 h-5 text-purple-600" />
                            <div>
                              <p className="text-sm font-medium">{stateInfo.stateName} DOC</p>
                              <p className="text-xs text-muted-foreground">{stateInfo.departmentName}</p>
                            </div>
                            <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
                          </a>
                        )
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Disclaimer */}
          <Card className="bg-muted/50 border-dashed">
            <CardContent className="py-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {results.disclaimer}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
