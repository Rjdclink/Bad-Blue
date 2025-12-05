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

    // Note: Using window.history.length is imperfect but works for most cases
    // It represents total session history, not just app history
    // For single-page apps, checking if length > 1 is a reasonable heuristic
    if (window.history.length > 1 && document.referrer) {
      window.history.back();
    } else {
      // No reliable history - use smart fallback
      const defaultFallback = isAuthenticated ? "/welcome" : "/login";
      setLocation(fallbackRoute || defaultFallback);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className={`flex items-center gap-2 hover:bg-accent ${className || ""}`}
      aria-label="Go back"
    >
      <ArrowLeft className="w-4 h-4" />
      <span className="text-sm">Back</span>
    </Button>
  );
}
