import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { teamProfileUpdateSchema } from "../../shared/team-profiles";

test("team-profile contracts reject invalid slugs and unauthorised publication", () => {
  const base = { bio: null, displayOrder: 0, qualifications: [], testimonials: [] };
  assert.equal(teamProfileUpdateSchema.safeParse({ ...base, slug: "Ana Isabel", isPublished: false, publicationAuthorized: false }).success, false);
  assert.equal(teamProfileUpdateSchema.safeParse({ ...base, slug: "ana-isabel", isPublished: true, publicationAuthorized: false }).success, false);
  assert.equal(teamProfileUpdateSchema.safeParse({ ...base, slug: "ana-isabel", isPublished: true, publicationAuthorized: true }).success, true);
});

test("routes gate admin and direct public access behind teamProfiles", async () => {
  const routes = await readFile(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /app\.get\("\/api\/public\/team-profiles", requireTeamProfilesEnabled/);
  assert.match(routes, /app\.get\("\/api\/public\/team-profiles\/:slug", requireTeamProfilesEnabled/);
  assert.match(routes, /app\.get\("\/api\/admin\/team-profiles\/:barberId", requireTeamGlobalManage, requireTeamProfilesEnabled/);
  assert.match(routes, /app\.put\("\/api\/admin\/team-profiles\/:barberId", requireTeamGlobalManage, requireTeamProfilesEnabled/);
});

test("public DTO is constructed by allowlist", async () => {
  const source = await readFile(new URL("../../server/team-profiles.ts", import.meta.url), "utf8");
  const publicProjection = source.slice(source.indexOf("return profileResult.rows.map"));
  for (const forbidden of ["email:", "password:", "userId:", "publicationAuthorizedByUserId:"]) {
    assert.equal(publicProjection.includes(forbidden), false);
  }
});
