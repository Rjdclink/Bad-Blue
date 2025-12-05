/**
 * People Finder Tool Component
 * Professional OSINT intelligence gathering tool for legal professionals
 * 
 * Features:
 * - Comprehensive identity intelligence
 * - Multi-source data aggregation
 * - Professional dossier presentation
 * - Legal compliance focused
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Search, User, MapPin, Mail, Phone, Briefcase, FileText, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface PeopleSearchReport {
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
  sources: Array<{
    name: string;
    data: any;
    confidence: number;
    timestamp: string;
  }>;
  emails?: {
    emails: string[];
    confidence: number;
  };
  breaches?: {
    breaches: Array<{
      name: string;
      domain: string;
      breachDate: string;
      dataClasses: string[];
    }>;
  };
  spiderfoot?: any;
}

interface PeopleFinderToolProps {
  lawType?: string;
}

export function PeopleFinderTool({ lawType }: PeopleFinderToolProps) {
  const { toast } = useToast();
  const [searchName, setSearchName] = useState("");
  const [searchDepartment, setSearchDepartment] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const [searchDomain, setSearchDomain] = useState("");
  const [searchReport, setSearchReport] = useState<PeopleSearchReport | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (params: {
      name: string;
      department?: string;
      location?: string;
      domain?: string;
    }) => {
      const response = await apiRequest("/api/osint/full-search", "POST", params);
      const data = await response.json();
      return data as PeopleSearchReport;
    },
    onSuccess: (data) => {
      setSearchReport(data);
      toast({
        title: "Search Complete",
        description: `Intelligence report generated with ${data.confidenceScore}% confidence.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Search Failed",
        description: error.message || "Failed to complete OSINT search",
        variant: "destructive",
      });
    },
  });

  const handleSearch = () => {
    if (!searchName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a name to search.",
        variant: "destructive",
      });
      return;
    }

    searchMutation.mutate({
      name: searchName.trim(),
      department: searchDepartment.trim() || undefined,
      location: searchLocation.trim() || undefined,
      domain: searchDomain.trim() || undefined,
    });
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 70) return "text-green-600";
    if (score >= 40) return "text-yellow-600";
    return "text-red-600";
  };

  const getConfidenceBadge = (score: number) => {
    if (score >= 70) return "default";
    if (score >= 40) return "secondary";
    return "destructive";
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-600" />
            People Intelligence Search
          </CardTitle>
          <CardDescription>
            Conduct comprehensive OSINT research on individuals for legal purposes.
            All searches are conducted within legal and ethical boundaries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search-name">Full Name *</Label>
              <Input
                id="search-name"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="John Doe"
                disabled={searchMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="search-location">Location (Optional)</Label>
              <Input
                id="search-location"
                value={searchLocation}
                onChange={(e) => setSearchLocation(e.target.value)}
                placeholder="City, State"
                disabled={searchMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="search-department">Organization (Optional)</Label>
              <Input
                id="search-department"
                value={searchDepartment}
                onChange={(e) => setSearchDepartment(e.target.value)}
                placeholder="Company or Department"
                disabled={searchMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="search-domain">Email Domain (Optional)</Label>
              <Input
                id="search-domain"
                value={searchDomain}
                onChange={(e) => setSearchDomain(e.target.value)}
                placeholder="example.com"
                disabled={searchMutation.isPending}
              />
            </div>
          </div>

          <Button
            onClick={handleSearch}
            disabled={searchMutation.isPending}
            className="w-full md:w-auto"
          >
            {searchMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Start Intelligence Search
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {searchReport && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Intelligence Report: {searchReport.identitySummary.name}
              </CardTitle>
              <Badge variant={getConfidenceBadge(searchReport.confidenceScore)}>
                {searchReport.confidenceScore}% Confidence
              </Badge>
            </div>
            <CardDescription>
              Report generated from {searchReport.sources.length} data sources
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="identity">Identity</TabsTrigger>
                <TabsTrigger value="contact">Contact</TabsTrigger>
                <TabsTrigger value="records">Records</TabsTrigger>
                <TabsTrigger value="online">Online</TabsTrigger>
                <TabsTrigger value="sources">Sources</TabsTrigger>
              </TabsList>

              {/* Summary Tab */}
              <TabsContent value="summary" className="space-y-4">
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    <div className="whitespace-pre-wrap text-sm">
                      {searchReport.summary}
                    </div>
                  </AlertDescription>
                </Alert>
              </TabsContent>

              {/* Identity Tab */}
              <TabsContent value="identity" className="space-y-4">
                <div className="grid gap-4">
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <User className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-1">Primary Name</h4>
                      <p className="text-sm">{searchReport.identitySummary.name}</p>
                    </div>
                  </div>

                  {searchReport.identitySummary.aliases && searchReport.identitySummary.aliases.length > 0 && (
                    <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                      <User className="w-5 h-5 mt-0.5 text-blue-600" />
                      <div className="flex-1">
                        <h4 className="font-semibold mb-1">Known Aliases</h4>
                        <div className="flex flex-wrap gap-2">
                          {searchReport.identitySummary.aliases.map((alias, i) => (
                            <Badge key={i} variant="outline">{alias}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 mt-0.5 text-green-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-1">Verification Status</h4>
                      <p className="text-sm">{searchReport.identitySummary.verificationStatus}</p>
                    </div>
                  </div>

                  {searchReport.employmentAndEducation.length > 0 && (
                    <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                      <Briefcase className="w-5 h-5 mt-0.5 text-blue-600" />
                      <div className="flex-1">
                        <h4 className="font-semibold mb-2">Employment & Education</h4>
                        <ul className="space-y-1 text-sm">
                          {searchReport.employmentAndEducation.map((item, i) => (
                            <li key={i} className="pl-4 border-l-2 border-slate-200 dark:border-slate-700">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Contact Tab */}
              <TabsContent value="contact" className="space-y-4">
                {searchReport.emails && searchReport.emails.emails.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <Mail className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Email Addresses</h4>
                      <div className="space-y-1">
                        {searchReport.emails.emails.map((email, i) => (
                          <div key={i} className="text-sm font-mono">{email}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {searchReport.contactInformation.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <Phone className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Contact Information</h4>
                      <ul className="space-y-1 text-sm">
                        {searchReport.contactInformation.map((info, i) => (
                          <li key={i}>{info}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {searchReport.locationHistory.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <MapPin className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Location History</h4>
                      <ul className="space-y-1 text-sm">
                        {searchReport.locationHistory.map((location, i) => (
                          <li key={i}>{location}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {searchReport.breaches && searchReport.breaches.breaches.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <h4 className="font-semibold mb-2">Security Breaches Detected</h4>
                      <div className="space-y-2">
                        {searchReport.breaches.breaches.map((breach, i) => (
                          <div key={i} className="text-sm">
                            <strong>{breach.name}</strong> ({breach.breachDate})
                            <div className="text-xs mt-1">
                              Exposed: {breach.dataClasses.join(", ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>

              {/* Public Records Tab */}
              <TabsContent value="records" className="space-y-4">
                {searchReport.publicRecords.length > 0 ? (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <FileText className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Public Records & Court Data</h4>
                      <ul className="space-y-2 text-sm">
                        {searchReport.publicRecords.map((record, i) => (
                          <li key={i} className="pl-4 border-l-2 border-slate-200 dark:border-slate-700">
                            {record}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription>
                      No public records found or records not yet integrated.
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>

              {/* Online Presence Tab */}
              <TabsContent value="online" className="space-y-4">
                {searchReport.socialMediaPresence.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <ExternalLink className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Social Media Presence</h4>
                      <ul className="space-y-1 text-sm">
                        {searchReport.socialMediaPresence.map((profile, i) => (
                          <li key={i}>{profile}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {searchReport.onlineMentions.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <FileText className="w-5 h-5 mt-0.5 text-blue-600" />
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Online Mentions</h4>
                      <ul className="space-y-2 text-sm">
                        {searchReport.onlineMentions.map((mention, i) => (
                          <li key={i} className="pl-4 border-l-2 border-slate-200 dark:border-slate-700">
                            {mention}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Sources Tab */}
              <TabsContent value="sources" className="space-y-4">
                <div className="space-y-3">
                  {searchReport.sources.map((source, i) => (
                    <div key={i} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">{source.name}</h4>
                        <Badge variant={getConfidenceBadge(source.confidence)}>
                          {source.confidence}% confidence
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Retrieved: {new Date(source.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <Separator className="my-6" />

            {/* Legal Disclaimer */}
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>LEGAL DISCLAIMER:</strong> This report contains only publicly accessible
                information aggregated from lawful sources. All data should be independently
                verified before use in legal proceedings. This service complies with all applicable
                laws including the Fair Credit Reporting Act (FCRA). Information is provided for
                legal professional use only.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
