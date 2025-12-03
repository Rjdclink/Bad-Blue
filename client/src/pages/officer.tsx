import { useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Shield, MapPin, Calendar, ArrowLeft, FileText, Building2 } from "lucide-react";
import type { BadgeLookup } from "@shared/schema";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function OfficerInfo() {
  const { id } = useParams();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [user, authLoading, toast]);

  const { data: lookup, isLoading } = useQuery<BadgeLookup>({
    queryKey: [`/api/badge-lookups/${id}`],
    enabled: !!user && !!id,
  });

  usePageFaqSchema();

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-9 w-9" />
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!lookup) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Lookup Not Found</h2>
          <p className="text-muted-foreground mb-6">This badge lookup doesn't exist or you don't have access.</p>
          <Button asChild>
            <Link href="/">Return Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const officerSearchSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Police Officer Information Search",
    "description": "Search and view detailed police officer information including badge numbers, departments, ranks, and service records for accountability purposes",
    "provider": {
      "@type": "Organization",
      "name": "BadBlue"
    },
    "serviceType": "Police Officer Information Search",
    "areaServed": {
      "@type": "Country",
      "name": "United States"
    }
  };

  const breadcrumbs = [
    { name: "Officer Search", url: "https://bad-blue.com/officer" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Officer Information | BadBlue - Professional Police Accountability Platform"
        description="View officer information and records. Professional legal rights protection service for reporting police misconduct and civil rights violations."
        keywords="police officer information, officer badge lookup, police accountability, bad cops, officer assault, law enforcement abuse, police misconduct records"
        canonicalUrl="https://bad-blue.com/officer"
        structuredData={officerSearchSchema}
        breadcrumbs={breadcrumbs}
        pageType="service"
      />
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <PageBreadcrumbs currentPageName="Officer Search" />
        {/* Back Button */}
        <Button variant="ghost" asChild className="mb-6" data-testid="button-back">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        {/* Badge Number Card */}
        <Card className="mb-6 border-2">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-sm text-muted-foreground uppercase tracking-wide mb-2">Badge Number</div>
                <div className="font-mono text-4xl font-bold text-primary" data-testid="text-badge-number">
                  {lookup.badgeNumber || 'Unknown'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground mb-2">Department</div>
                <Badge className="text-base px-4 py-1" data-testid="badge-department">
                  {lookup.department || 'Unknown Department'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Officer Details */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">Officer Information</CardTitle>
            <CardDescription>Public records information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Name
                </div>
                <div className="text-lg font-semibold" data-testid="text-officer-name">
                  {lookup.officerName || 'Not Available'}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Rank
                </div>
                <div className="text-lg font-semibold" data-testid="text-officer-rank">
                  {lookup.officerRank || 'Not Available'}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Department Location
                </div>
                <div className="text-lg" data-testid="text-department-location">
                  {lookup.departmentLocation || 'Not Available'}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Years of Service
                </div>
                <div className="text-lg" data-testid="text-officer-years">
                  {lookup.officerYears ? `${lookup.officerYears} years` : 'Not Available'}
                </div>
              </div>

              {lookup.jurisdiction && (
                <div className="md:col-span-2">
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Jurisdiction
                  </div>
                  <div className="text-lg" data-testid="text-jurisdiction">
                    {lookup.jurisdiction}
                  </div>
                </div>
              )}
            </div>

            {lookup.analysisConfidence && (
              <div className="pt-4 border-t">
                <div className="text-xs text-muted-foreground">
                  AI Analysis Confidence: {lookup.analysisConfidence}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>What would you like to do with this information?</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                asChild 
                size="lg" 
                className="flex-1"
                data-testid="button-file-complaint"
              >
                <Link href={`/complaints/new?lookupId=${lookup.id}`}>
                  <FileText className="w-4 h-4 mr-2" />
                  File a Complaint
                </Link>
              </Button>
              <Button 
                variant="outline" 
                size="lg"
                onClick={() => window.print()}
                data-testid="button-save-info"
              >
                Save Information
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          <p className="leading-relaxed">
            This information is sourced from publicly available records. If you believe any information is incorrect, please{" "}
            <a href="/contact" className="text-primary hover:underline">
              contact us
            </a>.
          </p>
        </div>
      </main>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/officer" />
    </div>
  );
}
