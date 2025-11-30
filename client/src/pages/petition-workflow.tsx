import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Users, 
  FileText, 
  Send, 
  CheckCircle2, 
  ArrowRight, 
  ArrowLeft,
  Loader2,
  Building2,
  MapPin,
  Shield,
  AlertTriangle,
  Search,
  Database,
  Sparkles,
  Mail
} from "lucide-react";

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

type WorkflowStep = 'info' | 'sources' | 'generate' | 'review' | 'submit';

interface PetitionWorkflow {
  id: string;
  userId?: string;
  city: string;
  state: string;
  officerName: string;
  officerBadge?: string;
  officerDepartment?: string;
  misconductSummary: string;
  requestedAction: string;
  petitionerName: string;
  petitionerEmail?: string;
  petitionerAddress?: string;
  cityPopulation?: number;
  requiredSignatures?: number;
  residentsCollected?: number;
  status: string;
  petitionContent?: string;
  submissionChannel?: string;
  submissionTarget?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const STEPS: { key: WorkflowStep; label: string; icon: typeof Users }[] = [
  { key: 'info', label: 'Petition Info', icon: FileText },
  { key: 'sources', label: 'Data Sources', icon: Database },
  { key: 'generate', label: 'AI Generation', icon: Sparkles },
  { key: 'review', label: 'Review', icon: Search },
  { key: 'submit', label: 'Submit', icon: Send },
];

export default function PetitionWorkflow() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('info');
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    city: '',
    state: '',
    officerName: '',
    officerBadge: '',
    officerDepartment: '',
    misconductSummary: '',
    requestedAction: '',
    petitionerName: '',
    petitionerEmail: '',
    petitionerAddress: '',
    county: ''
  });

  const { data: workflowData, refetch: refetchWorkflow } = useQuery<{
    success: boolean;
    workflow: PetitionWorkflow;
    sources: any[];
    signers: any[];
    submissions: any[];
  }>({
    queryKey: ['/api/petition-workflow', workflowId],
    enabled: !!workflowId,
  });

  const createWorkflowMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest('/api/petition-workflow', 'POST', data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setWorkflowId(data.workflow.id);
      toast({
        title: "Petition workflow created",
        description: data.message,
      });
      setCurrentStep('sources');
    },
    onError: (error: any) => {
      toast({
        title: "Error creating petition",
        description: error.message || "Failed to create petition workflow",
        variant: "destructive",
      });
    },
  });

  const discoverSourcesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/petition-workflow/${workflowId}/discover-sources`, 'POST', { county: formData.county });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Data sources discovered",
        description: "Found public records sources for resident data",
      });
      refetchWorkflow();
    },
    onError: (error: any) => {
      toast({
        title: "Error discovering sources",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateContentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/petition-workflow/${workflowId}/generate`, 'POST', {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Petition generated",
        description: "AI has generated your petition content",
      });
      refetchWorkflow();
      setCurrentStep('review');
    },
    onError: (error: any) => {
      toast({
        title: "Error generating petition",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const discoverChannelsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/petition-workflow/${workflowId}/discover-channels`, 'POST', {});
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Channels discovered",
        description: data.message,
      });
    },
  });

  const submitPetitionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/petition-workflow/${workflowId}/submit`, 'POST', {});
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Petition submitted",
        description: data.message,
      });
      refetchWorkflow();
    },
    onError: (error: any) => {
      toast({
        title: "Error submitting petition",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleCreateWorkflow = () => {
    if (!formData.city || !formData.state || !formData.officerName || !formData.misconductSummary || !formData.requestedAction || !formData.petitionerName) {
      toast({
        title: "Missing required fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createWorkflowMutation.mutate(formData);
  };

  const workflow = workflowData?.workflow;
  const sources = workflowData?.sources || [];
  const signers = workflowData?.signers || [];

  const getStepProgress = () => {
    const stepIndex = STEPS.findIndex(s => s.key === currentStep);
    return ((stepIndex + 1) / STEPS.length) * 100;
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Authentication Required
            </CardTitle>
            <CardDescription>
              Please log in to create a petition workflow
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => window.location.href = '/login'}>
              Log In
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <>
      <SEOHead 
        title="Create Petition | BadBlue"
        description="Create an automated community petition for police accountability with AI-powered content generation and automated city council submission."
      />
      
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
            <Users className="h-8 w-8 text-primary" />
            Community Petition Workflow
          </h1>
          <p className="text-muted-foreground mt-2">
            Create an AI-powered petition to demand police accountability in your community
          </p>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = step.key === currentStep;
              const isPast = STEPS.findIndex(s => s.key === currentStep) > idx;
              return (
                <div 
                  key={step.key}
                  className={`flex items-center gap-2 ${isActive ? 'text-primary font-medium' : isPast ? 'text-green-600' : 'text-muted-foreground'}`}
                  data-testid={`step-${step.key}`}
                >
                  <div className={`rounded-full p-2 ${isActive ? 'bg-primary text-primary-foreground' : isPast ? 'bg-green-100 text-green-600' : 'bg-muted'}`}>
                    {isPast ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className="hidden sm:inline text-sm">{step.label}</span>
                </div>
              );
            })}
          </div>
          <Progress value={getStepProgress()} className="h-2" />
        </div>

        {currentStep === 'info' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Petition Information
              </CardTitle>
              <CardDescription>
                Provide details about the officer and incident
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="city">City *</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    placeholder="Enter city name"
                    data-testid="input-city"
                  />
                </div>
                <div>
                  <Label htmlFor="state">State *</Label>
                  <Select value={formData.state} onValueChange={(v) => handleInputChange('state', v)}>
                    <SelectTrigger data-testid="select-state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => (
                        <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Officer Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="officerName">Officer Name *</Label>
                    <Input
                      id="officerName"
                      value={formData.officerName}
                      onChange={(e) => handleInputChange('officerName', e.target.value)}
                      placeholder="Full name of officer"
                      data-testid="input-officer-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="officerBadge">Badge Number</Label>
                    <Input
                      id="officerBadge"
                      value={formData.officerBadge}
                      onChange={(e) => handleInputChange('officerBadge', e.target.value)}
                      placeholder="If known"
                      data-testid="input-officer-badge"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="officerDepartment">Department</Label>
                  <Input
                    id="officerDepartment"
                    value={formData.officerDepartment}
                    onChange={(e) => handleInputChange('officerDepartment', e.target.value)}
                    placeholder="Police department name"
                    data-testid="input-officer-department"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium">Misconduct Details</h3>
                <div>
                  <Label htmlFor="misconductSummary">Misconduct Summary *</Label>
                  <Textarea
                    id="misconductSummary"
                    value={formData.misconductSummary}
                    onChange={(e) => handleInputChange('misconductSummary', e.target.value)}
                    placeholder="Describe the officer's misconduct in detail (at least 50 characters)"
                    className="min-h-[120px]"
                    data-testid="input-misconduct-summary"
                  />
                </div>
                <div>
                  <Label htmlFor="requestedAction">Requested Action *</Label>
                  <Textarea
                    id="requestedAction"
                    value={formData.requestedAction}
                    onChange={(e) => handleInputChange('requestedAction', e.target.value)}
                    placeholder="What action do you want the city council to take?"
                    className="min-h-[80px]"
                    data-testid="input-requested-action"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Your Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="petitionerName">Your Name *</Label>
                    <Input
                      id="petitionerName"
                      value={formData.petitionerName}
                      onChange={(e) => handleInputChange('petitionerName', e.target.value)}
                      placeholder="Your full name"
                      data-testid="input-petitioner-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="petitionerEmail">Your Email</Label>
                    <Input
                      id="petitionerEmail"
                      type="email"
                      value={formData.petitionerEmail}
                      onChange={(e) => handleInputChange('petitionerEmail', e.target.value)}
                      placeholder="your@email.com"
                      data-testid="input-petitioner-email"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="petitionerAddress">Your Address</Label>
                  <Input
                    id="petitionerAddress"
                    value={formData.petitionerAddress}
                    onChange={(e) => handleInputChange('petitionerAddress', e.target.value)}
                    placeholder="Street address (helps verify residency)"
                    data-testid="input-petitioner-address"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button 
                onClick={handleCreateWorkflow}
                disabled={createWorkflowMutation.isPending}
                data-testid="button-create-workflow"
              >
                {createWorkflowMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <>Create Petition <ArrowRight className="h-4 w-4 ml-2" /></>
                )}
              </Button>
            </CardFooter>
          </Card>
        )}

        {currentStep === 'sources' && workflow && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Data Source Discovery
              </CardTitle>
              <CardDescription>
                Find public records sources for collecting resident signatures
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="font-medium">City Population</h4>
                    <p className="text-2xl font-bold text-primary">
                      {workflow.cityPopulation?.toLocaleString() || 'Calculating...'}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Required Signatures</h4>
                    <p className="text-2xl font-bold text-primary">
                      {workflow.requiredSignatures?.toLocaleString() || 'Calculating...'}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Collected</h4>
                    <p className="text-2xl font-bold text-green-600">
                      {workflow.residentsCollected || 0}
                    </p>
                  </div>
                </div>
                <Progress 
                  value={((workflow.residentsCollected || 0) / (workflow.requiredSignatures || 1)) * 100} 
                  className="h-3"
                />
              </div>

              <div>
                <Label htmlFor="county">County (for better source discovery)</Label>
                <Input
                  id="county"
                  value={formData.county}
                  onChange={(e) => handleInputChange('county', e.target.value)}
                  placeholder="Enter county name"
                  data-testid="input-county"
                />
              </div>

              <Button 
                onClick={() => discoverSourcesMutation.mutate()}
                disabled={discoverSourcesMutation.isPending}
                className="w-full"
                data-testid="button-discover-sources"
              >
                {discoverSourcesMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Discovering Sources...</>
                ) : (
                  <><Search className="h-4 w-4 mr-2" /> Discover Public Data Sources</>
                )}
              </Button>

              {sources.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-medium">Discovered Sources</h4>
                  {sources.map((source: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{source.sourceName}</p>
                        <p className="text-sm text-muted-foreground">{source.sourceType}</p>
                      </div>
                      <Badge variant={source.status === 'completed' ? 'default' : 'secondary'}>
                        {source.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <AlertTriangle className="h-4 w-4 inline mr-2" />
                  Note: Resident data collection from public sources is handled by our automated system. 
                  You can also manually add signers if needed.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep('info')}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={() => setCurrentStep('generate')} data-testid="button-next-generate">
                Generate Petition <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {currentStep === 'generate' && workflow && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Petition Generation
              </CardTitle>
              <CardDescription>
                Our AI will generate a professional petition document based on your information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p><strong>City:</strong> {workflow.city}, {workflow.state}</p>
                <p><strong>Officer:</strong> {workflow.officerName}</p>
                <p><strong>Misconduct:</strong> {workflow.misconductSummary?.substring(0, 100)}...</p>
                <p><strong>Requested Action:</strong> {workflow.requestedAction?.substring(0, 100)}...</p>
              </div>

              {!workflow.petitionContent ? (
                <Button 
                  onClick={() => generateContentMutation.mutate()}
                  disabled={generateContentMutation.isPending}
                  className="w-full"
                  size="lg"
                  data-testid="button-generate-content"
                >
                  {generateContentMutation.isPending ? (
                    <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Generating Petition...</>
                  ) : (
                    <><Sparkles className="h-5 w-5 mr-2" /> Generate Petition with AI</>
                  )}
                </Button>
              ) : (
                <div className="space-y-4">
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Petition Generated
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    Your petition has been generated. Review it in the next step.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep('sources')}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button 
                onClick={() => setCurrentStep('review')} 
                disabled={!workflow.petitionContent}
                data-testid="button-next-review"
              >
                Review Petition <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {currentStep === 'review' && workflow && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Review Petition
              </CardTitle>
              <CardDescription>
                Review the generated petition before submission
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {workflow.petitionContent ? (
                <div className="bg-muted/30 rounded-lg p-6 max-h-[500px] overflow-y-auto">
                  <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed">
                    {workflow.petitionContent}
                  </pre>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No petition content generated yet
                </p>
              )}

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <h4 className="font-medium mb-2">Petition Summary</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Target City</p>
                    <p className="font-medium">{workflow.city}, {workflow.state}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Population</p>
                    <p className="font-medium">{workflow.cityPopulation?.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Required Signatures</p>
                    <p className="font-medium">{workflow.requiredSignatures}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Collected</p>
                    <p className="font-medium">{workflow.residentsCollected || 0}</p>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep('generate')}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button 
                onClick={() => {
                  discoverChannelsMutation.mutate();
                  setCurrentStep('submit');
                }}
                data-testid="button-next-submit"
              >
                Prepare Submission <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {currentStep === 'submit' && workflow && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Submit Petition
              </CardTitle>
              <CardDescription>
                Submit your petition to the city council
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {workflow.status === 'submitted' ? (
                <div className="text-center py-8 space-y-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-green-600">Petition Submitted!</h3>
                  <p className="text-muted-foreground">
                    Your petition has been submitted via {workflow.submissionChannel} to {workflow.submissionTarget}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Submitted on: {workflow.submittedAt ? new Date(workflow.submittedAt).toLocaleString() : 'N/A'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Submission Target
                    </h4>
                    <p className="text-lg font-medium">{workflow.city}, {workflow.state} City Council</p>
                    
                    {workflow.submissionChannel && (
                      <div className="mt-2">
                        <Badge>{workflow.submissionChannel}</Badge>
                        <p className="text-sm text-muted-foreground mt-1">{workflow.submissionTarget}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <span>Petition Content</span>
                      <Badge variant={workflow.petitionContent ? 'default' : 'destructive'}>
                        {workflow.petitionContent ? 'Ready' : 'Missing'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <span>Signatures Collected</span>
                      <span className="font-medium">
                        {workflow.residentsCollected || 0} / {workflow.requiredSignatures}
                      </span>
                    </div>
                  </div>

                  <Button 
                    onClick={() => submitPetitionMutation.mutate()}
                    disabled={submitPetitionMutation.isPending || !workflow.petitionContent}
                    className="w-full"
                    size="lg"
                    data-testid="button-submit-petition"
                  >
                    {submitPetitionMutation.isPending ? (
                      <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Submitting...</>
                    ) : (
                      <><Mail className="h-5 w-5 mr-2" /> Submit Petition to City Council</>
                    )}
                  </Button>

                  <p className="text-sm text-muted-foreground text-center">
                    By submitting, you confirm that all information is accurate to the best of your knowledge.
                  </p>
                </>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep('review')}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              {workflow.status === 'submitted' && (
                <Button variant="outline" onClick={() => window.location.href = '/petitions'}>
                  View All Petitions
                </Button>
              )}
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
}
