import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Loader2,
  DollarSign,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
  Send,
  Edit,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { LEGAL_DOCUMENT_CREATOR_PRICING } from "@shared/schema";

interface QuestionnaireQuestion {
  id: string;
  question: string;
  type: "text" | "select" | "multiline";
  options?: string[];
  required: boolean;
  helpText?: string;
}

interface SessionState {
  sessionId: string | null;
  status: "idle" | "questionnaire" | "generating" | "preview" | "checkout" | "paid";
  questions: QuestionnaireQuestion[];
  answers: Record<string, string>;
  draftPreview: string | null;
  documentType: string | null;
  jurisdiction: string | null;
  message: string;
  readyToDraft: boolean;
}

const initialState: SessionState = {
  sessionId: null,
  status: "idle",
  questions: [],
  answers: {},
  draftPreview: null,
  documentType: null,
  jurisdiction: null,
  message: "",
  readyToDraft: false,
};

export default function LegalDocumentCreatorPanel() {
  const { toast } = useToast();
  const [state, setState] = useState<SessionState>(initialState);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [editRequest, setEditRequest] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);

  // Initialize session
  const initSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/legal/session", "POST", {});
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to start session");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setState({
        ...initialState,
        sessionId: data.sessionId,
        status: "questionnaire",
        questions: data.questions,
        message: data.message,
      });
      setIsDialogOpen(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Submit answers
  const submitAnswersMutation = useMutation({
    mutationFn: async (answers: Record<string, string>) => {
      const response = await apiRequest(
        `/api/legal/session/${state.sessionId}/answer`,
        "POST",
        { answers }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to submit answers");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setState((prev) => ({
        ...prev,
        questions: data.nextQuestions || [],
        readyToDraft: data.readyToDraft,
        documentType: data.inferredDocumentType || prev.documentType,
        jurisdiction: data.inferredJurisdiction || prev.jurisdiction,
        message: data.message || prev.message,
      }));
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Generate draft
  const generateDraftMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        `/api/legal/session/${state.sessionId}/generate`,
        "POST",
        {}
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate document");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setState((prev) => ({
        ...prev,
        status: "preview",
        draftPreview: data.documentPreview,
        documentType: data.documentType,
        jurisdiction: data.jurisdiction,
        message: data.message,
      }));
    },
    onError: (error: Error) => {
      setState((prev) => ({ ...prev, status: "questionnaire" }));
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Request edit
  const requestEditMutation = useMutation({
    mutationFn: async (request: string) => {
      const response = await apiRequest(
        `/api/legal/session/${state.sessionId}/edit`,
        "POST",
        { editRequest: request }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to process edit");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setState((prev) => ({
        ...prev,
        draftPreview: data.documentPreview,
        message: data.message,
      }));
      setEditRequest("");
      setShowEditForm(false);
      toast({
        title: "Document Updated",
        description: "Your requested changes have been applied.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Edit Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create checkout
  const createCheckoutMutation = useMutation({
    mutationFn: async (userEmail: string) => {
      const response = await apiRequest(
        `/api/legal/session/${state.sessionId}/checkout`,
        "POST",
        { email: userEmail }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create checkout");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setState((prev) => ({ ...prev, status: "checkout" }));
      // Redirect to Stripe
      window.location.href = data.checkoutUrl;
    },
    onError: (error: Error) => {
      toast({
        title: "Checkout Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle answer change
  const handleAnswerChange = (questionId: string, value: string) => {
    setState((prev) => ({
      ...prev,
      answers: { ...prev.answers, [questionId]: value },
    }));
  };

  // Handle submit answers
  const handleSubmitAnswers = () => {
    const currentAnswers = { ...state.answers };
    submitAnswersMutation.mutate(currentAnswers);
  };

  // Handle generate draft
  const handleGenerateDraft = () => {
    setState((prev) => ({ ...prev, status: "generating" }));
    generateDraftMutation.mutate();
  };

  // Handle checkout
  const handleCheckout = () => {
    if (!email.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter your email to receive the document.",
        variant: "destructive",
      });
      return;
    }
    createCheckoutMutation.mutate(email);
  };

  // Handle edit request
  const handleRequestEdit = () => {
    if (!editRequest.trim()) {
      toast({
        title: "Edit Request Required",
        description: "Please describe what changes you want.",
        variant: "destructive",
      });
      return;
    }
    requestEditMutation.mutate(editRequest);
  };

  // Prevent copy on preview
  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    toast({
      title: "Copy Disabled",
      description: "Please complete payment to receive your document.",
      variant: "default",
    });
  }, [toast]);

  // Handle start button
  const handleStart = () => {
    initSessionMutation.mutate();
  };

  // Handle close dialog
  const handleClose = () => {
    setIsDialogOpen(false);
    setState(initialState);
  };

  // Check for payment success on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get("legal_doc_payment");
    const sessionId = urlParams.get("session");

    if (paymentStatus === "success" && sessionId) {
      toast({
        title: "Payment Successful!",
        description: "Your legal document will be sent to your email shortly.",
      });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (paymentStatus === "cancelled") {
      toast({
        title: "Payment Cancelled",
        description: "Your payment was cancelled. Your draft is still saved.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  // Render questionnaire form
  const renderQuestionnaire = () => (
    <div className="space-y-6">
      {state.message && (
        <p className="text-muted-foreground">{state.message}</p>
      )}
      
      {state.documentType && (
        <div className="p-3 bg-primary/10 rounded-lg">
          <p className="text-sm font-medium">
            Document Type: <span className="text-primary">{state.documentType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
          </p>
          {state.jurisdiction && (
            <p className="text-sm text-muted-foreground">
              Jurisdiction: {state.jurisdiction}
            </p>
          )}
        </div>
      )}

      {state.questions.map((question) => (
        <div key={question.id} className="space-y-2">
          <Label htmlFor={question.id}>
            {question.question}
            {question.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          
          {question.type === "text" && (
            <Input
              id={question.id}
              value={state.answers[question.id] || ""}
              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
              placeholder={question.helpText}
            />
          )}
          
          {question.type === "multiline" && (
            <Textarea
              id={question.id}
              value={state.answers[question.id] || ""}
              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
              placeholder={question.helpText}
              rows={4}
            />
          )}
          
          {question.type === "select" && question.options && (
            <Select
              value={state.answers[question.id] || ""}
              onValueChange={(value) => handleAnswerChange(question.id, value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={question.helpText || "Select..."} />
              </SelectTrigger>
              <SelectContent>
                {question.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
          {question.helpText && question.type !== "select" && (
            <p className="text-xs text-muted-foreground">{question.helpText}</p>
          )}
        </div>
      ))}

      <div className="flex gap-4 pt-4">
        {state.readyToDraft ? (
          <Button
            onClick={handleGenerateDraft}
            disabled={generateDraftMutation.isPending}
            className="flex-1"
          >
            {generateDraftMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Document...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Generate Document
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={handleSubmitAnswers}
            disabled={submitAnswersMutation.isPending}
            className="flex-1"
          >
            {submitAnswersMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Continue
              </>
            )}
          </Button>
        )}
        
        <Button variant="outline" onClick={handleClose}>
          Cancel
        </Button>
      </div>
    </div>
  );

  // Render generating state
  const renderGenerating = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <Loader2 className="w-12 h-12 animate-spin text-primary" />
      <p className="text-lg font-medium">Generating Your Document...</p>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        Our AI is researching jurisdiction-specific requirements and drafting your professional legal document. This may take a minute.
      </p>
    </div>
  );

  // Render preview
  // Note: Client-side copy protection (userSelect:none, onCopy) is a UX deterrent only.
  // The actual document protection is server-side: full document only sent via email after payment.
  const renderPreview = () => (
    <div className="space-y-6">
      <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center gap-2">
        <CheckCircle className="w-5 h-5 text-green-600" />
        <p className="text-sm font-medium text-green-800 dark:text-green-200">
          Your {state.documentType?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} is ready!
        </p>
      </div>

      <div 
        className="bg-muted/50 p-6 rounded-lg border max-h-96 overflow-y-auto"
        style={{ userSelect: "none" }}
        onCopy={handleCopy}
      >
        <pre className="whitespace-pre-wrap text-sm font-mono select-none">
          {state.draftPreview}
        </pre>
      </div>

      <div className="p-3 bg-amber-100 dark:bg-amber-900/20 rounded-lg flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Preview Only
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Complete payment to receive the full document via email.
          </p>
        </div>
      </div>

      {showEditForm ? (
        <div className="space-y-4 p-4 border rounded-lg">
          <Label htmlFor="edit-request">Describe the changes you want:</Label>
          <Textarea
            id="edit-request"
            value={editRequest}
            onChange={(e) => setEditRequest(e.target.value)}
            placeholder="e.g., Change the deadline to 30 days, add a paragraph about late fees..."
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              onClick={handleRequestEdit}
              disabled={requestEditMutation.isPending}
              variant="outline"
            >
              {requestEditMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Apply Changes"
              )}
            </Button>
            <Button variant="ghost" onClick={() => setShowEditForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setShowEditForm(true)}
          className="w-full"
        >
          <Edit className="w-4 h-4 mr-2" />
          Request Changes
        </Button>
      )}

      <div className="space-y-4 border-t pt-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email for Document Delivery</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>

        <Button
          onClick={handleCheckout}
          disabled={createCheckoutMutation.isPending}
          className="w-full"
          size="lg"
        >
          {createCheckoutMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <DollarSign className="w-4 h-4 mr-2" />
              Pay ${LEGAL_DOCUMENT_CREATOR_PRICING} & Receive Document
            </>
          )}
        </Button>
      </div>

      <Button variant="ghost" onClick={handleClose} className="w-full">
        Cancel
      </Button>
    </div>
  );

  // Render dialog content based on status
  const renderDialogContent = () => {
    switch (state.status) {
      case "questionnaire":
        return renderQuestionnaire();
      case "generating":
        return renderGenerating();
      case "preview":
        return renderPreview();
      default:
        return null;
    }
  };

  return (
    <>
      {/* Panel Card on Home Page */}
      <Card
        className="hover-elevate cursor-pointer transition-all"
        onClick={handleStart}
        data-testid="card-legal-document-creator"
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-primary/10">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl">Legal Document Creator</CardTitle>
                <CardDescription className="mt-1">
                  AI-powered legal documents - <span className="text-primary font-semibold">${LEGAL_DOCUMENT_CREATOR_PRICING}</span>
                </CardDescription>
              </div>
            </div>
            <ChevronRight className="w-6 h-6 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-3">
            Generate professional legal documents customized for your jurisdiction. Our AI creates demand letters, cease & desist notices, affidavits, and more.
          </p>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Jurisdiction-aware drafting</li>
            <li>• Multiple document types supported</li>
            <li>• AI-powered questionnaire guides you</li>
            <li>• Document delivered via email</li>
          </ul>
        </CardContent>
      </Card>

      {/* Dialog for Document Creation Flow */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Legal Document Creator
            </DialogTitle>
            <DialogDescription>
              {state.status === "questionnaire" && "Answer a few questions to generate your document."}
              {state.status === "generating" && "Creating your document..."}
              {state.status === "preview" && "Review your document before payment."}
            </DialogDescription>
          </DialogHeader>
          
          {renderDialogContent()}
        </DialogContent>
      </Dialog>
    </>
  );
}
