import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, LogIn } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { BackButton } from "@/components/BackButton";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 space-y-4">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">404 - Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            The page you're looking for doesn't exist or may have been moved.
          </p>

          <div className="space-y-2 pt-4">
            <BackButton 
              fallbackRoute={isAuthenticated ? "/welcome" : "/login"}
              className="w-full justify-center"
            />
            
            {isAuthenticated ? (
              <Button 
                variant="default" 
                className="w-full"
                onClick={() => setLocation("/welcome")}
                data-testid="button-home"
              >
                <Home className="w-4 h-4 mr-2" />
                Go to Welcome
              </Button>
            ) : (
              <Button 
                variant="default" 
                className="w-full"
                onClick={() => setLocation("/login")}
                data-testid="button-login"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Go to Login
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
