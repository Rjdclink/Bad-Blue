import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Shield, History as HistoryIcon, Upload, ArrowLeft } from "lucide-react";
import type { BadgeLookup } from "@shared/schema";
import { format } from "date-fns";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function History() {
  usePageFaqSchema("/history");
  
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [user, authLoading, toast]);

  const { data: lookups, isLoading } = useQuery<BadgeLookup[]>({
    queryKey: ["/api/badge-lookups"],
    enabled: !!user,
  });

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" aria-label="Loading"/>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.history.back()}
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
              <HistoryIcon className="w-8 h-8 text-primary" />
              Search History
            </h1>
            <p className="text-muted-foreground">
              All your badge lookups and officer information searches
            </p>
          </div>
          <Button variant="ghost" asChild data-testid="link-home">
            <Link href="/">Home</Link>
          </Button>
        </div>

        {/* Search History List */}
        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : lookups && lookups.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lookups.map((lookup) => (
              <Link key={lookup.id} href={`/officer/${lookup.id}`}>
                <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-history-${lookup.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-mono text-lg font-bold text-primary">
                        #{lookup.badgeNumber || 'Unknown'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {lookup.createdAt ? format(new Date(lookup.createdAt), 'MMM dd, yyyy') : 'Unknown date'}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <div className="text-sm text-muted-foreground">Officer</div>
                      <div className="font-semibold">{lookup.officerName || 'Analyzing...'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Department</div>
                      <div className="text-sm">{lookup.department || 'Unknown'}</div>
                    </div>
                    {lookup.officerRank && (
                      <div>
                        <div className="text-sm text-muted-foreground">Rank</div>
                        <div className="text-sm">{lookup.officerRank}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <HistoryIcon className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No Search History</h3>
              <p className="text-muted-foreground mb-6">
                You haven't searched any badges yet. Upload your first badge photo to get started.
              </p>
              <Button asChild data-testid="button-upload-first">
                <Link href="/">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Badge Photo
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/history" />
    </div>
  );
}
