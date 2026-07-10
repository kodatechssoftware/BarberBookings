const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const apiUrl = (process.env.API_URL || process.env.VITE_API_URL || "").replace(/\/+$/, "");

function requireUrl(name, value) {
  if (!value) {
    throw new Error(`${name} is required. Example: ${name}=https://example.com`);
  }
}

async function fetchText(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error?.cause?.code === "SELF_SIGNED_CERT_IN_CHAIN") {
      throw new Error(
        `Could not fetch ${url}: the local Node.js TLS trust store rejected the certificate chain. ` +
        "Configure NODE_EXTRA_CA_CERTS with your corporate CA certificate and run the check again.",
      );
    }
    throw error;
  }
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    text,
  };
}

function assertJsonResponse(label, result) {
  if (!result.contentType.toLowerCase().includes("application/json")) {
    const preview = result.text.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`${label} returned ${result.contentType || "no content-type"} instead of JSON. Preview: ${preview}`);
  }
}

requireUrl("FRONTEND_URL", frontendUrl);
requireUrl("API_URL", apiUrl);

console.log(`Checking frontend: ${frontendUrl}`);
const frontend = await fetchText(frontendUrl);
if (!frontend.ok) {
  throw new Error(`Frontend returned HTTP ${frontend.status}`);
}
if (!frontend.contentType.toLowerCase().includes("text/html")) {
  throw new Error(`Frontend returned unexpected content-type: ${frontend.contentType}`);
}

console.log(`Checking API health: ${apiUrl}/health`);
const health = await fetchText(`${apiUrl}/health`);
if (!health.ok) {
  throw new Error(`API health returned HTTP ${health.status}`);
}
assertJsonResponse("API health", health);

console.log(`Checking frontend relative API route: ${frontendUrl}/api/appointments/public`);
const relativeApi = await fetchText(`${frontendUrl}/api/appointments/public`);
if (relativeApi.contentType.toLowerCase().includes("text/html")) {
  throw new Error(
    "The frontend domain is serving HTML for /api/appointments/public. " +
    "Set VITE_API_URL in the frontend deploy so the app calls the real API domain.",
  );
}

console.log("Deploy smoke check passed.");
