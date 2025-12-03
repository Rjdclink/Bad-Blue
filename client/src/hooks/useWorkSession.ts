import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface WorkSession {
  id: string;
  lawType: string;
  sessionType: string;
  title: string;
  currentStep: string;
  progressPercentage: number;
  isComplete: boolean;
  lastAccessedAt: string;
}

interface CreateSessionPayload {
  lawType: string;
  sessionType: string;
  title?: string;
  initialData?: Record<string, any>;
}

export function useWorkSession(sessionId?: string) {
  const queryClient = useQueryClient();

  // Fetch full session state
  const { data: session, isLoading, error } = useQuery({
    queryKey: ['workSession', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      
      const response = await fetch(`/api/autosave/sessions/${sessionId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch session');
      }

      return response.json();
    },
    enabled: !!sessionId,
    staleTime: 30000, // 30 seconds
  });

  // Create new session
  const createSessionMutation = useMutation({
    mutationFn: async (payload: CreateSessionPayload) => {
      const response = await fetch('/api/autosave/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workSessions'] });
    },
  });

  // Update session metadata
  const updateSessionMutation = useMutation({
    mutationFn: async (payload: { currentStep?: string; progressPercentage?: number; isComplete?: boolean }) => {
      if (!sessionId) throw new Error('No session ID');
      
      const response = await fetch(`/api/autosave/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to update session');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workSession', sessionId] });
    },
  });

  // Delete session
  const deleteSessionMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No session ID');
      
      const response = await fetch(`/api/autosave/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete session');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workSessions'] });
    },
  });

  return {
    session,
    isLoading,
    error,
    createSession: createSessionMutation.mutateAsync,
    updateSession: updateSessionMutation.mutate,
    deleteSession: deleteSessionMutation.mutate,
    isCreating: createSessionMutation.isPending,
    isUpdating: updateSessionMutation.isPending,
    isDeleting: deleteSessionMutation.isPending,
  };
}
