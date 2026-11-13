import { z } from "zod";

const MAX_URL_LENGTH = 2048;
const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const GOOGLE_MAPS_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com"]);
const REDIRECT_QUERY_KEYS = new Set(["continue", "dest", "destination", "next", "redirect", "redirect_uri", "url"]);

function parseSecureUrl(value: string) {
  if (value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    return url;
  } catch {
    return null;
  }
}

function queryKeys(url: URL) {
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));
  return keys;
}

export function isOfficialGoogleMapsUrl(value: string) {
  const url = parseSecureUrl(value);
  if (!url || !GOOGLE_MAPS_HOSTS.has(url.hostname.toLowerCase())) return false;
  if (queryKeys(url).some((key) => REDIRECT_QUERY_KEYS.has(key.toLowerCase()))) return false;
  if (url.hostname.toLowerCase() === "maps.google.com") return url.pathname === "/" || url.pathname.startsWith("/maps");
  return url.pathname === "/maps" || url.pathname.startsWith("/maps/");
}

export function isOfficialGoogleReviewRequestUrl(value: string) {
  const url = parseSecureUrl(value);
  if (!url || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (host === "search.google.com") {
    if (url.pathname !== "/local/writereview") return false;
    const keys = queryKeys(url);
    return keys.length === 1
      && keys[0] === "placeid"
      && GOOGLE_PLACE_ID_PATTERN.test(url.searchParams.get("placeid") ?? "");
  }
  if (host === "g.page") {
    if (url.search) return false;
    return /^\/r\/[A-Za-z0-9_-]+\/review$/.test(url.pathname);
  }
  return false;
}

const nullableGooglePlaceIdSchema = z.union([
  z.string().trim().max(512).regex(GOOGLE_PLACE_ID_PATTERN, "O Place ID contém caracteres inválidos."),
  z.literal(""),
  z.null(),
]).optional().transform((value) => value || null);

export const googleReviewSettingsUpdateSchema = z.object({
  googlePlaceId: nullableGooglePlaceIdSchema,
  googleMapsUrl: z.string().trim().min(1, "Indique a ligação para as avaliações no Google.").max(MAX_URL_LENGTH)
    .refine(isOfficialGoogleMapsUrl, "Utilize uma ligação HTTPS oficial de google.com/maps."),
  googleReviewRequestUrl: z.string().trim().min(1, "Indique a ligação para deixar uma avaliação.").max(MAX_URL_LENGTH)
    .refine(isOfficialGoogleReviewRequestUrl, "Utilize a ligação oficial para escrever uma avaliação no Google."),
}).strict().superRefine((value, context) => {
  if (!value.googlePlaceId) return;
  const reviewUrl = new URL(value.googleReviewRequestUrl);
  if (reviewUrl.hostname === "search.google.com" && reviewUrl.searchParams.get("placeid") !== value.googlePlaceId) {
    context.addIssue({
      code: "custom",
      path: ["googleReviewRequestUrl"],
      message: "O Place ID da ligação de avaliação não corresponde ao Place ID configurado.",
    });
  }
});

export type GoogleReviewSettingsUpdateInput = z.infer<typeof googleReviewSettingsUpdateSchema>;

export type AdminGoogleReviewSettings = {
  locationId: number;
  configured: boolean;
  googlePlaceId: string | null;
  googleMapsUrl: string;
  googleReviewRequestUrl: string;
  updatedAt: string | null;
};

export type PublicGoogleReviewsPresentation = {
  provider: "google";
  source: "links";
  links: {
    reviewsUrl: string;
    reviewRequestUrl: string;
  };
  summary: null;
  reviews: [];
};

export function toPublicGoogleReviewsPresentation(input: {
  googleMapsUrl: string;
  googleReviewRequestUrl: string;
}): PublicGoogleReviewsPresentation {
  return {
    provider: "google",
    source: "links",
    links: {
      reviewsUrl: input.googleMapsUrl,
      reviewRequestUrl: input.googleReviewRequestUrl,
    },
    summary: null,
    reviews: [],
  };
}
