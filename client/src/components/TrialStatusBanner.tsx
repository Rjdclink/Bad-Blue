import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { trialCountdownLabel, trialRemainingAt, trialReminder } from "@/lib/trialCountdown";

interface TrialStatusBannerProps {
  accessState?: string;
  trialRemainingMs?: number;
  trialExpiresAt?: string | null;
  userId?: string;
}

export function TrialStatusBanner({ accessState, trialRemainingMs = 0, trialExpiresAt, userId }: TrialStatusBannerProps) {
  const [remainingMs, setRemainingMs] = useState(Math.max(0, trialRemainingMs));
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const expiryNavigationStarted = useRef(false);

  useEffect(() => {
    const start = performance.now();
    const update = () => setRemainingMs(trialRemainingAt(trialRemainingMs, performance.now() - start));
    update();
    expiryNavigationStarted.current = false;
    if (accessState !== "trial_active") return;
    const timer = window.setInterval(update, 1000);
    const onVisibility = () => {
      update();
      if (!document.hidden) void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accessState, queryClient, trialRemainingMs]);

  useEffect(() => {
    if (accessState !== "trial_active" || !userId || !trialExpiresAt) return;
    const reminder = trialReminder(remainingMs);
    if (!reminder) return;
    const key = `legalwhat-trial-reminder:${userId}:${trialExpiresAt}:${reminder.key}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "shown");
      toast({ title: "Free trial reminder", description: reminder.message });
    } catch {
      // The persistent banner still gives the reminder when storage is disabled.
    }
  }, [accessState, remainingMs, trialExpiresAt, userId, toast]);

  useEffect(() => {
    if (
      accessState !== "trial_active" ||
      remainingMs > 0 ||
      expiryNavigationStarted.current
    ) return;

    expiryNavigationStarted.current = true;
    // Confirm the server's current entitlement before redirecting: payment in
    // another tab may have changed this account to paid during the countdown.
    void queryClient.refetchQueries({ queryKey: ["/api/auth/user"] }).then(() => {
      const current = queryClient.getQueryData<{ accessState?: string }>(["/api/auth/user"]);
      if (current?.accessState === "trial_expired" && location !== "/trial-expired") {
        setLocation("/trial-expired", { replace: true });
      }
    });
  }, [accessState, location, queryClient, remainingMs, setLocation]);

  if (accessState !== "trial_active" || remainingMs <= 0) return null;

  const reminder = trialReminder(remainingMs);
  return (
    <aside
      aria-label="Free trial status"
      aria-live="polite"
      className="fixed right-3 top-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur sm:right-4 sm:top-4"
    >
      Free trial · {trialCountdownLabel(remainingMs)}
      <span className="ml-2">· <Link href="/trial-upgrade" className="underline">Subscribe now</Link></span>
    </aside>
  );
}
