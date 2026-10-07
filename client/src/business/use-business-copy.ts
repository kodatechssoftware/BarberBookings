import { useBusinessConfig } from "./use-business-config";

export function useBusinessCopy() {
  return useBusinessConfig().copy;
}
