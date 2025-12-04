import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Shield, FileText, DollarSign, CheckCircle2, ArrowLeft, Upload, Image, Video, File, X, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClientSession } from "@/contexts/ClientSessionContext";
import { apiRequest } from "@/lib/queryClient";
import { COMPLAINT_PRICING } from "@shared/schema";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";
import { FormAssistant } from "@/components/FormAssistant";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

// Component for rendering the actual complaint document preview from backend
function ComplaintDocumentPreview({
  state,
  complaintType,
  officerName,
  badgeNumber,
  department,
  description,
  incidentDate,
  city,
  county
}: {
  state: string;
  complaintType: string;
  officerName: string;
  badgeNumber: string;
  department: string;
  description: string;
  incidentDate: string;
  city: string;
  county: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/preview-complaint', state, complaintType, officerName, badgeNumber, department, description, incidentDate, city, county],
    queryFn: async () => {
      const response = await fetch('/api/preview-complaint', {
        method: 'POST',
        body: JSON.stringify({
          state,
          complaintType,
          officerName,
          officerBadge: badgeNumber,
          department,
          description,
          incidentDate,
          city,
          county
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error('Failed to generate preview');
      }
      return response.json();
    },
    enabled: !!(state && complaintType && officerName && department && description && incidentDate && city),
  });

  return (
    <div className="mt-6 pt-6 border-t">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Generated Complaint Document Preview
      </h3>
      
      {isLoading && (
        <div className="bg-background rounded-md border p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Generating preview...</span>
        </div>
      )}
      
      {error && (
        <div className="bg-background rounded-md border p-4">
          <p className="text-sm text-destructive">Failed to generate preview. Please check all required fields are filled.</p>
        </div>
      )}
      
      {data && (
        <>
          <div className="bg-background rounded-md border p-4 max-h-96 overflow-y-auto select-none" style={{userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none'}}>
            <pre className="text-xs whitespace-pre-wrap font-mono" data-testid="preview-document-template">
              {data.document}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            This is an exact preview of the complaint document that will be generated after payment.
          </p>
        </>
      )}
    </div>
  );
}

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

export default function ComplaintForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { sessionData, hydrateFromUrl } = useClientSession();
  
  usePageFaqSchema();
  
  // AI-collected form data
  const [officerName, setOfficerName] = useState("");
  const [badgeNumber, setBadgeNumber] = useState("");
  const [department, setDepartment] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [complaintType, setComplaintType] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<Array<{ url: string; name: string }>>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [readyToSubmit, setReadyToSubmit] = useState(false);

  // Require login to access this page
  if (!user) {
    window.location.href = "/api/login";
    return null;
  }

  // DEPRECATED: Access check removed - Officer search and legal consultation are now FREE for all signed-in users
  // The complaint filing itself still requires a separate payment ($39.75), but access to the platform is free
  const { data: userData } = useQuery({
    queryKey: ['/api/user'],
    queryFn: async () => {
      const response = await fetch('/api/user');
      if (!response.ok) throw new Error('Failed to fetch user data');
      return response.json();
    }
  });

  // DEPRECATED: Payment redirect removed - All signed-in users have full access
  // Note: Complaint filing still requires payment, but platform access is free

  // Hydrate from URL params first (for shareable links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.toString()) {
      hydrateFromUrl(params);
    }
  }, []);

  // Auto-fill from ClientSession data on component mount
  useEffect(() => {
    if (sessionData.officerName) setOfficerName(sessionData.officerName);
    if (sessionData.badgeNumber) setBadgeNumber(sessionData.badgeNumber);
    if (sessionData.department) setDepartment(sessionData.department);
    if (sessionData.state) setState(sessionData.state);
    if (sessionData.city) setCity(sessionData.city);
    if (sessionData.county) setCounty(sessionData.county);
    if (sessionData.incidentDate) setIncidentDate(sessionData.incidentDate);
    if (sessionData.incidentDescription) setDescription(sessionData.incidentDescription);
  }, [sessionData]);

  // Auto-fill from LegalAI Consultation data (if available)
  useEffect(() => {
    const prefillData = localStorage.getItem("prefillData");
    if (prefillData) {
      try {
        const data = JSON.parse(prefillData);
        console.log("[ComplaintForm] Loading prefill data from LegalAI Consultation:", data);
        
        // Map backend field names to form field names
        // Only set if field is empty (don't overwrite existing data)
        if (!officerName && data.officerName) setOfficerName(data.officerName);
        if (!badgeNumber && data.officerBadge) setBadgeNumber(data.officerBadge);
        if (!department && data.officerDepartment) setDepartment(data.officerDepartment);
        if (!state && data.state) setState(data.state);
        if (!city && data.city) setCity(data.city);
        if (!county && data.county) setCounty(data.county);
        if (!incidentDate && data.incidentDate) setIncidentDate(data.incidentDate);
        if (!description && data.incidentDescription) setDescription(data.incidentDescription);
        if (!complaintType && data.complaintType) setComplaintType(data.complaintType);
        
        // Clear the prefill data after using it
        localStorage.removeItem("prefillData");
        
        toast({
          title: "Information Loaded",
          description: "Your details from the LegalAI Consultation have been automatically filled in.",
        });
      } catch (error) {
        console.error("[ComplaintForm] Failed to parse prefill data:", error);
      }
    }
  }, []);

  // Handle AI-suggested fields from FormAssistant
  const handleAISuggestedFields = (fields: any) => {
    console.log("[ComplaintForm] Received AI-suggested fields:", fields);
    
    if (fields.officerName) setOfficerName(fields.officerName);
    if (fields.badgeNumber) setBadgeNumber(fields.badgeNumber);
    if (fields.department) setDepartment(fields.department);
    if (fields.state) setState(fields.state);
    if (fields.city) setCity(fields.city);
    if (fields.county) setCounty(fields.county);
    if (fields.complaintType) setComplaintType(fields.complaintType);
    if (fields.description) setDescription(fields.description);
    if (fields.incidentDate) setIncidentDate(fields.incidentDate);
    
    // Check if all required fields are filled to enable preview
    const hasAllRequired = fields.officerName && fields.state && fields.city && 
                          fields.complaintType && fields.description && fields.incidentDate;
    
    if (hasAllRequired) {
      toast({
        title: "Form Ready!",
        description: "All required information has been collected. Review your complaint below.",
      });
    }
  };

  const submitMutation = useMutation({
    mutationFn: async (complaintData: any) => {
      // First, create the complaint in the database
      const response = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(complaintData),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || "Connection issue");
      }
      
      const data = await response.json();
      
      // Then create the payment session for the complaint
      const paymentResponse = await fetch("/api/create-complaint-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complaintId: data.complaintId }),
      });
      
      if (!paymentResponse.ok) {
        const errorData = await paymentResponse.json();
        throw new Error(errorData.error || errorData.message || "Payment processing issue");
      }
      
      return await paymentResponse.json();
    },
    onSuccess: (data) => {
      if (data.sessionUrl) {
        // Redirect to Stripe checkout
        window.location.href = data.sessionUrl;
      } else {
        toast({
          title: "Processing Error",
          description: "We couldn't process your payment. Please try again or contact support",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      console.error("Submission error:", error);
      
      // Provide user-friendly error messages based on error type
      let errorMessage = "We couldn't submit your complaint. Please check your information and try again";
      
      if (error.message?.toLowerCase().includes('payment') || 
          error.message?.toLowerCase().includes('stripe')) {
        errorMessage = "Payment could not be processed. Please check your card details and try again";
      } else if (error.message?.toLowerCase().includes('network') || 
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
        title: "Unable to Submit Complaint",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleConfirmAndPay = () => {
    if (!officerName || !state || !city || !complaintType || !description || !incidentDate) {
      toast({
        title: "Required Fields Missing",
        description: "Please complete all required fields before continuing",
        variant: "destructive",
      });
      return;
    }
    
    submitMutation.mutate({
      officerName,
      officerBadge: badgeNumber || null,
      officerDepartment: department || "",
      state,
      city,
      county,
      complaintType,
      description,
      incidentDate,
      evidenceUrls: evidenceFiles.map(f => f.url),
    });
  };

  // Check if form is complete
  const isFormComplete = !!(officerName && state && city && complaintType && description && incidentDate);

  // Preview Mode
  if (showPreview) {
    const complaintTypeName = complaintType.charAt(0).toUpperCase() + complaintType.slice(1).replace('-', ' ');
    const stateName = US_STATES.find(s => s.code === state)?.name || state;
    
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary" />
              <span className="font-semibold text-lg">BadBlue</span>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-12">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Review Your Complaint</h1>
            <p className="text-muted-foreground">
              Please review all information carefully before proceeding to payment.
            </p>
          </div>

          <div className="space-y-6">
            {/* Officer Information */}
            <Card>
              <CardHeader>
                <CardTitle>Officer Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Officer Name</p>
                    <p className="font-medium" data-testid="preview-officer-name">{officerName}</p>
                  </div>
                  {badgeNumber && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Badge Number</p>
                      <p className="font-medium">{badgeNumber}</p>
                    </div>
                  )}
                  {department && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Department</p>
                      <p className="font-medium">{department}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Incident Details */}
            <Card>
              <CardHeader>
                <CardTitle>Incident Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">State</p>
                    <p className="font-medium">{stateName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">City</p>
                    <p className="font-medium">{city}</p>
                  </div>
                  {county && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">County</p>
                      <p className="font-medium">{county}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Complaint Type</p>
                    <p className="font-medium">{complaintTypeName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Incident Date</p>
                    <p className="font-medium">{incidentDate}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Description</p>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{description}</p>
                </div>
              </CardContent>
            </Card>

            {/* Evidence Files */}
            {evidenceFiles.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Evidence Files ({evidenceFiles.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {evidenceFiles.map((file, index) => (
                      <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{file.name}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Document Preview */}
            <Card>
              <CardHeader>
                <CardTitle>Document Preview</CardTitle>
                <CardDescription>Preview of the formal complaint document that will be submitted</CardDescription>
              </CardHeader>
              <CardContent>
                <ComplaintDocumentPreview
                  state={state}
                  complaintType={complaintType}
                  officerName={officerName}
                  badgeNumber={badgeNumber}
                  department={department}
                  description={description}
                  incidentDate={incidentDate}
                  city={city}
                  county={county}
                />
              </CardContent>
            </Card>

            {/* Payment Summary */}
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Payment Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between py-4 mb-4 border-b">
                  <div>
                    <p className="font-medium">Police Complaint Filing Fee</p>
                    <p className="text-sm text-muted-foreground">Service payment</p>
                  </div>
                  <div className="text-2xl font-bold">${COMPLAINT_PRICING.toFixed(2)}</div>
                </div>
                <p className="text-sm text-muted-foreground">
                  By proceeding, you agree to file this complaint and authorize payment of ${COMPLAINT_PRICING.toFixed(2)} for document generation and processing. Your complaint will be automatically routed to the appropriate authority.
                </p>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setShowPreview(false)}
                data-testid="button-back-edit"
              >
                Back to Edit
              </Button>
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={handleConfirmAndPay}
                disabled={submitMutation.isPending}
                data-testid="button-confirm-pay"
              >
                {submitMutation.isPending ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Confirm & Pay ${COMPLAINT_PRICING.toFixed(2)}
                  </>
                )}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const complaintFilingSchema = {
    "@context": "https://schema.org",
    "@type": "LegalService",
    "name": "Police Misconduct Complaint Filing Service",
    "description": "File formal police misconduct complaints online with automated routing to Internal Affairs, oversight boards, and command staff. Professional document generation for excessive force, false arrest, and civil rights violations.",
    "provider": {
      "@type": "Organization",
      "name": "BadBlue"
    },
    "serviceType": "Police Misconduct Complaint Filing",
    "areaServed": {
      "@type": "Country",
      "name": "United States"
    }
  };

  const breadcrumbs = [
    { name: "File Complaint", url: "https://example.com/complaints/new" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — File Misconduct Complaints Online"
        description="Generate professional police misconduct complaints with automatic routing to Internal Affairs, oversight boards, and command staff. Affordable alternative to attorneys, submit complaints online without leaving home."
        keywords="file police complaint online, file officer complaint online, police misconduct complaint form, officer misconduct grievance form, report police brutality, report officer assault, file complaint against police officer, file grievance against officer, excessive force police complaint, excessive force officer grievance, police harassment complaint, officer harassment grievance, false arrest police complaint, wrongful arrest officer complaint, police discrimination report, officer discrimination complaint, internal affairs complaint police, internal affairs grievance officer, file complaint police department, file grievance officer department, civilian complaint review board police, civilian complaint officer, report law enforcement misconduct, report officer misconduct, police accountability complaint, officer accountability grievance, police brutality complaint online, officer brutality grievance online, police assault complaint form, officer assault complaint form, police violence complaint, officer violence grievance, department misconduct complaint, department brutality grievance, complaint police excessive force, complaint officer assault, grievance police harassment, grievance officer discrimination, police complaint process online, officer grievance process online, submit police complaint online, submit officer grievance online, file formal police complaint, file formal officer grievance, police misconduct documentation, officer misconduct evidence, complaint against police online, complaint against officer online, police brutality report online, officer assault report online, police harassment grievance, officer harassment complaint, false arrest police report, wrongful detention officer complaint, police rights violation complaint, officer constitutional violation grievance, police abuse complaint online, officer abuse grievance online, police corruption complaint, officer corruption grievance, department accountability complaint, department misconduct grievance, how to file police complaint, how to file officer grievance, how to report police brutality, how to report officer assault, how to complain about police, how to complain about officer, police complaint help online, officer grievance help online, assistance filing police complaint, assistance filing officer grievance, guidance police complaint process, guidance officer grievance process, police complaint legal help, officer grievance legal advice, police misconduct complaint assistance, officer misconduct grievance support, file police brutality complaint, file officer assault grievance, submit police harassment complaint, submit officer discrimination grievance, police excessive force complaint form, officer assault complaint form online, police department complaint online, officer department grievance online"
        ogTitle="File Police Misconduct Complaint Online | BadBlue"
        ogDescription="Report police brutality, excessive force, and civil rights violations. File formal complaints with automated routing to proper authorities."
        canonicalUrl="https://example.com/complaints/new"
        structuredData={complaintFilingSchema}
        breadcrumbs={breadcrumbs}
        pageType="service"
      />
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.history.back()}
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              onClick={() => window.location.href = "/api/logout"}
              data-testid="button-logout"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <PageBreadcrumbs currentPageName="File Complaint" />
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">File a Complaint</h1>
          <p className="text-muted-foreground">
            Use the AI assistant below to provide all necessary information. The AI will ask comprehensive legal questions and guide you through the process.
          </p>
        </div>

        {/* AI-Assisted Formatting Alert */}
        <Alert className="mb-6 border-primary/20 bg-primary/5">
          <Sparkles className="h-5 w-5 text-primary" />
          <AlertTitle className="text-base font-semibold">AI-Assisted Professional Formatting</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              <strong>Claude 3.5 Sonnet</strong> formats complaints professionally with proper legal language 
              and structure used by civil rights attorneys.
            </p>
            <p>
              <strong>DeepSeek R1T2 Chimera</strong> analyzes 100,000+ successful complaint patterns to ensure 
              your complaint follows best practices for maximum impact.
            </p>
          </AlertDescription>
        </Alert>

        {/* AI Form Assistant - PRIMARY AND ONLY INTERFACE */}
        <div className="mb-6">
          <FormAssistant
            formType="complaint"
            userContext={{
              officerName: sessionData.officerName,
              badgeNumber: sessionData.badgeNumber,
              department: sessionData.department,
              state: sessionData.state,
              city: sessionData.city,
              county: sessionData.county,
              incidentDate: sessionData.incidentDate,
              incidentDescription: sessionData.incidentDescription,
              violationType: sessionData.violationType,
              damagesAmount: sessionData.damagesAmount,
              badgeAnalysisData: sessionData.badgeAnalysisData,
              legalConsultationData: sessionData.legalConsultationData,
            }}
            currentFormData={{
              officerName,
              badgeNumber,
              department,
              state,
              city,
              county,
              complaintType,
              description,
              incidentDate
            }}
            onFieldsSuggested={handleAISuggestedFields}
            onReadyToSubmit={setReadyToSubmit}
          />
        </div>

        {/* Read-Only Review Section - Only shows when AI has collected data */}
        {isFormComplete && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Information Collected</CardTitle>
              <CardDescription>
                The AI has gathered the following information from your conversation. Review it carefully.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Form Fields Preview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Officer Name</Label>
                  <p className="font-medium" data-testid="preview-officer-name">{officerName}</p>
                </div>
                {badgeNumber && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Badge Number</Label>
                    <p className="font-medium" data-testid="preview-badge-number">{badgeNumber}</p>
                  </div>
                )}
                {department && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Department</Label>
                    <p className="font-medium" data-testid="preview-department">{department}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">State</Label>
                  <p className="font-medium" data-testid="preview-state">
                    {US_STATES.find(s => s.code === state)?.name || state}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">City</Label>
                  <p className="font-medium" data-testid="preview-city">{city}</p>
                </div>
                {county && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">County</Label>
                    <p className="font-medium" data-testid="preview-county">{county}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Complaint Type</Label>
                  <p className="font-medium" data-testid="preview-complaint-type">
                    {complaintType.charAt(0).toUpperCase() + complaintType.slice(1).replace('-', ' ')}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Incident Date</Label>
                  <p className="font-medium" data-testid="preview-incident-date">{incidentDate}</p>
                </div>
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md" data-testid="preview-description">
                  {description}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Evidence Upload Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Evidence Files (Optional)</CardTitle>
            <CardDescription>
              Attach photos, videos, or documents that support your complaint
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Uploaded Files List */}
            {evidenceFiles.length > 0 && (
              <div className="space-y-2 mb-3">
                {evidenceFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-md border bg-muted/50"
                    data-testid={`evidence-file-${index}`}
                  >
                    <div className="flex items-center gap-2">
                      {file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <Image className="w-4 h-4 text-blue-500" />
                      ) : file.name.match(/\.(mp4|mov|avi|wmv)$/i) ? (
                        <Video className="w-4 h-4 text-purple-500" />
                      ) : (
                        <File className="w-4 h-4 text-gray-500" />
                      )}
                      <span className="text-sm font-medium">{file.name}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEvidenceFiles(prev => prev.filter((_, i) => i !== index));
                        toast({
                          title: "File Removed",
                          description: "Evidence file removed from upload list",
                        });
                      }}
                      data-testid={`button-remove-evidence-${index}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload Button */}
            <ObjectUploader
              maxNumberOfFiles={10}
              maxFileSize={10485760}
              onGetUploadParameters={async () => {
                const response = await apiRequest("/api/objects/upload", "POST", {});
                const data = await response.json();
                return {
                  method: "PUT" as const,
                  url: data.uploadURL,
                };
              }}
              onComplete={async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
                if (!result.successful || result.successful.length === 0) {
                  return;
                }
                
                for (const file of result.successful) {
                  const uploadURL = file.uploadURL;
                  const fileName = file.name || 'Untitled';
                  
                  const aclResponse = await apiRequest("/api/evidence-files", "PUT", {
                    fileURL: uploadURL,
                  });
                  const aclData = await aclResponse.json();
                  
                  setEvidenceFiles(prev => [...prev, {
                    url: String(aclData.objectPath),
                    name: String(fileName),
                  }]);
                }
                
                toast({
                  title: "Files Uploaded",
                  description: `${result.successful.length} file(s) uploaded successfully`,
                });
              }}
              variant="outline"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Evidence
            </ObjectUploader>
            <p className="text-xs text-muted-foreground mt-2">
              Supported: Images, videos, PDFs, documents (10MB max per file)
            </p>
          </CardContent>
        </Card>

        {/* Submit Button - Appears when AI confirms information is complete */}
        {(readyToSubmit || isFormComplete) && (
          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={() => setShowPreview(true)}
              data-testid="button-submit"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Submit
            </Button>
          </div>
        )}
      </main>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/complaint-form" />
    </div>
  );
}
