import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Scale, FileText, Upload, MessageSquare, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/FileUpload";
import { LAW_TYPE_DATA } from "@shared/lawTypes";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SEOHead } from "@/components/SEOHead";

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
  
  const [activeTab, setActiveTab] = useState<'consultation' | 'documents'>('consultation');
  const [state, setState] = useState("");
  const [situation, setSituation] = useState("");
  const [consultationResponse, setConsultationResponse] = useState("");
  
  // Consultation mutation
  const consultationMutation = useMutation({
    mutationFn: async (data: { state: string; situation: string; lawType: string }) => {
      const response = await apiRequest<{ analysis: string }>("/api/legal-consultation", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return response.analysis;
    },
    onSuccess: (analysis) => {
      setConsultationResponse(analysis);
      toast({
        title: "Analysis Complete",
        description: "Your legal consultation has been generated.",
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
    
    consultationMutation.mutate({
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
        <div className="container max-w-7xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <Button
              variant="ghost"
              onClick={() => setLocation('/welcome')}
              className="mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Law Types
            </Button>
            
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Scale className="w-8 h-8 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {lawTypeInfo.name}
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  {lawTypeInfo.description}
                </p>
              </div>
            </div>
          </div>
          
          {/* Main Content */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'consultation' | 'documents')} className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="consultation" className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Legal Consultation
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Document Tools
              </TabsTrigger>
            </TabsList>
            
            {/* Consultation Tab */}
            <TabsContent value="consultation" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                    AI Legal Consultation
                  </CardTitle>
                  <CardDescription>
                    Get expert analysis for your {lawTypeInfo.name.toLowerCase()} case. Our AI is specialized in this practice area.
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
                    disabled={consultationMutation.isPending}
                    className="w-full"
                  >
                    {consultationMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Get Legal Analysis
                      </>
                    )}
                  </Button>
                  
                  {consultationResponse && (
                    <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
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
          </Tabs>
        </div>
      </div>
    </>
  );
}
