import { Scissors, Sparkles } from "lucide-react";
import { useBusinessConfig } from "./use-business-config";

export function useBusinessServiceIcon() {
  return useBusinessConfig().vertical === "beauty" ? Sparkles : Scissors;
}
