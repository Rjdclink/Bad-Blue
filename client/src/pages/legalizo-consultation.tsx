import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, ArrowLeft, Scale, FileText, User, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";
import LegalConsultation from "@/components/LegalConsultation";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LegalizoConsultation() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [lawType, setLawType] = useState<string>("");
  const [consultationData, setConsultationData] = useState<any>(null);

  // Get law type from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lawTypeParam = params.get('lawType');
    if (lawTypeParam) {
      setLawType(lawTypeParam);
    }
  }, [location]);

  const handleLogout = async () => {
    window.location.href = "/api/logout";
  };

  if (!user) {
    setLocation('/legalizo-auth');
    return null;
  }

  if (!lawType) {
    setLocation('/legalizo-welcome');
    return null;
  }

  const handleConsultationDataChange = (data: any) => {
    setConsultationData(data);
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`${lawType} - Legal Consultation & Documents | LegalWhat`}
        description="Complete legal consultation and document creation workflow"
      />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center gap-4 px-4">
          <Link href="/legalizo-welcome" className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">LegalWhat</span>
          </Link>
          
          <div className="ml-8">
            <Badge variant="secondary" className="text-sm">
              {lawType}
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">
                {user.firstName} {user.lastName}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => setLocation('/legalizo-welcome')}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Law Types
        </Button>

        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">{lawType}</h1>
          <p className="text-muted-foreground text-lg">
            Complete your consultation and create legal documents
          </p>
        </div>

        {/* Legal Consultation Tool */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Scale className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold">Legal Consultation</h2>
          </div>
          <Card>
            <CardHeader>
              <CardDescription>
                Answer questions about your case. Your responses will automatically populate the document creation tool below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LegalConsultation 
                lawType={lawType}
                onDataChange={handleConsultationDataChange}
              />
            </CardContent>
          </Card>
        </div>

        {/* Document Creator Tool */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold">Document Creation</h2>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Generate Legal Documents</CardTitle>
              <CardDescription>
                Review and edit the information transferred from your consultation, then generate your legal documents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {consultationData ? (
                <div className="space-y-6">
                  {/* Display consultation data */}
                  <Alert>
                    <RefreshCw className="h-4 w-4" />
                    <AlertDescription>
                      Information from your consultation has been automatically transferred below
                    </AlertDescription>
                  </Alert>

                  {/* Editable fields populated from consultation */}
                  <div className="bg-muted p-6 rounded-lg space-y-4">
                    <h3 className="font-semibold text-lg mb-4">Consultation Summary</h3>
                    
                    {consultationData.question && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Your Question</p>
                        <p className="text-sm">{consultationData.question}</p>
                      </div>
                    )}

                    {consultationData.response && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">AI Analysis</p>
                        <p className="text-sm whitespace-pre-wrap">{consultationData.response}</p>
                      </div>
                    )}

                    {/* Additional fields would be populated here based on the specific law type */}
                  </div>

                  <div className="flex gap-4">
                    <Button className="flex-1">
                      Generate Document
                    </Button>
                    <Button variant="outline">
                      Edit Information
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert>
                  <FileText className="h-4 w-4" />
                  <AlertDescription>
                    Complete the consultation above to begin document creation. Information will be automatically transferred here.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-12 border-t text-center text-sm text-muted-foreground">
        <p>© 2024 Legalizo. All rights reserved.</p>
      </footer>
    </div>
  );
}
