import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Search, ArrowRight, Scale, FileText, User } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";
import { LAW_TYPES } from "@shared/schema";
import SampleLegalConsultation from "@/components/SampleLegalConsultation";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LegalizoWelcome() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedLawType, setSelectedLawType] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter law types based on search
  const filteredLawTypes = LAW_TYPES.filter(lawType =>
    lawType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleLawTypeSelect = (lawType: string) => {
    setSelectedLawType(lawType);
  };

  const handleLetsGo = () => {
    if (selectedLawType) {
      setLocation(`/legalizo-consultation?lawType=${encodeURIComponent(selectedLawType)}`);
    }
  };

  const handleLogout = async () => {
    window.location.href = "/api/logout";
  };

  if (!user) {
    setLocation('/legalizo-auth');
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Welcome - LegalWhat"
        description="Access your legal services dashboard"
      />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center gap-4 px-4">
          <Link href="/legalizo-welcome" className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">LegalWhat</span>
          </Link>
          
          <nav className="ml-8 flex gap-6">
            <Link href="/legalizo-welcome">
              <Button variant="ghost" size="sm">Home</Button>
            </Link>
            <Link href="/legalizo-people-search">
              <Button variant="ghost" size="sm">
                <Search className="w-4 h-4 mr-2" />
                People Search
              </Button>
            </Link>
          </nav>

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
        {/* Welcome Message */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Welcome, {user.firstName}!
          </h1>
          <p className="text-muted-foreground text-lg">
            Your AI-powered legal partner is ready to assist you
          </p>
        </div>

        {/* Legal Consultation Tool Preview */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Scale className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold">Legal Consultation Tool</h2>
            <Badge variant="secondary">Preview</Badge>
          </div>
          <Card>
            <CardHeader>
              <CardDescription>
                Get a preview of our AI-powered legal consultation tool. Select a law type below to access the full version.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SampleLegalConsultation />
            </CardContent>
          </Card>
        </div>

        {/* Document Creator Tool Preview */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold">Document Creation Tool</h2>
            <Badge variant="secondary">Preview</Badge>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>AI-Powered Document Generation</CardTitle>
              <CardDescription>
                Create professional legal documents with intelligent AI assistance. Our document creator automatically transfers information from your consultation to generate tailored documents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <FileText className="h-4 w-4" />
                <AlertDescription>
                  Select a law type below to access the full consultation and document creation workflow
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>

        {/* Law Type Selection */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Select Your Legal Area</h2>
          
          {/* Search */}
          <div className="mb-6">
            <Input
              type="text"
              placeholder="Search law types..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
          </div>

          {/* Law Types Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {filteredLawTypes.map((lawType) => (
              <Card
                key={lawType}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedLawType === lawType
                    ? 'ring-2 ring-primary bg-primary/5'
                    : ''
                }`}
                onClick={() => handleLawTypeSelect(lawType)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{lawType}</CardTitle>
                    {selectedLawType === lawType && (
                      <Badge>Selected</Badge>
                    )}
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>

          {/* Let's Go Button */}
          {selectedLawType && (
            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={handleLetsGo}
                className="min-w-[200px]"
              >
                Let's Go
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          )}

          {filteredLawTypes.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No law types match your search
            </div>
          )}
        </div>

        {/* Link to Legacy Bad Blue App */}
        <div className="border-t pt-8 mt-12">
          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle>Looking for the Original Bad Blue App?</CardTitle>
              <CardDescription>
                Access all the original features and tools from the Bad Blue police accountability platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                onClick={() => setLocation('/home')}
                className="w-full sm:w-auto"
              >
                Access Original Bad Blue App
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-12 border-t text-center text-sm text-muted-foreground">
        <p>© 2024 LegalWhat. All rights reserved.</p>
        <p className="mt-2">AI-powered legal services platform</p>
      </footer>
    </div>
  );
}
