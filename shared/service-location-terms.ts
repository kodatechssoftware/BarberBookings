export type ServiceIdentityTerms = {
  id: number;
  name: string;
  price: number;
  duration: number;
};

export type ServiceLocationTerms = {
  serviceId: number;
  locationId: number;
  isActive: boolean;
  priceOverride: number | null;
  durationOverride: number | null;
};

export function resolveServiceLocationTerms(
  locationId: number,
  service: ServiceIdentityTerms,
  offer: ServiceLocationTerms | undefined,
) {
  if (!offer || offer.serviceId !== service.id || offer.locationId !== locationId) return null;

  return {
    serviceId: service.id,
    locationId,
    name: service.name,
    isActive: offer.isActive,
    priceCents: offer.priceOverride ?? service.price,
    durationMinutes: offer.durationOverride ?? service.duration,
    priceOverride: offer.priceOverride,
    durationOverride: offer.durationOverride,
    basePrice: service.price,
    baseDuration: service.duration,
  };
}
