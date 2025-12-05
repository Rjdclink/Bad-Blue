/**
 * BackButton Component
 * 
 * Universal back button for all authenticated app pages
 * - Positioned in upper left corner
 * - Small and unobtrusive but clearly visible
 * - Smart history-aware navigation with fallbacks
 * - Protects in-progress data with autosave
 */

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useAutosave } from "@/hooks/useAutosave";

interface BackButtonProps {
  fallbackRoute?: string; // Where to go if no history
  className?: string;
}

export function BackButton({ fallbackRoute, className }: BackButtonProps) {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const { saveNow } = useAutosave(); // Hook into autosave system

  const handleBack = async () => {
    // Trigger autosave before navigation
    try {
      await saveNow?.();
    } catch (error) {
      console.error("Autosave failed during back navigation:", error);
    }

    // Check if there's browser history to go back to
    if (window.history.length > 1) {
      window.history.back();
    } else {
      // No history - use smart fallback
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
