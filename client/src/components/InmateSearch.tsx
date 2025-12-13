import { useState, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

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

// Local state data - no API needed
const STATE_DATA: StateInfo[] = [
  { state: 'AL', stateName: 'Alabama', departmentName: 'Alabama Department of Corrections', searchUrl: 'https://doc.alabama.gov/InmateSearch' },
  { state: 'AK', stateName: 'Alaska', departmentName: 'Alaska Department of Corrections', searchUrl: 'https://doc.alaska.gov/vinelink' },
  { state: 'AZ', stateName: 'Arizona', departmentName: 'Arizona Department of Corrections', searchUrl: 'https://corrections.az.gov/public-resources/inmate-datasearch' },
  { state: 'AR', stateName: 'Arkansas', departmentName: 'Arkansas Division of Correction', searchUrl: 'https://apps.ark.org/inmate_info/index.php' },
  { state: 'CA', stateName: 'California', departmentName: 'California Department of Corrections and Rehabilitation', searchUrl: 'https://inmatelocator.cdcr.ca.gov/' },
  { state: 'CO', stateName: 'Colorado', departmentName: 'Colorado Department of Corrections', searchUrl: 'https://www.colorado.gov/pacific/cdoc/offender-search' },
  { state: 'CT', stateName: 'Connecticut', departmentName: 'Connecticut Department of Correction', searchUrl: 'https://portal.ct.gov/DOC/Common-Elements/Inmate-Information' },
  { state: 'DE', stateName: 'Delaware', departmentName: 'Delaware Department of Correction', searchUrl: 'https://doc.delaware.gov/views/inmate.shtml' },
  { state: 'FL', stateName: 'Florida', departmentName: 'Florida Department of Corrections', searchUrl: 'https://fdc.myflorida.com/OffenderSearch/' },
  { state: 'GA', stateName: 'Georgia', departmentName: 'Georgia Department of Corrections', searchUrl: 'https://gdc.georgia.gov/offender-information/find-offender' },
  { state: 'HI', stateName: 'Hawaii', departmentName: 'Hawaii Department of Corrections', searchUrl: 'https://dps.hawaii.gov/occc/offender-search/' },
  { state: 'ID', stateName: 'Idaho', departmentName: 'Idaho Department of Correction', searchUrl: 'https://www.idoc.idaho.gov/content/prisons/offender_search' },
  { state: 'IL', stateName: 'Illinois', departmentName: 'Illinois Department of Corrections', searchUrl: 'https://www.idoc.state.il.us/subsections/search/default.asp' },
  { state: 'IN', stateName: 'Indiana', departmentName: 'Indiana Department of Correction', searchUrl: 'https://www.in.gov/idoc/offender-locator/' },
  { state: 'IA', stateName: 'Iowa', departmentName: 'Iowa Department of Corrections', searchUrl: 'https://doc.iowa.gov/offender-information' },
  { state: 'KS', stateName: 'Kansas', departmentName: 'Kansas Department of Corrections', searchUrl: 'https://kdocrepository.doc.ks.gov/kasper/' },
  { state: 'KY', stateName: 'Kentucky', departmentName: 'Kentucky Department of Corrections', searchUrl: 'https://corrections.ky.gov/Facilities/Pages/Inmate-Search.aspx' },
  { state: 'LA', stateName: 'Louisiana', departmentName: 'Louisiana Department of Corrections', searchUrl: 'https://doc.louisiana.gov/imprisoned-person-locator/' },
  { state: 'ME', stateName: 'Maine', departmentName: 'Maine Department of Corrections', searchUrl: 'https://www.maine.gov/corrections/' },
  { state: 'MD', stateName: 'Maryland', departmentName: 'Maryland Department of Corrections', searchUrl: 'https://www.dpscs.state.md.us/inmate/' },
  { state: 'MA', stateName: 'Massachusetts', departmentName: 'Massachusetts Department of Correction', searchUrl: 'https://www.mass.gov/lists/doc-inmate-look-up' },
  { state: 'MI', stateName: 'Michigan', departmentName: 'Michigan Department of Corrections', searchUrl: 'https://mdocweb.state.mi.us/otis2/otis2.aspx' },
  { state: 'MN', stateName: 'Minnesota', departmentName: 'Minnesota Department of Corrections', searchUrl: 'https://coms.doc.state.mn.us/PublicViewer/' },
  { state: 'MS', stateName: 'Mississippi', departmentName: 'Mississippi Department of Corrections', searchUrl: 'https://www.mdoc.ms.gov/inmate-information/inmate-search' },
  { state: 'MO', stateName: 'Missouri', departmentName: 'Missouri Department of Corrections', searchUrl: 'https://doc.mo.gov/offender-search-and-victim-notification' },
  { state: 'MT', stateName: 'Montana', departmentName: 'Montana Department of Corrections', searchUrl: 'https://cor.mt.gov/victimservices/offsearch' },
  { state: 'NE', stateName: 'Nebraska', departmentName: 'Nebraska Department of Corrections', searchUrl: 'https://dcs-inmatesearch.ne.gov/Corrections/InmateDisplayInquiry.aspx' },
  { state: 'NV', stateName: 'Nevada', departmentName: 'Nevada Department of Corrections', searchUrl: 'https://ofdsearch.doc.nv.gov/' },
  { state: 'NH', stateName: 'New Hampshire', departmentName: 'New Hampshire Department of Corrections', searchUrl: 'https://www.nh.gov/nhdoc/divisions/field/victim.html' },
  { state: 'NJ', stateName: 'New Jersey', departmentName: 'New Jersey Department of Corrections', searchUrl: 'https://www.state.nj.us/corrections/pages/index.shtml' },
  { state: 'NM', stateName: 'New Mexico', departmentName: 'New Mexico Corrections Department', searchUrl: 'https://cd.nm.gov/divisions/adult-prisons/inmate-search/' },
  { state: 'NY', stateName: 'New York', departmentName: 'New York Department of Corrections', searchUrl: 'https://nysdoccslookup.doccs.ny.gov/' },
  { state: 'NC', stateName: 'North Carolina', departmentName: 'North Carolina Department of Corrections', searchUrl: 'https://webapps.doc.state.nc.us/opi/offendersearch.do' },
  { state: 'ND', stateName: 'North Dakota', departmentName: 'North Dakota Department of Corrections', searchUrl: 'https://www.docr.nd.gov/offender-locator' },
  { state: 'OH', stateName: 'Ohio', departmentName: 'Ohio Department of Rehabilitation and Correction', searchUrl: 'https://appgateway.drc.ohio.gov/OffenderSearch' },
  { state: 'OK', stateName: 'Oklahoma', departmentName: 'Oklahoma Department of Corrections', searchUrl: 'https://okoffender.doc.ok.gov/' },
  { state: 'OR', stateName: 'Oregon', departmentName: 'Oregon Department of Corrections', searchUrl: 'https://docpub.state.or.us/OOS/intro.jsf' },
  { state: 'PA', stateName: 'Pennsylvania', departmentName: 'Pennsylvania Department of Corrections', searchUrl: 'https://inmatelocator.cor.pa.gov/' },
  { state: 'RI', stateName: 'Rhode Island', departmentName: 'Rhode Island Department of Corrections', searchUrl: 'https://www.doc.ri.gov/rehabilitative-services/offender-search' },
  { state: 'SC', stateName: 'South Carolina', departmentName: 'South Carolina Department of Corrections', searchUrl: 'https://www.dc.state.sc.us/inmates.html' },
  { state: 'SD', stateName: 'South Dakota', departmentName: 'South Dakota Department of Corrections', searchUrl: 'https://doc.sd.gov/adult/lookup/default.aspx' },
  { state: 'TN', stateName: 'Tennessee', departmentName: 'Tennessee Department of Correction', searchUrl: 'https://www.tn.gov/correction/statistics-and-information/felony-offender-information.html' },
  { state: 'TX', stateName: 'Texas', departmentName: 'Texas Department of Criminal Justice', searchUrl: 'https://inmate.tdcj.texas.gov/InmateSearch/start.action' },
  { state: 'UT', stateName: 'Utah', departmentName: 'Utah Department of Corrections', searchUrl: 'https://corrections.utah.gov/offender-search/' },
  { state: 'VT', stateName: 'Vermont', departmentName: 'Vermont Department of Corrections', searchUrl: 'https://doc.vermont.gov/about/inmate-programs-and-services' },
  { state: 'VA', stateName: 'Virginia', departmentName: 'Virginia Department of Corrections', searchUrl: 'https://vadoc.virginia.gov/offenders/offender-locator/' },
  { state: 'WA', stateName: 'Washington', departmentName: 'Washington State Department of Corrections', searchUrl: 'https://www.doc.wa.gov/information/inmate-search/' },
  { state: 'WV', stateName: 'West Virginia', departmentName: 'West Virginia Division of Corrections', searchUrl: 'https://dcr.wv.gov/resources/Pages/offender-search.aspx' },
  { state: 'WI', stateName: 'Wisconsin', departmentName: 'Wisconsin Department of Corrections', searchUrl: 'https://appsdoc.wi.gov/lop/' },
  { state: 'WY', stateName: 'Wyoming', departmentName: 'Wyoming Department of Corrections', searchUrl: 'https://corrections.wyo.gov/residents-home/offender-locator' },
  { state: 'DC', stateName: 'District of Columbia', departmentName: 'Federal Bureau of Prisons (BOP)', searchUrl: 'https://www.bop.gov/inmateloc/' },
];

// Generate mock inmate data for demonstration
const generateMockInmates = (query: {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  state?: string;
  inmateId?: string;
  searchScope?: string;
}): InmateRecord[] => {
  const facilities = [
    { name: 'Federal Correctional Institution', type: 'Federal Prison', city: 'Tallahassee', state: 'FL' },
    { name: 'USP Leavenworth', type: 'Federal Prison', city: 'Leavenworth', state: 'KS' },
    { name: 'FCI Fort Dix', type: 'Federal Prison', city: 'Fort Dix', state: 'NJ' },
    { name: 'State Correctional Facility', type: 'State Prison', city: 'Sacramento', state: 'CA' },
    { name: 'Metropolitan Detention Center', type: 'County Jail', city: 'Brooklyn', state: 'NY' },
    { name: 'Cook County Jail', type: 'County Jail', city: 'Chicago', state: 'IL' },
    { name: 'Harris County Jail', type: 'County Jail', city: 'Houston', state: 'TX' },
    { name: 'Los Angeles County Jail', type: 'County Jail', city: 'Los Angeles', state: 'CA' },
  ];

  const charges = [
    ['Drug Trafficking - 21 USC 841', 'Conspiracy - 18 USC 371'],
    ['Bank Fraud - 18 USC 1344', 'Wire Fraud - 18 USC 1343'],
    ['Armed Robbery - State Statute 18.2-58', 'Assault with Deadly Weapon'],
    ['Possession with Intent to Distribute', 'Felon in Possession of Firearm'],
    ['Theft Over $1000', 'Identity Fraud'],
    ['DUI - 3rd Offense', 'Driving on Suspended License'],
  ];

  const sources = ['BOP', 'STATE_DOC', 'VINE', 'COUNTY_JAIL'];
  
  // Generate 1-3 mock results based on search
  const numResults = Math.floor(Math.random() * 3) + 1;
  const inmates: InmateRecord[] = [];

  for (let i = 0; i < numResults; i++) {
    const facility = facilities[Math.floor(Math.random() * facilities.length)];
    const charge = charges[Math.floor(Math.random() * charges.length)];
    const source = sources[Math.floor(Math.random() * sources.length)];
    const isViolent = charge.some(c => c.toLowerCase().includes('robbery') || c.toLowerCase().includes('assault'));
    
    inmates.push({
      id: `mock-${Date.now()}-${i}`,
      source,
      firstName: query.firstName || 'John',
      lastName: query.lastName || 'Doe',
      middleName: query.middleName || (Math.random() > 0.5 ? 'Michael' : undefined),
      inmateNumber: query.inmateId || `${Math.floor(10000 + Math.random() * 90000)}-${Math.floor(100 + Math.random() * 900)}`,
      facilityName: facility.name,
      facilityType: facility.type,
      facilityLocation: {
        city: facility.city,
        state: query.state || facility.state,
      },
      custodyStatus: Math.random() > 0.3 ? 'In Custody' : 'Released',
      releaseDate: Math.random() > 0.5 ? `${2024 + Math.floor(Math.random() * 5)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}` : undefined,
      admissionDate: `${2018 + Math.floor(Math.random() * 5)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
      age: 25 + Math.floor(Math.random() * 35),
      sex: Math.random() > 0.2 ? 'Male' : 'Female',
      race: ['White', 'Black', 'Hispanic', 'Asian'][Math.floor(Math.random() * 4)],
      charges: charge,
      chargeDetails: charge.map(c => ({
        description: c,
        classification: isViolent ? 'VIOLENT' : 'OTHER',
      })),
      isViolentOffender: isViolent,
      isSexualOffender: false,
      offenseClassifications: isViolent ? ['VIOLENT'] : ['OTHER'],
      confidence: 70 + Math.floor(Math.random() * 25),
      sourceUrl: source === 'BOP' ? 'https://www.bop.gov/inmateloc/' : 'https://www.vinelink.com/',
    });
  }

  return inmates;
};

export default function InmateSearch() {
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
  const [isSearching, setIsSearching] = useState(false);

  // Local state data - no API needed
  const statesData = { success: true, data: STATE_DATA };

  // Local search simulation - no API needed
  const performSearch = useCallback(async (searchData: {
    firstName?: string;
    lastName?: string;
    middleName?: string;
    dateOfBirth?: string;
    state?: string;
    inmateId?: string;
    searchScope?: string;
  }) => {
    const startTime = Date.now();
    
    // Simulate search delay for realism
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
    
    // Generate mock inmates based on search
    const mockInmates = generateMockInmates(searchData);
    
    // Build source statuses
    const sources: SourceSearchStatus[] = [];
    if (searchData.searchScope === 'all' || searchData.searchScope === 'federal') {
      sources.push({ source: 'BOP', searched: true, resultsCount: mockInmates.filter(i => i.source === 'BOP').length, status: 'completed' });
    }
    if (searchData.searchScope === 'all' || searchData.searchScope === 'state') {
      sources.push({ source: 'STATE_DOC', searched: true, resultsCount: mockInmates.filter(i => i.source === 'STATE_DOC').length, status: 'completed' });
    }
    if (searchData.searchScope === 'all' || searchData.searchScope === 'county') {
      sources.push({ source: 'VINE', searched: true, resultsCount: mockInmates.filter(i => i.source === 'VINE').length, status: 'completed' });
    }
    
    return {
      query: searchData,
      totalResults: mockInmates.length,
      inmates: mockInmates,
      sources,
      searchDuration: Date.now() - startTime,
      cached: false,
      partial: false,
      disclaimer: 'This search displays simulated demonstration data. For actual inmate information, please visit the official government sources linked below. Information may not be current or complete.',
    };
  }, []);

  // Handle search
  const handleSearch = async () => {
    if (!firstName && !lastName && !inmateId) {
      toast({
        title: "Input Required",
        description: "Please enter a name or inmate ID to search",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setSearchProgress(5);
    
    // Animate progress
    const progressInterval = setInterval(() => {
      setSearchProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 200);

    try {
      const result = await performSearch({
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        middleName: middleName.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        state: state || undefined,
        inmateId: inmateId.trim() || undefined,
        searchScope,
      });
      
      setSearchProgress(100);
      setResults(result);
      toast({
        title: "Search Complete",
        description: `Found ${result.totalResults} result(s) in ${result.searchDuration}ms`,
      });
    } finally {
      clearInterval(progressInterval);
      setIsSearching(false);
      setSearchProgress(0);
    }
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
                  disabled={isSearching}
                  className="w-full"
                  size="lg"
                >
                  {isSearching ? (
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
            {isSearching && (
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
                          {inmate.releaseDate && (
                            <div className="flex items-center gap-2 text-sm">
                              <Clock className="w-4 h-4 text-muted-foreground" />
                              Projected Release: {inmate.releaseDate}
                            </div>
                          )}
                        </div>
                      </div>

                      {inmate.charges && inmate.charges.length > 0 && (
                        <div className="mt-4">
                          <Separator className="mb-3" />
                          <p className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Gavel className="w-4 h-4" />
                            Charges/Offenses:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {inmate.charges.map((charge, idx) => {
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
