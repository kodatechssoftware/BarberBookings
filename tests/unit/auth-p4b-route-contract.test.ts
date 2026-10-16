import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("server/routes.ts", "utf8");
const admin = readFileSync("client/src/pages/Admin.tsx", "utf8");

test("P4B management endpoints use their explicit capability guards", () => {
  for (const expected of [
    'app.get("/api/admin/locations", requireLocationsManage',
    'app.post("/api/admin/locations", requireLocationsManage',
    'app.patch("/api/admin/locations/:id", requireLocationsManage',
    'app.get("/api/admin/audit-logs", requireAuditView',
    'app.post("/api/admin/extras", requireExtrasManage',
    'app.patch("/api/admin/extras/:id", requireExtrasManage',
    'app.get("/api/admin/expenses", requireExpensesManage',
    'app.post("/api/admin/expenses", requireExpensesManage',
    'app.patch("/api/admin/expenses/:id", requireExpensesManage',
    'app.delete("/api/admin/expenses/:id", requireExpensesManage',
    'app.get("/api/admin/expense-series", requireExpensesManage',
    'app.post("/api/admin/expense-series", requireExpensesManage',
    'app.patch("/api/admin/expense-series/:id", requireExpensesManage',
    'app.delete("/api/admin/expense-series/:id", requireExpensesManage',
    'app.post("/api/admin/expense-series/:id/versions", requireExpensesManage',
    'app.post("/api/admin/expense-series/:id/state", requireExpensesManage',
    'app.patch("/api/admin/expenses/:id/occurrence", requireExpensesManage',
    'app.post("/api/admin/location-barbers", requireTeamLocationAssignment',
    'app.patch("/api/barbers/:id/services", requireCatalogLocationManage',
    'app.patch("/api/barbers/:id/reset-password", requireUsersManage',
    'app.post("/api/barbers/:id/invite", requireUsersManage',
    'app.patch("/api/shop/availability", requireShopHoursManage',
    'app.get("/api/admin/services/available", requireCatalogLocationManage',
    'app.post("/api/admin/service-locations", requireCatalogLocationManage',
    'app.patch("/api/admin/service-locations/:serviceId", requireCatalogLocationManage',
    'app.delete("/api/admin/service-locations/:serviceId", requireCatalogLocationManage',
    'app.post("/api/admin/create", requireUsersAndAccessManage',
    'app.get("/api/admin/blacklist", requireCustomerBlock',
    'app.post("/api/admin/blacklist", requireCustomerBlock',
  ]) {
    assert.ok(routes.includes(expected), expected);
  }
});

test("recurring expense mutations remain location-sensitive", () => {
  assert.match(routes, /\^\\\/admin\\\/expense-series\(\?:\\\/\\d\+\(\?:\\\/\(\?:versions\|state\)\)\?\)\?\$\//);
  assert.match(routes, /\^\\\/admin\\\/expenses\\\/\\d\+\\\/occurrence\$\//);
});

test("mixed professional and service mutations authorize independent payload fields", () => {
  assert.match(routes, /globalIdentityFields[\s\S]*team\.manage_global/);
  assert.match(routes, /inputFields\.has\("email"\)[\s\S]*users\.manage/);
  assert.match(routes, /inputFields\.has\("serviceIds"\)[\s\S]*catalog\.manage_location/);
  assert.match(routes, /compensationModel[\s\S]*finance\.manage_compensation/);
  assert.match(routes, /\["name", "description", "agendaLabel", "categoryId"\][\s\S]*catalog\.manage_global/);
  assert.match(routes, /\["priceOverride", "durationOverride", "isActive", "isVisible", "price", "duration"\][\s\S]*catalog\.manage_location/);
  assert.match(routes, /includePrivateFields \? \{ email \} : \{\}/);
  assert.match(routes, /includeFinancialFields[\s\S]*compensationModel[\s\S]*chairRentPeriod/);
  assert.doesNotMatch(routes, /canViewTeam \|\| canViewTeamFinance \|\|/);
});

test("location-scoped blacklist checks, removals and cancellations never fall back globally", () => {
  assert.match(routes, /storage\.isBlacklisted\(\s*Number\(res\.locals\.locationId\)/);
  assert.match(routes, /storage\.getAppointments\(undefined, undefined, locationId\)/);
  assert.match(routes, /storage\.getBlacklist\(locationId\)/);
  assert.match(routes, /storage\.removeFromBlacklist\(entryId, locationId\)/);
  assert.match(routes, /\^\\\/admin\\\/blacklist\(\?:\\\/\\d\+\)\?\$\//);
  assert.doesNotMatch(routes, /storage\.getBlacklist\(\)/);
  assert.doesNotMatch(routes, /storage\.removeFromBlacklist\(entryId\)/);
});

test("Admin UI gates P4B surfaces with granular capabilities instead of users.manage", () => {
  assert.doesNotMatch(admin, /canManageAdminFeatures/);
  for (const capability of [
    "team.view",
    "team.manage_global",
    "team.assign_location",
    "catalog.manage_global",
    "catalog.manage_location",
    "hours.manage_establishment",
    "extras.manage",
    "finance.manage_expenses",
    "finance.manage_compensation",
    "locations.manage",
    "audit.view",
    "customers.block",
  ]) {
    assert.ok(admin.includes(`"${capability}"`), capability);
  }
});
