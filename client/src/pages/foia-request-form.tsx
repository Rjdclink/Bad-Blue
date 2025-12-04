import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { FileText, DollarSign, CheckCircle2, ArrowLeft, AlertTriangle, Mail } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClientSession } from "@/contexts/ClientSessionContext";
import { FormAssistant } from "@/components/FormAssistant";
import { FOIA_REQUEST_PRICING_CENTS } from "@shared/schema";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

const AGENCY_TYPES = [
  'Police Department',
  'Sheriff\'s Office',
  'State Police',
  'Highway Patrol',
  'City/Municipal Police',
  'County Sheriff',
  'Other Law Enforcement'
];

export default function FOIARequestForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { sessionData, hydrateFromUrl } = useClientSession();

  usePageFaqSchema();

  const [state, setState] = useState("");
  const [agencyType, setAgencyType] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [city, setCity] = useState("");
  const [officerName, setOfficerName] = useState("");
  const [badgeNumber, setBadgeNumber] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const [certifiedMailConsent, setCertifiedMailConsent] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generatingLetter, setGeneratingLetter] = useState(false);

  const seoKeywords = "FOIA request police records, freedom of information act police, public records request police, police records FOIA, officer records request, body camera footage FOIA, disciplinary records police, use of force reports, internal investigation files, police department records, FOIA request online, state FOIA laws police, public records law enforcement, police transparency request, officer misconduct records, police brutality documentation, excessive force records, false arrest records, civil rights records request, police accountability documents";

  if (!user) {
    window.location.href = "/api/login";
    return null;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.toString()) {
      hydrateFromUrl(params);
    }
  }, []);

  useEffect(() => {
    if (sessionData.officerName) setOfficerName(sessionData.officerName);
    if (sessionData.badgeNumber) setBadgeNumber(sessionData.badgeNumber);
    if (sessionData.department) setAgencyName(sessionData.department);
    if (sessionData.state) setState(sessionData.state);
    if (sessionData.city) setCity(sessionData.city);
    if (sessionData.incidentDate) setIncidentDate(sessionData.incidentDate);
    if (sessionData.incidentDescription) setRequestDescription(sessionData.incidentDescription);
  }, [sessionData]);

  const handleAISuggestedFields = (fields: any) => {
    if (fields.officerName) setOfficerName(fields.officerName);
    if (fields.badgeNumber) setBadgeNumber(fields.badgeNumber);
    if (fields.department) setAgencyName(fields.department);
    if (fields.state) setState(fields.state);
    if (fields.city) setCity(fields.city);
    if (fields.incidentDate) setIncidentDate(fields.incidentDate);
    if (fields.incidentDescription) setRequestDescription(fields.incidentDescription);

    const hasAllRequired = fields.state && fields.officerName && fields.incidentDate;

    if (hasAllRequired) {
      toast({
        title: "FOIA Request Ready!",
        description: "Required information collected. Review and submit below.",
      });
    }
  };

  const generateMutation = useMutation({
    mutationFn: async (foiaData: any) => {
      const response = await fetch("/api/foia/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(foiaData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || "Connection issue");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "FOIA Request Generated!",
        description: "Review your request letter below.",
      });
      setShowPreview(true);
    },
    onError: (error: any) => {
      // Provide user-friendly error messages based on error type
      let errorMessage = "We couldn't generate your FOIA request. Please check your information and try again";
      
      if (error.message?.toLowerCase().includes('network') || 
          error.message?.toLowerCase().includes('connection')) {
        errorMessage = "Connection issue. Please check your internet and try again";
      } else if (error.message?.toLowerCase().includes('session') || 
                 error.message?.toLowerCase().includes('expired')) {
        errorMessage = "Your session has expired. Please log in again to continue";
      } else if (error.message?.toLowerCase().includes('validation')) {
        errorMessage = "Please check the highlighted fields and correct any issues";
      } else if (error.message?.toLowerCase().includes('rate') || 
                 error.message?.toLowerCase().includes('too many')) {
        errorMessage = "Too many requests. Please wait a few moments before trying again";
      } else if (error.message?.toLowerCase().includes('technical') ||
                 error.message?.toLowerCase().includes('database')) {
        errorMessage = "We're experiencing technical difficulties. Please try again in a few moments";
      }
      
      toast({
        title: "Unable to Generate Request",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (foiaRequestId: string) => {
      const response = await fetch("/api/create-foia-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foiaRequestId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || "Payment processing issue");
      }

      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      // Provide user-friendly error messages based on error type
      let errorMessage = "Payment could not be processed. Please check your card details and try again";
      
      if (error.message?.toLowerCase().includes('network') || 
          error.message?.toLowerCase().includes('connection')) {
        errorMessage = "Connection issue. Please check your internet and try again";
      } else if (error.message?.toLowerCase().includes('session') || 
                 error.message?.toLowerCase().includes('expired')) {
        errorMessage = "Your session has expired. Please log in again to continue";
      } else if (error.message?.toLowerCase().includes('card') || 
                 error.message?.toLowerCase().includes('stripe')) {
        errorMessage = "Payment could not be processed. Please check your card details and try again";
      } else if (error.message?.toLowerCase().includes('rate') || 
                 error.message?.toLowerCase().includes('too many')) {
        errorMessage = "Too many payment attempts. Please wait a few moments before trying again";
      }
      
      toast({
        title: "Payment Issue",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleGenerateLetter = () => {
    if (!state || !officerName || !incidentDate) {
      toast({
        title: "Required Fields Missing",
        description: "Please complete all required fields (state, officer name, incident date) before generating",
        variant: "destructive",
      });
      return;
    }

    if (!certifiedMailConsent) {
      toast({
        title: "Action Required",
        description: "Please check the box to authorize certified mail delivery before continuing",
        variant: "destructive",
      });
      return;
    }

    setGeneratingLetter(true);
    generateMutation.mutate({
      state,
      agencyType,
      agencyName,
      city,
      officerName,
      badgeNumber,
      incidentDate,
      requestDescription,
    });
  };

  const handleConfirmAndPay = () => {
    if (!generateMutation.data?.foiaRequestId) {
      toast({
        title: "Letter Not Generated",
        description: "Please generate your FOIA request letter before proceeding to payment",
        variant: "destructive",
      });
      return;
    }

    submitMutation.mutate(generateMutation.data.foiaRequestId);
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(cents / 100);
  };

  const foiaServiceSchema = {
    "@context": "https://schema.org",
    "@type": "LegalService",
    "name": "FOIA Request Filing Service",
    "description": "Generate and file state-specific FOIA requests for police records including body camera footage, disciplinary records, use-of-force reports, and internal investigation files. Automatic routing to records custodians via certified mail.",
    "provider": {
      "@type": "Organization",
      "name": "BadBlue"
    },
    "serviceType": "Freedom of Information Act Request Filing",
    "areaServed": {
      "@type": "Country",
      "name": "United States"
    }
  };

  const breadcrumbs = [
    { name: "FOIA Request", url: "https://example.com/foia-request" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Bad Blue — File FOIA Requests for Police Records Online"
        description="Generate state-specific FOIA requests for body camera footage, disciplinary records, use-of-force reports, and police investigation files. Automatic routing to records custodians. Affordable, fully online."
        keywords={seoKeywords}
        canonicalUrl="https://example.com/foia-request"
        structuredData={foiaServiceSchema}
        breadcrumbs={breadcrumbs}
        pageType="service"
      />
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.href = "/home"}
            data-testid="button-back-home"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <PageBreadcrumbs currentPageName="FOIA Request" />
          <div>
            <h1 className="text-3xl font-bold mb-2">FOIA Records Request</h1>
            <p className="text-muted-foreground">
              Request official police records under the Freedom of Information Act
            </p>
          </div>

          <FormAssistant 
            formType="complaint"
            currentFormData={{
              officerName,
              badgeNumber,
              department: agencyName,
              state,
              city,
              incidentDate,
              description: requestDescription,
            }}
            onFieldsSuggested={handleAISuggestedFields}
          />

          <Card data-testid="card-foia-form">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Request Information
              </CardTitle>
              <CardDescription>
                Provide details about the records you're requesting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger id="state" data-testid="select-state">
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

                <div className="space-y-2">
                  <Label htmlFor="agencyType">Agency Type</Label>
                  <Select value={agencyType} onValueChange={setAgencyType}>
                    <SelectTrigger id="agencyType" data-testid="select-agency-type">
                      <SelectValue placeholder="Select agency type" />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENCY_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agencyName">Agency/Department Name</Label>
                  <Input
                    id="agencyName"
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    placeholder="e.g., Miami Police Department"
                    data-testid="input-agency-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g., Miami"
                    data-testid="input-city"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="officerName">Officer Name *</Label>
                  <Input
                    id="officerName"
                    value={officerName}
                    onChange={(e) => setOfficerName(e.target.value)}
                    placeholder="Officer's full name"
                    data-testid="input-officer-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="badgeNumber">Badge Number</Label>
                  <Input
                    id="badgeNumber"
                    value={badgeNumber}
                    onChange={(e) => setBadgeNumber(e.target.value)}
                    placeholder="Badge number (if known)"
                    data-testid="input-badge-number"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="incidentDate">Incident Date *</Label>
                  <Input
                    id="incidentDate"
                    type="date"
                    value={incidentDate}
                    onChange={(e) => setIncidentDate(e.target.value)}
                    data-testid="input-incident-date"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="requestDescription">
                  Records Description (What specific records are you requesting?)
                </Label>
                <Textarea
                  id="requestDescription"
                  value={requestDescription}
                  onChange={(e) => setRequestDescription(e.target.value)}
                  placeholder="Describe the specific records you're requesting (e.g., body camera footage, incident reports, disciplinary records, etc.)"
                  rows={5}
                  data-testid="textarea-request-description"
                />
              </div>

              <div className="flex items-start space-x-3 rounded-lg border p-4 bg-muted/50">
                <Checkbox
                  id="certifiedMail"
                  checked={certifiedMailConsent}
                  onCheckedChange={(checked) => setCertifiedMailConsent(checked as boolean)}
                  data-testid="checkbox-certified-mail"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="certifiedMail"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Authorize Certified Mail Delivery
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    I authorize BadBlue to send my FOIA request via certified mail and email the tracking number to me when mailed.
                  </p>
                </div>
              </div>

              <Button
                onClick={handleGenerateLetter}
                disabled={generateMutation.isPending || !certifiedMailConsent}
                className="w-full"
                data-testid="button-generate-letter"
              >
                {generateMutation.isPending ? "Generating Letter..." : "Generate FOIA Letter"}
              </Button>
            </CardContent>
          </Card>

          {showPreview && generateMutation.data && (
            <>
              <Card data-testid="card-letter-preview">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Generated FOIA Letter
                  </CardTitle>
                  <CardDescription>
                    Review your FOIA request letter before payment
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bg-background border rounded-lg p-6 whitespace-pre-wrap font-mono text-sm">
                    {generateMutation.data.generatedLetter}
                  </div>

                  {generateMutation.data.departmentAddress && (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Mail To:
                      </h4>
                      <p className="text-sm whitespace-pre-line">
                        {generateMutation.data.departmentName}
                        {'\n'}
                        {generateMutation.data.departmentAddress}
                      </p>
                    </div>
                  )}

                  {generateMutation.data.statute && (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <h4 className="font-semibold mb-2">Applicable Statute:</h4>
                      <p className="text-sm">
                        <strong>{generateMutation.data.statute.statuteName}</strong>
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {generateMutation.data.statute.citation}
                      </p>
                      {generateMutation.data.statute.responseDays && (
                        <p className="text-sm mt-2">
                          Response Time: {generateMutation.data.statute.responseDays} days
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-payment-summary">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Payment Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">FOIA Request Service</span>
                    <span className="font-semibold">{formatCurrency(FOIA_REQUEST_PRICING_CENTS)}</span>
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span>Total</span>
                      <span>{formatCurrency(FOIA_REQUEST_PRICING_CENTS)}</span>
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-900 dark:text-blue-100">
                      <CheckCircle2 className="h-4 w-4 inline mr-2" />
                      After payment, you'll receive the complete FOIA letter via email. BadBlue will send it via certified mail and email you the tracking number.
                    </p>
                  </div>

                  <Button
                    onClick={handleConfirmAndPay}
                    disabled={submitMutation.isPending}
                    className="w-full"
                    size="lg"
                    data-testid="button-confirm-payment"
                  >
                    {submitMutation.isPending ? "Processing..." : `Pay ${formatCurrency(FOIA_REQUEST_PRICING_CENTS)} & Submit Request`}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/foia-request-form" />
    </div>
  );
}