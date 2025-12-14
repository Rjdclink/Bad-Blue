import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Global event bus for correlation IDs
export const CORRELATION_ID_EVENT = 'correlation-id-updated';

function dispatchCorrelationId(data: any) {
  try {
    if (data?.meta?.correlationId) {
      const event = new CustomEvent(CORRELATION_ID_EVENT, { 
        detail: data.meta.correlationId 
      });
      window.dispatchEvent(event);
    }
  } catch (e) {
    // Ignore errors in event dispatching
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const text = await res.text();
      if (text) {
        errorMessage = text;
      }
    } catch (e) {
      // If reading text fails, use statusText
      console.error('Failed to read error response:', e);
    }
    throw new Error(`${res.status}: ${errorMessage}`);
  }
}

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  
  // Capture correlation ID without consuming the response stream
  try {
    const clone = res.clone();
    clone.json().then(responseData => {
      dispatchCorrelationId(responseData);
    }).catch(() => {
      // Ignore if not JSON
    });
  } catch (e) {
    // Ignore cloning errors
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const data = await res.json();
    
    // Capture correlation ID from query results
    dispatchCorrelationId(data);
    
    return data;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
