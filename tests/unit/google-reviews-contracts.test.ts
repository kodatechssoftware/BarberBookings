import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  googleReviewSettingsUpdateSchema,
  isOfficialGoogleMapsUrl,
  isOfficialGoogleReviewRequestUrl,
  toPublicGoogleReviewsPresentation,
} from "../../shared/google-reviews";

const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";

test("Google review configuration accepts only strict official HTTPS link formats", () => {
  assert.equal(isOfficialGoogleMapsUrl("https://www.google.com/maps/place/Beauty/@38.7,-9.1,15z"), true);
  assert.equal(isOfficialGoogleMapsUrl("https://maps.google.com/?q=Beauty"), true);
  assert.equal(isOfficialGoogleReviewRequestUrl(`https://search.google.com/local/writereview?placeid=${placeId}`), true);
  assert.equal(isOfficialGoogleReviewRequestUrl("https://g.page/r/CX_example-123/review"), true);

  for (const unsafe of [
    "http://www.google.com/maps/place/Beauty",
    "https://maps.app.goo.gl/example",
    "https://www.google.com.evil.example/maps/place/Beauty",
    "https://user:password@www.google.com/maps/place/Beauty",
    "https://www.google.com:8443/maps/place/Beauty",
    "https://www.google.com/maps?redirect=https://evil.example",
  ]) assert.equal(isOfficialGoogleMapsUrl(unsafe), false, unsafe);

  for (const unsafe of [
    `http://search.google.com/local/writereview?placeid=${placeId}`,
    `https://search.google.com/local/writereview?placeid=${placeId}&next=https://evil.example`,
    "https://g.page/r/example/review?redirect=https://evil.example",
    "https://g.page/r/example/not-review",
    "https://evil.example/review",
  ]) assert.equal(isOfficialGoogleReviewRequestUrl(unsafe), false, unsafe);
});

test("Google review settings reject mismatched Place IDs and unknown fields", () => {
  const valid = googleReviewSettingsUpdateSchema.parse({
    googlePlaceId: placeId,
    googleMapsUrl: "https://www.google.com/maps/place/Beauty",
    googleReviewRequestUrl: `https://search.google.com/local/writereview?placeid=${placeId}`,
  });
  assert.equal(valid.googlePlaceId, placeId);
  assert.equal(googleReviewSettingsUpdateSchema.safeParse({ ...valid, googlePlaceId: "other-place" }).success, false);
  assert.equal(googleReviewSettingsUpdateSchema.safeParse({ ...valid, apiKey: "must-not-be-stored" }).success, false);
});

test("public Google reviews presentation is an allowlist with no invented review content", () => {
  const presentation = toPublicGoogleReviewsPresentation({
    googleMapsUrl: "https://www.google.com/maps/place/Beauty",
    googleReviewRequestUrl: `https://search.google.com/local/writereview?placeid=${placeId}`,
  });
  assert.deepEqual(presentation, {
    provider: "google",
    source: "links",
    links: {
      reviewsUrl: "https://www.google.com/maps/place/Beauty",
      reviewRequestUrl: `https://search.google.com/local/writereview?placeid=${placeId}`,
    },
    summary: null,
    reviews: [],
  });
  const serialized = JSON.stringify(presentation);
  for (const forbidden of ["placeId", "apiKey", "rating", "reviewCount", "author", "text"]) {
    assert.equal(serialized.includes(forbidden), false, `public DTO must not expose ${forbidden}`);
  }
});

test("Google review routes remain feature-gated, location-scoped and capability-protected", () => {
  const source = readFileSync("server/routes.ts", "utf8");
  assert.match(source, /app\.get\("\/api\/public\/google-reviews", requireGoogleReviewsEnabled/);
  assert.match(source, /app\.get\("\/api\/admin\/google-reviews", requireLocationsManage, requireGoogleReviewsEnabled/);
  assert.match(source, /app\.put\("\/api\/admin\/google-reviews", requireLocationsManage, requireGoogleReviewsEnabled/);
  assert.match(source, /locationId: Number\(res\.locals\.locationId\)/);
});
