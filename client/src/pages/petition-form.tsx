import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Users, DollarSign, CheckCircle2, ArrowLeft, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClientSession } from "@/contexts/ClientSessionContext";
import { FormAssistant } from "@/components/FormAssistant";
import { SEOHead } from "@/components/SEOHead";

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

const SEO_KEYWORDS = [
  "police brutality", "police assault", "police lawsuit", "police complaint", "police grievance",
  "FOIA police", "police search", "police information", "police legal", "police misconduct",
  "officer brutality", "officer assault", "officer lawsuit", "officer complaint", "officer grievance",
  "FOIA officer", "officer search", "officer information", "officer legal", "officer misconduct",
  "police department lawsuit", "police department complaint", "police department grievance",
  "police department legal documents", "police department FOIA request", "find police complaint",
  "locate police assault", "petition for police resignation", "police brutality lawsuit",
  "police assault complaint", "police lawsuit documents", "officer legal help", "police information request",
  "filing a police complaint", "police misconduct information", "excessive force lawsuit",
  "civil rights violation police", "police brutality documents", "police officer resignation petition",
  "police complaint investigation", "legal advice police issues", "FOIA request for police records",
  "officer fired lawsuit", "police brutality help", "police search warrant complaint",
  "departmental complaint police", "file police grievance", "obtain police information",
  "police legal recourse", "officer behavior complaint", "police brutality FOIA",
  "lawsuit against police department", "officer sued for assault", "police investigation documents",
  "resignation petition officer", "fired officer lawsuit", "legal assistance police brutality",
  "comprehensive police information", "search police records FOIA", "police complaint petition",
  "officer legal complaint", "departmental lawsuit police", "police brutality settlement",
  "find officer complaint", "police assault information", "police lawsuit lawyer",
  "officer grievance form", "police information portal", "legal case police brutality",
  "police brutality evidence", "officer resignation demand", "police department legal action",
  "FOIA police misconduct", "police brutality compensation", "officer fired complaint",
  "police search complaint", "police brutality assistance", "officer resignation process",
  "police legal case", "complaint against officer", "lawsuit for police brutality",
  "police department records FOIA", "officer fired resignation", "police brutality legal help",
  "information on police misconduct", "petition for officer resignation", "police assault lawsuit",
  "police complaint form", "police search legal", "officer brutality information",
  "police lawsuit help", "police grievance procedure", "find police lawsuit",
  "officer complaint documents", "police information request FOIA", "legal advice for police brutality",
  "police brutality petition", "officer assault complaint", "police lawsuit update",
  "police department grievance", "locate officer complaint", "police brutality legal advice",
  "officer search information", "police legal documents", "petition officer resignation",
  "fired officer complaint", "police brutality resources", "police information search",
  "officer legal petition", "departmental complaint lawsuit", "police assault legal",
  "police grievance lawsuit", "find officer information", "police brutality legal case",
  "officer legal assistance", "police complaint legal", "lawsuit over police brutality",
  "police department FOIA documents", "officer fired legal", "police search complaint FOIA",
  "police brutality help center", "officer resignation petition form", "police legal petition help",
  "departmental lawsuit complaint", "police assault legal advice", "police grievance information",
  "find police grievance", "officer complaint legal help", "police information lawsuit",
  "legal recourse police brutality", "police brutality documents FOIA", "officer resignation demand letter",
  "police department legal complaint", "FOIA police lawsuit", "police brutality settlement help",
  "officer fired grievance", "police search complaint legal", "police brutality legal resources",
  "officer resignation process help", "police legal help center", "complaint against officer lawsuit",
  "lawsuit for police assault", "police department records complaint", "officer fired petition",
  "police brutality legal case update", "information on police assault", "petition for officer complaint",
  "police brutality search", "officer complaint legal documents", "police information legal help",
  "legal advice police assault", "police brutality lawsuit update", "officer grievance legal",
  "police search complaint documents", "police legal advice center", "petition for officer grievance",
  "fired officer legal", "police brutality help lawsuit", "officer resignation information",
  "police department legal assistance", "FOIA officer complaint", "police brutality compensation lawsuit",
  "officer fired lawsuit documents", "police search legal information", "police brutality legal petition",
  "officer resignation process lawsuit", "police legal complaint help", "departmental lawsuit legal",
  "police assault legal documents", "police grievance legal advice", "find officer legal help",
  "police brutality legal case documents", "officer legal help lawsuit", "police complaint legal advice",
  "lawsuit over police assault", "police department FOIA lawsuit", "officer fired legal advice",
  "police search complaint legal help", "police brutality help petition", "officer resignation legal help",
  "police legal assistance lawsuit", "departmental lawsuit legal advice", "police assault legal help",
  "police grievance legal petition", "find officer complaint documents", "police brutality legal case help",
  "officer legal help petition", "police complaint legal documents", "lawsuit over police misconduct",
  "police department FOIA legal help", "officer fired legal help", "police search legal petition",
  "police brutality help legal", "officer resignation legal petition", "police legal assistance petition",
  "departmental lawsuit help", "police assault legal petition", "police grievance legal help",
  "find officer legal petition", "police brutality legal case petition", "officer legal help legal",
  "police complaint legal petition", "lawsuit over officer misconduct", "police department FOIA petition",
  "officer fired legal petition", "police search legal help", "police brutality help information",
  "officer resignation legal information", "police legal assistance information", "departmental lawsuit information",
  "police assault legal information", "police grievance legal information", "find officer legal information",
  "police brutality legal case information", "officer legal help information", "police complaint legal information",
  "lawsuit over police brutality complaint", "police department FOIA information", "officer fired legal information",
  "police search legal information help", "police brutality help legal help", "officer resignation legal help help",
  "police legal assistance legal help", "departmental lawsuit legal help", "police assault legal help help",
  "police grievance legal help help", "find officer legal help help", "police brutality legal case help help",
  "officer legal help legal help", "police complaint legal help help", "lawsuit over police brutality lawsuit",
  "police department FOIA legal help help", "officer fired legal help help", "police search legal help help",
  "police brutality help legal help help", "officer resignation legal help help help", "police legal assistance legal help help",
  "departmental lawsuit legal help help", "police assault legal help help help", "police grievance legal help help help",
  "find officer legal help help help", "police brutality legal case help help help", "officer legal help legal help help",
  "police complaint legal help help help", "lawsuit over police brutality complaint lawsuit", "police department FOIA legal help help help",
  "officer fired legal help help help", "police search legal help help help", "police brutality help legal help help help",
  "officer resignation legal help help help help", "police legal assistance legal help help help help", "departmental lawsuit legal help help help help",
  "police assault legal help help help help", "police grievance legal help help help help", "find officer legal help help help help",
  "police brutality legal case help help help help", "officer legal help legal help help help help", "police complaint legal help help help help help",
  "police brutality lawsuit", "police assault lawsuit", "police complaint lawsuit", "police grievance lawsuit",
  "officer brutality lawsuit", "officer assault lawsuit", "officer complaint lawsuit", "officer grievance lawsuit",
  "police department lawsuit", "police search lawsuit", "police information lawsuit", "police legal lawsuit",
  "officer search lawsuit", "officer information lawsuit", "officer legal lawsuit", "FOIA lawsuit",
  "petition lawsuit", "resignation lawsuit", "fired lawsuit", "document lawsuit", "complaint lawsuit",
  "grievance lawsuit", "legal advice lawsuit", "assault lawsuit", "brutality lawsuit", "search lawsuit",
  "find lawsuit", "locate lawsuit", "petition lawsuit", "resignation lawsuit", "fired lawsuit",
  "information lawsuit", "legal lawsuit", "help lawsuit", "ECT lawsuit",
];

export default function PetitionForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { sessionData, updateSessionData, hydrateFromUrl } = useClientSession();

  const [officerName, setOfficerName] = useState("");
  const [badgeNumber, setBadgeNumber] = useState("");
  const [department, setDepartment] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [readyToSubmit, setReadyToSubmit] = useState(false);

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
    if (sessionData.department) setDepartment(sessionData.department);
    if (sessionData.state) setState(sessionData.state);
    if (sessionData.city) setCity(sessionData.city);
    if (sessionData.county) setCounty(sessionData.county);
    if (sessionData.incidentDate) setIncidentDate(sessionData.incidentDate);
    if (sessionData.incidentDescription) setIncidentSummary(sessionData.incidentDescription);
  }, [sessionData]);

  const handleAISuggestedFields = (fields: any) => {
    if (fields.officerName) setOfficerName(fields.officerName);
    if (fields.badgeNumber) setBadgeNumber(fields.badgeNumber);
    if (fields.department) setDepartment(fields.department);
    if (fields.state) setState(fields.state);
    if (fields.city) setCity(fields.city);
    if (fields.county) setCounty(fields.county);
    if (fields.incidentSummary) setIncidentSummary(fields.incidentSummary);
    if (fields.description) setIncidentSummary(fields.description);
    if (fields.incidentDate) setIncidentDate(fields.incidentDate);

    // Save to ClientSession for autosave persistence
    const sessionUpdates: any = {};
    if (fields.officerName) sessionUpdates.officerName = fields.officerName;
    if (fields.badgeNumber) sessionUpdates.badgeNumber = fields.badgeNumber;
    if (fields.department) sessionUpdates.department = fields.department;
    if (fields.state) sessionUpdates.state = fields.state;
    if (fields.city) sessionUpdates.city = fields.city;
    if (fields.county) sessionUpdates.county = fields.county;
    if (fields.incidentDate) sessionUpdates.incidentDate = fields.incidentDate;
    if (fields.incidentSummary || fields.description) {
      sessionUpdates.incidentDescription = fields.incidentSummary || fields.description;
    }

    if (Object.keys(sessionUpdates).length > 0) {
      updateSessionData(sessionUpdates);
    }

    const hasAllRequired = fields.officerName && fields.state && fields.city &&
                          fields.department && fields.incidentDate &&
                          (fields.incidentSummary || fields.description);

    if (hasAllRequired) {
      toast({
        title: "Petition Ready!",
        description: "All required information collected. Review your petition below.",
      });
    }
  };

  const submitMutation = useMutation({
    mutationFn: async (petitionData: any) => {
      const response = await fetch("/api/petitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(petitionData),
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
      }
    },
    onError: (error: any) => {
      // Provide user-friendly error messages based on error type
      let errorMessage = "We couldn't create your petition. Please check your information and try again";
      
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
        title: "Unable to Create Petition",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleConfirmAndPay = () => {
    if (!officerName || !department || !state || !city || !incidentDate || !incidentSummary) {
      toast({
        title: "Required Fields Missing",
        description: "Please complete all required fields before continuing",
        variant: "destructive",
      });
      return;
    }

    const petitionDocument = `PETITION FOR OFFICER RESIGNATION

Officer: ${officerName}${badgeNumber ? ` (Badge #${badgeNumber})` : ''}
Department: ${department}
Location: ${city}, ${state}${county ? `, ${county} County` : ''}

INCIDENT SUMMARY:
Date: ${incidentDate}

${incidentSummary}

---

If you feel this officer's actions were not valid, please sign and make a difference.

This petition will circulate for 90 days and will be sent to ${department} with all collected signatures.`;

    submitMutation.mutate({
      officerName,
      officerBadge: badgeNumber || null,
      officerDepartment: department,
      state,
      city,
      county: county || null,
      incidentDate,
      incidentSummary,
      petitionDocument,
    });
  };

  const isFormComplete = !!(officerName && state && city && incidentSummary && incidentDate);

  if (showPreview) {
    const stateName = US_STATES.find(s => s.code === state)?.name || state;

    return (
      <div className="min-h-screen bg-background">
        <SEOHead
          title="Review Your Petition"
          description="Review all information before proceeding to payment."
          keywords={SEO_KEYWORDS.join(", ")}
          noIndex={true}
        />
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
            <h1 className="text-3xl font-bold mb-2">Review Your Petition</h1>
            <p className="text-muted-foreground">
              Review all information before proceeding to payment.
            </p>
          </div>

          <div className="space-y-6">
            <Card className="border-orange-500/20 bg-orange-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  Petition Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Officer Name</p>
                    <p className="font-medium">{officerName}</p>
                  </div>
                  {badgeNumber && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Badge Number</p>
                      <p className="font-medium">{badgeNumber}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Department</p>
                    <p className="font-medium">{department}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Location</p>
                    <p className="font-medium">{city}, {stateName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Incident Date</p>
                    <p className="font-medium">{incidentDate}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Incident Summary</p>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md">{incidentSummary}</p>
                </div>
              </CardContent>
            </Card>

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
                    <p className="font-medium">Petition Creation & 90-Day Circulation</p>
                    <p className="text-sm text-muted-foreground">Service payment</p>
                  </div>
                  <div className="text-2xl font-bold">$45.99</div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Your petition will circulate for 90 days, then be automatically sent to {department} with all signatures.
                </p>
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setShowPreview(false)}
              >
                Back to Edit
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={handleConfirmAndPay}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? (
                  <>Processing...</>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Confirm & Pay $45.99
                  </>
                )}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Start an Officer Resignation Petition"
        description="Create an officer resignation petition demanding officer resignation. Your officer resignation petition will circulate for 90 days and be automatically sent to the department with all signatures."
        keywords={SEO_KEYWORDS.join(", ")}
        noIndex={true}
      />
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => window.location.href = "/api/logout"}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-8 h-8 text-orange-500" />
            <h1 className="text-3xl font-bold">Start an Officer Resignation Petition</h1>
          </div>
          <p className="text-muted-foreground">
            Create an officer resignation petition demanding officer resignation. Your officer resignation petition will circulate for 90 days and be automatically sent to the department with all signatures.
          </p>
        </div>

        <div className="mb-6">
          <FormAssistant
            formType="petition"
            userContext={{
              officerName: sessionData.officerName || officerName || undefined,
              badgeNumber: sessionData.badgeNumber || badgeNumber || undefined,
              department: sessionData.department || department || undefined,
              state: sessionData.state || state || undefined,
              city: sessionData.city || city || undefined,
              county: sessionData.county || county || undefined,
              incidentDate: sessionData.incidentDate || incidentDate || undefined,
              incidentDescription: sessionData.incidentDescription || incidentSummary || undefined,
            }}
            currentFormData={{
              officerName: officerName || '',
              badgeNumber: badgeNumber || '',
              department: department || '',
              state: state || '',
              city: city || '',
              county: county || '',
              incidentSummary: incidentSummary || '',
              incidentDate: incidentDate || ''
            }}
            onFieldsSuggested={handleAISuggestedFields}
            onReadyToSubmit={setReadyToSubmit}
          />
        </div>

        {isFormComplete && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Information Collected</CardTitle>
              <CardDescription>
                Review the information for your petition
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Officer Name</Label>
                  <p className="font-medium">{officerName}</p>
                </div>
                {badgeNumber && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Badge Number</Label>
                    <p className="font-medium">{badgeNumber}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Department</Label>
                  <p className="font-medium">{department}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">State</Label>
                  <p className="font-medium">{US_STATES.find(s => s.code === state)?.name || state}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">City</Label>
                  <p className="font-medium">{city}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Incident Date</Label>
                  <p className="font-medium">{incidentDate}</p>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Incident Summary</Label>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                  {incidentSummary}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {(readyToSubmit || isFormComplete) && (
          <div className="flex justify-end">
            <Button size="lg" onClick={() => setShowPreview(true)}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Submit
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}