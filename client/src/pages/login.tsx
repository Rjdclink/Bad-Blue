import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Loader2, Sparkles, Brain, Zap, Network } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SEOHead } from "@/components/SEOHead";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * LegalWhat Landing/Login Page - Dual Purpose
 * Phenomenal visual concept combining landing page and authentication
 * Features XIII model orchestrated parallel cross-computational cognition framework
 */
export default function Login() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  
  // Check URL parameter to determine which tab to show
  const urlParams = new URLSearchParams(window.location.search);
  const showSignup = urlParams.get('signup') === 'true';
  const [activeTab, setActiveTab] = useState(showSignup ? 'signup' : 'login');
  
  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  
  // Signup form state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupFirstName, setSignupFirstName] = useState("");
  const [signupLastName, setSignupLastName] = useState("");
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setLocation('/welcome');
    }
  }, [isAuthenticated, setLocation]);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await apiRequest("/api/login", "POST", {
        email: loginEmail,
        password: loginPassword,
      });
      
      if (response.ok) {
        // Refresh auth state
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        
        toast({
          title: "Login successful",
          description: "Welcome back to LegalWhat!",
        });
        
        setLocation('/welcome');
      } else {
        const data = await response.json();
        throw new Error(data.error || "Login failed");
      }
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
  
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await apiRequest("/api/auth/signup", "POST", {
        email: signupEmail,
        password: signupPassword,
        first_name: signupFirstName,
        last_name: signupLastName,
      });
      
      if (response.ok) {
        await response.json();
        
        toast({
          title: "Account created",
          description: "Welcome to LegalWhat! Redirecting to your dashboard...",
        });
        
        // Refresh auth state
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        
        // Redirect to welcome page - user can access free features
        // Payment/subscription will be handled separately if needed
        setLocation('/welcome');
      } else {
        const data = await response.json();
        throw new Error(data.error || "Signup failed");
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
    <>
      <SEOHead
        title="LegalWhat - XIII Model AI Legal Platform"
        description="Experience the power of XIII model orchestrated parallel cross-computational cognition framework. Advanced AI legal services with 7+ models working in harmony."
      />
      
      {/* Full-page Hero Background with istockphoto.jpg */}
      <div className="min-h-screen relative overflow-hidden">
        {/* Hero Background Image */}
        <div
          className="fixed inset-0 bg-cover bg-center bg-no-repeat"
          style={{ 
            backgroundImage: "url(/images/istockphoto.jpg)"
          }}
        >
          {/* Dark overlay for better readability and depth */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/85 via-blue-900/80 to-slate-900/90" />
          {/* Additional vignette effect for professional look */}
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.4) 100%)' }} />
        </div>

        {/* Main Content Container */}
        <div className="relative z-10 min-h-screen">
          <div className="container mx-auto px-4 py-6 lg:py-8 min-h-screen flex flex-col">
            
            {/* Header: WELCOME TO LEGAL WHAT with integrated icon */}
            <div className="text-center mb-8 lg:mb-12 animate-in fade-in slide-in-from-top duration-700">
              <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-white drop-shadow-2xl leading-tight tracking-tight flex items-center justify-center flex-wrap gap-2 lg:gap-3">
                <span>WELCOME TO LEGAL</span>
                <span className="inline-flex items-center gap-1">
                  <span>WHAT</span>
                  <img 
                    src="/images/Legal What Icon.png" 
                    alt="LegalWhat" 
                    className="inline-block h-[0.9em] w-auto object-contain drop-shadow-2xl"
                    style={{ verticalAlign: 'baseline', marginBottom: '-0.1em' }}
                  />
                </span>
              </h1>
              
              {/* Subtitle with AI Framework description */}
              <div className="mt-6 max-w-4xl mx-auto">
                <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 lg:p-8 border border-white/20 shadow-2xl">
                  <p className="text-white text-lg lg:text-xl font-medium leading-relaxed">
                    Powered by the revolutionary <span className="text-yellow-300 font-bold">XIII Model Orchestrated Parallel Cross-Computational Cognition Framework</span>
                  </p>
                  <p className="text-white/90 text-base lg:text-lg mt-4 leading-relaxed">
                    Our ultra-sophisticated AI system employs multiple advanced language models working in parallel harmony, 
                    analyzing legal queries from diverse computational perspectives to deliver unprecedented accuracy, 
                    depth, and reliability in legal research and document generation.
                  </p>
                </div>
              </div>
            </div>

            {/* Main Grid Layout */}
            <div className="flex-1 grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
              
              {/* Bottom-Left: Comprehensive AI Model Attributes List */}
              <div className="lg:col-span-5 lg:self-end lg:pb-12">
                <div className="bg-gradient-to-br from-slate-900/95 via-blue-900/90 to-slate-900/95 backdrop-blur-xl rounded-2xl p-6 lg:p-8 border-2 border-yellow-400/40 shadow-2xl animate-in fade-in slide-in-from-left duration-700 delay-300">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-yellow-400/20 rounded-xl">
                      <Brain className="w-8 h-8 text-yellow-300" />
                    </div>
                    <h2 className="text-2xl lg:text-3xl font-bold text-yellow-300 tracking-wide">
                      AI MODEL ATTRIBUTES
                    </h2>
                  </div>
                  
                  <div className="space-y-3">
                    {[
                      { icon: <Zap className="w-5 h-5" />, text: "7+ Advanced AI Models Running in Parallel" },
                      { icon: <Network className="w-5 h-5" />, text: "Cross-Computational Cognition Framework" },
                      { icon: <Brain className="w-5 h-5" />, text: "Multi-Perspective Legal Analysis" },
                      { icon: <Sparkles className="w-5 h-5" />, text: "Real-Time Consensus Synthesis" },
                      { icon: <Shield className="w-5 h-5" />, text: "Adaptive Model Orchestration" },
                      { icon: <Zap className="w-5 h-5" />, text: "Contextual Understanding Enhancement" },
                      { icon: <Network className="w-5 h-5" />, text: "Distributed Processing Architecture" },
                      { icon: <Brain className="w-5 h-5" />, text: "Ensemble Learning Integration" },
                      { icon: <Sparkles className="w-5 h-5" />, text: "Dynamic Model Weight Balancing" },
                      { icon: <Shield className="w-5 h-5" />, text: "Legal Domain Specialization" },
                      { icon: <Zap className="w-5 h-5" />, text: "Multi-Modal Input Processing" },
                      { icon: <Network className="w-5 h-5" />, text: "Iterative Refinement Pipeline" },
                      { icon: <Brain className="w-5 h-5" />, text: "Confidence Scoring System" },
                      { icon: <Sparkles className="w-5 h-5" />, text: "Failover & Redundancy Protection" },
                      { icon: <Shield className="w-5 h-5" />, text: "State-Specific Legal Knowledge" }
                    ].map((item, index) => (
                      <div 
                        key={index}
                        className="flex items-start gap-3 p-3 bg-white/5 backdrop-blur-sm rounded-lg border border-white/10 hover:bg-white/10 hover:border-yellow-400/30 transition-all duration-300 group"
                      >
                        <div className="text-yellow-300 group-hover:text-yellow-200 mt-0.5 flex-shrink-0">
                          {item.icon}
                        </div>
                        <span className="text-white font-medium text-sm lg:text-base leading-snug">
                          {item.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Side: Login Card & LEXARA */}
              <div className="lg:col-span-7 lg:self-end lg:pb-12 space-y-6">
                <div className="grid lg:grid-cols-2 gap-6">
                  
                  {/* LEXARA Persona Card */}
                  <div className="lg:order-1 animate-in fade-in slide-in-from-bottom duration-700 delay-500">
                    <div className="relative">
                      <div className="bg-white/98 backdrop-blur-sm rounded-2xl p-5 lg:p-6 border-2 border-blue-200 shadow-2xl hover:shadow-3xl hover:-translate-y-2 transition-all duration-500 hover:border-blue-400 group">
                        {/* Glow effect */}
                        <div className="absolute -inset-1 bg-blue-400/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />
                        
                        {/* Voice Checkbox */}
                        <div className="absolute top-3 right-3 flex items-center gap-2 bg-slate-900/90 rounded-lg px-3 py-1.5 shadow-lg z-10 border border-blue-400/30">
                          <Checkbox
                            id="voice-enable"
                            checked={voiceEnabled}
                            onCheckedChange={(checked) => setVoiceEnabled(checked as boolean)}
                            className="w-4 h-4 border-blue-400"
                          />
                          <label htmlFor="voice-enable" className="text-xs font-bold cursor-pointer text-blue-300 tracking-wider">
                            VOICE
                          </label>
                        </div>

                        {/* LEXARA Image using OIP.webp */}
                        <div className="mb-4 overflow-hidden rounded-xl">
                          <img 
                            src="/images/OIP.webp"
                            alt="LEXARA - Legal AI Assistant"
                            className="w-full h-auto rounded-xl shadow-lg group-hover:scale-105 transition-transform duration-500"
                          />
                        </div>

                        {/* Caption */}
                        <div className="text-center space-y-2">
                          <h3 className="text-xl lg:text-2xl font-bold text-slate-900 tracking-wide">
                            LEXARA
                          </h3>
                          <p className="text-sm text-slate-600 font-medium leading-relaxed">
                            Legal X-computational Autonomous<br />Reasoning Architecture
                          </p>
                          <div className="pt-2">
                            <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                              AI LEGAL ASSISTANT
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Login/Signup Card - Lower Right */}
                  <div className="lg:order-2 animate-in fade-in slide-in-from-right duration-700 delay-700">
                    <Card className="bg-white/98 backdrop-blur-sm shadow-2xl border-2 border-slate-200 rounded-2xl hover:shadow-3xl transition-all duration-300">
                      <CardHeader className="text-center pb-4 space-y-3">
                        <div className="flex justify-center">
                          <div className="p-3 bg-blue-600/10 rounded-xl border-2 border-blue-200">
                            <Shield className="h-10 w-10 text-blue-600" />
                          </div>
                        </div>
                        <CardTitle className="text-2xl font-bold text-slate-900">
                          Get Started
                        </CardTitle>
                        <CardDescription className="text-base font-medium text-slate-600">
                          Sign in or create your account
                        </CardDescription>
                      </CardHeader>
                      
                      <CardContent className="pb-6">
                        <Tabs value={activeTab} onValueChange={setActiveTab}>
                          <TabsList className="grid w-full grid-cols-2 mb-4 h-11 bg-slate-100">
                            <TabsTrigger value="login" className="text-sm font-semibold">Login</TabsTrigger>
                            <TabsTrigger value="signup" className="text-sm font-semibold">Sign Up</TabsTrigger>
                          </TabsList>
                          
                          {/* Login Tab */}
                          <TabsContent value="login">
                            <form onSubmit={handleLogin} className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="login-email" className="text-sm font-semibold text-slate-700">Email</Label>
                                <Input
                                  id="login-email"
                                  type="email"
                                  placeholder="your@email.com"
                                  value={loginEmail}
                                  onChange={(e) => setLoginEmail(e.target.value)}
                                  required
                                  disabled={isLoading}
                                  className="h-11 text-base border-2 focus:border-blue-500"
                                />
                              </div>
                              
                              <div className="space-y-2">
                                <Label htmlFor="login-password" className="text-sm font-semibold text-slate-700">Password</Label>
                                <Input
                                  id="login-password"
                                  type="password"
                                  placeholder="••••••••"
                                  value={loginPassword}
                                  onChange={(e) => setLoginPassword(e.target.value)}
                                  required
                                  disabled={isLoading}
                                  className="h-11 text-base border-2 focus:border-blue-500"
                                />
                              </div>
                              
                              <Button type="submit" className="w-full h-11 text-base font-bold bg-blue-600 hover:bg-blue-700" disabled={isLoading}>
                                {isLoading ? (
                                  <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Logging in...
                                  </>
                                ) : (
                                  "Login"
                                )}
                              </Button>
                            </form>
                          </TabsContent>
                          
                          {/* Signup Tab */}
                          <TabsContent value="signup">
                            <form onSubmit={handleSignup} className="space-y-4">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                  <Label htmlFor="signup-firstname" className="text-sm font-semibold text-slate-700">First Name</Label>
                                  <Input
                                    id="signup-firstname"
                                    type="text"
                                    placeholder="John"
                                    value={signupFirstName}
                                    onChange={(e) => setSignupFirstName(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    className="h-11 text-base border-2 focus:border-blue-500"
                                  />
                                </div>
                                
                                <div className="space-y-2">
                                  <Label htmlFor="signup-lastname" className="text-sm font-semibold text-slate-700">Last Name</Label>
                                  <Input
                                    id="signup-lastname"
                                    type="text"
                                    placeholder="Doe"
                                    value={signupLastName}
                                    onChange={(e) => setSignupLastName(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    className="h-11 text-base border-2 focus:border-blue-500"
                                  />
                                </div>
                              </div>
                              
                              <div className="space-y-2">
                                <Label htmlFor="signup-email" className="text-sm font-semibold text-slate-700">Email</Label>
                                <Input
                                  id="signup-email"
                                  type="email"
                                  placeholder="your@email.com"
                                  value={signupEmail}
                                  onChange={(e) => setSignupEmail(e.target.value)}
                                  required
                                  disabled={isLoading}
                                  className="h-11 text-base border-2 focus:border-blue-500"
                                />
                              </div>
                              
                              <div className="space-y-2">
                                <Label htmlFor="signup-password" className="text-sm font-semibold text-slate-700">Password</Label>
                                <Input
                                  id="signup-password"
                                  type="password"
                                  placeholder="••••••••"
                                  value={signupPassword}
                                  onChange={(e) => setSignupPassword(e.target.value)}
                                  required
                                  minLength={8}
                                  disabled={isLoading}
                                  className="h-11 text-base border-2 focus:border-blue-500"
                                />
                                <p className="text-xs text-slate-500 font-medium">
                                  Password must be at least 8 characters
                                </p>
                              </div>
                              
                              <Button type="submit" className="w-full h-11 text-base font-bold bg-blue-600 hover:bg-blue-700" disabled={isLoading}>
                                {isLoading ? (
                                  <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Creating account...
                                  </>
                                ) : (
                                  "Sign Up"
                                )}
                              </Button>
                            </form>
                          </TabsContent>
                        </Tabs>
                        
                        <div className="mt-4 text-center">
                          <Button
                            variant="link"
                            onClick={() => setLocation('/faq')}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                          >
                            Learn more about LegalWhat
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Mobile: Sticky Login/Sign Up Bar */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t-2 border-yellow-400/40 shadow-2xl p-4 z-50">
          <div className="flex gap-3 max-w-md mx-auto">
            <Button 
              className="flex-1 h-12 text-base font-bold bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setActiveTab('login');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Login
            </Button>
            <Button 
              className="flex-1 h-12 text-base font-bold border-2 border-blue-400 bg-white text-blue-600 hover:bg-blue-50"
              variant="outline"
              onClick={() => {
                setActiveTab('signup');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Sign Up
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
