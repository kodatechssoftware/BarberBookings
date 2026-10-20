import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { resolveBusinessBrandingProfile } from "./shared/business/branding";
import { parseBusinessVertical } from "./shared/business/vertical";

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function deploymentMetadataPlugin() {
  const vertical = parseBusinessVertical(process.env.BUSINESS_VERTICAL) ?? "barber";
  const branding = vertical === "beauty"
    ? resolveBusinessBrandingProfile(vertical, process.env)
    : null;
  const replacements = branding
    ? {
        "__BUSINESS_META_TITLE__": branding.metadata.title,
        "__BUSINESS_META_DESCRIPTION__": branding.metadata.description,
        "__BUSINESS_SOCIAL_IMAGE__": branding.metadata.socialImageUrl,
        "__BUSINESS_NAME__": branding.defaultName,
        "__BUSINESS_SHORT_NAME__": branding.defaultShortName,
        "__BUSINESS_THEME_COLOR__": branding.manifest.themeColor,
        "__BUSINESS_FAVICON_URL__": branding.defaultIconUrl,
        "__BUSINESS_TOUCH_ICON_URL__": branding.defaultIconUrl,
      }
    : {
        "__BUSINESS_META_TITLE__": "Marcações Online",
        "__BUSINESS_META_DESCRIPTION__": "Plataforma de marcações online.",
        "__BUSINESS_SOCIAL_IMAGE__": "",
        "__BUSINESS_NAME__": "Marcações Online",
        "__BUSINESS_SHORT_NAME__": "Marcações",
        "__BUSINESS_THEME_COLOR__": "#d4af37",
        "__BUSINESS_FAVICON_URL__": "/favicon.png",
        "__BUSINESS_TOUCH_ICON_URL__": "/icons/icon-192.png",
      };

  return {
    name: "deployment-metadata",
    transformIndexHtml(html: string) {
      return Object.entries(replacements).reduce(
        (result, [token, value]) => result.replaceAll(token, escapeHtmlAttribute(value)),
        html,
      );
    },
  };
}

export default defineConfig({
  define: {
    __DEMO_MODE__: JSON.stringify(process.env.DEMO_MODE === "true"),
  },
  plugins: [
    deploymentMetadataPlugin(),
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
