import { isProductionDeployment } from "./runtime-environment";

export function getPublicBaseUrl() {
  const configuredUrl =
    process.env.PUBLIC_URL ||
    process.env.APP_BASE_URL ||
    (process.env.REPL_SLUG && process.env.REPL_OWNER
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : isProductionDeployment
        ? ""
        : "http://localhost:5000");

  if (!configuredUrl) {
    throw new Error("PUBLIC_URL (or APP_BASE_URL) is required in Production.");
  }

  return configuredUrl.replace(/\/+$/, "");
}
