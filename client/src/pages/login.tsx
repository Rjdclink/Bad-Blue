import { useState, useEffect, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SEOHead } from "@/components/SEOHead";

/**
 * Login/Signup Page - Entry point for the application.
 * Normal users authenticate by email/password. Master access is deliberately
 * password-only and never exposes or requires an administrator email address.
 */
export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const showSignup = urlParams.get('signup') === 'true';
  const [activeTab, setActiveTab] = useState(showSignup ? 'signup' : 'login');

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [masterPassword, setMasterPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupFirstName, setSignupFirstName] = useState("");
  const [signupLastName, setSignupLastName] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      setLocation('/welcome');
    }
  }, [isAuthenticated, setLocation]);

  const completeLogin = async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || data.message || "Login failed");
    }

    const data = await response.json();
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

    const redirectPath = data.accessZone ? (data.redirectRoute || '/welcome') : '/welcome';
    toast({
      title: "Login successful",
      description: data.accessZone ? 'Master access enabled.' : 'Welcome back!',
    });
    setLocation(redirectPath);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("/api/local-login", "POST", {
        email: loginEmail,
        password: loginPassword,
      });
      await completeLogin(response);
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMasterLogin = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("/api/master-login", "POST", {
        password: masterPassword,
      });
      await completeLogin(response);
    } catch (error: any) {
      toast({
        title: "Master login failed",
        description: error.message || "Invalid master password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("/api/local-register", "POST", {
        email: signupEmail,
        password: signupPassword,
        firstName: signupFirstName,
        lastName: signupLastName,
      });

      if (response.ok) {
        await response.json();
        toast({
          title: "Account created",
          description: "Account created. Sign in to continue.",
        });
        setActiveTab('login');
        setLoginEmail(signupEmail);
        setLoginPassword('');
        setLocation('/login');
      } else {
        const data = await response.json();
        throw new Error(data.error || data.message || "Signup failed");
      }
    } catch (error: any) {
      toast({
        title: "Signup failed",
        description: error.message || "Could not create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative">
      <SEOHead
        title="Login | Legal What?"
        description="Sign in to access Legal What? AI-assisted legal tools, document workflows, public-record research, and consultation services"
        noIndex
      />

      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: 'url(/images/Constitution.webp), linear-gradient(to bottom, #1a1a2e, #16213e)',
          backgroundSize: 'cover',
          backgroundPosition: 'center center'
        }}
      >
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 mb-4">
              <img src="/images/Legal%20What%20Icon.png" alt="Legal What?" className="w-12 h-12 object-contain" />
              <h1 className="text-3xl font-bold text-white">Legal What?</h1>
            </div>
            <p className="text-gray-200 text-sm">AI-Powered Legal Platform</p>
          </div>

          <Card className="bg-white/95 backdrop-blur-sm border-white/20 shadow-2xl">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Welcome</CardTitle>
              <CardDescription>Sign in, use master access, or create a new account</CardDescription>
            </CardHeader>

            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="master">Master</TabsTrigger>
                  <TabsTrigger value="signup">Sign Up</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        name="email"
                        autoComplete="username"
                        inputMode="email"
                        placeholder="Email address"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                        disabled={isLoading}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        disabled={isLoading}
                      />
                    </div>

                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logging in...</> : "Login"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="master">
                  <form onSubmit={handleMasterLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="master-password">Master Password</Label>
                      <Input
                        id="master-password"
                        type="password"
                        name="master-password"
                        placeholder="Master password"
                        value={masterPassword}
                        onChange={(e) => setMasterPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        disabled={isLoading}
                      />
                      <p className="text-xs text-muted-foreground">No email address is required for master access.</p>
                    </div>

                    <Button type="submit" className="w-full" disabled={isLoading || !masterPassword}>
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening master access...</> : "Master Login"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="signup-firstname">First Name</Label>
                        <Input id="signup-firstname" name="given-name" autoComplete="given-name" type="text" placeholder="John" value={signupFirstName} onChange={(e) => setSignupFirstName(e.target.value)} required disabled={isLoading} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-lastname">Last Name</Label>
                        <Input id="signup-lastname" name="family-name" autoComplete="family-name" type="text" placeholder="Doe" value={signupLastName} onChange={(e) => setSignupLastName(e.target.value)} required disabled={isLoading} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <Input id="signup-email" name="email" autoComplete="username" inputMode="email" type="email" placeholder="your@email.com" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required disabled={isLoading} />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <Input id="signup-password" name="new-password" autoComplete="new-password" type="password" placeholder="••••••••" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required minLength={8} disabled={isLoading} />
                      <p className="text-xs text-muted-foreground">Password must be at least 8 characters</p>
                    </div>

                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : "Sign Up"}
                    </Button>

                    <p className="text-xs text-center text-muted-foreground">By signing up, you agree to complete payment before accessing tools</p>
                  </form>
                </TabsContent>
              </Tabs>

              <div className="mt-6 text-center">
                <Button variant="link" onClick={() => setLocation('/faq')} className="text-sm">Learn more about LegalWhat</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
