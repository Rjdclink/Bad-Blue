/**
 * LogoutButton Component
 * 
 * Universal logout button for all authenticated app views
 * - Positioned in upper right corner
 * - Small and unobtrusive but clearly visible
 * - Triggers autosave before logout
 * - Redirects to login page after logout
 */

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useAutosave } from "@/hooks/useAutosave";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  const [, setLocation] = useLocation();
  const { saveNow } = useAutosave();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      // Step 1: Trigger autosave for any in-progress work
      toast({
        title: "Saving your work...",
        description: "Please wait while we save your progress.",
      });

      try {
        await saveNow?.();
      } catch (error) {
        console.error("Autosave failed during logout:", error);
        // Show warning but continue with logout
        toast({
          title: "Warning",
          description: "Some changes may not have been saved.",
          variant: "destructive",
        });
      }

      // Step 2: Call logout API to clear session
      await apiRequest("/api/auth/logout", "GET");

      // Step 3: Clear all cached queries
      queryClient.clear();

      // Step 4: Show success message
      toast({
        title: "Logged out successfully",
        description: "Your work has been saved.",
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
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      className={`flex items-center gap-2 hover:bg-accent ${className || ""}`}
      aria-label="Logout"
    >
      <LogOut className="w-4 h-4" />
      <span className="text-sm">Logout</span>
    </Button>
  );
}
