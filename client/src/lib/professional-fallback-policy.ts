export type ProfessionalAvatarFallback = "baptista" | "bruno" | "brand";

export function getProfessionalAvatarFallback(
  professionalName: string,
  useLegacyBarberAvatars: boolean,
): ProfessionalAvatarFallback {
  if (!useLegacyBarberAvatars) return "brand";
  const name = professionalName.toLowerCase();
  if (name.includes("baptista")) return "baptista";
  if (name.includes("bruno")) return "bruno";
  return "brand";
}
