import { useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";

export default function SubscriptionSuccess() {
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    // Redirect to welcome page after 3 seconds
    const timer = setTimeout(() => {
      setLocation('/');
    }, 3000);
    return () => clearTimeout(timer);
  }, [setLocation]);
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SEOHead
        title="Payment Successful - LegalWhat"
        description="Your subscription payment was successful"
        noIndex={true}
      />
      <Card className="max-w-md">
        <CardContent className="pt-6 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Payment Successful!</h1>
          <p className="text-muted-foreground">
            Your LegalWhat subscription is now active. Redirecting...
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
