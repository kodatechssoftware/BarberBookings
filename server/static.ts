import express, { type Express } from "express";
import fs from "fs";
import path from "path";

function getStaticDistPath() {
  return path.resolve(__dirname, "public");
}

export function hasStaticBuild() {
  return fs.existsSync(getStaticDistPath());
}

export function serveStatic(app: Express) {
  const distPath = getStaticDistPath();
  if (!hasStaticBuild()) {
    return false;
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  return true;
}
