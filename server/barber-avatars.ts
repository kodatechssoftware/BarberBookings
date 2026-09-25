import { createHash } from "node:crypto";

// Only uploaded raster images become references. Existing external/local URLs
// (and any legacy formats) keep their existing representation.
export const INLINE_BARBER_AVATAR_PATTERN = "^data:image/(jpeg|png|webp|gif);base64,";
const inlinePattern = new RegExp(INLINE_BARBER_AVATAR_PATTERN);

export function barberAvatarVersion(avatar: string | null): string | undefined {
  if (!avatar || !inlinePattern.test(avatar)) return undefined;
  return createHash("md5").update(avatar).digest("hex");
}

export function barberAvatarReference(id: number, avatar: string | null): string | null {
  const version = barberAvatarVersion(avatar);
  if (!version) return avatar;
  // Content version, not authentication.
  return `/api/barbers/${id}/avatar?v=${version}`;
}

export function referencedBarberId(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, "http://local.invalid");
    const match = /^\/api\/barbers\/(\d+)\/avatar$/.exec(url.pathname);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function decodeBarberAvatar(avatar: string | null) {
  if (!avatar || !inlinePattern.test(avatar)) return undefined;
  const separator = avatar.indexOf(",");
  return {
    contentType: avatar.slice(5, avatar.indexOf(";")),
    bytes: Buffer.from(avatar.slice(separator + 1), "base64"),
  };
}
