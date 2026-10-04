import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomerNoteIdentityConflictError,
  MemoryStorage,
  customerNoteIdentityConflictCode,
} from "../../server/storage";

test("customer notes support phone-only, email-only and enriched identities", async () => {
  const storage = new MemoryStorage();

  const phoneOnly = await storage.upsertCustomerNote({
    locationId: 1,
    phone: "+351910000001",
    customerNameKey: "cliente telefone",
    notes: "Nota por telefone",
  });
  assert.equal(phoneOnly.emailKey, null);
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 1,
    phone: "+351910000001",
    customerNameKey: "cliente telefone",
  }))?.id, phoneOnly.id);

  const emailOnly = await storage.upsertCustomerNote({
    locationId: 1,
    email: " Email.Only@Example.Test ",
    customerNameKey: "cliente email",
    notes: "Nota por email",
  });
  assert.equal(emailOnly.phone, null);
  assert.equal(emailOnly.email, "email.only@example.test");
  assert.equal(emailOnly.emailKey, "email.only@example.test");
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 1,
    email: "EMAIL.ONLY@example.test",
    customerNameKey: "cliente email",
  }))?.id, emailOnly.id);

  const enrichedFromPhone = await storage.upsertCustomerNote({
    locationId: 1,
    phone: "+351910000001",
    email: "phone@example.test",
    customerNameKey: "cliente telefone",
    notes: "Nota enriquecida",
  });
  assert.equal(enrichedFromPhone.id, phoneOnly.id);
  assert.equal(enrichedFromPhone.emailKey, "phone@example.test");

  const enrichedFromEmail = await storage.upsertCustomerNote({
    locationId: 1,
    phone: "+351910000002",
    email: "email.only@example.test",
    customerNameKey: "cliente email",
    notes: "Nota email enriquecida",
  });
  assert.equal(enrichedFromEmail.id, emailOnly.id);
  assert.equal(enrichedFromEmail.phone, "+351910000002");
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 1,
    phone: "+351910000002",
    customerNameKey: "cliente email",
  }))?.notes, "Nota email enriquecida");
});

test("customer notes stay isolated by location and normalized customer name", async () => {
  const storage = new MemoryStorage();
  const locationOne = await storage.upsertCustomerNote({
    locationId: 1,
    email: "shared@example.test",
    customerNameKey: "cliente um",
    notes: "Loja A",
  });
  const locationTwo = await storage.upsertCustomerNote({
    locationId: 2,
    email: "shared@example.test",
    customerNameKey: "cliente um",
    notes: "Loja B",
  });
  const differentCustomer = await storage.upsertCustomerNote({
    locationId: 1,
    email: "shared@example.test",
    customerNameKey: "cliente dois",
    notes: "Outra pessoa",
  });

  assert.notEqual(locationOne.id, locationTwo.id);
  assert.notEqual(locationOne.id, differentCustomer.id);
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 1,
    email: "shared@example.test",
    customerNameKey: "cliente um",
  }))?.notes, "Loja A");
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 2,
    email: "shared@example.test",
    customerNameKey: "cliente um",
  }))?.notes, "Loja B");
});

test("phone and email resolving to distinct notes raises an explicit conflict", async () => {
  const storage = new MemoryStorage();
  await storage.upsertCustomerNote({
    locationId: 1,
    phone: "+351910000003",
    customerNameKey: "cliente conflito",
    notes: "Nota telefone",
  });
  await storage.upsertCustomerNote({
    locationId: 1,
    email: "conflict@example.test",
    customerNameKey: "cliente conflito",
    notes: "Nota email",
  });

  await assert.rejects(
    storage.upsertCustomerNote({
      locationId: 1,
      phone: "+351910000003",
      email: "conflict@example.test",
      customerNameKey: "cliente conflito",
      notes: "Não deve fazer merge",
    }),
    (error: unknown) => error instanceof CustomerNoteIdentityConflictError
      && error.code === customerNoteIdentityConflictCode
      && error.status === 409,
  );
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 1,
    phone: "+351910000003",
    customerNameKey: "cliente conflito",
  }))?.notes, "Nota telefone");
  assert.equal((await storage.getCustomerNoteByIdentity({
    locationId: 1,
    email: "conflict@example.test",
    customerNameKey: "cliente conflito",
  }))?.notes, "Nota email");
});
