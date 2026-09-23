import assert from "node:assert/strict";
import test from "node:test";
import { groupServicesForDisplay } from "../../client/src/lib/service-groups";

type TestService = {
  id: number;
  name: string;
  category?: { id: number; name: string; sortOrder: number } | null;
};

test("zero active category metadata preserves the exact flat order without headings", () => {
  const services: TestService[] = [
    { id: 8, name: "Primeiro" },
    { id: 3, name: "Segundo", category: null },
  ];

  assert.deepEqual(groupServicesForDisplay(services), [{
    key: "all-services",
    label: null,
    services,
  }]);
});

test("orders groups and preserves the incoming order inside each group", () => {
  const services: TestService[] = [
    { id: 1, name: "B primeiro", category: { id: 20, name: "B", sortOrder: 2 } },
    { id: 2, name: "Sem categoria" },
    { id: 3, name: "A primeiro", category: { id: 10, name: "A", sortOrder: 1 } },
    { id: 4, name: "B segundo", category: { id: 20, name: "B", sortOrder: 2 } },
    { id: 5, name: "A segundo", category: { id: 10, name: "A", sortOrder: 1 } },
  ];

  const groups = groupServicesForDisplay(services);
  assert.deepEqual(groups.map((group) => group.label), ["A", "B", "Outros serviços"]);
  assert.deepEqual(groups.map((group) => group.services.map((service) => service.id)), [[3, 5], [1, 4], [2]]);
});

test("uses category id as tie-break and never creates an empty group", () => {
  const services: TestService[] = [
    { id: 1, name: "Categoria 2", category: { id: 2, name: "Segunda", sortOrder: 0 } },
    { id: 2, name: "Categoria 1", category: { id: 1, name: "Primeira", sortOrder: 0 } },
  ];

  const groups = groupServicesForDisplay(services);
  assert.deepEqual(groups.map((group) => group.key), ["category-1", "category-2"]);
  assert.ok(groups.every((group) => group.services.length > 0));
});

test("grouping only considers the already-filtered services supplied by the caller", () => {
  const services: TestService[] = [
    { id: 2, name: "Visível nesta loja", category: { id: 7, name: "Cortes", sortOrder: 0 } },
    { id: 4, name: "Sem categoria nesta loja" },
  ];

  assert.deepEqual(
    groupServicesForDisplay(services).map((group) => group.services.map((service) => service.id)),
    [[2], [4]],
  );
});
