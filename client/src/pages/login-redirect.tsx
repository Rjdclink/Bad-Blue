import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Login Redirect Page
 * Redirects users to the unified LegalWhat auth page at /legalizo-auth
 */
export default function LoginRedirect() {
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    // Redirect to unified auth page
    setLocation('/legalizo-auth');
  }, [setLocation]);
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Redirecting to login...</p>
    </div>
  );
}
