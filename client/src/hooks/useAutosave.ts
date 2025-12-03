import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useDebounce } from './useDebounce';

interface UseAutosaveOptions {
  sessionId: string;
  data: Record<string, any>;
  enabled?: boolean;
  debounceMs?: number;
  onSaveSuccess?: (version: number) => void;
  onSaveError?: (error: Error) => void;
}

export function useAutosave({
  sessionId,
  data,
  enabled = true,
  debounceMs = 3000,
  onSaveSuccess,
  onSaveError,
}: UseAutosaveOptions) {
  const previousDataRef = useRef<string>('');
  const debouncedData = useDebounce(data, debounceMs);
  
  const saveMutation = useMutation({
    mutationFn: async (payload: { data: Record<string, any>; fieldsChanged: string[] }) => {
      const response = await fetch(`/api/autosave/sessions/${sessionId}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Autosave failed');
      }

      return response.json();
    },
    onSuccess: (result) => {
      console.log('[Autosave] Saved successfully', { version: result.version });
      onSaveSuccess?.(result.version);
    },
    onError: (error: Error) => {
      console.error('[Autosave] Save failed', error);
      onSaveError?.(error);
    },
  });

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const currentDataString = JSON.stringify(debouncedData);
    const previousDataString = previousDataRef.current;

    // Skip if data hasn't changed
    if (currentDataString === previousDataString) {
      return;
    }

    // Detect which fields changed
    const fieldsChanged: string[] = [];
    if (previousDataString) {
      try {
        const previousData = JSON.parse(previousDataString);
        Object.keys(debouncedData).forEach(key => {
          if (JSON.stringify(debouncedData[key]) !== JSON.stringify(previousData[key])) {
            fieldsChanged.push(key);
          }
        });
      } catch (error) {
        console.error('[Autosave] Error parsing previous data', error);
      }
    }

    // Only save if there are actual changes
    if (fieldsChanged.length > 0 || !previousDataString) {
      saveMutation.mutate({
        data: debouncedData,
        fieldsChanged,
      });
    }

    previousDataRef.current = currentDataString;
  }, [debouncedData, sessionId, enabled]);

  return {
    isSaving: saveMutation.isPending,
    lastSaved: saveMutation.data?.savedAt,
    error: saveMutation.error,
    manualSave: () => saveMutation.mutate({ data, fieldsChanged: [] }),
  };
}
