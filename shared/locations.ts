import { z } from "zod";

const optionalHttpUrl = z.string().trim().max(1000).refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}, "Indique um endereço web válido.");

const optionalGoogleMapsEmbedUrl = optionalHttpUrl.refine((value) => {
  if (!value) return true;
  try {
    const { protocol, hostname, pathname, searchParams, username, password } = new URL(value);
    const googleHost = hostname === "google.com" || hostname.endsWith(".google.com");
    const embedPath = pathname === "/maps/embed" || pathname.startsWith("/maps/embed/");
    const addressEmbed = (pathname === "/maps" || pathname === "/maps/")
      && searchParams.get("output") === "embed"
      && Boolean(searchParams.get("q")?.trim());
    return protocol === "https:" && !username && !password && googleHost && (embedPath || addressEmbed);
  } catch {
    return false;
  }
}, "Utilize um link de incorporação do Google Maps válido.");

export const locationInputSchema = z.object({
  name: z.string().trim().min(2, "Indique o nome da localização.").max(120),
  address: z.string().trim().min(5, "Indique a morada completa.").max(300),
  mapUrl: optionalHttpUrl.optional().default(""),
  mapEmbedUrl: optionalGoogleMapsEmbedUrl.optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(120).refine(
    (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Indique um email válido.",
  ).optional().default(""),
  timezone: z.string().trim().min(1).max(80).default("Europe/Lisbon"),
  isActive: z.boolean().optional().default(false),
});

export const locationUpdateSchema = locationInputSchema.partial();

export type LocationInput = z.infer<typeof locationInputSchema>;
export type LocationUpdate = z.infer<typeof locationUpdateSchema>;

export type ShopLocation = {
  id: number;
  name: string;
  slug: string;
  address: string;
  mapUrl: string | null;
  mapEmbedUrl: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};
