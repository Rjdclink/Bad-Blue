import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function getInternalAuthHeaders(): Record<string, string> {
  try {
    // Browser-side only. If not set, no headers are added.
    const key =
      window?.localStorage?.getItem("INTERNAL_KEY") ||
      window?.localStorage?.getItem("INTERNAL_API_KEY") ||
      window?.sessionStorage?.getItem("INTERNAL_KEY") ||
      window?.sessionStorage?.getItem("INTERNAL_API_KEY") ||
      "";
    if (!key) return {};
    return { "X-Internal-Key": key };
  } catch {
    return {};
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
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...getInternalAuthHeaders(),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
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
      headers: getInternalAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
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
