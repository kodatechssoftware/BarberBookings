export function resolvePublicBookingUrl(configuredBaseUrl: string | undefined, browserOrigin: string) {
  const candidates = [configuredBaseUrl, browserOrigin];
  let browserHost = "";
  try {
    browserHost = new URL(browserOrigin).hostname;
  } catch {
    // The configured URL may still be usable in non-browser tests.
  }
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const base = new URL(candidate.trim());
      if (base.protocol !== "https:" && base.protocol !== "http:") continue;
      const configuredIsLocal = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "::1";
      const browserIsRemote = Boolean(browserHost) && !["localhost", "127.0.0.1", "::1"].includes(browserHost);
      if (candidate === configuredBaseUrl && configuredIsLocal && browserIsRemote) continue;
      base.pathname = `${base.pathname.replace(/\/+$/, "")}/booking`;
      base.search = "";
      base.hash = "";
      return base.toString().replace(/\/$/, "");
    } catch {
      // Try the browser origin before failing closed below.
    }
  }
  return "";
}

export function formatPublicBookingLabel(bookingUrl: string) {
  try {
    const url = new URL(bookingUrl);
    return `${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return bookingUrl;
  }
}

