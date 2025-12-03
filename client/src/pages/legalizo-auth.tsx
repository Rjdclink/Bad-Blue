import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Loader2, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { SEOHead } from "@/components/SEOHead";

export default function LegalizoAuth() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [isLoading, setIsLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (mode === 'signup') {
      if (!formData.firstName.trim()) {
        newErrors.firstName = 'First name is required';
      }
      if (!formData.lastName.trim()) {
        newErrors.lastName = 'Last name is required';
      }
      if (!formData.password.trim()) {
        newErrors.password = 'Password is required';
      } else if (formData.password.length < 8) {
        newErrors.password = 'Password must be at least 8 characters';
      }
      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }

    if (mode === 'login' && !formData.password.trim()) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'signup') {
        // Register the user
        const response = await fetch('/api/legalizo/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            password: formData.password,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Registration failed');
        }

        const data = await response.json();
        
        // Show payment button
        setShowPayment(true);
        toast({
          title: "Account Created",
          description: "Please complete your subscription to continue",
        });
      } else {
        // Login the user
        const response = await fetch('/api/legalizo/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Login failed');
        }

        const data = await response.json();
        
        // Check subscription status
        if (data.hasActiveSubscription) {
          // Redirect to welcome page
          setLocation('/legalizo-welcome');
        } else {
          // Show payment button
          setShowPayment(true);
          toast({
            title: "Subscription Required",
            description: "Please complete your subscription to continue",
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `${mode === 'signup' ? 'Registration' : 'Login'} failed`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async () => {
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/legalizo/subscription/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to create subscription');
      }

      const data = await response.json();
      
      // Redirect to Square payment page
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to process payment",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center px-4">
      <SEOHead
        title={`${mode === 'signup' ? 'Sign Up' : 'Login'} - Legalizo`}
        description="Join Legalizo and access professional AI-powered legal services"
      />

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Shield className="w-10 h-10 text-primary" />
            <h1 className="text-3xl font-bold">Legalizo</h1>
          </div>
          <p className="text-muted-foreground">
            {mode === 'signup' 
              ? 'Create your account to get started' 
              : 'Welcome back! Please login to continue'}
          </p>
        </div>

        {/* Auth Form */}
        <Card>
          <CardHeader>
            <CardTitle>
              {mode === 'signup' ? 'Sign Up' : 'Login'}
            </CardTitle>
            <CardDescription>
              {mode === 'signup' 
                ? 'Enter your details to create an account' 
                : 'Enter your credentials to access your account'}
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {!showPayment ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name *</Label>
                        <Input
                          id="firstName"
                          type="text"
                          value={formData.firstName}
                          onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                          className={errors.firstName ? 'border-destructive' : ''}
                        />
                        {errors.firstName && (
                          <p className="text-xs text-destructive">{errors.firstName}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name *</Label>
                        <Input
                          id="lastName"
                          type="text"
                          value={formData.lastName}
                          onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                          className={errors.lastName ? 'border-destructive' : ''}
                        />
                        {errors.lastName && (
                          <p className="text-xs text-destructive">{errors.lastName}</p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={errors.email ? 'border-destructive' : ''}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={errors.password ? 'border-destructive' : ''}
                  />
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password}</p>
                  )}
                  {mode === 'signup' && (
                    <p className="text-xs text-muted-foreground">
                      Must be at least 8 characters
                    </p>
                  )}
                </div>

                {mode === 'signup' && (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password *</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className={errors.confirmPassword ? 'border-destructive' : ''}
                    />
                    {errors.confirmPassword && (
                      <p className="text-xs text-destructive">{errors.confirmPassword}</p>
                    )}
                  </div>
                )}

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    mode === 'signup' ? 'Create Account' : 'Login'
                  )}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Account created successfully! Complete your subscription to access all features.
                  </AlertDescription>
                </Alert>

                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold">Monthly Subscription</span>
                    <span className="text-2xl font-bold text-primary">$25.99</span>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>✓ Legal consultation</li>
                    <li>✓ Document creation</li>
                    <li>✓ People search</li>
                    <li>✓ All 40+ law types</li>
                    <li>✓ 8 AI systems</li>
                  </ul>
                </div>

                <Button 
                  onClick={handlePayment} 
                  className="w-full" 
                  size="lg"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>Pay $25.99 Subscription</>
                  )}
                </Button>
              </div>
            )}
          </CardContent>

          {!showPayment && (
            <CardFooter className="flex flex-col gap-4">
              <div className="text-center text-sm">
                {mode === 'signup' ? (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setErrors({});
                      }}
                      className="text-primary hover:underline font-medium"
                    >
                      Login
                    </button>
                  </>
                ) : (
                  <>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signup');
                        setErrors({});
                      }}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign Up
                    </button>
                  </>
                )}
              </div>

              <Button
                variant="ghost"
                onClick={() => setLocation('/legalizo')}
                className="w-full"
              >
                ← Back to Home
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
