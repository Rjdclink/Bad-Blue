import { useState, useEffect, useRef, ClipboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileText, DollarSign, ArrowLeft, Shield, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";
import { apiRequest } from "@/lib/queryClient";

// Document types
const DOCUMENT_TYPES = [
  { value: 'demand_letter', label: 'Demand Letter', description: 'A formal letter demanding specific action or payment' },
  { value: 'cease_desist', label: 'Cease and Desist', description: 'A letter demanding the recipient stop specific behavior' },
  { value: 'notice_of_intent', label: 'Notice of Intent to Sue', description: 'A formal notice that legal action may be taken' },
  { value: 'formal_complaint', label: 'Formal Complaint', description: 'A detailed complaint documenting grievances' },
  { value: 'settlement_proposal', label: 'Settlement Proposal', description: 'A proposal for resolving a dispute without litigation' },
];

// Service price
const LEGAL_DOCUMENT_PRICE = 3.00;

export default function LegalDocumentCreate() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Form fields
  const [documentType, setDocumentType] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [context, setContext] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderAddress, setSenderAddress] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [damagesAmount, setDamagesAmount] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  
  // Reference for protected fields
  const contextRef = useRef<HTMLTextAreaElement>(null);
  const additionalDetailsRef = useRef<HTMLTextAreaElement>(null);

  // Pre-fill sender name from user data
  useEffect(() => {
    if (user) {
      setSenderName(`${user.firstName || ''} ${user.lastName || ''}`.trim());
    }
  }, [user]);

  // Prevent copy/cut/paste on sensitive fields
  const handlePreventCopyPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    toast({
      title: "Action Not Allowed",
      description: "Copy, cut, and paste are disabled for security reasons. Please type your information directly.",
      variant: "destructive",
    });
  };

  // Also prevent right-click context menu
  const handlePreventContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    toast({
      title: "Action Not Allowed",
      description: "Right-click is disabled on this form for security.",
      variant: "destructive",
    });
  };

  // Payment mutation
  const createPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("/api/legal-document/create", "POST", data);
      return await res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({
          title: "Error",
          description: "Failed to create payment session",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create payment",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    if (!documentType || !recipientName || !context || !senderName) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Create payment session
    createPaymentMutation.mutate({
      documentType,
      recipientName,
      recipientAddress,
      context,
      senderName,
      senderAddress,
      incidentDate,
      damagesAmount: damagesAmount ? parseInt(damagesAmount) * 100 : undefined, // Convert to cents
      additionalDetails,
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Login Required</CardTitle>
            <CardDescription>Please sign in to create legal documents</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.href = "/login"} className="w-full">
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Create Legal Document | BadBlue - Professional Legal Document Generator"
        description="Generate professional legal documents including demand letters, cease and desist letters, and more using AI-powered document generation."
        keywords="legal document generator, demand letter, cease and desist, legal letter template, professional legal document"
      />
      
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.location.href = "/home"}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary" />
              <span className="font-bold text-xl">Legal Document Service</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span>${LEGAL_DOCUMENT_PRICE.toFixed(2)}</span>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Info Banner */}
        <Card className="mb-6 border-yellow-400/50 bg-yellow-50/50 dark:bg-yellow-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800 dark:text-yellow-200">Important Disclaimer</p>
                <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                  This service generates legal documents using AI. Documents are for informational purposes only 
                  and do not constitute legal advice. Consult with a licensed attorney before using any legal document.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Create Legal Document
            </CardTitle>
            <CardDescription>
              Generate a professional legal document using our 3-way AI system (Claude + Gemini + Mistral)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Document Type */}
              <div className="space-y-2">
                <Label htmlFor="documentType">Document Type *</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select document type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div>
                          <div className="font-medium">{type.label}</div>
                          <div className="text-xs text-muted-foreground">{type.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Sender Information */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="senderName">Your Name *</Label>
                  <Input
                    id="senderName"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="Your full name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senderAddress">Your Address</Label>
                  <Input
                    id="senderAddress"
                    value={senderAddress}
                    onChange={(e) => setSenderAddress(e.target.value)}
                    placeholder="Your mailing address"
                  />
                </div>
              </div>

              {/* Recipient Information */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="recipientName">Recipient Name *</Label>
                  <Input
                    id="recipientName"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Name of person/organization"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recipientAddress">Recipient Address</Label>
                  <Input
                    id="recipientAddress"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="Recipient's address"
                  />
                </div>
              </div>

              {/* Context - Protected from copy/paste */}
              <div className="space-y-2">
                <Label htmlFor="context">Situation/Context *</Label>
                <Textarea
                  id="context"
                  ref={contextRef}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  onCopy={handlePreventCopyPaste}
                  onCut={handlePreventCopyPaste}
                  onPaste={handlePreventCopyPaste}
                  onContextMenu={handlePreventContextMenu}
                  placeholder="Describe the situation that requires this legal document. Be specific about what happened, when, and what you want as an outcome."
                  className="min-h-[150px] select-none"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Copy/paste is disabled for security. Please type your information directly.
                </p>
              </div>

              {/* Optional Fields */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="incidentDate">Incident Date</Label>
                  <Input
                    id="incidentDate"
                    type="date"
                    value={incidentDate}
                    onChange={(e) => setIncidentDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="damagesAmount">Damages Amount ($)</Label>
                  <Input
                    id="damagesAmount"
                    type="number"
                    value={damagesAmount}
                    onChange={(e) => setDamagesAmount(e.target.value)}
                    placeholder="Amount in dollars"
                    min="0"
                  />
                </div>
              </div>

              {/* Additional Details - Protected from copy/paste */}
              <div className="space-y-2">
                <Label htmlFor="additionalDetails">Additional Details</Label>
                <Textarea
                  id="additionalDetails"
                  ref={additionalDetailsRef}
                  value={additionalDetails}
                  onChange={(e) => setAdditionalDetails(e.target.value)}
                  onCopy={handlePreventCopyPaste}
                  onCut={handlePreventCopyPaste}
                  onPaste={handlePreventCopyPaste}
                  onContextMenu={handlePreventContextMenu}
                  placeholder="Any additional information that should be included in the document"
                  className="min-h-[100px] select-none"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-4 border-t">
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={createPaymentMutation.isPending}
                >
                  {createPaymentMutation.isPending ? (
                    "Processing..."
                  ) : (
                    <>
                      <DollarSign className="mr-2 h-4 w-4" />
                      Pay ${LEGAL_DOCUMENT_PRICE.toFixed(2)} & Generate Document
                    </>
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-2">
                  Document will be emailed to you after payment
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
