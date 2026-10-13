import { useMemo } from "react";
import { resolveShopBranding } from "@/lib/branding";
import { useBusinessConfig } from "./use-business-config";

export function useBusinessBranding() {
  const config = useBusinessConfig();
  return useMemo(
    () => resolveShopBranding(config.branding, config.theme.id),
    [config.branding, config.theme.id],
  );
}
