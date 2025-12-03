import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Scale, FileText, Users, Brain, CheckCircle, Search } from "lucide-react";
import { useLocation } from "wouter";
import { SEOHead } from "@/components/SEOHead";

export default function LegalizoLanding() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <SEOHead
        title="Legalizo - AI-Powered Legal Platform | Professional Legal Services"
        description="Access comprehensive legal services with AI-assisted guidance. Get legal consultation, document creation, and support for all types of law. Subscribe for $25.99/month."
        keywords="legal platform, AI legal services, legal consultation, document creation, legal assistance"
        ogTitle="Legalizo - Your AI-Powered Legal Partner"
        ogDescription="Professional legal services with AI assistance for all types of law. Subscribe now for $25.99/month."
      />

      {/* Hero Section with Lady of Justice */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Lady of Justice Illustration */}
          <div className="flex justify-center">
            <div className="relative w-full max-w-md">
              {/* SVG Illustration of Lady of Justice */}
              <svg
                viewBox="0 0 400 500"
                className="w-full h-auto drop-shadow-2xl"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Base/Pedestal */}
                <rect x="120" y="470" width="160" height="30" fill="#8B7355" />
                <rect x="100" y="460" width="200" height="15" fill="#A0826D" />
                
                {/* Body/Robes */}
                <path
                  d="M200 200 L160 460 L240 460 Z"
                  fill="#1E40AF"
                  stroke="#1E3A8A"
                  strokeWidth="2"
                />
                <path
                  d="M200 200 L150 250 L200 460 L250 250 Z"
                  fill="#2563EB"
                  opacity="0.8"
                />
                
                {/* Arms */}
                <line x1="200" y1="220" x2="100" y2="240" stroke="#D4A373" strokeWidth="12" strokeLinecap="round" />
                <line x1="200" y1="220" x2="300" y2="240" stroke="#D4A373" strokeWidth="12" strokeLinecap="round" />
                
                {/* Scales (Left Hand) */}
                <g transform="translate(100, 240)">
                  <line x1="0" y1="0" x2="0" y2="40" stroke="#C0A080" strokeWidth="3" />
                  <line x1="-25" y1="40" x2="25" y2="40" stroke="#C0A080" strokeWidth="3" />
                  <rect x="-30" y="40" width="25" height="20" fill="#FFD700" stroke="#DAA520" strokeWidth="2" />
                  <rect x="5" y="40" width="25" height="20" fill="#FFD700" stroke="#DAA520" strokeWidth="2" />
                </g>
                
                {/* Sword (Right Hand) */}
                <g transform="translate(300, 240)">
                  <rect x="-3" y="0" width="6" height="80" fill="#C0C0C0" />
                  <rect x="-15" y="75" width="30" height="8" fill="#B8860B" />
                  <polygon points="0,-15 -8,0 8,0" fill="#E8E8E8" stroke="#C0C0C0" strokeWidth="2" />
                </g>
                
                {/* Head */}
                <circle cx="200" cy="180" r="25" fill="#E5B897" />
                
                {/* Blindfold */}
                <rect x="170" y="175" width="60" height="8" fill="#1E3A8A" rx="2" />
                
                {/* Hair */}
                <path
                  d="M175 170 Q175 150 200 155 Q225 150 225 170"
                  fill="#654321"
                />
                
                {/* Neck */}
                <rect x="195" y="202" width="10" height="15" fill="#D4A373" />
                
                {/* Crown/Laurel */}
                <circle cx="185" cy="160" r="5" fill="#FFD700" />
                <circle cx="200" cy="155" r="5" fill="#FFD700" />
                <circle cx="215" cy="160" r="5" fill="#FFD700" />
              </svg>
            </div>
          </div>

          {/* Right: Service Description */}
          <div className="space-y-6">
            <div>
              <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                Legalizo
              </h1>
              <p className="text-xl text-muted-foreground mb-2">
                Your AI-Powered Legal Partner
              </p>
              <div className="flex items-center gap-2 text-2xl font-semibold text-primary">
                <span>$25.99</span>
                <span className="text-lg text-muted-foreground">/month</span>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-lg leading-relaxed">
                Legalizo is a revolutionary subscription-based legal platform that democratizes access to professional legal services through cutting-edge AI technology. Our platform combines the expertise of eight coordinated AI systems with comprehensive legal knowledge to provide you with unparalleled legal assistance.
              </p>

              <div className="grid gap-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold">Professional Legal Consultation</p>
                    <p className="text-sm text-muted-foreground">Get expert guidance on your legal matters with AI-powered analysis and recommendations</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold">Document Creation & Automation</p>
                    <p className="text-sm text-muted-foreground">Generate professional legal documents tailored to your specific needs</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold">Eight AI Systems Working in Harmony</p>
                    <p className="text-sm text-muted-foreground">Benefit from coordinated AI for classification, drafting, optimization, validation, and more</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold">All Types of Law Covered</p>
                    <p className="text-sm text-muted-foreground">From family law to corporate law, immigration to intellectual property - we cover 40+ legal practice areas</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold">Step-by-Step Workflows</p>
                    <p className="text-sm text-muted-foreground">Intuitive guided processes that take you from consultation to completed documents</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold">Deep OSINT People Search</p>
                    <p className="text-sm text-muted-foreground">Comprehensive background research with professional reports for your legal needs</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6">
              <Button 
                size="lg" 
                className="w-full text-lg py-6"
                onClick={() => setLocation("/legalizo-auth")}
              >
                Login or Sign Up
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-3">
                Start your legal journey today. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          Comprehensive Legal Services at Your Fingertips
        </h2>
        
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Scale className="w-12 h-12 text-primary mb-4" />
              <CardTitle>Legal Consultation</CardTitle>
              <CardDescription>
                AI-powered legal analysis and consultation for your specific case
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Case evaluation and analysis
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Legal strategy recommendations
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Statute and case law research
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <FileText className="w-12 h-12 text-primary mb-4" />
              <CardTitle>Document Creation</CardTitle>
              <CardDescription>
                Professional legal documents generated and customized for you
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Contracts and agreements
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Legal briefs and motions
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Complaints and petitions
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Search className="w-12 h-12 text-primary mb-4" />
              <CardTitle>People Search</CardTitle>
              <CardDescription>
                Deep OSINT research with comprehensive professional reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Public records aggregation
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Social media analysis
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Professional report generation
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* AI Systems Section */}
      <section className="container mx-auto px-4 py-16 bg-muted/50 rounded-lg">
        <h2 className="text-3xl font-bold text-center mb-4">
          Powered by Eight Coordinated AI Systems
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
          Our platform leverages multiple specialized AI models working in parallel to provide you with the most accurate and comprehensive legal assistance
        </p>

        <div className="grid md:grid-cols-4 gap-6">
          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Classification AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Identifies and categorizes your legal issues accurately
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Drafting AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Provides intelligent document drafting suggestions
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Optimization AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Refines legal language for maximum effectiveness
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Question AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Generates relevant questions for thorough consultation
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Validation AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Ensures accuracy and completeness of your information
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Prediction AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Analyzes potential outcomes based on legal precedents
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Auto-fill AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Intelligently populates repetitive legal data fields
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Brain className="w-8 h-8 text-primary mb-2" />
              <CardTitle className="text-base">Summary AI</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Synthesizes consultation data for document creation
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center text-muted-foreground">
        <p className="text-sm">
          © 2024 Legalizo. All rights reserved. Professional legal services powered by AI.
        </p>
        <p className="text-xs mt-2">
          Legalizo provides AI-assisted legal services but does not replace the advice of a licensed attorney.
        </p>
      </footer>
    </div>
  );
}
