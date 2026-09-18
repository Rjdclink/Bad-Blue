import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { BackButton } from "@/components/BackButton";
import { apiRequest, queryClient } from "@/lib/queryClient";

type VerificationState = "verifying" | "active" | "error";

export default function SubscriptionSuccess() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<VerificationState>("verifying");
  const [message, setMessage] = useState("Verifying your LegalWhat subscription with Square...");

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("orderId") || params.get("order_id") || "";

  const verifySubscription = async () => {
    if (!orderId) {
      setState("error");
      setMessage("Square did not return the order information needed to verify this subscription.");
      return;
    }

    setState("verifying");
    setMessage("Verifying your LegalWhat subscription with Square...");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await apiRequest("/api/subscription/confirm", "POST", { orderId });
        const data = await response.json();

        if (data.active === true) {
          setState("active");
          setMessage("Subscription verified. Opening your LegalWhat law library...");
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
          setLocation(data.redirectTo || "/welcome", { replace: true });
          return;
        }

        if (response.status === 202 || data.pending === true) {
          setMessage("Payment received. Square is finalizing your subscription...");
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }

        throw new Error(data.message || "Subscription verification did not complete");
      } catch (error: any) {
        const detail = String(error?.message || "");
        if (/^401\b/.test(detail)) {
          setLocation("/login", { replace: true });
          return;
        }

        if (attempt < 3 && /temporarily unavailable|503/i.test(detail)) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }

        setState("error");
        setMessage(detail || "We could not verify the Square subscription.");
        return;
      }
    }

    setState("error");
    setMessage("Square is taking longer than expected to finalize the subscription. You can retry verification safely.");
  };

  useEffect(() => {
    void verifySubscription();
    // orderId is fixed for this return page; reruns are intentionally user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-background p-4 pt-20">
      <SEOHead
        title="Subscription Verification | Legal What?"
        description="Verify your Legal What? subscription payment"
        noIndex
      />

      <div className="absolute left-4 top-4 z-20 sm:left-6 sm:top-6">
        <BackButton fallbackRoute="/login" />
      </div>

      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center">
          {state === "verifying" ? (
            <Loader2 className="w-14 h-14 mx-auto mb-4 animate-spin" />
          ) : state === "active" ? (
            <CheckCircle className="w-14 h-14 mx-auto mb-4 text-green-600" />
          ) : (
            <AlertCircle className="w-14 h-14 mx-auto mb-4 text-destructive" />
          )}

          <h1 className="text-2xl font-bold mb-3">
            {state === "error" ? "Subscription verification needed" : "Square Subscription"}
          </h1>
          <p className="text-muted-foreground mb-6">{message}</p>

          {state === "error" && (
            <div className="space-y-3">
              <Button className="w-full" onClick={() => void verifySubscription()}>
                Retry verification
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setLocation("/login")}>
                Return to sign in
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
