import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Login Page - Redirects to Landing
 */
export default function Login() {
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
