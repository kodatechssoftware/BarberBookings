export type CapabilityArea =
  | "agenda"
  | "appointments"
  | "customers"
  | "team"
  | "catalog"
  | "hours"
  | "extras"
  | "finance"
  | "reports"
  | "locations"
  | "users"
  | "access"
  | "settings"
  | "audit"
  | "system";

type CapabilityDefinition = {
  area: CapabilityArea;
  description: string;
  /** A global grant is valid for every location. This flag controls local grants only. */
  locationGrantAllowed: boolean;
};

export const capabilityRegistry = {
  "agenda.view_own": {
    area: "agenda",
    description: "View the professional's own agenda.",
    locationGrantAllowed: true,
  },
  "agenda.view_team": {
    area: "agenda",
    description: "View the team's agenda without granting management rights.",
    locationGrantAllowed: true,
  },
  "appointments.create_manual": {
    area: "appointments",
    description: "Create manual appointments, subject to ownership checks.",
    locationGrantAllowed: true,
  },
  "appointments.block_time": {
    area: "appointments",
    description: "Create blocked-time or absence entries.",
    locationGrantAllowed: true,
  },
  "appointments.manage_own": {
    area: "appointments",
    description: "Edit, reschedule or cancel the professional's own appointments.",
    locationGrantAllowed: true,
  },
  "appointments.manage_team": {
    area: "appointments",
    description: "Edit, reschedule or cancel team appointments.",
    locationGrantAllowed: true,
  },
  "appointments.change_status_own": {
    area: "appointments",
    description: "Change the status of the professional's own appointments.",
    locationGrantAllowed: true,
  },
  "appointments.change_status_team": {
    area: "appointments",
    description: "Change the status of team appointments.",
    locationGrantAllowed: true,
  },
  "customers.view_own": {
    area: "customers",
    description: "View customers connected to the professional's own appointments.",
    locationGrantAllowed: true,
  },
  "customers.view_team": {
    area: "customers",
    description: "View customers connected to team appointments.",
    locationGrantAllowed: true,
  },
  "customers.notes_own": {
    area: "customers",
    description: "View and manage notes for the professional's own customers.",
    locationGrantAllowed: true,
  },
  "customers.notes_team": {
    area: "customers",
    description: "View and manage notes for team customers.",
    locationGrantAllowed: true,
  },
  "customers.block": {
    area: "customers",
    description: "Block or unblock customers.",
    locationGrantAllowed: true,
  },
  "team.view": {
    area: "team",
    description: "View team profiles and their operational configuration.",
    locationGrantAllowed: true,
  },
  "team.manage_global": {
    area: "team",
    description: "Manage the global identity of professional profiles.",
    locationGrantAllowed: false,
  },
  "team.assign_location": {
    area: "team",
    description: "Associate professionals with locations.",
    locationGrantAllowed: true,
  },
  "catalog.view": {
    area: "catalog",
    description: "View the services catalogue.",
    locationGrantAllowed: true,
  },
  "catalog.manage_global": {
    area: "catalog",
    description: "Manage global service and category identity.",
    locationGrantAllowed: false,
  },
  "catalog.manage_location": {
    area: "catalog",
    description: "Manage location-specific service offers and associations.",
    locationGrantAllowed: true,
  },
  "hours.manage_own": {
    area: "hours",
    description: "Manage the professional's own working hours.",
    locationGrantAllowed: true,
  },
  "hours.manage_team": {
    area: "hours",
    description: "Manage team working hours.",
    locationGrantAllowed: true,
  },
  "hours.manage_establishment": {
    area: "hours",
    description: "Manage establishment opening hours.",
    locationGrantAllowed: true,
  },
  "extras.manage": {
    area: "extras",
    description: "Manage the location's Extras catalogue.",
    locationGrantAllowed: true,
  },
  "finance.view_own": {
    area: "finance",
    description: "View only the professional's commission, workspace rent, voucher values and own results.",
    locationGrantAllowed: true,
  },
  "finance.view_team": {
    area: "finance",
    description: "View team and establishment financial results.",
    locationGrantAllowed: true,
  },
  "finance.manage_expenses": {
    area: "finance",
    description: "Manage business expenses.",
    locationGrantAllowed: true,
  },
  "reports.export_own": {
    area: "reports",
    description: "Export only the professional's own report data.",
    locationGrantAllowed: true,
  },
  "reports.export_team": {
    area: "reports",
    description: "Export team and establishment report data.",
    locationGrantAllowed: true,
  },
  "locations.manage": {
    area: "locations",
    description: "Create and manage locations.",
    locationGrantAllowed: false,
  },
  "users.manage": {
    area: "users",
    description: "Create, update, activate and deactivate user identities.",
    locationGrantAllowed: false,
  },
  "access.manage": {
    area: "access",
    description: "Grant and revoke access presets, scopes and capabilities.",
    locationGrantAllowed: true,
  },
  "settings.manage": {
    area: "settings",
    description: "Manage installation-wide settings.",
    locationGrantAllowed: false,
  },
  "audit.view": {
    area: "audit",
    description: "View the audit log.",
    locationGrantAllowed: true,
  },
  "system.diagnostics": {
    area: "system",
    description: "Use protected system diagnostics.",
    locationGrantAllowed: false,
  },
} as const satisfies Record<string, CapabilityDefinition>;

export type CapabilityCode = keyof typeof capabilityRegistry;

export const capabilityCodes = Object.freeze(
  Object.keys(capabilityRegistry) as CapabilityCode[],
) as readonly CapabilityCode[];

export const ownCapabilityCodes = [
  "agenda.view_own",
  "appointments.manage_own",
  "appointments.change_status_own",
  "customers.view_own",
  "customers.notes_own",
  "hours.manage_own",
  "finance.view_own",
  "reports.export_own",
] as const satisfies readonly CapabilityCode[];

export type OwnCapabilityCode = (typeof ownCapabilityCodes)[number];

const ownCapabilitySet: ReadonlySet<CapabilityCode> = new Set(ownCapabilityCodes);

export function isOwnCapability(
  capability: CapabilityCode,
): capability is OwnCapabilityCode {
  return ownCapabilitySet.has(capability);
}

export function canGrantCapabilityAtLocation(capability: CapabilityCode): boolean {
  return capabilityRegistry[capability].locationGrantAllowed;
}
