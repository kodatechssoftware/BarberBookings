import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyAuthPreflightReport } from "../../server/auth-legacy-preflight";

const now = new Date("2030-01-15T12:00:00.000Z");

test("normal admin and credentialed professional are SAFE_AUTO candidates", () => {
  const report = buildLegacyAuthPreflightReport({
    admins: [{ id: 1, username: "admin", email: "owner@example.test", passwordHash: "$2b$admin" }],
    barbers: [
      { id: 10, name: "Ana", email: "ana@example.test", passwordHash: "$2b$ana" },
      { id: 11, name: "Sem acesso", email: null, passwordHash: null },
    ],
    invites: [],
    now,
  });

  assert.equal(report.classificationTotals.SAFE_AUTO, 3);
  assert.equal(report.classificationTotals.MANUAL_REVIEW, 0);
  assert.equal(report.classificationTotals.BLOCKER, 0);
  assert.equal(report.inventory.admins.usernameNotEmail, 1);
  assert.equal(report.inventory.barbers.withoutCredential, 1);
  assert.match(
    report.cases.find((entry) => entry.barberIds.includes(11))?.reasons.join(",") || "",
    /remain_unlinked/,
  );
});

test("Bruno-style duplicate with one literal credential is a single SAFE_AUTO identity", () => {
  const report = buildLegacyAuthPreflightReport({
    admins: [{
      id: 2,
      username: "bs881366@gmail.com",
      email: "BS881366@gmail.com",
      passwordHash: "$2b$same-literal-hash",
    }],
    barbers: [{
      id: 20,
      name: "Bruno Santos",
      email: " bs881366@gmail.com ",
      passwordHash: "$2b$same-literal-hash",
    }],
    invites: [],
    now,
  });

  assert.equal(report.cases.length, 1);
  assert.deepEqual(report.cases[0], {
    key: "bs881366@gmail.com",
    classification: "SAFE_AUTO",
    normalizedIdentifiers: ["bs881366@gmail.com"],
    adminIds: [2],
    barberIds: [20],
    credentialComparison: "literal_equal",
    reasons: ["legacy_records_have_one_unambiguous_identity"],
    proposedAction: "Eligible for a controlled P2B backfill after explicit approval.",
  });
  assert.equal(report.credentialMatches.literalEqual, 1);
});

test("Bruno-style duplicate with different bcrypt strings requires manual review", () => {
  const report = buildLegacyAuthPreflightReport({
    admins: [{
      id: 2,
      username: "bs881366@gmail.com",
      email: "bs881366@gmail.com",
      passwordHash: "$2b$admin-salt",
    }],
    barbers: [{
      id: 20,
      name: "Bruno Santos",
      email: "bs881366@gmail.com",
      passwordHash: "$2b$barber-salt",
    }],
    invites: [],
    now,
  });

  assert.equal(report.cases[0].classification, "MANUAL_REVIEW");
  assert.equal(report.cases[0].credentialComparison, "different");
  assert.ok(report.cases[0].reasons.includes("shared_identity_has_different_literal_hashes"));
  assert.match(report.credentialMatches.note, /salts differ/i);
});

test("duplicate emails and password without identifier are blockers", () => {
  const report = buildLegacyAuthPreflightReport({
    admins: [],
    barbers: [
      { id: 30, name: "A", email: "duplicate@example.test", passwordHash: "$2b$a" },
      { id: 31, name: "B", email: "DUPLICATE@example.test", passwordHash: "$2b$b" },
      { id: 32, name: "C", email: null, passwordHash: "$2b$orphan" },
    ],
    invites: [],
    now,
  });

  assert.equal(report.classificationTotals.BLOCKER, 2);
  assert.deepEqual(report.collisions.duplicateBarberEmails, [{
    identifier: "duplicate@example.test",
    adminIds: [],
    barberIds: [30, 31],
  }]);
  assert.ok(report.cases.some((entry) => entry.reasons.includes("professional_has_password_without_usable_email")));
});

test("email without password and admin without canonical email require manual review", () => {
  const report = buildLegacyAuthPreflightReport({
    admins: [{ id: 5, username: "legacy-admin", email: null, passwordHash: "$2b$admin" }],
    barbers: [{ id: 50, name: "Convidado", email: "invite@example.test", passwordHash: null }],
    invites: [],
    now,
  });

  assert.equal(report.classificationTotals.MANUAL_REVIEW, 2);
  assert.ok(report.cases.some((entry) => entry.reasons.includes("admin_requires_canonical_email")));
  assert.ok(report.cases.some((entry) => entry.reasons.includes("professional_email_has_no_password")));
});

test("normalized admin username/email collisions are explicit blockers", () => {
  const duplicateUsername = buildLegacyAuthPreflightReport({
    admins: [
      { id: 60, username: "OWNER", email: "first@example.test", passwordHash: "$2b$first" },
      { id: 61, username: " owner ", email: "second@example.test", passwordHash: "$2b$second" },
    ],
    barbers: [],
    invites: [],
    now,
  });
  assert.deepEqual(duplicateUsername.collisions.duplicateAdminUsernames, [{
    identifier: "owner",
    adminIds: [60, 61],
    barberIds: [],
  }]);
  assert.equal(duplicateUsername.cases[0].classification, "BLOCKER");

  const crossColumn = buildLegacyAuthPreflightReport({
    admins: [
      { id: 62, username: "legacy-owner", email: "shared@example.test", passwordHash: "$2b$first" },
      { id: 63, username: "SHARED@example.test", email: "other@example.test", passwordHash: "$2b$second" },
    ],
    barbers: [],
    invites: [],
    now,
  });
  assert.deepEqual(crossColumn.collisions.adminUsernameVsAdminEmail, [{
    identifier: "shared@example.test",
    adminIds: [62, 63],
    barberIds: [],
  }]);
  assert.equal(crossColumn.cases[0].classification, "BLOCKER");
});

test("invite and legacy session inventory is classified without exposing hashes", () => {
  const report = buildLegacyAuthPreflightReport({
    admins: [{ id: 1, username: "admin@example.test", email: null, passwordHash: "SECRET-HASH" }],
    barbers: [],
    invites: [
      { id: 1, barberId: 1, expiresAt: new Date("2030-01-16T00:00:00.000Z"), usedAt: null },
      { id: 2, barberId: 2, expiresAt: new Date("2030-01-14T00:00:00.000Z"), usedAt: null },
      { id: 3, barberId: 3, expiresAt: new Date("2030-01-14T00:00:00.000Z"), usedAt: new Date("2030-01-13T00:00:00.000Z") },
    ],
    sessions: {
      tablePresent: true,
      total: 4,
      active: 3,
      activeAdmin: 1,
      activeBarber: 1,
      activeUnknownRole: 1,
    },
    now,
  });

  assert.deepEqual(report.inventory.invites, { total: 3, pending: 1, expired: 1, accepted: 1 });
  assert.equal(report.inventory.sessions.active, 3);
  assert.equal(JSON.stringify(report).includes("SECRET-HASH"), false);
  assert.equal(JSON.stringify(report).includes("passwordHash"), false);
});
