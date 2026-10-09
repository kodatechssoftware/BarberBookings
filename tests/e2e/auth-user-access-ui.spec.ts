import { expect, test, type Page, type Route } from "@playwright/test";
import {
  capabilityCodes,
  professionalCapabilityCodes,
  type AccessScope,
  type CapabilityCode,
  type EffectiveAccess,
} from "../../shared/auth";

type MockUser = {
  id: number;
  displayName: string;
  username: string | null;
  email: string;
  status: "invited" | "active" | "disabled";
  authVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  professionalId: number | null;
  access: AccessScope[];
};

const locations = [
  { id: 1, name: "Loja A", slug: "loja-a", address: "Rua A", logoUrl: null, mapUrl: null, mapEmbedUrl: null, phone: null, email: null, timezone: "Europe/Lisbon", isActive: true, isDefault: true, sortOrder: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: 2, name: "Loja B", slug: "loja-b", address: "Rua B", logoUrl: null, mapUrl: null, mapEmbedUrl: null, phone: null, email: null, timezone: "Europe/Lisbon", isActive: true, isDefault: false, sortOrder: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];

const professionals = [
  { id: 11, name: "Ana Professional", specialty: "Corte", bio: null, avatar: null, email: "ana@example.test", userId: null, color: "#D4AF37", isVisible: true, serviceIds: [] },
  { id: 12, name: "Bruno Santos", specialty: "Corte", bio: null, avatar: null, email: "bs881366@gmail.com", userId: 102, color: "#D4AF37", isVisible: true, serviceIds: [] },
  { id: 13, name: "Joana Professional", specialty: "Cor", bio: null, avatar: null, email: "joana@example.test", userId: 103, color: "#D4AF37", isVisible: true, serviceIds: [] },
];

function user(input: Partial<MockUser> & Pick<MockUser, "id" | "displayName" | "email" | "status" | "professionalId" | "access">): MockUser {
  return {
    username: null,
    authVersion: 1,
    lastLoginAt: null,
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
    ...input,
  };
}

function defaultUsers(): MockUser[] {
  return [
    user({ id: 101, displayName: "Admin sem Professional", email: "admin@example.test", status: "active", professionalId: null, access: [{ kind: "global", preset: "administrator", capabilities: [] }] }),
    user({ id: 102, displayName: "Bruno Santos", email: "bs881366@gmail.com", status: "active", professionalId: 12, access: [{ kind: "global", preset: "administrator", capabilities: [] }] }),
    user({ id: 103, displayName: "Joana", email: "joana@example.test", status: "active", professionalId: 13, access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }] }),
    user({ id: 104, displayName: "Convidado", email: "invite@example.test", status: "invited", professionalId: null, access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }] }),
    user({ id: 105, displayName: "Desativado", email: "disabled@example.test", status: "disabled", professionalId: null, access: [{ kind: "location", locationId: 2, preset: "professional", capabilities: [] }] }),
  ];
}

async function loginLegacyAdmin(page: Page) {
  const response = await page.request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function mockCanonicalAdmin(
  page: Page,
  options: {
    access?: EffectiveAccess;
    users?: MockUser[];
    rejectNextAccessUpdate?: boolean;
    rejectNextStatusUpdate?: boolean;
  } = {},
) {
  const actorAccess = options.access ?? {
    globalCapabilities: capabilityCodes,
    locationCapabilities: [],
    presetLabels: ["Administrador"],
  };
  const users = options.users ?? defaultUsers();
  const observed = {
    created: null as Record<string, unknown> | null,
    identityUpdates: [] as Array<{ userId: number; displayName?: string; email?: string }>,
    professionalUpdates: [] as Array<{ userId: number; professionalId: number | null }>,
    accessUpdates: [] as Array<{ userId: number; body: Record<string, unknown> }>,
    statusUpdates: [] as Array<{ userId: number; status: string }>,
    inviteReplacements: 0,
    inviteRevocations: 0,
    sessionRevocations: 0,
    professionalLocationHeaders: new Set<string>(),
  };
  let rejectNextAccessUpdate = options.rejectNextAccessUpdate ?? false;
  let rejectNextStatusUpdate = options.rejectNextStatusUpdate ?? false;

  await page.route("**/api/admin/me", (route) => route.fulfill({ json: {
    authorized: true,
    role: actorAccess.globalCapabilities.length === capabilityCodes.length ? "admin" : "user",
    id: 101,
    userId: 101,
    professionalId: null,
    name: "Admin sem Professional",
    email: "admin@example.test",
    access: actorAccess,
  } }));
  await page.route("**/api/account/locations", (route) => route.fulfill({ json: locations }));
  await page.route("**/api/barbers**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/barbers") {
      const locationHeader = route.request().headers()["x-location-id"];
      if (locationHeader) observed.professionalLocationHeaders.add(locationHeader);
      await route.fulfill({ json: professionals });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/admin/users**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const match = url.pathname.match(/^\/api\/admin\/users\/(\d+)(?:\/(access|professional|status|invites|revoke-sessions))?$/);

    if (url.pathname === "/api/admin/users" && method === "GET") {
      await route.fulfill({ json: users.map(({ access: _access, ...listed }) => listed) });
      return;
    }
    if (url.pathname === "/api/admin/users" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      observed.created = body;
      const created = user({
        id: 200,
        displayName: String(body.displayName),
        email: String(body.email),
        status: "invited",
        professionalId: body.professionalId ? Number(body.professionalId) : null,
        access: body.access as AccessScope[],
      });
      users.push(created);
      await route.fulfill({ status: 201, json: {
        user: created,
        inviteUrl: "https://example.test/user-invite#token=one-time-secret",
        expiresAt: "2026-10-13T08:00:00.000Z",
      } });
      return;
    }
    if (!match) {
      await route.continue();
      return;
    }

    const userId = Number(match[1]);
    const action = match[2];
    const target = users.find((candidate) => candidate.id === userId)!;
    if (!action && method === "GET") {
      await route.fulfill({ json: target });
      return;
    }
    if (!action && method === "PATCH") {
      const body = request.postDataJSON() as { displayName?: string; email?: string };
      Object.assign(target, body);
      observed.identityUpdates.push({ userId, ...body });
      await route.fulfill({ json: target });
      return;
    }
    if (action === "professional" && method === "PUT") {
      const body = request.postDataJSON() as { professionalId: number | null };
      target.professionalId = body.professionalId;
      observed.professionalUpdates.push({ userId, professionalId: body.professionalId });
      await route.fulfill({ json: target });
      return;
    }
    if (action === "access" && method === "PUT") {
      if (rejectNextAccessUpdate) {
        rejectNextAccessUpdate = false;
        await route.fulfill({ status: 403, json: { code: "GRANT_CEILING", message: "Não pode conceder acesso superior ao seu." } });
        return;
      }
      const body = request.postDataJSON() as { mode: string; scopes: AccessScope[] };
      target.access = body.mode === "replace_all" ? body.scopes : target.access;
      observed.accessUpdates.push({ userId, body });
      await route.fulfill({ json: target });
      return;
    }
    if (action === "status" && method === "PUT") {
      const body = request.postDataJSON() as { status: "active" | "disabled" };
      if (rejectNextStatusUpdate) {
        rejectNextStatusUpdate = false;
        await route.fulfill({ status: 409, json: { code: "PASSWORD_REQUIRED", message: "O utilizador não tem palavra-passe definida." } });
        return;
      }
      target.status = body.status;
      observed.statusUpdates.push({ userId, status: body.status });
      await route.fulfill({ json: target });
      return;
    }
    if (action === "invites" && method === "POST") {
      observed.inviteReplacements += 1;
      await route.fulfill({ status: 201, json: { inviteUrl: "https://example.test/user-invite#token=replaced-secret", expiresAt: "2026-10-13T08:00:00.000Z" } });
      return;
    }
    if (action === "invites" && method === "DELETE") {
      observed.inviteRevocations += 1;
      await route.fulfill({ json: { revoked: 1 } });
      return;
    }
    if (action === "revoke-sessions" && method === "POST") {
      observed.sessionRevocations += 1;
      await route.fulfill({ json: { authVersion: target.authVersion + 1 } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Mock route missing" } });
  });

  return observed;
}

test.describe("canonical User & Access Management UI", () => {
  test("covers identity, Professional linkage, states, invitations and responsive rendering", async ({ page }) => {
    await loginLegacyAdmin(page);
    const observed = await mockCanonicalAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Utilizadores", exact: true }).click();

    await expect(page.getByText("Utilizadores e acessos", { exact: true })).toBeVisible();
    const bruno = page.getByTestId("managed-user-102");
    await expect(bruno).toContainText("Bruno Santos");
    await expect(bruno).toContainText("Ativo");
    await expect(bruno).toContainText("Professional associado");
    await expect(bruno).toContainText("Administrator global");
    await expect(page.getByTestId("managed-user-101")).toContainText("Sem Professional associado");
    await expect(page.getByTestId("managed-user-104")).toContainText("Convidado");
    await expect(page.getByTestId("managed-user-105")).toContainText("Desativado");
    await expect.poll(() => Array.from(observed.professionalLocationHeaders).sort()).toEqual(["1", "2"]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

    await page.getByRole("button", { name: "Convidar utilizador" }).click();
    const createDialog = page.getByRole("dialog", { name: "Convidar novo utilizador" });
    await createDialog.getByLabel("Nome").fill("Receção");
    await createDialog.getByLabel("Email").fill("rececao@example.test");
    await createDialog.getByRole("button", { name: "Criar e gerar convite" }).click();
    await expect(page.getByRole("dialog", { name: "Convite pronto" })).toBeVisible();
    expect(observed.created).toMatchObject({
      displayName: "Receção",
      email: "rececao@example.test",
      professionalId: null,
      access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
    });
    await page.getByRole("dialog", { name: "Convite pronto" }).getByRole("button", { name: "Concluir" }).click();

    await bruno.getByRole("button", { name: "Editar" }).click();
    const editDialog = page.getByRole("dialog", { name: "Editar utilizador" });
    await expect(editDialog.getByText("Identidade", { exact: true })).toBeVisible();
    await expect(editDialog.getByText("Perfis e permissões", { exact: true })).toBeVisible();
    await editDialog.getByLabel("Nome").fill("Bruno Santos QA");
    await editDialog.getByLabel("Email").fill("bruno.qa@example.test");
    await editDialog.getByLabel("Vínculo Professional").click();
    await page.getByRole("option", { name: "Sem Professional" }).click();
    await editDialog.getByRole("button", { name: "Guardar identidade", exact: true }).click();
    await expect.poll(() => observed.identityUpdates).toContainEqual({
      userId: 102,
      displayName: "Bruno Santos QA",
      email: "bruno.qa@example.test",
    });
    await editDialog.getByRole("button", { name: "Guardar vínculo Professional" }).click();
    await expect.poll(() => observed.professionalUpdates).toContainEqual({ userId: 102, professionalId: null });
    await editDialog.getByRole("button", { name: "Fechar" }).click();

    await page.getByTestId("managed-user-101").getByRole("button", { name: "Editar" }).click();
    const adminDialog = page.getByRole("dialog", { name: "Editar utilizador" });
    await adminDialog.getByLabel("Vínculo Professional").click();
    await page.getByRole("option", { name: "Ana Professional" }).click();
    await adminDialog.getByRole("button", { name: "Guardar vínculo Professional" }).click();
    await expect.poll(() => observed.professionalUpdates).toContainEqual({ userId: 101, professionalId: 11 });
    await adminDialog.getByRole("button", { name: "Fechar" }).click();

    const invited = page.getByTestId("managed-user-104");
    await invited.getByRole("button", { name: "Reenviar convite" }).click();
    await expect(page.getByRole("dialog", { name: "Convite pronto" })).toBeVisible();
    expect(observed.inviteReplacements).toBe(1);
    await page.getByRole("dialog", { name: "Convite pronto" }).getByRole("button", { name: "Concluir" }).click();
    await invited.getByRole("button", { name: "Revogar convite" }).click();
    await expect.poll(() => observed.inviteRevocations).toBe(1);

    const disabled = page.getByTestId("managed-user-105");
    await disabled.getByRole("button", { name: "Reativar" }).click();
    await expect.poll(() => observed.statusUpdates).toContainEqual({ userId: 105, status: "active" });
    await disabled.getByRole("button", { name: "Revogar sessões" }).click();
    await expect.poll(() => observed.sessionRevocations).toBe(1);
  });

  test("edits global/location scopes and surfaces backend grant-ceiling errors", async ({ page }) => {
    await loginLegacyAdmin(page);
    const observed = await mockCanonicalAdmin(page, {
      rejectNextAccessUpdate: true,
      rejectNextStatusUpdate: true,
    });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Utilizadores", exact: true }).click();
    await page.getByTestId("managed-user-103").getByRole("button", { name: "Editar" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar utilizador" });

    await dialog.getByLabel("Preset de Loja A").click();
    await page.getByRole("option", { name: "Personalizado" }).click();
    await dialog.getByText("Permissões explícitas (0)").click();
    await dialog.getByLabel("Ver o catálogo").click();
    await dialog.getByRole("button", { name: "Acesso global" }).click();
    await expect(dialog.getByLabel("Preset de Toda a instalação")).toBeVisible();
    await dialog.getByRole("button", { name: "Guardar acesso" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Não pode conceder acesso superior ao seu.");

    await dialog.getByRole("button", { name: "Guardar acesso" }).click();
    await expect.poll(() => observed.accessUpdates.length).toBe(1);
    expect(observed.accessUpdates[0]).toMatchObject({ userId: 103, body: { mode: "replace_all" } });
    await dialog.getByRole("button", { name: "Fechar" }).click();

    await page.getByTestId("managed-user-105").getByRole("button", { name: "Reativar" }).click();
    await expect(page.getByLabel("Notifications (F8)")).toContainText("O utilizador não tem palavra-passe definida.");
  });

  test("last Administrator and grant ceiling are blocked visibly before the API", async ({ page }) => {
    await loginLegacyAdmin(page);
    const onlyAdministrator = defaultUsers().filter((candidate) => candidate.id !== 102);
    const limitedAccess: EffectiveAccess = {
      globalCapabilities: ["users.manage"],
      locationCapabilities: [{
        locationId: 1,
        capabilities: ["access.manage", ...professionalCapabilityCodes] as CapabilityCode[],
      }],
      presetLabels: [],
    };
    await mockCanonicalAdmin(page, { access: limitedAccess, users: onlyAdministrator });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Utilizadores", exact: true }).click();

    const lastAdmin = page.getByTestId("managed-user-101");
    await expect(lastAdmin.getByRole("button", { name: "Desativar" })).toBeDisabled();
    await lastAdmin.getByRole("button", { name: "Editar" }).click();
    const lastAdminDialog = page.getByRole("dialog", { name: "Editar utilizador" });
    await expect(lastAdminDialog.getByLabel("Preset de Toda a instalação")).toBeDisabled();
    await lastAdminDialog.getByRole("button", { name: "Fechar" }).click();

    await page.getByRole("button", { name: "Convidar utilizador" }).click();
    const createDialog = page.getByRole("dialog", { name: "Convidar novo utilizador" });
    await expect(createDialog.getByRole("button", { name: "Acesso global" })).toBeDisabled();
    await createDialog.getByLabel("Preset de Loja A").click();
    await expect(page.getByRole("option", { name: "Administrator" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await createDialog.getByRole("button", { name: "Cancelar" }).click();
  });

  test("legacy mode keeps the existing Admin UI and hides canonical user management", async ({ page }) => {
    await loginLegacyAdmin(page);
    await page.goto("/admin");
    await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Utilizadores", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("user-access-manager")).toHaveCount(0);
  });
});
