import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, FileText, Scale, Upload, Bell, ArrowLeft } from "lucide-react";
import { LanguageSelector } from "@/components/LanguageSelector";
import { SEOHead } from "@/components/SEOHead";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";
import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FULL_ACCESS_PRICING, LAWSUIT_DIY_PRICING, LAWSUIT_FULL_SERVICE_PRICING, COMPLAINT_PRICING, PETITION_PRICING, FOIA_REQUEST_PRICING } from "@shared/schema";

export default function Login() {
  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  
  // Registration fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Check URL parameters to determine which tab to show
  const urlParams = new URLSearchParams(window.location.search);
  const shouldShowSignup = urlParams.get('signup') === 'true';
  const defaultTab = shouldShowSignup ? 'signup' : 'signin';

  // Local login mutation (works for both regular users and admin)
  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await apiRequest("/api/login/local", "POST", data);
      return await res.json();
    },
    onSuccess: (data: any) => {
      // Don't show different messages for admin - keep it inconspicuous
      toast({
        title: "Welcome Back",
        description: "Sign in successful",
      });
      window.location.href = "/";
    },
    onError: (error: any) => {
      // Provide user-friendly error messages based on error type
      let errorMessage = "Please check your login credentials and try again";
      
      if (error.message?.toLowerCase().includes('network') || 
          error.message?.toLowerCase().includes('connection')) {
        errorMessage = "Connection issue. Please check your internet and try again";
      } else if (error.message?.toLowerCase().includes('session') || 
                 error.message?.toLowerCase().includes('expired')) {
        errorMessage = "Your session has expired. Please log in again to continue";
      } else if (error.message?.toLowerCase().includes('suspended') || 
                 error.message?.toLowerCase().includes('banned')) {
        errorMessage = "Your account has been suspended. Please contact support for assistance";
      } else if (error.message?.toLowerCase().includes('rate') || 
                 error.message?.toLowerCase().includes('too many')) {
        errorMessage = "Too many login attempts. Please wait a few moments before trying again";
      }
      
      toast({
        title: "Unable to Sign In",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Local registration mutation
  const registerMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; password: string }) => {
      const res = await apiRequest("/api/register/local", "POST", data);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Account Created",
        description: "Please sign in with your new credentials",
      });
      setSignupPassword("");
      setSignupEmail("");
      setFirstName("");
      setLastName("");
    },
    onError: (error: any) => {
      // Provide user-friendly error messages based on error type
      let errorMessage = "Please check your information and try again";
      
      if (error.message?.toLowerCase().includes('duplicate') || 
          error.message?.toLowerCase().includes('already exists') ||
          error.message?.toLowerCase().includes('already in use') ||
          error.message?.toLowerCase().includes('already registered')) {
        errorMessage = "This email is already registered. Please sign in or use a different email";
      } else if (error.message?.toLowerCase().includes('network') || 
                 error.message?.toLowerCase().includes('connection')) {
        errorMessage = "Connection issue. Please check your internet and try again";
      } else if (error.message?.toLowerCase().includes('password')) {
        errorMessage = "Password must be at least 8 characters long";
      } else if (error.message?.toLowerCase().includes('email')) {
        errorMessage = "Please enter a valid email address";
      } else if (error.message?.toLowerCase().includes('rate') || 
                 error.message?.toLowerCase().includes('too many')) {
        errorMessage = "Too many sign-up attempts. Please wait a few moments before trying again";
      }
      
      toast({
        title: "Unable to Create Account",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      toast({
        title: "Missing Information",
        description: "Please enter email and password",
        variant: "destructive",
      });
      return;
    }
    // Admin login is inconspicuous - works seamlessly through same form
    loginMutation.mutate({ email: loginEmail, password: loginPassword });
  };

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !signupEmail || !signupPassword) {
      toast({
        title: "Missing Information",
        description: "Please enter all required fields",
        variant: "destructive",
      });
      return;
    }
    if (!signupEmail.includes('@')) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    registerMutation.mutate({ firstName, lastName, email: signupEmail, password: signupPassword });
  };

  // Unmute video on first user interaction (click, keypress, or scroll)
  useEffect(() => {
    const unmuteVideo = () => {
      if (videoRef.current && videoRef.current.muted) {
        videoRef.current.muted = false;
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {
          // Silently handle play rejection
        });
        // Remove all listeners after first interaction
        document.removeEventListener('pointerdown', unmuteVideo);
        document.removeEventListener('keydown', unmuteVideo);
        document.removeEventListener('wheel', unmuteVideo);
        document.removeEventListener('scroll', unmuteVideo, true);
      }
    };

    document.addEventListener('pointerdown', unmuteVideo, { once: false });
    document.addEventListener('keydown', unmuteVideo, { once: false });
    document.addEventListener('wheel', unmuteVideo, { once: false, passive: true });
    document.addEventListener('scroll', unmuteVideo, { once: false, passive: true, capture: true });

    return () => {
      document.removeEventListener('pointerdown', unmuteVideo);
      document.removeEventListener('keydown', unmuteVideo);
      document.removeEventListener('wheel', unmuteVideo);
      document.removeEventListener('scroll', unmuteVideo, true);
    };
  }, []);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "BadBlue",
    "description": "Police accountability platform for filing complaints and civil rights lawsuits online",
    "url": "https://bad-blue.com",
    "applicationCategory": "LegalService",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Free legal consultation and officer search for signed-in users"
    },
    "featureList": [
      "FREE AI-powered legal consultation",
      "FREE comprehensive officer search",
      "AI-powered officer badge identification",
      "Automated complaint routing to proper authorities",
      "Civil rights lawsuit document generation",
      "State-specific legal templates",
      "Secure evidence upload",
      "Legal actionability analysis"
    ]
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — Login | Officer Search & Legal Tools Access"
        description="Sign in to access free officer search, AI legal consultation, police misconduct complaint filing, §1983 lawsuit generator, and FOIA request tools. Affordable police accountability platform."
        keywords="file police complaint online, file officer complaint online, police misconduct complaint, officer misconduct grievance, civil rights lawsuit police, civil rights lawsuit officer, police brutality complaint, officer brutality lawsuit, police assault complaint, officer assault lawsuit, excessive force police complaint, excessive force officer lawsuit, file complaint against police, file lawsuit against officer, police accountability documents, officer accountability FOIA, report police misconduct, report officer assault, police brutality legal help, officer brutality legal advice, search police officer, find officer information, locate police department, FOIA request police, FOIA request officer, police complaint form online, officer grievance form online, lawsuit police department, complaint officer department, legal advice police case, legal help officer lawsuit, police information search, officer background search, police documents request, officer records FOIA, petition police officer, petition officer resignation, police harassment complaint, officer harassment grievance, false arrest police lawsuit, wrongful arrest officer complaint, police discrimination complaint, officer discrimination lawsuit, police violence complaint, officer violence lawsuit, department misconduct grievance, department brutality complaint, how to file police complaint, how to sue police officer, how to file officer lawsuit, how to get police documents, how to search officer information, how to file FOIA police records, help filing police complaint, help suing officer, assistance with police lawsuit, guidance police grievance, support officer complaint filing, resources police legal case, police brutality attorney alternative, officer assault lawyer alternative, police lawsuit online filing, officer complaint online submission, department grievance online process, civil rights police violation, constitutional rights officer violation, police excessive force documentation, officer assault evidence collection, police complaint process help, officer lawsuit filing assistance, department accountability legal help, police misconduct legal advice, officer conduct complaint filing, police rights violation lawsuit, officer abuse complaint online, police corruption grievance, department cover-up complaint, police retaliation lawsuit, officer negligence complaint, police civil rights lawsuit 42 USC 1983, officer section 1983 lawsuit, police qualified immunity lawsuit, officer constitutional violation complaint, find police officer by badge, search officer by name, locate police department address, get officer information online, police brutality help online, officer assault legal resources, file police grievance online, submit officer complaint online, police legal assistance online, officer lawsuit guidance online"
        ogTitle="BadBlue - Police Accountability Platform | File Complaints & Lawsuits"
        ogDescription="Step-by-step platform to file police misconduct complaints and civil rights lawsuits. AI-powered badge identification, legal analysis, and automated routing to proper authorities."
        canonicalUrl="https://bad-blue.com/login"
        structuredData={structuredData}
      />
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => window.location.href = "/landing"}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary" />
              <span className="font-bold text-xl">BadBlue</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSelector />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Video Section */}
        <div className="max-w-2xl mx-auto mb-16">
          <div className="relative w-full rounded-lg overflow-hidden shadow-lg" style={{ aspectRatio: '720/980' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              controlsList="nodownload nofullscreen noremoteplayback"
              style={{ 
                pointerEvents: 'none', 
                display: 'block'
              }}
            >
              <source src="/video/badblue-demo.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
            
            {/* White overlay to cover URL at top */}
            <div 
              className="absolute left-0 right-0 bg-background"
              style={{ 
                top: 0,
                height: '5%',
                pointerEvents: 'none'
              }}
            />
            
            {/* White overlay to cover URL at bottom */}
            <div 
              className="absolute left-0 right-0 bg-background"
              style={{ 
                bottom: 0,
                height: '20%',
                pointerEvents: 'none'
              }}
            />
          </div>
          
          {/* Website URL */}
          <div className="text-center mt-6 mb-16">
            <p className="text-2xl font-semibold text-primary">https://Bad-Blue.com</p>
          </div>
        </div>

        {/* How It Works - Simplified */}
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-4">How BadBlue Works</h2>
            <p className="text-base text-muted-foreground max-w-2xl mx-auto">
              AI-powered complaint filing and lawsuit drafting to make justice accessible.
            </p>
          </div>

          <div className="space-y-6">
            {/* Step 1: Sign In - Simplified */}
            <Card className="border-muted">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    1
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">Sign In & Get Free Access</h3>
                    <p className="text-sm text-muted-foreground">
                      Create an account to get FREE legal consultation and officer search.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Choose Your Service - Simplified */}
            <Card className="border-muted">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    2
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2">Choose Your Service</h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      Free core services plus optional documents and lawsuits.
                    </p>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs">FREE: Legal Consultation</Badge>
                        <Badge variant="secondary" className="text-xs">FREE: Officer Search</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs">FOIA</Badge>
                        <Badge variant="outline" className="text-xs">Complaints</Badge>
                        <Badge variant="outline" className="text-xs">Lawsuits</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 3: LegalAI Consultation - Simplified */}
            <Card className="border-muted">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    3
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">Get LegalAI Consultation</h3>
                    <p className="text-sm text-muted-foreground">
                      Describe your incident. AI analyzes laws and recommends next steps.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 4: Upload Evidence - Simplified */}
            <Card className="border-muted">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    4
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">Upload Evidence</h3>
                    <p className="text-sm text-muted-foreground">
                      Add photos, videos, and documents. AI can identify badges and officers.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 5: Review & Pay - Simplified */}
            <Card className="border-muted">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    5
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">Review & Pay</h3>
                    <p className="text-sm text-muted-foreground">
                      Review details and complete secure payment via Stripe.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 6: Get Your Documents - Simplified */}
            <Card className="border-muted">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                    6
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">Get Your Documents</h3>
                    <p className="text-sm text-muted-foreground">
                      Receive complete documents via email with filing instructions.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Login Card - Simplified with more spacing */}
        <Card className="max-w-md mx-auto mt-8 mb-16">
          <CardContent className="pt-10 pb-10 px-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold mb-2">Welcome</h1>
              <p className="text-sm text-muted-foreground">
                Sign in or create an account
              </p>
            </div>

            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="signin" data-testid="tab-signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup" data-testid="tab-signup">Sign Up</TabsTrigger>
              </TabsList>

              {/* Sign In Form - With more spacing */}
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email or Username</Label>
                    <Input
                      id="signin-email"
                      data-testid="input-signin-email"
                      type="text"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="Enter your email or username"
                      disabled={loginMutation.isPending}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      data-testid="input-signin-password"
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      disabled={loginMutation.isPending}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    data-testid="button-signin"
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? "Signing In..." : "Sign In"}
                  </Button>
                </form>
              </TabsContent>

              {/* Sign Up Form - With more spacing */}
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="signup-firstName">First Name</Label>
                    <Input
                      id="signup-firstName"
                      data-testid="input-signup-firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Enter your first name"
                      disabled={registerMutation.isPending}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-lastName">Last Name</Label>
                    <Input
                      id="signup-lastName"
                      data-testid="input-signup-lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Enter your last name"
                      disabled={registerMutation.isPending}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      data-testid="input-signup-email"
                      type="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="Enter your email"
                      disabled={registerMutation.isPending}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      data-testid="input-signup-password"
                      type="password"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      disabled={registerMutation.isPending}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    data-testid="button-signup"
                    disabled={registerMutation.isPending}
                  >
                    {registerMutation.isPending ? "Creating Account..." : "Sign Up"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      
      <SupportEmailFooter />
    </div>
  );
}
