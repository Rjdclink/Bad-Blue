import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Shield, Scale, DollarSign, CheckCircle2, FileText, ArrowLeft, Upload, Image, Video, File, X, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClientSession } from "@/contexts/ClientSessionContext";
import { apiRequest } from "@/lib/queryClient";
import { LAWSUIT_DIY_PRICING, LAWSUIT_FULL_SERVICE_PRICING } from "@shared/schema";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";
import { FormAssistant } from "@/components/FormAssistant";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

// Component for rendering the actual lawsuit document preview from backend
function LawsuitDocumentPreview({
  state,
  lawsuitType,
  officerName,
  badgeNumber,
  department,
  description,
  incidentDate,
  incidentTime,
  city,
  county,
  damagesAmount,
  plaintiffName,
  plaintiffAddress,
  injuryDetails,
  subsequentEvents,
  witnessNames
}: {
  state: string;
  lawsuitType: string;
  officerName: string;
  badgeNumber: string;
  department: string;
  description: string;
  incidentDate: string;
  incidentTime?: string;
  city: string;
  county: string;
  damagesAmount: string;
  plaintiffName?: string;
  plaintiffAddress?: string;
  injuryDetails?: string;
  subsequentEvents?: string;
  witnessNames?: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/preview-lawsuit', state, lawsuitType, officerName, badgeNumber, department, description, incidentDate, incidentTime, city, county, damagesAmount, plaintiffName, plaintiffAddress, injuryDetails, subsequentEvents, witnessNames],
    queryFn: async () => {
      // Convert witnessNames string to array (same logic as submission)
      const witnessNamesArray = witnessNames
        ? witnessNames.split(',').map(name => name.trim()).filter(name => name.length > 0)
        : null;
      
      const response = await fetch('/api/preview-lawsuit', {
        method: 'POST',
        body: JSON.stringify({
          state,
          lawsuitType,
          officerName,
          officerBadge: badgeNumber,
          department,
          description,
          incidentDate,
          incidentTime,
          city,
          county,
          damagesAmount,
          plaintiffName,
          plaintiffAddress,
          injuryDetails,
          subsequentEvents,
          witnessNames: witnessNamesArray
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error('Failed to generate preview');
      }
      return response.json();
    },
    enabled: !!(state && lawsuitType && officerName && department && description && incidentDate && city),
  });

  return (
    <div className="mt-6 pt-6 border-t">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Generated Lawsuit Document Preview
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
            This is an exact preview of the lawsuit document that will be generated after payment. The final document may include additional AI-researched state-specific forms and local rules if available.
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

export default function LawsuitForm() {
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
  const [lawsuitType, setLawsuitType] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentTime, setIncidentTime] = useState(""); // NEW: Time of incident
  const [damagesAmount, setDamagesAmount] = useState("");
  const [plaintiffName, setPlaintiffName] = useState(""); // NEW: Plaintiff's name
  const [plaintiffAddress, setPlaintiffAddress] = useState(""); // NEW: Plaintiff's address
  const [returnMailingAddress, setReturnMailingAddress] = useState(""); // Physical mailing address for full-service returns
  const [injuryDetails, setInjuryDetails] = useState(""); // NEW: List of injuries
  const [subsequentEvents, setSubsequentEvents] = useState(""); // NEW: What happened after
  const [witnessNames, setWitnessNames] = useState(""); // NEW: Witness names
  const [evidenceFiles, setEvidenceFiles] = useState<Array<{ url: string; name: string }>>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [lawsuitTier, setLawsuitTier] = useState<'diy' | 'full-service'>('diy'); // Tier from URL
  const [serviceDisclaimerAccepted, setServiceDisclaimerAccepted] = useState(false); // BadBlue service disclaimer

  // Require login to access this page
  if (!user) {
    window.location.href = "/api/login";
    return null;
  }

  // Hydrate from URL params first (for shareable links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    // Get tier from URL
    const tier = params.get('tier');
    if (tier === 'full' || tier === 'full-service') {
      setLawsuitTier('full-service');
    } else {
      setLawsuitTier('diy');
    }
    
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
    if (sessionData.damagesAmount) setDamagesAmount(sessionData.damagesAmount);
  }, [sessionData]);

  // Auto-fill plaintiff name from user profile
  useEffect(() => {
    if (user && user.firstName && user.lastName && !plaintiffName) {
      setPlaintiffName(`${user.firstName} ${user.lastName}`);
    }
  }, [user]);

  // Auto-fill from LegalAI Consultation data (if available)
  useEffect(() => {
    const prefillData = localStorage.getItem("prefillData");
    if (prefillData) {
      try {
        const data = JSON.parse(prefillData);
        console.log("[LawsuitForm] Loading prefill data from LegalAI Consultation:", data);
        
        // Map backend field names to form field names
        // Only set if field is empty (don't overwrite existing data)
        if (!officerName && data.officerName) setOfficerName(data.officerName);
        if (!badgeNumber && data.officerBadge) setBadgeNumber(data.officerBadge);
        if (!department && data.officerDepartment) setDepartment(data.officerDepartment);
        if (!state && data.state) setState(data.state);
        if (!city && data.city) setCity(data.city);
        if (!county && data.county) setCounty(data.county);
        if (!incidentDate && data.incidentDate) setIncidentDate(data.incidentDate);
        if (!incidentTime && data.incidentTime) setIncidentTime(data.incidentTime); // NEW
        if (!description && data.description) setDescription(data.description);
        if (!lawsuitType && data.lawsuitType) setLawsuitType(data.lawsuitType);
        if (!damagesAmount && data.damagesEstimate) setDamagesAmount(data.damagesEstimate.toString()); // NEW: use damagesEstimate
        if (!injuryDetails && data.injuryDetails) setInjuryDetails(data.injuryDetails); // NEW
        if (!witnessNames && data.witnessNames) setWitnessNames(data.witnessNames.join(', ')); // NEW: join array
        
        // Clear the prefill data after using it
        localStorage.removeItem("prefillData");
        
        toast({
          title: "Information Loaded",
          description: "Your details from the LegalAI Consultation have been automatically filled in.",
        });
      } catch (error) {
        console.error("[LawsuitForm] Failed to parse prefill data:", error);
      }
    }
  }, []);

  // Handle AI-suggested fields from FormAssistant
  const handleAISuggestedFields = (fields: any) => {
    console.log("[LawsuitForm] Received AI-suggested fields:", fields);
    
    if (fields.officerName) setOfficerName(fields.officerName);
    if (fields.badgeNumber) setBadgeNumber(fields.badgeNumber);
    if (fields.department) setDepartment(fields.department);
    if (fields.state) setState(fields.state);
    if (fields.city) setCity(fields.city);
    if (fields.county) setCounty(fields.county);
    if (fields.lawsuitType) setLawsuitType(fields.lawsuitType);
    if (fields.description) setDescription(fields.description);
    if (fields.incidentDate) setIncidentDate(fields.incidentDate);
    if (fields.incidentTime) setIncidentTime(fields.incidentTime);
    if (fields.damagesAmount) setDamagesAmount(fields.damagesAmount);
    if (fields.plaintiffName) setPlaintiffName(fields.plaintiffName);
    if (fields.plaintiffAddress) setPlaintiffAddress(fields.plaintiffAddress);
    if (fields.injuryDetails) setInjuryDetails(fields.injuryDetails);
    if (fields.subsequentEvents) setSubsequentEvents(fields.subsequentEvents);
    if (fields.witnessNames) setWitnessNames(fields.witnessNames);
    
    // Check if all required fields are filled to enable preview
    const hasAllRequired = fields.officerName && fields.state && fields.city && 
                          fields.lawsuitType && fields.description && fields.incidentDate &&
                          fields.damagesAmount && fields.plaintiffName;
    
    if (hasAllRequired) {
      toast({
        title: "Form Ready!",
        description: "All required information has been collected. Review your lawsuit below.",
      });
    }
  };

  const submitMutation = useMutation({
    mutationFn: async (lawsuitData: any) => {
      const response = await fetch("/api/lawsuits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lawsuitData),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || "Connection issue");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        toast({
          title: "Success!",
          description: "Lawsuit submitted. You will receive an email confirmation after payment is processed.",
        });
      }
    },
    onError: (error: any) => {
      console.error("Submission error:", error);
      
      // Provide user-friendly error messages based on error type
      let errorMessage = "We couldn't submit your lawsuit. Please check your information and try again";
      
      if (error.message?.toLowerCase().includes('payment') || 
          error.message?.toLowerCase().includes('square')) {
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
        title: "Unable to File Lawsuit",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleConfirmAndPay = () => {
    // Validate service disclaimer is accepted
    if (!serviceDisclaimerAccepted) {
      toast({
        title: "Action Required",
        description: "Please review and accept the service disclaimer before continuing",
        variant: "destructive",
      });
      return;
    }

    // Convert witnessNames string to array
    const witnessNamesArray = witnessNames
      ? witnessNames.split(',').map(name => name.trim()).filter(name => name.length > 0)
      : null;
    
    submitMutation.mutate({
      officerName,
      officerBadge: badgeNumber || null,
      officerDepartment: department || "",
      state,
      city,
      county,
      lawsuitType,
      lawsuitTier,
      description,
      incidentDate,
      incidentTime: incidentTime || null,
      damagesAmount,
      plaintiffName: plaintiffName || null,
      plaintiffAddress: plaintiffAddress || null,
      returnMailingAddress: returnMailingAddress || null,
      injuryDetails: injuryDetails || null,
      subsequentEvents: subsequentEvents || null,
      witnessNames: witnessNamesArray,
      evidenceUrls: evidenceFiles.map(f => f.url),
    });
  };

  // Check if form is complete (including returnMailingAddress for full-service)
  const isFormComplete = !!(
    officerName && 
    state && 
    city && 
    lawsuitType && 
    description && 
    incidentDate && 
    damagesAmount &&
    (lawsuitTier === 'diy' || (lawsuitTier === 'full-service' && returnMailingAddress))
  );

  // Refinement mode - AI helps fill missing information
  const [showRefinement, setShowRefinement] = useState(false);
  const [refinedDocument, setRefinedDocument] = useState("");

  // Preview Mode
  if (showPreview) {
    const lawsuitTypeName = lawsuitType.charAt(0).toUpperCase() + lawsuitType.slice(1).replace('-', ' ');
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
            <h1 className="text-3xl font-bold mb-2">Review Your Lawsuit</h1>
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
                <CardTitle>Lawsuit Details</CardTitle>
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
                    <p className="text-sm font-medium text-muted-foreground">Lawsuit Type</p>
                    <p className="font-medium">{lawsuitTypeName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Incident Date</p>
                    <p className="font-medium">{incidentDate}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Damages Amount</p>
                    <p className="font-medium">${parseFloat(damagesAmount).toLocaleString()}</p>
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
                <CardDescription>Preview of the formal lawsuit document that will be filed</CardDescription>
              </CardHeader>
              <CardContent>
                <LawsuitDocumentPreview
                  state={state}
                  lawsuitType={lawsuitType}
                  officerName={officerName}
                  badgeNumber={badgeNumber}
                  department={department}
                  description={description}
                  incidentDate={incidentDate}
                  incidentTime={incidentTime}
                  city={city}
                  county={county}
                  damagesAmount={damagesAmount}
                  plaintiffName={plaintiffName}
                  plaintiffAddress={plaintiffAddress}
                  injuryDetails={injuryDetails}
                  subsequentEvents={subsequentEvents}
                  witnessNames={witnessNames}
                />
                
                {!showRefinement && (
                  <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
                    <p className="text-sm text-blue-900 dark:text-blue-100 mb-3">
                      <strong>Need to fill in missing details?</strong> Our AI can help you complete any placeholder text or missing information in your lawsuit.
                    </p>
                    <Button 
                      onClick={() => setShowRefinement(true)}
                      variant="outline"
                      className="w-full"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Refine Lawsuit with AI
                    </Button>
                  </div>
                )}
                
                {showRefinement && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      AI Lawsuit Refinement Assistant
                    </h4>
                    <FormAssistant
                      formType="lawsuit"
                      userContext={{
                        officerName,
                        badgeNumber,
                        department,
                        state,
                        city,
                        county,
                        incidentDate,
                        incidentTime,
                        incidentDescription: description,
                        damagesAmount,
                      }}
                      currentFormData={{
                        officerName,
                        badgeNumber,
                        department,
                        state,
                        city,
                        county,
                        lawsuitType,
                        description,
                        incidentDate,
                        incidentTime,
                        damagesAmount,
                        plaintiffName,
                        plaintiffAddress,
                        injuryDetails,
                        subsequentEvents,
                        witnessNames
                      }}
                      onFieldsSuggested={(fields) => {
                        // Update fields with refined data
                        if (fields.officerName) setOfficerName(fields.officerName);
                        if (fields.plaintiffName) setPlaintiffName(fields.plaintiffName);
                        if (fields.plaintiffAddress) setPlaintiffAddress(fields.plaintiffAddress);
                        if (fields.description) setDescription(fields.description);
                        if (fields.injuryDetails) setInjuryDetails(fields.injuryDetails);
                        if (fields.subsequentEvents) setSubsequentEvents(fields.subsequentEvents);
                        if (fields.witnessNames) setWitnessNames(fields.witnessNames);
                        if (fields.damagesAmount) setDamagesAmount(fields.damagesAmount);
                      }}
                      onReadyToSubmit={() => setShowRefinement(false)}
                      refinementMode={true}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Return Mailing Address - Full Service Only */}
            {lawsuitTier === 'full-service' && (
              <Card className="border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                    <FileText className="w-5 h-5" />
                    Return Mailing Address Required
                  </CardTitle>
                  <CardDescription>
                    Because BadBlue will be physically filing your lawsuit with the court on your behalf, we need your physical mailing address. This address will be used as the return address for any court correspondence regarding your case.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="returnMailingAddress" className="font-medium">
                      Your Physical Mailing Address <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="returnMailingAddress"
                      placeholder="123 Main Street&#10;Apt 4B&#10;City, State ZIP"
                      value={returnMailingAddress}
                      onChange={(e) => setReturnMailingAddress(e.target.value)}
                      rows={4}
                      required
                      data-testid="input-return-mailing-address"
                      className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                      Include street address, apartment/suite number (if applicable), city, state, and ZIP code.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

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
                    <p className="font-medium">
                      {lawsuitTier === 'full-service' ? 'Full-Service' : 'DIY'} Lawsuit Filing Fee
                    </p>
                    <p className="text-sm text-muted-foreground">Service payment</p>
                  </div>
                  <div className="text-2xl font-bold">
                    ${lawsuitTier === 'full-service' ? LAWSUIT_FULL_SERVICE_PRICING.toFixed(2) : LAWSUIT_DIY_PRICING.toFixed(2)}
                  </div>
                </div>
                
                {/* Full-Service Disclaimer */}
                {lawsuitTier === 'full-service' && (
                  <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-amber-800 dark:text-amber-200">
                        <p className="font-semibold mb-1">Additional Costs Notice</p>
                        <p>Filing fee and official service costs not included. Depending on your jurisdiction, additional fees may apply for court filing and service of process via U.S. Marshal or private process server.</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <p className="text-sm text-muted-foreground">
                  By proceeding, you agree to file this lawsuit and authorize payment of ${lawsuitTier === 'full-service' ? LAWSUIT_FULL_SERVICE_PRICING.toFixed(2) : LAWSUIT_DIY_PRICING.toFixed(2)} for document generation and legal processing.
                </p>
              </CardContent>
            </Card>

            {/* BadBlue Service Disclaimer */}
            <Card className="border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950">
              <CardHeader>
                <CardTitle className="text-blue-900 dark:text-blue-100">Service Disclaimer</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="service-disclaimer-checkbox"
                    checked={serviceDisclaimerAccepted}
                    onCheckedChange={(checked) => setServiceDisclaimerAccepted(checked as boolean)}
                    data-testid="checkbox-service-disclaimer"
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label htmlFor="service-disclaimer-checkbox" className="text-sm leading-relaxed cursor-pointer text-blue-800 dark:text-blue-200">
                      <span className="font-semibold">Required Acknowledgment:</span>{" "}
                      I acknowledge that BadBlue is a document-coordination service for self-represented litigants and is not a law firm. BadBlue does not provide legal advice or representation. I understand that I am representing myself in this legal matter and should consult with a qualified attorney for legal advice specific to my situation.
                    </label>
                  </div>
                </div>
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
                disabled={submitMutation.isPending || !serviceDisclaimerAccepted}
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
                    Confirm & Pay ${lawsuitTier === 'full-service' ? LAWSUIT_FULL_SERVICE_PRICING.toFixed(2) : LAWSUIT_DIY_PRICING.toFixed(2)}
                  </>
                )}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "LegalService",
    "name": "BadBlue Civil Rights Lawsuit Filing",
    "description": "File Section 1983 civil rights lawsuits online with state-specific legal templates",
    "serviceType": "Civil Rights Lawsuit Filing",
    "provider": {
      "@type": "Organization",
      "name": "BadBlue"
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — 42 USC §1983 Civil Rights Lawsuit Generator"
        description="Create U.S. District Court-compliant civil rights lawsuits for police violations. Remote filing, cheaper than attorney consultation. Generate complaint, summons, and civil cover sheet online."
        keywords="file civil rights lawsuit, file police lawsuit, file officer lawsuit, 42 USC 1983 lawsuit police, Section 1983 claim officer, civil rights lawsuit police, civil rights lawsuit officer, police brutality lawsuit, officer brutality lawsuit, excessive force lawsuit police, excessive force lawsuit officer, false arrest lawsuit police, wrongful arrest lawsuit officer, constitutional rights violation lawsuit police, constitutional violation lawsuit officer, police misconduct lawsuit, officer misconduct lawsuit, civil rights lawsuit online police, civil rights lawsuit online officer, police assault lawsuit, officer assault lawsuit, police violence lawsuit, officer violence lawsuit, department lawsuit, department civil rights lawsuit, how to file 1983 claim police, how to file 1983 claim officer, Bivens claim police, Bivens claim officer, qualified immunity lawsuit police, qualified immunity lawsuit officer, file lawsuit against police, file lawsuit against officer, sue police officer, sue police department, lawsuit police brutality, lawsuit officer assault, lawsuit police excessive force, lawsuit officer misconduct, legal documents police lawsuit, legal documents officer lawsuit, police lawsuit filing, officer lawsuit filing online, department lawsuit filing, civil rights attorney police, civil rights attorney officer, police brutality lawyer alternative, officer assault lawyer alternative, lawsuit police harassment, lawsuit officer discrimination, lawsuit false arrest police, lawsuit wrongful detention officer, constitutional violation lawsuit police, rights violation lawsuit officer, police civil rights lawsuit online, officer civil rights lawsuit online, file lawsuit police misconduct, file lawsuit officer brutality, sue police for assault, sue officer for excessive force, police lawsuit legal help, officer lawsuit legal advice, lawsuit against police department, lawsuit against officer department, police brutality lawsuit online, officer assault lawsuit online, civil lawsuit police, civil lawsuit officer, federal lawsuit police, federal lawsuit officer, police misconduct legal action, officer misconduct legal action, lawsuit police violence, lawsuit officer abuse, police rights violation lawsuit, officer constitutional violation lawsuit, how to sue police officer, how to sue police department, how to file police lawsuit, how to file officer lawsuit, police lawsuit help online, officer lawsuit help online, assistance filing police lawsuit, assistance filing officer lawsuit, guidance police lawsuit process, guidance officer lawsuit filing, police lawsuit documents online, officer lawsuit documents online, lawsuit police corruption, lawsuit officer negligence, police retaliation lawsuit, officer retaliation lawsuit, file Section 1983 lawsuit police, file Section 1983 lawsuit officer, police excessive force legal action, officer assault legal action, lawsuit police department misconduct, lawsuit officer department brutality"
        ogTitle="File Civil Rights Lawsuit Online - Section 1983 Claims | BadBlue"
        ogDescription="File Section 1983 civil rights lawsuits with professional legal templates. Expert guidance for police misconduct, excessive force, and constitutional violations."
        canonicalUrl="https://bad-blue.com/lawsuit-form"
        structuredData={structuredData}
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
        <PageBreadcrumbs currentPageName="Generate Lawsuit" />
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold">File a Civil Rights Lawsuit</h1>
          </div>
          <p className="text-muted-foreground">
            Use the AI assistant below to provide all necessary information. The AI will ask comprehensive legal questions and guide you through the lawsuit filing process.
          </p>
        </div>

        {/* AI Legal Team Card */}
        <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5" />
              AI Legal Team
            </CardTitle>
            <CardDescription>
              Seven specialized AI models working together to build your Section 1983 lawsuit
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚖️</span>
              <div className="flex-1">
                <p className="text-sm font-medium">Claude 3.5 Sonnet</p>
                <p className="text-xs text-muted-foreground">Advanced legal reasoning and proper court formatting</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">🧠</span>
              <div className="flex-1">
                <p className="text-sm font-medium">DeepSeek R1T2 Chimera</p>
                <p className="text-xs text-muted-foreground">Precedent analysis from 100,000+ civil rights cases</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">⚡</span>
              <div className="flex-1">
                <p className="text-sm font-medium">Gemini 2.5 Flash</p>
                <p className="text-xs text-muted-foreground">Legal research and case law verification</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">📚</span>
              <div className="flex-1">
                <p className="text-sm font-medium">Grok 4.1 Fast</p>
                <p className="text-xs text-muted-foreground">Massive case law and statute processing</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xl">✓</span>
              <div className="flex-1">
                <p className="text-sm font-medium">Mistral Small</p>
                <p className="text-xs text-muted-foreground">Accuracy verification and quality control</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Form Assistant - PRIMARY AND ONLY INTERFACE */}
        <div className="mb-6">
          <FormAssistant
            formType="lawsuit"
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
              lawsuitType,
              description,
              incidentDate,
              incidentTime,
              damagesAmount,
              plaintiffName,
              plaintiffAddress,
              injuryDetails,
              subsequentEvents,
              witnessNames
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
                  <Label className="text-xs text-muted-foreground">Lawsuit Type</Label>
                  <p className="font-medium" data-testid="preview-lawsuit-type">
                    {lawsuitType.charAt(0).toUpperCase() + lawsuitType.slice(1).replace('-', ' ')}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Incident Date</Label>
                  <p className="font-medium" data-testid="preview-incident-date">{incidentDate}</p>
                </div>
                {incidentTime && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Incident Time</Label>
                    <p className="font-medium" data-testid="preview-incident-time">{incidentTime}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Damages Amount</Label>
                  <p className="font-medium" data-testid="preview-damages">${parseFloat(damagesAmount).toLocaleString()}</p>
                </div>
                {plaintiffName && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Plaintiff Name</Label>
                    <p className="font-medium" data-testid="preview-plaintiff-name">{plaintiffName}</p>
                  </div>
                )}
                {plaintiffAddress && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Plaintiff Address</Label>
                    <p className="font-medium" data-testid="preview-plaintiff-address">{plaintiffAddress}</p>
                  </div>
                )}
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md" data-testid="preview-description">
                  {description}
                </p>
              </div>
              
              {injuryDetails && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Injury Details</Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md" data-testid="preview-injury-details">
                    {injuryDetails}
                  </p>
                </div>
              )}
              
              {subsequentEvents && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Subsequent Events</Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md" data-testid="preview-subsequent-events">
                    {subsequentEvents}
                  </p>
                </div>
              )}
              
              {witnessNames && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Witness Names</Label>
                  <p className="text-sm bg-muted/50 p-3 rounded-md" data-testid="preview-witness-names">
                    {witnessNames}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Evidence Upload Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Evidence Files (Optional)</CardTitle>
            <CardDescription>
              Attach photos, videos, or documents that support your lawsuit
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

            {/* Share with community checkbox */}
            <div className="flex items-center space-x-2 mb-3">
              <input
                type="checkbox"
                id="shareEvidence"
                className="rounded border-gray-300"
                onChange={(e) => localStorage.setItem('shareEvidence', e.target.checked.toString())}
              />
              <label htmlFor="shareEvidence" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Share with BadBlue community (Corrupt Law Enforcement & Informant Hub)
              </label>
            </div>

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

        {/* Damages Calculator - Shows when form is complete */}
        {isFormComplete && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                AI Damages Estimate
              </CardTitle>
              <CardDescription>
                Our AI has analyzed your case and estimated potential damages based on similar cases in {state}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormAssistant
                formType="lawsuit"
                userContext={{
                  officerName,
                  badgeNumber,
                  department,
                  state,
                  city,
                  county,
                  incidentDate,
                  incidentTime,
                  incidentDescription: description,
                  damagesAmount,
                }}
                currentFormData={{
                  officerName,
                  badgeNumber,
                  department,
                  state,
                  city,
                  county,
                  lawsuitType,
                  description,
                  incidentDate,
                  incidentTime,
                  damagesAmount,
                  plaintiffName,
                  plaintiffAddress,
                  injuryDetails,
                  subsequentEvents,
                  witnessNames
                }}
                onFieldsSuggested={(fields) => {
                  if (fields.damagesAmount) setDamagesAmount(fields.damagesAmount);
                }}
                onReadyToSubmit={() => {}}
                damagesCalculatorMode={true}
              />
            </CardContent>
          </Card>
        )}

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
      <HiddenFAQ path="/lawsuit-form" />
    </div>
  );
}
