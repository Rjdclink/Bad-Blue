import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, ArrowLeft, Search, User, Loader2, Download, CheckCircle, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { SEOHead } from "@/components/SEOHead";

interface ReportSection {
  title: string;
  content: string[];
}

export default function LegalizoPeopleSearch() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);

  const handleLogout = async () => {
    window.location.href = "/api/logout";
  };

  if (!user) {
    setLocation('/legalizo-auth');
    return null;
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name to search",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setReport(null);
    setReportId(null);

    try {
      const response = await fetch('/api/legalizo/people-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchQuery }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setReportId(data.reportId);
      
      // Poll for report completion
      pollReportStatus(data.reportId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Search failed",
        variant: "destructive",
      });
      setIsSearching(false);
    }
  };

  const pollReportStatus = async (id: string) => {
    const maxAttempts = 30; // 30 attempts * 4 seconds = 2 minutes max
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/legalizo/people-search/${id}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch report status');
        }

        const data = await response.json();

        if (data.status === 'completed') {
          setReport(data.reportData);
          setIsSearching(false);
          toast({
            title: "Success",
            description: "Report generated successfully",
          });
        } else if (data.status === 'failed') {
          throw new Error(data.errorMessage || 'Report generation failed');
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 4000); // Poll every 4 seconds (reduced from 2 seconds)
        } else {
          throw new Error('Report generation timed out');
        }
      } catch (error: any) {
        setIsSearching(false);
        toast({
          title: "Error",
          description: error.message || "Failed to generate report",
          variant: "destructive",
        });
      }
    };

    poll();
  };

  const handleDownloadReport = async () => {
    if (!reportId) return;

    try {
      const response = await fetch(`/api/legalizo/people-search/${reportId}/download`);
      
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `legalizo-osint-report-${reportId}.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Report downloaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Download failed",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="People Search - Deep OSINT Report | Legalizo"
        description="Comprehensive background research with professional OSINT reports"
      />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center gap-4 px-4">
          <Link href="/legalizo-welcome" className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">Legalizo</span>
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">
                {user.firstName} {user.lastName}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => setLocation('/legalizo-welcome')}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>

        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Search className="w-8 h-8 text-primary" />
            <h1 className="text-4xl font-bold">People Search</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Deep OSINT Report – Comprehensive Background Research
          </p>
        </div>

        {/* Search Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Search for a Person</CardTitle>
            <CardDescription>
              Enter a name to generate a comprehensive OSINT report with information from public records, social media, court data, and more
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="searchQuery">Name or Identifying Information</Label>
                <div className="flex gap-2">
                  <Input
                    id="searchQuery"
                    type="text"
                    placeholder="Enter full name (e.g., John Smith)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    disabled={isSearching}
                  />
                  <Button 
                    onClick={handleSearch} 
                    disabled={isSearching || !searchQuery.trim()}
                    className="min-w-[120px]"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 mr-2" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This tool searches publicly accessible sources including social media, public records, court data, property records, and other open-source intelligence databases.
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {isSearching && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <div className="text-center">
                  <p className="font-semibold text-lg mb-2">Generating Report</p>
                  <p className="text-muted-foreground">
                    Scraping and aggregating data from multiple sources...
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    This may take 1-2 minutes
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Report Display */}
        {report && !isSearching && (
          <div className="space-y-6">
            {/* Report Header */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl flex items-center gap-2">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                      Report Generated
                    </CardTitle>
                    <CardDescription>
                      Subject: {report.identitySummary?.name || searchQuery}
                    </CardDescription>
                  </div>
                  <Button onClick={handleDownloadReport}>
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Report Sections */}
            {report.identitySummary && (
              <Card>
                <CardHeader>
                  <CardTitle>Identity Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(report.identitySummary).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="font-medium capitalize">{key.replace(/_/g, ' ')}:</span>
                        <span className="text-muted-foreground">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {report.contactInformation && (
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {Array.isArray(report.contactInformation) ? (
                      report.contactInformation.map((item: string, index: number) => (
                        <li key={index} className="text-sm">• {item}</li>
                      ))
                    ) : (
                      <li className="text-sm text-muted-foreground">No contact information found</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}

            {report.socialMediaPresence && (
              <Card>
                <CardHeader>
                  <CardTitle>Social Media Presence</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {Array.isArray(report.socialMediaPresence) ? (
                      report.socialMediaPresence.map((item: string, index: number) => (
                        <li key={index} className="text-sm">• {item}</li>
                      ))
                    ) : (
                      <li className="text-sm text-muted-foreground">No social media profiles found</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}

            {report.publicRecords && (
              <Card>
                <CardHeader>
                  <CardTitle>Public Records & Court Data</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {Array.isArray(report.publicRecords) ? (
                      report.publicRecords.map((item: string, index: number) => (
                        <li key={index} className="text-sm">• {item}</li>
                      ))
                    ) : (
                      <li className="text-sm text-muted-foreground">No public records found</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}

            {report.summary && (
              <Card>
                <CardHeader>
                  <CardTitle>Summary & Confidence Assessment</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{report.summary}</p>
                  {report.confidenceScore && (
                    <div className="mt-4">
                      <Badge variant="secondary">
                        Confidence Score: {report.confidenceScore}%
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-12 border-t text-center text-sm text-muted-foreground">
        <p>© 2024 Legalizo. All rights reserved.</p>
        <p className="mt-2">All data is sourced from publicly accessible information</p>
      </footer>
    </div>
  );
}
