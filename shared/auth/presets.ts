import { capabilityCodes, type CapabilityCode } from "./capabilities";

export const accessPresetKeys = ["administrator", "professional"] as const;

export type AccessPresetKey = (typeof accessPresetKeys)[number];

export type AccessPreset = {
  key: AccessPresetKey;
  label: string;
  description: string;
  reserved: boolean;
  capabilities: readonly CapabilityCode[];
};

export const professionalCapabilityCodes = [
  "agenda.view_own",
  "agenda.view_team",
  "appointments.create_manual",
  "appointments.manage_own",
  "appointments.change_status_own",
  "customers.view_own",
  "customers.notes_own",
  "catalog.view",
  "finance.view_own",
  "reports.export_own",
] as const satisfies readonly CapabilityCode[];

export const accessPresets = {
  administrator: {
    key: "administrator",
    label: "Administrador",
    description: "Acesso global reservado com todas as capabilities registadas.",
    reserved: true,
    // Derived from the registry so a newly registered capability cannot be omitted.
    capabilities: capabilityCodes,
  },
  professional: {
    key: "professional",
    label: "Profissional",
    description: "Acesso operacional próprio e leitura da agenda da equipa.",
    reserved: false,
    capabilities: professionalCapabilityCodes,
  },
} as const satisfies Record<AccessPresetKey, AccessPreset>;

export function resolvePresetCapabilities(
  preset: AccessPresetKey,
): readonly CapabilityCode[] {
  return accessPresets[preset].capabilities;
}
