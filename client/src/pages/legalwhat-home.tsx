import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Shield, 
  FileText, 
  Search, 
  Scale, 
  Gavel, 
  Users, 
  Brain,
  Zap,
  CheckCircle2,
  ArrowRight
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";

/**
 * LegalWhat Home Page - Access Zone A
 * Master Password: SARBEAR
 * Role: LEGALWHAT_ROOT
 * Purpose: LegalWhat platform interface with AI legal operations
 */
export default function LegalWhatHome() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, user } = useAuth();

  // Verify access to this zone
  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, setLocation]);

  const legalTools = [
    {
      title: "Officer Search",
      description: "Search and identify law enforcement officers with comprehensive public records",
      icon: Search,
      route: "/officer-search",
      color: "from-blue-500 to-blue-600"
    },
    {
      title: "Complaint Filing",
      description: "Generate professional police misconduct complaints with AI assistance",
      icon: FileText,
      route: "/complaint-form",
      color: "from-red-500 to-red-600"
    },
    {
      title: "Lawsuit Generator",
      description: "Create Section 1983 civil rights lawsuits with state-specific requirements",
      icon: Gavel,
      route: "/lawsuit-form",
      color: "from-purple-500 to-purple-600"
    },
    {
      title: "FOIA Requests",
      description: "Generate Freedom of Information Act requests for public records",
      icon: FileText,
      route: "/foia-request",
      color: "from-green-500 to-green-600"
    },
    {
      title: "Legal Consultation",
      description: "AI-powered legal consultation for civil rights matters",
      icon: Scale,
      route: "/legal-consultation",
      color: "from-yellow-500 to-yellow-600"
    },
    {
      title: "Petition System",
      description: "Create and manage public petitions for accountability",
      icon: Users,
      route: "/petition-form",
      color: "from-pink-500 to-pink-600"
    }
  ];

  const aiCapabilities = [
    "Legal document generation with state-specific requirements",
    "Automated form filling with AI-researched information",
    "Officer identification across multiple databases",
    "Case law research and precedent analysis",
    "Autosave and restoration of all documents",
    "Multi-jurisdiction statute lookup",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <SEOHead
        title="LegalWhat - AI Legal Operations Center"
        description="Access AI-powered legal tools for civil rights advocacy and law enforcement accountability"
      />

      {/* Header */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">LegalWhat</h1>
                <p className="text-sm text-blue-300">AI Legal Operations Center</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 border border-green-500/30">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-300">LEGALWHAT_ROOT Access</span>
              </div>
              <Button 
                variant="outline" 
                onClick={() => setLocation('/welcome')}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Dashboard
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="mb-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/20 border border-blue-500/30 mb-4">
            <Brain className="w-5 h-5 text-blue-400" />
            <span className="text-blue-300">AI Subsystem Active - Legal Mode</span>
          </div>
          <h2 className="text-4xl font-bold text-white mb-4">
            Welcome to LegalWhat Operations
          </h2>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Your AI-powered command center for civil rights advocacy and law enforcement accountability.
            All legal tools are fully activated with LEGALWHAT_ROOT privileges.
          </p>
        </div>

        {/* AI Capabilities Banner */}
        <Card className="mb-8 bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-blue-500/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              AI Cluster Enabled - Legal Mode
            </CardTitle>
            <CardDescription className="text-gray-300">
              The following AI capabilities are active for your session
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {aiCapabilities.map((capability, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white/5"
                >
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="text-sm text-gray-300">{capability}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Legal Tools Grid */}
        <h3 className="text-2xl font-bold text-white mb-6">Legal Tools</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {legalTools.map((tool, index) => {
            const Icon = tool.icon;
            return (
              <Card 
                key={index}
                className="bg-slate-800/50 border-white/10 hover:border-white/20 transition-all duration-300 cursor-pointer group"
                onClick={() => setLocation(tool.route)}
              >
                <CardHeader>
                  <div className={`p-3 rounded-lg bg-gradient-to-br ${tool.color} w-fit mb-2`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle className="text-white group-hover:text-blue-300 transition-colors">
                    {tool.title}
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    {tool.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-between text-blue-400 hover:text-blue-300 hover:bg-white/5"
                  >
                    Access Tool
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-slate-800/50 border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Recent Documents</CardTitle>
              <CardDescription className="text-gray-400">
                Access your recently created legal documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setLocation('/history')} 
                className="w-full"
              >
                View Document History
              </Button>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-800/50 border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Evidence Hub</CardTitle>
              <CardDescription className="text-gray-400">
                Access shared evidence and documentation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setLocation('/evidence-hub')} 
                className="w-full"
              >
                Open Evidence Hub
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-gray-400 text-sm">
          <p>LegalWhat AI Legal Operations Center • Access Zone A • LEGALWHAT_ROOT</p>
        </div>
      </footer>
    </div>
  );
}
