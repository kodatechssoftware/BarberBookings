type LocationMapSource = {
  address: string;
  mapUrl?: string | null;
  mapEmbedUrl?: string | null;
};

/** Derive links at display time so an address change cannot leave generated URLs stale. */
export function resolveLocationMapLinks(location: LocationMapSource) {
  const address = location.address.trim();
  const query = encodeURIComponent(address);
  return {
    mapUrl: location.mapUrl?.trim() || (address
      ? `https://www.google.com/maps/search/?api=1&query=${query}`
      : ""),
    mapEmbedUrl: location.mapEmbedUrl?.trim() || (address
      ? `https://www.google.com/maps?q=${query}&output=embed`
      : ""),
  };
}
