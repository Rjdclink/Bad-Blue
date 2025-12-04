import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Login Redirect Page
 * Redirects users to the landing page
 */
export default function LoginRedirect() {
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    // Redirect to landing page
    setLocation('/landing');
  }, [setLocation]);
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Redirecting to landing page...</p>
    </div>
  );
}
