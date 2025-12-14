/**
 * LogoutButton Component
 * 
 * Universal logout button for all authenticated app views
 * - Positioned in upper right corner
 * - Small and unobtrusive but clearly visible
 * - Redirects to login page after logout
 * - Note: Autosave should be handled by individual pages/components before calling logout
 */

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useState } from "react";

interface LogoutButtonProps {
  className?: string;
  onBeforeLogout?: () => Promise<void>; // Optional callback before logout (e.g., for autosave)
}

export function LogoutButton({ className, onBeforeLogout }: LogoutButtonProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return; // Prevent double-clicks
    
    setIsLoggingOut(true);
    
    try {
      // Step 1: Call optional pre-logout callback (e.g., for autosave)
      if (onBeforeLogout) {
        toast({
          title: "Saving your work...",
          description: "Please wait while we save your progress.",
        });

        try {
          await onBeforeLogout();
        } catch (error) {
          console.error("Pre-logout callback failed:", error);
          // Show warning but continue with logout
          toast({
            title: "Warning",
            description: "Some changes may not have been saved.",
            variant: "destructive",
          });
        }
      }

      // Step 2: Call logout API to clear session
      // Note: Using GET per server route definition in auth.routes.ts
      // Consider changing to POST in future for better REST semantics
      await apiRequest("/api/auth/logout", "GET");

      // Step 3: Clear all cached queries
      queryClient.clear();

      // Step 4: Show success message
      toast({
        title: "Logged out successfully",
        description: "See you next time!",
      });

      // Step 5: Redirect to login page
      setLocation("/login");
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        title: "Logout failed",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={isLoggingOut}
      className={`flex items-center gap-2 hover:bg-accent min-h-[44px] min-w-[44px] touch-manipulation ${className || ""}`}
      aria-label="Logout"
    >
      <LogOut className="w-5 h-5 md:w-4 md:h-4" />
      <span className="text-sm hidden sm:inline">Logout</span>
    </Button>
  );
}
