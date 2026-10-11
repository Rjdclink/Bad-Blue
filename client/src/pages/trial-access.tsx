import { useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Loader2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SEOHead } from "@/components/SEOHead";
import { apiRequest } from "@/lib/queryClient";

interface TrialAccessPageProps {
  review?: boolean;
  required?: boolean;
  early?: boolean;
}

export default function TrialAccessPage({ review = false, required = false, early = false }: TrialAccessPageProps) {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const continueWithSubscription = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await apiRequest("/api/subscription/checkout", "POST");
      const data = await response.json();
      if (data.alreadyActive) {
        setLocation(data.redirectUrl || "/lexara-consent", { replace: true });
        return;
      }

      const rawUrl = String(data.checkoutUrl || "").trim();
      if (!rawUrl) throw new Error("Square checkout did not return a payment page");
      const checkoutUrl = new URL(rawUrl);
      const host = checkoutUrl.hostname.toLowerCase();
      const trustedSquareHost =
        host === "square.link" ||
        host === "squareup.com" ||
        host.endsWith(".squareup.com") ||
        host === "square.site" ||
        host.endsWith(".square.site");
      if (checkoutUrl.protocol !== "https:" || !trustedSquareHost) {
        throw new Error("Square returned an invalid checkout destination");
      }

      if (data.orderId) {
        window.sessionStorage.setItem("legalwhat_pending_square_order_id", String(data.orderId));
      }
      window.location.assign(checkoutUrl.toString());
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Checkout is unavailable";
      if (/^401\b/.test(message)) {
        setLocation("/login");
        return;
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4 pt-20">
      <SEOHead
        title={review
          ? "Trial Eligibility Review | Legal What?"
          : early
            ? "Continue After Your Trial | Legal What?"
          : required
            ? "Subscription Required | Legal What?"
            : "Free Trial Ended | Legal What?"}
        description={review
          ? "Get help with your Legal What? trial eligibility."
          : early
            ? "Your free trial remains active. Set up a subscription when you are ready."
          : required
            ? "Start a Legal What? subscription to access protected tools."
          : "Continue your Legal What? subscription after the free trial."}
        noIndex
      />
      <div className="absolute left-4 top-4 z-20 sm:left-6 sm:top-6">
        <BackButton fallbackRoute="/login" />
      </div>

      <Card className="w-full max-w-lg">
        <CardContent className="space-y-5 px-6 py-8 text-center sm:px-8">
          <AlertCircle className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">
              {review
                ? "We need to review trial eligibility"
                : early
                  ? "Your free trial is still active"
                : required
                  ? "A subscription is required"
                  : "Your free trial has ended"}
            </h1>
            <p className="text-muted-foreground">
              {review
                ? "Your account and saved information are safe. We could not confidently confirm trial eligibility, so no new trial was started."
                : early
                  ? "You can keep using your free trial until it ends. If you choose to subscribe now, Square checkout will show the payment details before you confirm."
                : required
                  ? "Your account and saved information are safe. An active paid subscription is required to access LegalWhat pages and tools."
                  : "Your 72-hour trial is over. Your account and saved information remain available; start a subscription to restore access to protected tools."}
            </p>
          </div>

          <Button className="w-full" onClick={continueWithSubscription} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Continue with subscription
          </Button>

          {review ? (
            <Button variant="outline" className="w-full" onClick={() => setLocation("/support")}>
              Contact support
            </Button>
          ) : null}

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}

