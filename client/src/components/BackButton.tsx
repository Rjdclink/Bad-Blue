/**
 * BackButton Component
 * 
 * Universal back button for all authenticated app pages
 * - Positioned in upper left corner
 * - Small and unobtrusive but clearly visible
 * - Smart history-aware navigation with fallbacks
 */

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

interface BackButtonProps {
  fallbackRoute?: string; // Where to go if no history
  className?: string;
  onBeforeNavigate?: () => Promise<void>; // Optional callback before navigation
}

export function BackButton({ fallbackRoute, className, onBeforeNavigate }: BackButtonProps) {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  const handleBack = async () => {
    // Call optional pre-navigation callback (e.g., for autosave)
    if (onBeforeNavigate) {
      try {
        await onBeforeNavigate();
      } catch (error) {
        console.error("Pre-navigation callback failed:", error);
      }
    }

    // Browser history is the authority for "the page I just came from".
    // document.referrer does not update for SPA route changes, so gating on it
    // incorrectly skips valid in-app history entries.
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    // Direct-entry/new-tab fallback when there is no previous history entry.
    const defaultFallback = isAuthenticated ? "/lexara-consent" : "/login";
    setLocation(fallbackRoute || defaultFallback, { replace: true });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className={`flex items-center gap-2 hover:bg-accent min-h-11 px-3 ${className || ""}`}
      aria-label="Go back"
    >
      <ArrowLeft className="w-4 h-4" />
      <span className="text-sm">Back</span>
    </Button>
  );
}
