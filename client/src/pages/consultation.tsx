/**
 * Domain Consultation Page
 * 
 * Handles consultations for any legal domain by:
 * - Launching the appropriate sub-agent via 4JI orchestrator
 * - Loading domain-specific UI configuration
 * - Providing consultation forms and templates
 * - Displaying results with citations and suggested actions
 */

import { useState, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  ArrowLeft, 
  Send, 
  FileText, 
  Scale, 
  Book, 
  Lightbulb, 
  Clock, 
  CheckCircle,
  AlertCircle,
  Loader2,
  Volume2,
  Save
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { AppHeader } from '@/components/AppHeader';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { LAW_TYPE_DATA } from '@shared/lawTypes';

interface ConsultationResponse {
  domainId: string;
  response: string;
  citations: string[];
  templates: string[];
  confidence: number;
  suggestedActions: string[];
}

interface UIConfig {
  domain: string;
  name: string;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
  layout: {
    consultationForm: {
      title: string;
      subtitle: string;
      fields: Array<{
        id: string;
        label: string;
        type: string;
        placeholder?: string;
        options?: string[];
        required: boolean;
      }>;
    };
  };
  features: {
    voiceInput: boolean;
    documentGeneration: boolean;
    templateLibrary: boolean;
  };
}

export default function DomainConsultationPage() {
  const [, params] = useRoute('/consultation/:domainId');
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const domainId = params?.domainId || '';
  
  const [query, setQuery] = useState('');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [consultation, setConsultation] = useState<ConsultationResponse | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  
  // Get domain info from LAW_TYPE_DATA
  const domainInfo = LAW_TYPE_DATA.find(t => t.id === domainId);
  
  // Fetch domain information from 4JI orchestrator
  const { data: domainData, isLoading: domainLoading } = useQuery({
    queryKey: ['domain', domainId],
    queryFn: async () => {
      const response = await apiRequest(`/api/domains/${domainId}`, 'GET');
      if (!response.ok) throw new Error('Failed to fetch domain');
      return response.json();
    },
    enabled: !!domainId
  });
  
  // Consultation mutation
  const consultMutation = useMutation({
    mutationFn: async (data: { query: string; context: Record<string, any> }) => {
      const response = await apiRequest(`/api/domains/${domainId}/consult`, 'POST', {
        query: data.query,
        context: data.context
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Consultation failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setConsultation(data.response);
      toast({
        title: "Consultation Complete",
        description: `Analysis ready with ${data.response.confidence * 100}% confidence`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Consultation Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });
  
  // Draft generation mutation
  const draftMutation = useMutation({
    mutationFn: async (documentType: string) => {
      const response = await apiRequest(`/api/domains/${domainId}/draft`, 'POST', {
        documentType,
        context: { ...formData, query }
      });
      if (!response.ok) throw new Error('Draft generation failed');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Document Generated",
        description: "Your draft has been created successfully",
      });
    }
  });
  
  // Autosave effect
  useEffect(() => {
    if (!autosaveEnabled || !domainId) return;
    
    const saveData = { domainId, query, formData, consultation };
    const key = `consultation_${domainId}_draft`;
    localStorage.setItem(key, JSON.stringify(saveData));
  }, [query, formData, consultation, domainId, autosaveEnabled]);
  
  // Load saved data on mount
  useEffect(() => {
    if (!domainId) return;
    
    const key = `consultation_${domainId}_draft`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.domainId === domainId) {
          setQuery(data.query || '');
          setFormData(data.formData || {});
          setConsultation(data.consultation || null);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [domainId]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      toast({
        title: "Query Required",
        description: "Please describe your legal issue",
        variant: "destructive"
      });
      return;
    }
    
    consultMutation.mutate({
      query,
      context: formData
    });
  };
  
  const handleFieldChange = (fieldId: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };
  
  if (!domainId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Invalid domain</p>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`${domainInfo?.name || 'Legal'} Consultation | LegalWhat`}
        description={`Get AI-powered assistance with ${domainInfo?.name || 'legal'} matters`}
      />
      
      <AppHeader
        title={domainInfo?.name || 'Legal Consultation'}
        subtitle="4JI AI-Powered Analysis"
        fallbackRoute="/welcome"
      />
      
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Domain Info Header */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Scale className="h-6 w-6" />
                  {domainInfo?.name || 'Legal Consultation'}
                </CardTitle>
                <CardDescription className="mt-2">
                  {domainInfo?.description || 'AI-powered legal assistance'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  4JI Orchestrated
                </Badge>
                {autosaveEnabled && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Save className="h-3 w-3" />
                    Autosave On
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Consultation Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Describe Your Legal Issue
                </CardTitle>
                <CardDescription>
                  Provide details about your situation for accurate analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Issue Type */}
                  <div className="space-y-2">
                    <Label htmlFor="issueType">Type of Issue</Label>
                    <Select 
                      value={formData.issueType || ''} 
                      onValueChange={(v) => handleFieldChange('issueType', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select issue type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General Inquiry</SelectItem>
                        <SelectItem value="document">Document Review</SelectItem>
                        <SelectItem value="case">Case Evaluation</SelectItem>
                        <SelectItem value="research">Legal Research</SelectItem>
                        <SelectItem value="filing">Court Filing Assistance</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Main Query */}
                  <div className="space-y-2">
                    <Label htmlFor="query">Describe Your Situation</Label>
                    <Textarea
                      id="query"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Provide as much detail as possible about your legal issue..."
                      className="min-h-[150px]"
                      required
                    />
                  </div>
                  
                  {/* Additional Context */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="state">State/Jurisdiction</Label>
                      <Input
                        id="state"
                        value={formData.state || ''}
                        onChange={(e) => handleFieldChange('state', e.target.value)}
                        placeholder="e.g., California"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deadline">Any Deadlines?</Label>
                      <Input
                        id="deadline"
                        type="date"
                        value={formData.deadline || ''}
                        onChange={(e) => handleFieldChange('deadline', e.target.value)}
                      />
                    </div>
                  </div>
                  
                  {/* Submit */}
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setQuery('');
                        setFormData({});
                        setConsultation(null);
                      }}
                    >
                      Clear
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={consultMutation.isPending}
                    >
                      {consultMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Send className="mr-2 h-4 w-4" />
                          Get Analysis
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
            
            {/* Results */}
            {consultation && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      Analysis Results
                    </CardTitle>
                    <Badge 
                      variant={consultation.confidence >= 0.7 ? "default" : "secondary"}
                    >
                      Confidence: {(consultation.confidence * 100).toFixed(0)}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Main Response */}
                  <div>
                    <h4 className="font-semibold mb-2">Analysis</h4>
                    <p className="text-muted-foreground">{consultation.response}</p>
                  </div>
                  
                  {/* Citations */}
                  {consultation.citations.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <Book className="h-4 w-4" />
                        Relevant Citations
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {consultation.citations.map((citation, idx) => (
                          <Badge key={idx} variant="outline">
                            {citation}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Suggested Actions */}
                  {consultation.suggestedActions.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <Lightbulb className="h-4 w-4" />
                        Suggested Actions
                      </h4>
                      <ul className="space-y-2">
                        {consultation.suggestedActions.map((action, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0" />
                            <span className="text-sm">{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {/* Templates */}
                  {consultation.templates.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Available Templates
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {consultation.templates.map((template, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            onClick={() => draftMutation.mutate(template)}
                            disabled={draftMutation.isPending}
                          >
                            Generate: {template.replace(/-/g, ' ')}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
          
          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => setLocation('/welcome')}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Library
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => {
                    // Voice input would go here
                    toast({
                      title: "Voice Input",
                      description: "Voice input feature coming soon",
                    });
                  }}
                >
                  <Volume2 className="mr-2 h-4 w-4" />
                  Voice Input
                </Button>
              </CardContent>
            </Card>
            
            {/* System Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  System Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>4JI Orchestrator</span>
                    <span className="text-green-500">Active</span>
                  </div>
                  <Progress value={100} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Knowledge Base</span>
                    <span className="text-green-500">Loaded</span>
                  </div>
                  <Progress value={100} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>AI Models</span>
                    <span className="text-green-500">Ready</span>
                  </div>
                  <Progress value={100} className="h-2" />
                </div>
              </CardContent>
            </Card>
            
            {/* Domain Info */}
            {domainData?.domain && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Domain Details</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div>
                    <span className="text-muted-foreground">Domain:</span>{' '}
                    {domainData.domain.name}
                  </div>
                  <div>
                    <span className="text-muted-foreground">ID:</span>{' '}
                    {domainData.domain.id}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Description:</span>{' '}
                    {domainData.domain.description}
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Help Notice */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Legal Disclaimer</AlertTitle>
              <AlertDescription className="text-xs">
                This AI analysis is for informational purposes only and does not 
                constitute legal advice. Always consult with a qualified attorney 
                for legal matters.
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </main>
    </div>
  );
}
