import OfficerSearch from "@/components/OfficerSearch";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function OfficerSearchPage() {
  const [, setLocation] = useLocation();

  return (
    <>
      <SEOHead
        title="Officer Search - BadBlue Police Accountability"
        description="Search public records for police officer information including rank, disciplinary history, lawsuits, and career history. Comprehensive database search for police accountability."
        keywords="police officer search, officer lookup, police accountability, disciplinary records, police database"
      />
      <div className="min-h-screen bg-background">
        <div className="container max-w-4xl mx-auto px-4 py-4">
          <Button
            variant="ghost"
            onClick={() => setLocation("/")}
            className="mb-4"
            data-testid="button-back-to-dashboard"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
        <OfficerSearch onBack={() => setLocation("/")} />
      </div>
    </>
  );
}
