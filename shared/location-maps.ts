type LocationMapSource = {
  name?: string | null;
  address: string;
  mapUrl?: string | null;
  mapEmbedUrl?: string | null;
};

/** Derive links at display time so an address change cannot leave generated URLs stale. */
export function resolveLocationMapLinks(location: LocationMapSource) {
  const address = location.address.trim();
  const addressQuery = encodeURIComponent(address);
  const locationName = location.name?.trim();
  const embedQuery = encodeURIComponent(locationName ? `${locationName}, ${address}` : address);
  return {
    mapUrl: location.mapUrl?.trim() || (address
      ? `https://www.google.com/maps/search/?api=1&query=${addressQuery}`
      : ""),
    mapEmbedUrl: location.mapEmbedUrl?.trim() || (address
      ? `https://www.google.com/maps?q=${embedQuery}&output=embed`
      : ""),
  };
}
