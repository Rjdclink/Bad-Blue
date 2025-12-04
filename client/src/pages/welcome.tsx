/**
 * LegalWhat Welcome Page - Stage 1B
 * 
 * Displays 30 law types with interactive selection
 * Features Law Enforcement Accountability as highlighted option
 * Integrates with existing BadBlue functionality
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Shield } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { LAW_TYPE_DATA, type LawTypeInfo } from "@shared/lawTypes";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/hooks/useAuth";

export default function WelcomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedLawType, setSelectedLawType] = useState<string | null>(null);

  // Handle law type selection (only one at a time)
  const handleSelection = (lawTypeId: string) => {
    setSelectedLawType(selectedLawType === lawTypeId ? null : lawTypeId);
  };

  // Handle "Let's Go" button click
  const handleLetsGo = () => {
    if (!selectedLawType) return;
    
    const selectedType = LAW_TYPE_DATA.find(type => type.id === selectedLawType);
    if (selectedType) {
      setLocation(selectedType.route);
    }
  };

  // Get icon component dynamically
  const getIcon = (iconName: string) => {
    const Icon = (LucideIcons as any)[iconName];
    return Icon || Shield;
  };

  // Separate featured and non-featured law types
  const featuredTypes = LAW_TYPE_DATA.filter(type => type.featured);
  const nonFeaturedTypes = LAW_TYPE_DATA.filter(type => !type.featured);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <SEOHead
        title="Welcome to LegalWhat - AI Legal Platform"
        description="Select your legal area to get started with AI-powered legal assistance"
      />

      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">LegalWhat</h1>
                <p className="text-xs text-muted-foreground">AI Legal Platform</p>
              </div>
            </div>
            {user && (
              <div className="text-sm text-muted-foreground">
                Welcome, {user.firstName}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 sm:py-12">
        {/* Welcome Section */}
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">
            Choose Your Legal Area
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Select the area of law you need help with to get started with AI-powered legal assistance
          </p>
        </div>

        {/* Featured Law Type - Law Enforcement Accountability */}
        {featuredTypes.length > 0 && (
          <div className="mb-8 sm:mb-12">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="destructive" className="text-sm">Featured Service</Badge>
            </div>
            <div className="grid gap-4">
              {featuredTypes.map((lawType) => {
                const Icon = getIcon(lawType.icon);
                const isSelected = selectedLawType === lawType.id;
                
                return (
                  <Card
                    key={lawType.id}
                    className={`cursor-pointer transition-all hover:shadow-lg border-2 ${
                      isSelected
                        ? 'border-red-500 bg-red-50 dark:bg-red-950/20 shadow-lg'
                        : 'border-red-200 hover:border-red-300 dark:border-red-900 dark:hover:border-red-800'
                    }`}
                    onClick={() => handleSelection(lawType.id)}
                  >
                    <CardHeader>
                      <div className="flex items-start gap-4">
                        <div className="flex items-center gap-3 flex-1">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleSelection(lawType.id)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Icon className="h-6 w-6 text-red-600 dark:text-red-400" />
                              <CardTitle className="text-xl sm:text-2xl text-red-700 dark:text-red-400">
                                {lawType.name}
                              </CardTitle>
                            </div>
                            <CardDescription className="text-base">
                              {lawType.description}
                            </CardDescription>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Other Law Types */}
        <div className="mb-8">
          <h3 className="text-xl font-semibold mb-4">All Legal Areas</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {nonFeaturedTypes.map((lawType) => {
              const Icon = getIcon(lawType.icon);
              const isSelected = selectedLawType === lawType.id;
              
              return (
                <Card
                  key={lawType.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    isSelected
                      ? 'border-2 border-primary bg-primary/5 shadow-md'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => handleSelection(lawType.id)}
                >
                  <CardHeader className="pb-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleSelection(lawType.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-5 w-5 text-primary shrink-0" />
                          <CardTitle className="text-base leading-tight">
                            {lawType.name}
                          </CardTitle>
                        </div>
                        <CardDescription className="text-sm line-clamp-2">
                          {lawType.description}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Let's Go Button - Only shown when a type is selected */}
        {selectedLawType && (
          <div className="flex justify-center mt-8 sm:mt-12 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <Button
              size="lg"
              onClick={handleLetsGo}
              className="min-w-[200px] text-lg h-12 shadow-lg hover:shadow-xl transition-all"
            >
              Let's Go
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )}

        {/* Helper Text */}
        {!selectedLawType && (
          <div className="text-center mt-8 text-muted-foreground">
            <p className="text-sm">Select a legal area above to continue</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 py-6 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© 2024 LegalWhat. AI-powered legal platform.</p>
          <p className="mt-1">Featuring Law Enforcement Accountability and 29 other legal areas.</p>
        </div>
      </footer>
    </div>
  );
}
