import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Shield, FileText, Send, Loader2, Copy, CheckCircle, Edit } from "lucide-react";
import { Link } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { FileUpload } from "@/components/FileUpload";

interface Message {
  role: 'assistant' | 'user';
  content: string;
}

export default function LegalDocumentCreator() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<string>("initial");
  const [generatedDocument, setGeneratedDocument] = useState<string | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const [revisionRequest, setRevisionRequest] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!user) {
      setLocation("/badblue");
    }
  }, [user, setLocation]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const response = await fetch("/api/document-creator/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          throw new Error("Failed to start session");
        }

        const data = await response.json();
        setSessionId(data.sessionId);
        setPhase(data.phase);
        setMessages([{ role: 'assistant', content: data.message }]);
      } catch (error) {
        console.error("Error starting session:", error);
        toast({
          title: "Error",
          description: "Failed to start document creator session",
          variant: "destructive",
        });
      }
    };

    initSession();
  }, [toast]);

  const handleSendMessage = async () => {
    if (!userInput.trim() || !sessionId || isLoading) return;

    const newMessage: Message = { role: 'user', content: userInput };
    setMessages(prev => [...prev, newMessage]);
    setUserInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/document-creator/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: userInput,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to process message");
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
      setPhase(data.phase);

      if (data.documentGenerated && data.document) {
        setGeneratedDocument(data.document);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Error",
        description: "Failed to process your message",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReviseDocument = async () => {
    if (!revisionRequest.trim() || !sessionId || isRevising) return;

    setIsRevising(true);

    try {
      const response = await fetch("/api/document-creator/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          revisionRequest,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to revise document");
      }

      const data = await response.json();
      setGeneratedDocument(data.document);
      setRevisionRequest("");
      toast({
        title: "Success",
        description: "Document revised successfully",
      });
    } catch (error) {
      console.error("Error revising document:", error);
      toast({
        title: "Error",
        description: "Failed to revise document",
        variant: "destructive",
      });
    } finally {
      setIsRevising(false);
    }
  };

  const handlePayment = async () => {
    if (!sessionId) return;

    try {
      const response = await fetch("/api/document-creator/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error("Failed to create payment session");
      }

      const data = await response.json();
      
      // Redirect to Stripe checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Error creating payment:", error);
      toast({
        title: "Error",
        description: "Failed to process payment",
        variant: "destructive",
      });
    }
  };

  const handleCopyDocument = () => {
    if (generatedDocument) {
      navigator.clipboard.writeText(generatedDocument);
      toast({
        title: "Copied",
        description: "Document copied to clipboard",
      });
    }
  };

  if (!user) return null;

  return (
    <>
      <SEOHead 
        title="Legal Document Creator | BadBlue"
        description="Create professional legal documents through conversational AI"
      />
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
          <div className="container flex h-14 items-center gap-4 px-4">
            <Link href="/" className="flex items-center gap-2">
              <Shield className="h-10 w-auto text-primary" />
              <span className="font-semibold">BadBlue</span>
            </Link>
            <div className="ml-auto">
              <Link href="/welcome">
                <Button variant="ghost" size="sm">← Back to Dashboard</Button>
              </Link>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="container max-w-6xl mx-auto px-4 py-8">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Chat Interface */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="w-6 h-6 text-primary" />
                  <div>
                    <CardTitle>Legal Document Creator</CardTitle>
                    <CardDescription>
                      Conversational AI-powered document generation
                    </CardDescription>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <Badge variant="secondary">5 AI Providers</Badge>
                  <Badge variant="secondary">8 Models</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {/* Messages */}
                <div className="space-y-4 mb-4 max-h-96 overflow-y-auto">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg ${
                        msg.role === 'assistant'
                          ? 'bg-muted'
                          : 'bg-primary/10 ml-8'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Processing...</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                {!generatedDocument && (
                  <div className="flex gap-2">
                    <Input
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Type your response..."
                      disabled={isLoading}
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={isLoading || !userInput.trim()}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Document Preview */}
            <Card>
              <CardHeader>
                <CardTitle>Document Preview</CardTitle>
                <CardDescription>
                  {generatedDocument 
                    ? "Your document is ready" 
                    : "Document will appear here once generated"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {generatedDocument ? (
                  <div>
                    {/* Document display with copy protection */}
                    <div 
                      className="bg-muted p-4 rounded-lg mb-4 max-h-96 overflow-y-auto"
                      style={{ 
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        MozUserSelect: 'none',
                        msUserSelect: 'none'
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <div className="relative">
                        {/* Watermark overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                          <div className="text-4xl font-bold transform -rotate-45">
                            UNPAID PREVIEW
                          </div>
                        </div>
                        <pre className="text-sm whitespace-pre-wrap font-mono">
                          {generatedDocument}
                        </pre>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="space-y-3">
                      <Button 
                        onClick={handlePayment}
                        className="w-full"
                        size="lg"
                      >
                        <CheckCircle className="w-5 h-5 mr-2" />
                        Pay $3.99 & Receive Document
                      </Button>

                      {/* Revision Section */}
                      <div className="border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Edit className="w-4 h-4" />
                          <span className="text-sm font-medium">Request Changes</span>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={revisionRequest}
                            onChange={(e) => setRevisionRequest(e.target.value)}
                            placeholder="Describe changes you'd like..."
                            disabled={isRevising}
                          />
                          <Button
                            onClick={handleReviseDocument}
                            disabled={isRevising || !revisionRequest.trim()}
                            variant="outline"
                          >
                            {isRevising ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground text-center">
                        After payment, you'll receive the full document via email
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-12">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Continue the conversation to generate your document</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Evidence Upload Section - Stage 2B */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Upload Supporting Documents</CardTitle>
              <CardDescription>
                Upload any evidence or documents related to your case (optional)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUpload 
                associatedWith="document"
                maxFiles={10}
                maxSizeMB={50}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
