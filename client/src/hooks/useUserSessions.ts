import { useQuery } from '@tanstack/react-query';

interface UserSession {
  id: string;
  lawType: string;
  sessionType: string;
  title: string;
  progressPercentage: number;
  isComplete: boolean;
  lastAccessedAt: string;
}

interface UseUserSessionsOptions {
  includeCompleted?: boolean;
  lawType?: string;
  limit?: number;
}

export function useUserSessions(options: UseUserSessionsOptions = {}) {
  const { includeCompleted = false, lawType, limit = 50 } = options;

  return useQuery<{ sessions: UserSession[]; total: number }>({
    queryKey: ['workSessions', { includeCompleted, lawType, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({
        includeCompleted: includeCompleted.toString(),
        limit: limit.toString(),
      });

      if (lawType) {
        params.append('lawType', lawType);
      }

      const response = await fetch(`/api/autosave/sessions?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }

      return response.json();
    },
    staleTime: 60000, // 1 minute
  });
}
