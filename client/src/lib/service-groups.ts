export type ServiceCategoryMetadata = {
  id: number;
  name: string;
  sortOrder: number;
};

export type CategorizedService = {
  id: number;
  category?: ServiceCategoryMetadata | null;
};

export type ServiceDisplayGroup<T extends CategorizedService> = {
  key: string;
  label: string | null;
  services: T[];
};

export function groupServicesForDisplay<T extends CategorizedService>(services: readonly T[]): ServiceDisplayGroup<T>[] {
  const categorizedServices = services.filter((service) => Boolean(service.category));

  // Preserve the legacy flat catalogue when there are no active category
  // associations in the already-filtered list.
  if (categorizedServices.length === 0) {
    return [{ key: "all-services", label: null, services: [...services] }];
  }

  const categories = new Map<number, ServiceCategoryMetadata>();
  for (const service of categorizedServices) {
    const category = service.category!;
    categories.set(category.id, category);
  }

  const groups = Array.from(categories.values())
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    .map((category) => ({
      key: `category-${category.id}`,
      label: category.name,
      services: services.filter((service) => service.category?.id === category.id),
    }))
    .filter((group) => group.services.length > 0);

  const uncategorizedServices = services.filter((service) => !service.category);
  if (uncategorizedServices.length > 0) {
    groups.push({
      key: "other-services",
      label: "Outros serviços",
      services: uncategorizedServices,
    });
  }

  return groups;
}
