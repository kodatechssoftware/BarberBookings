export function getSafeBuildSha(environment: NodeJS.ProcessEnv = process.env) {
  const candidate = environment.RENDER_GIT_COMMIT?.trim() || environment.APP_BUILD_SHA?.trim() || "";
  return /^[0-9a-f]{7,40}$/i.test(candidate) ? candidate.toLowerCase() : null;
}
