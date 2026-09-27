import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

interface TrialStatusBannerProps {
  accessState?: string;
  trialRemainingMs?: number;
}

export function TrialStatusBanner({ accessState, trialRemainingMs = 0 }: TrialStatusBannerProps) {
  const [remainingMs, setRemainingMs] = useState(Math.max(0, trialRemainingMs));
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const expiryNavigationStarted = useRef(false);

  useEffect(() => {
    setRemainingMs(Math.max(0, trialRemainingMs));
    expiryNavigationStarted.current = false;
  }, [trialRemainingMs]);

  useEffect(() => {
    if (accessState !== "trial_active" || remainingMs <= 0) return;
    const timer = window.setInterval(() => {
      setRemainingMs(value => Math.max(0, value - 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [accessState, remainingMs > 0]);

  useEffect(() => {
    if (
      accessState !== "trial_active" ||
      remainingMs > 0 ||
      expiryNavigationStarted.current
    ) return;

    expiryNavigationStarted.current = true;
    void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    if (location !== "/trial-expired") {
      setLocation("/trial-expired", { replace: true });
    }
  }, [accessState, location, queryClient, remainingMs, setLocation]);

  if (accessState !== "trial_active" || remainingMs <= 0) return null;

  const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  return (
    <aside
      aria-label="Free trial status"
      aria-live="polite"
      className="fixed right-3 top-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur sm:right-4 sm:top-4"
    >
      Free trial · {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining
    </aside>
  );
}