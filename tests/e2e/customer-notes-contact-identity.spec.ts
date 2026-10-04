import { expect, test, type APIRequestContext } from "@playwright/test";

async function loginAdmin(request: APIRequestContext) {
  const response = await request.post("/api/admin/login", {
    data: { username: "admin", password: "Playwright-Test-Admin-2026!" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test.describe.serial("customer-note contact identities", () => {
  test("resolves phone/email identities, reuses unique notes and rejects ambiguous matches", async ({ request }) => {
    await loginAdmin(request);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const serviceResponse = await request.post("/api/services", { data: {
      name: `Notas identidade ${suffix}`,
      description: "Serviço de teste",
      price: 1500,
      duration: 30,
      isVisible: true,
    } });
    expect(serviceResponse.status(), await serviceResponse.text()).toBe(201);
    const service = await serviceResponse.json();
    const barberResponse = await request.post("/api/barbers", { data: {
      name: `Barbeiro notas ${suffix}`,
      specialty: "Notas internas",
      email: `barber-notes-${suffix}@example.test`,
      color: "#0EA5E9",
      isVisible: true,
      serviceIds: [service.id],
    } });
    expect(barberResponse.status(), await barberResponse.text()).toBe(201);
    const barber = await barberResponse.json();
    let sequence = 0;

    const createAppointment = async (options: { name: string; phone?: string; email?: string }) => {
      sequence += 1;
      const start = new Date(Date.UTC(2032, 0, 5 + sequence, 9, 0, 0));
      const response = await request.post("/api/appointments/block", { data: {
        barberId: barber.id,
        serviceId: service.id,
        startTime: start.toISOString(),
        name: options.name,
        phone: options.phone ?? "",
        customerEmail: options.email ?? "",
        isManualBooking: true,
        allowOutsideHours: true,
        isRecurring: false,
      } });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).appointments[0];
    };
    const saveByAppointment = (appointmentId: number, notes: string) => request.patch(
      "/api/admin/customers/notes",
      { data: { appointmentId, notes } },
    );
    const history = async (appointmentId: number) => {
      const response = await request.get(`/api/admin/customers/history?appointmentId=${appointmentId}`);
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };

    const legacyPhone = "+351910100001";
    const phoneOnly = await createAppointment({ name: "Cliente telefone legacy", phone: legacyPhone });
    const legacyResponse = await request.patch(`/api/admin/customers/${encodeURIComponent(legacyPhone)}/notes`, {
      data: { customerName: phoneOnly.customerName, email: "", notes: "Nota legacy por telefone" },
    });
    expect(legacyResponse.ok(), await legacyResponse.text()).toBe(true);
    expect((await history(phoneOnly.id)).notes.notes).toBe("Nota legacy por telefone");

    const blankNameLegacyPhone = "+351910100008";
    const blankNameLegacyResponse = await request.patch(
      `/api/admin/customers/${encodeURIComponent(blankNameLegacyPhone)}/notes`,
      { data: { customerName: "", email: "", notes: "Nota legacy sem chave de nome" } },
    );
    expect(blankNameLegacyResponse.ok(), await blankNameLegacyResponse.text()).toBe(true);
    const blankNameLegacyNote = await blankNameLegacyResponse.json();
    const namedLegacyAppointment = await createAppointment({
      name: "Cliente legacy agora identificado",
      phone: blankNameLegacyPhone,
    });
    expect((await history(namedLegacyAppointment.id)).notes.notes).toBe("Nota legacy sem chave de nome");
    const reusedBlankNameLegacy = await saveByAppointment(namedLegacyAppointment.id, "Nota legacy reutilizada");
    expect(reusedBlankNameLegacy.ok(), await reusedBlankNameLegacy.text()).toBe(true);
    expect((await reusedBlankNameLegacy.json()).id).toBe(blankNameLegacyNote.id);

    const emailOnly = await createAppointment({
      name: "Cliente apenas email",
      email: "Email.Only@Example.Test",
    });
    const emailSave = await saveByAppointment(emailOnly.id, "Nota por email");
    expect(emailSave.ok(), await emailSave.text()).toBe(true);
    expect(await emailSave.json()).toMatchObject({
      phone: null,
      email: "email.only@example.test",
      emailKey: "email.only@example.test",
      notes: "Nota por email",
    });
    expect((await history(emailOnly.id)).notes.notes).toBe("Nota por email");

    const phoneReuseName = "Cliente reutiliza telefone";
    const phoneReuse = "+351910100002";
    const phoneReuseOriginal = await createAppointment({ name: phoneReuseName, phone: phoneReuse });
    expect((await saveByAppointment(phoneReuseOriginal.id, "Original telefone")).ok()).toBe(true);
    const phoneReuseBoth = await createAppointment({
      name: phoneReuseName,
      phone: phoneReuse,
      email: "phone-reuse@example.test",
    });
    expect((await history(phoneReuseBoth.id)).notes.notes).toBe("Original telefone");
    const phoneEnriched = await saveByAppointment(phoneReuseBoth.id, "Telefone enriquecido");
    expect(phoneEnriched.ok(), await phoneEnriched.text()).toBe(true);
    const phoneEnrichedNote = await phoneEnriched.json();
    const phoneReuseEmailOnly = await createAppointment({ name: phoneReuseName, email: "PHONE-REUSE@example.test" });
    expect((await history(phoneReuseEmailOnly.id)).notes.notes).toBe("Telefone enriquecido");

    const emailReuseName = "Cliente reutiliza email";
    const emailReuseOriginal = await createAppointment({ name: emailReuseName, email: "reuse@example.test" });
    expect((await saveByAppointment(emailReuseOriginal.id, "Original email")).ok()).toBe(true);
    const emailReuseBoth = await createAppointment({
      name: emailReuseName,
      phone: "+351910100003",
      email: "REUSE@example.test",
    });
    const emailEnriched = await saveByAppointment(emailReuseBoth.id, "Email enriquecido");
    expect(emailEnriched.ok(), await emailEnriched.text()).toBe(true);
    expect((await emailEnriched.json()).id).not.toBe(phoneEnrichedNote.id);
    const emailReusePhoneOnly = await createAppointment({ name: emailReuseName, phone: "+351910100003" });
    expect((await history(emailReusePhoneOnly.id)).notes.notes).toBe("Email enriquecido");

    const both = await createAppointment({
      name: "Cliente ambos contactos",
      phone: "+351910100004",
      email: "both@example.test",
    });
    expect((await saveByAppointment(both.id, "Nota com ambos")).ok()).toBe(true);
    expect((await history(both.id)).notes.notes).toBe("Nota com ambos");

    const withoutContacts = await createAppointment({ name: "Cliente sem contactos" });
    const noContactSave = await saveByAppointment(withoutContacts.id, "Não deve gravar");
    expect(noContactSave.status()).toBe(400);
    expect(await noContactSave.json()).toEqual({
      message: "Adicione um telemóvel ou email à marcação para utilizar notas internas.",
    });
    const noContactHistory = await history(withoutContacts.id);
    expect(noContactHistory.appointments).toHaveLength(1);
    expect(noContactHistory.notes.notes).toBe("");

    const conflictName = "Cliente identidade ambígua";
    const conflictPhone = "+351910100005";
    const conflictPhoneAppointment = await createAppointment({ name: conflictName, phone: conflictPhone });
    expect((await saveByAppointment(conflictPhoneAppointment.id, "Nota do telefone")).ok()).toBe(true);
    const conflictEmailAppointment = await createAppointment({ name: conflictName, email: "conflict@example.test" });
    expect((await saveByAppointment(conflictEmailAppointment.id, "Nota do email")).ok()).toBe(true);
    const conflictBothAppointment = await createAppointment({
      name: conflictName,
      phone: conflictPhone,
      email: "conflict@example.test",
    });
    const conflictSave = await saveByAppointment(conflictBothAppointment.id, "Não deve fundir");
    expect(conflictSave.status()).toBe(409);
    expect(await conflictSave.json()).toMatchObject({ code: "CUSTOMER_NOTE_IDENTITY_CONFLICT" });
    const conflictHistory = await request.get(
      `/api/admin/customers/history?appointmentId=${conflictBothAppointment.id}`,
    );
    expect(conflictHistory.status()).toBe(409);
    expect(await conflictHistory.json()).toMatchObject({ code: "CUSTOMER_NOTE_IDENTITY_CONFLICT" });
  });

  test("appointment endpoint preserves barber permissions", async ({ page, request }) => {
    await loginAdmin(request);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const [service] = await (await request.get("/api/services?includeHidden=true")).json();
    const barberResponse = await request.post("/api/barbers", { data: {
      name: `Barbeiro permissões ${suffix}`,
      specialty: "Notas internas",
      email: `barber-permissions-${suffix}@example.test`,
      color: "#22C55E",
      isVisible: true,
      serviceIds: [service.id],
    } });
    expect(barberResponse.status(), await barberResponse.text()).toBe(201);
    const barber = await barberResponse.json();
    const otherBarberResponse = await request.post("/api/barbers", { data: {
      name: `Outro barbeiro ${suffix}`,
      specialty: "Notas internas",
      color: "#EF4444",
      isVisible: true,
      serviceIds: [service.id],
    } });
    expect(otherBarberResponse.status(), await otherBarberResponse.text()).toBe(201);
    const otherBarber = await otherBarberResponse.json();
    const createFor = async (barberId: number, name: string, phone: string, day: number) => {
      const response = await request.post("/api/appointments/block", { data: {
        barberId,
        serviceId: service.id,
        startTime: new Date(Date.UTC(2033, 0, day, 10, 0, 0)).toISOString(),
        name,
        phone,
        customerEmail: "",
        isManualBooking: true,
        allowOutsideHours: true,
        isRecurring: false,
      } });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).appointments[0];
    };
    const ownAppointment = await createFor(barber.id, `Cliente próprio ${suffix}`, "+351910100006", 10);
    const otherAppointment = await createFor(otherBarber.id, `Cliente alheio ${suffix}`, "+351910100007", 11);

    const inviteResponse = await request.post(`/api/barbers/${barber.id}/invite`);
    expect(inviteResponse.status(), await inviteResponse.text()).toBe(201);
    const inviteToken = new URL((await inviteResponse.json()).inviteUrl).pathname.split("/").pop();
    const acceptResponse = await page.request.post(`/api/barber-invites/${inviteToken}/accept`, {
      data: { password: "Barber-Notes-2026!" },
    });
    expect(acceptResponse.ok(), await acceptResponse.text()).toBe(true);

    const ownSave = await page.request.patch("/api/admin/customers/notes", {
      data: { appointmentId: ownAppointment.id, notes: "Nota autorizada" },
    });
    expect(ownSave.ok(), await ownSave.text()).toBe(true);
    const forbiddenSave = await page.request.patch("/api/admin/customers/notes", {
      data: { appointmentId: otherAppointment.id, notes: "Nota sem autorização" },
    });
    expect(forbiddenSave.status()).toBe(403);
  });
});
