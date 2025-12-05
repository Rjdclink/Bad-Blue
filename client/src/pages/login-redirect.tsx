import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Login Redirect Page
 * Redirects users to the BadBlue landing page
 */
export default function LoginRedirect() {
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    // Redirect to BadBlue landing page
    setLocation('/badblue');
  }, [setLocation]);
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Redirecting to BadBlue landing page...</p>
    </div>
  );
}
