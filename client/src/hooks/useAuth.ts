// Authentication hook
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { User } from "@shared/schema";
import { markPerformance } from "@/lib/performance";

export function useAuth() {
  const { data: user, isLoading, isFetched, error } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    // Keep normal auth reads cached, but refresh trials so the browser follows
    // the same server-derived expiry state while the tab remains open.
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache (gcTime replaces cacheTime in v5)
    refetchOnMount: false, // Don't refetch if we have cached data
    refetchOnWindowFocus: true,
    refetchOnReconnect: false, // Disable refetch on reconnect
    refetchInterval: query =>
      (query.state.data as any)?.accessState === "trial_active" ? 30_000 : false,
    // Only fetch if we're on a page that needs auth
    enabled: typeof window !== 'undefined',
  });

  // Performance monitoring for auth state changes
  useEffect(() => {
    if (isFetched && !isLoading) {
      if (error) {
        markPerformance('auth:error');
        console.log('[Performance] Auth check failed:', error);
      } else {
        markPerformance(user ? 'auth:user-loaded' : 'auth:no-user');
      }
    }
  }, [isFetched, isLoading, user, error]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  };
}
