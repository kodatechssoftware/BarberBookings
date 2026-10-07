import { createContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ResolvedBusinessConfig } from "@shared/business/public-config";

export const BusinessConfigContext = createContext<ResolvedBusinessConfig | null>(null);

type BusinessConfigProviderProps = {
  children: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
};

export function BusinessConfigProvider({
  children,
  loadingFallback = null,
  errorFallback,
}: BusinessConfigProviderProps) {
  const configQuery = useQuery<ResolvedBusinessConfig>({
    queryKey: ["/api/runtime-config"],
    queryFn: async () => {
      const response = await apiFetch("/api/runtime-config", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Não foi possível carregar a configuração da aplicação.");
      }
      return response.json() as Promise<ResolvedBusinessConfig>;
    },
    staleTime: Infinity,
  });

  if (configQuery.isPending) return loadingFallback;
  if (configQuery.isError || !configQuery.data) {
    return errorFallback ?? (
      <div role="alert" className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 text-center">
        Não foi possível carregar a configuração da aplicação.
      </div>
    );
  }

  return (
    <BusinessConfigContext.Provider value={configQuery.data}>
      {children}
    </BusinessConfigContext.Provider>
  );
}
