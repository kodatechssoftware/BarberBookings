import { useContext } from "react";
import { BusinessConfigContext } from "./BusinessConfigProvider";

export function useBusinessConfig() {
  const config = useContext(BusinessConfigContext);
  if (!config) {
    throw new Error("useBusinessConfig must be used inside BusinessConfigProvider.");
  }
  return config;
}
