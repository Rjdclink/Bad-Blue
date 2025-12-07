import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Scale, FileText, Upload, MessageSquare, CheckCircle2, Loader2, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/FileUpload";
import EvidenceAnalysis from "@/components/EvidenceAnalysis";
import { LAW_TYPE_DATA } from "@shared/lawTypes";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SEOHead } from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { AppHeader } from "@/components/AppHeader";

const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

export default function LegalToolsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Get law type from URL query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const lawTypeParam = urlParams.get('type') || '';
  
  // Find law type info
  const lawTypeInfo = LAW_TYPE_DATA.find(t => t.id === lawTypeParam);
  
  // Redirect if invalid law type or Law Enforcement Accountability
  if (!lawTypeInfo || lawTypeParam === 'law-enforcement-accountability') {
    setLocation('/welcome');
    return null;
  }
  
  // Validated law type (safe to use)
  const validatedLawType = lawTypeParam;
  
  const [activeTab, setActiveTab] = useState<'consultation' | 'documents' | 'people' | 'evidence'>('consultation');
  const [state, setState] = useState("");
  const [situation, setSituation] = useState("");
  const [consultationResponse, setConsultationResponse] = useState("");
  const [recommendations, setRecommendations] = useState<any>(null);
  
  // Consultation mutation - Enhanced version
  const enhancedConsultationMutation = useMutation({
    mutationFn: async (data: { state: string; situation: string; lawType: string }) => {
      const response = await apiRequest("/api/enhanced-consultation", "POST", data);
      const json = await response.json();
      return json;
    },
    onSuccess: (data) => {
      setConsultationResponse(data.analysis);
      setRecommendations(data);
      toast({
        title: "Strategic Analysis Complete",
        description: "Your comprehensive legal consultation with tool recommendations is ready.",
      });
    },
    onError: (error: Error) => {
      // Fallback to standard consultation
      consultationMutation.mutate({
        state,
        situation,
        lawType: validatedLawType,
      });
    },
  });
  
  // Consultation mutation
  const consultationMutation = useMutation({
    mutationFn: async (data: { state: string; situation: string; lawType: string }) => {
      const response = await apiRequest("/api/legal-consultation", "POST", data);
      const json = await response.json();
      return json; // Return full enhanced response
    },
    onSuccess: (data) => {
      setConsultationResponse(data);
      toast({
        title: "Analysis Complete",
        description: "Your comprehensive legal consultation has been generated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate consultation",
        variant: "destructive",
      });
    },
  });
  
  const handleConsultation = () => {
    if (!state || !situation) {
      toast({
        title: "Missing Information",
        description: "Please select a state and describe your situation.",
        variant: "destructive",
      });
      return;
    }
    
    // Try enhanced consultation first
    enhancedConsultationMutation.mutate({
      state,
      situation,
      lawType: validatedLawType,
    });
  };
  
  return (
    <>
      <SEOHead
        title={`${lawTypeInfo.name} - LegalWhat Legal Tools`}
        description={`Access AI-powered legal tools for ${lawTypeInfo.name}: ${lawTypeInfo.description}`}
      />
      
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        {/* App Header with Back and Logout */}
        <AppHeader 
          title={lawTypeInfo.name}
          subtitle="AI-Powered Legal Tools"
          fallbackRoute="/welcome"
        />
        
        <div className="container max-w-7xl mx-auto px-4 py-8">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'consultation' | 'documents' | 'people' | 'evidence')} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 max-w-3xl">
              <TabsTrigger value="consultation" className="flex items-center gap-2">
                <img 
                  src="/images/Law-book.webp" 
                  alt="" 
                  className="w-4 h-4 object-contain"
                />
                ALEXERA
              </TabsTrigger>
              <TabsTrigger value="evidence" className="flex items-center gap-2">
                <img 
                  src="/images/Law-book.webp" 
                  alt="" 
                  className="w-4 h-4 object-contain"
                />
                Evidence
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-2">
                <img 
                  src="/images/Law-book.webp" 
                  alt="" 
                  className="w-4 h-4 object-contain"
                />
                Documents
              </TabsTrigger>
              <TabsTrigger value="people" className="flex items-center gap-2">
                <img 
                  src="/images/Law-book.webp" 
                  alt="" 
                  className="w-4 h-4 object-contain"
                />
                People
              </TabsTrigger>
            </TabsList>
            
            {/* Consultation Tab */}
            <TabsContent value="consultation" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <img 
                      src="/images/Law-book.webp" 
                      alt="" 
                      className="w-5 h-5 object-contain"
                    />
                    ALEXERA — Legal Expert AI Resource Advisor
                  </CardTitle>
                  <CardDescription>
                    Get expert analysis for your {lawTypeInfo.name.toLowerCase()} case. ALEXERA is specialized in this practice area.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Select value={state} onValueChange={setState}>
                      <SelectTrigger id="state">
                        <SelectValue placeholder="Select your state" />
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
                    <Label htmlFor="situation">Describe Your Situation</Label>
                    <Textarea
                      id="situation"
                      value={situation}
                      onChange={(e) => setSituation(e.target.value)}
                      placeholder={`Describe your ${lawTypeInfo.name.toLowerCase()} issue in detail...`}
                      rows={6}
                      className="resize-none"
                    />
                  </div>
                  
                  <Button
                    onClick={handleConsultation}
                    disabled={consultationMutation.isPending || enhancedConsultationMutation.isPending}
                    className="w-full"
                  >
                    {(consultationMutation.isPending || enhancedConsultationMutation.isPending) ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Get Strategic Analysis
                      </>
                    )}
                  </Button>
                  
                  {consultationResponse && (
                    <div className="mt-6 space-y-4">
                      <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                          Legal Analysis
                        </h3>
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <div className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                            {consultationResponse}
                          </div>
                        </div>
                      </div>

                      {/* Tool Recommendations */}
                      {recommendations && (
                        <>
                          {/* Identified Parties for People Finder */}
                          {recommendations.identifiedParties && recommendations.identifiedParties.length > 0 && (
                            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <Users className="w-4 h-4" />
                                  Recommended: Research These Individuals
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  {recommendations.identifiedParties.map((party: string, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border">
                                      <span className="text-sm font-medium">{party}</span>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setLocation(`/people-finder?name=${encodeURIComponent(party)}`)}
                                      >
                                        <Users className="w-3 h-3 mr-1" />
                                        Search
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Suggested Actions */}
                          {recommendations.recommendations && recommendations.recommendations.length > 0 && (
                            <Card>
                              <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Recommended Actions
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  {recommendations.recommendations.map((action: any, idx: number) => (
                                    <div key={idx} className={`p-3 rounded border ${
                                      action.priority === 'high' ? 'border-red-300 bg-red-50 dark:bg-red-950/20' :
                                      action.priority === 'medium' ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20' :
                                      'border-slate-300 bg-slate-50 dark:bg-slate-900'
                                    }`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            <Badge variant={action.priority === 'high' ? 'destructive' : 'secondary'} className="text-xs">
                                              {action.priority} priority
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">{action.type}</span>
                                          </div>
                                          <p className="text-sm">{action.description}</p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Next Steps */}
                          {recommendations.nextSteps && recommendations.nextSteps.length > 0 && (
                            <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <ArrowLeft className="w-4 h-4 rotate-180" />
                                  Next Steps
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <ol className="space-y-2 list-decimal list-inside">
                                  {recommendations.nextSteps.map((step: string, idx: number) => (
                                    <li key={idx} className="text-sm">{step}</li>
                                  ))}
                                </ol>
                              </CardContent>
                            </Card>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              
              {/* File Upload for Consultation */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="w-5 h-5 text-blue-600" />
                    Upload Evidence
                  </CardTitle>
                  <CardDescription>
                    Upload relevant documents, photos, or videos to support your case.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FileUpload
                    associatedWith="consultation"
                    lawType={validatedLawType}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            
            {/* Evidence Analysis Tab */}
            <TabsContent value="evidence" className="space-y-6">
              <EvidenceAnalysis lawType={validatedLawType} lawTypeName={lawTypeInfo.name} />
            </TabsContent>
            
            {/* Documents Tab */}
            <TabsContent value="documents" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Document Generation
                  </CardTitle>
                  <CardDescription>
                    Generate legal documents for {lawTypeInfo.name.toLowerCase()} cases.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                    <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">Document Generation Coming Soon</p>
                    <p className="text-sm">
                      Advanced document generation tools for {lawTypeInfo.name.toLowerCase()} will be available in a future update.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setLocation('/legal-document-creator')}
                    >
                      Use General Document Creator
                    </Button>
                  </div>
                </CardContent>
              </Card>
              
              {/* File Upload for Documents */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="w-5 h-5 text-blue-600" />
                    Upload Supporting Documents
                  </CardTitle>
                  <CardDescription>
                    Upload documents related to your {lawTypeInfo.name.toLowerCase()} case.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FileUpload
                    associatedWith="document"
                    lawType={validatedLawType}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            
            {/* People Finder Tab */}
            <TabsContent value="people" className="space-y-6">
              <Card 
                className="relative overflow-hidden"
                style={{
                  backgroundImage: 'url(/images/PANTHEON.png)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat'
                }}
              >
                {/* Simple dark overlay for readability - NO GRADIENTS */}
                <div className="absolute inset-0 bg-black/60 z-0" />
                
                <CardHeader className="relative z-10">
                  <CardTitle className="flex items-center gap-2 text-white drop-shadow-lg">
                    <Users className="w-5 h-5 text-blue-400" />
                    People Finder - Identity Intelligence
                  </CardTitle>
                  <CardDescription className="text-gray-200 drop-shadow-md">
                    Search for individuals relevant to your {lawTypeInfo.name.toLowerCase()} case. Find witnesses, opposing parties, experts, or other relevant individuals.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10">
                  <div className="text-center py-12">
                    {/* Icon - simple, no glow effects */}
                    <Users className="w-16 h-16 mx-auto mb-4 text-blue-400 opacity-90" />
                    {/* Title - consistent white */}
                    <p className="text-lg mb-2 font-semibold text-white drop-shadow-lg">
                      Advanced People Search Available
                    </p>
                    {/* Description - consistent gray-200 (NO COLOR CHANGES) */}
                    <p className="text-sm text-gray-200 mb-6 max-w-md mx-auto drop-shadow-md">
                      Use our advanced People Finder to locate witnesses, experts, parties, or other individuals 
                      relevant to your {lawTypeInfo.name.toLowerCase()} case. Aggregates data from public records, 
                      court filings, professional networks, and more.
                    </p>
                    {/* Button - simple styling */}
                    <Button
                      onClick={() => setLocation('/people-finder')}
                      size="lg"
                      className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
                    >
                      <Users className="w-4 h-4" />
                      Launch People Finder
                    </Button>
                    
                    {/* Common Use Cases - simple backdrop */}
                    <div className="mt-8 p-4 bg-black/50 backdrop-blur-sm rounded-lg border border-blue-400/30 text-left max-w-md mx-auto">
                      <h4 className="font-semibold text-sm mb-2 text-blue-300 drop-shadow-md">
                        Common Use Cases for {lawTypeInfo.name}:
                      </h4>
                      <ul className="text-xs text-gray-200 space-y-1">
                        <li>• Locate witnesses and expert witnesses</li>
                        <li>• Find contact information for parties</li>
                        <li>• Research backgrounds and credentials</li>
                        <li>• Discover professional associations</li>
                        <li>• Verify identity and contact details</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
