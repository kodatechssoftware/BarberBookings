import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    if (text) {
      let serverMessage: string | undefined;
      try {
        const payload = JSON.parse(text);
        if (typeof payload?.message === "string" && payload.message.trim()) {
          serverMessage = payload.message;
        }
      } catch (error) {
        serverMessage = undefined;
      }

      throw new Error(serverMessage || text);
    }

    throw new Error(res.statusText || "Não foi possível concluir o pedido.");
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await apiFetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
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
    const path = queryKey[0];
    if (typeof path !== "string") {
      throw new Error("Query key must start with an API path");
    }

    const res = await apiFetch(path);

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
