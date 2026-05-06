import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { hasStaticBuild, serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);
const isProduction = process.env.NODE_ENV === "production";

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, "");
}

function getAllowedOrigins() {
  const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.PUBLIC_URL || "";

  return new Set(
    rawOrigins
      .split(",")
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean),
  );
}

const allowedOrigins = getAllowedOrigins();

if (isProduction) {
  app.set("trust proxy", 1);
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? normalizeOrigin(origin) : "";
  const isAllowedOrigin = normalizedOrigin
    ? allowedOrigins.has(normalizedOrigin)
    : false;

  if (origin && isAllowedOrigin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] || "Content-Type, Authorization",
    );
    res.append("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (origin && !isAllowedOrigin) {
      return res.sendStatus(403);
    }

    return res.sendStatus(204);
  }

  next();
});

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function getErrorLogPayload(body: unknown) {
  if (!body || typeof body !== "object" || !("message" in body)) return "";

  const message = (body as { message?: unknown }).message;
  if (typeof message !== "string") return "";

  return ` :: ${JSON.stringify({ message })}`;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (res.statusCode >= 400) {
        logLine += getErrorLogPayload(capturedJsonResponse);
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app, httpServer);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (isProduction) {
    if (hasStaticBuild()) {
      serveStatic(app);
    } else {
      log("static client build not found, serving API only");
    }
  } else {
    const viteDevServerModule = "./vite";
    const { setupVite } = await import(viteDevServerModule);
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, () => {
    log(`serving on http://localhost:${port}`);
  });
})();
