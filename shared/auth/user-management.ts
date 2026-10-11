import { z } from "zod";
import {
  canGrantCapabilityAtLocation,
  capabilityCodes,
  type CapabilityCode,
} from "./capabilities";
import { accessPresetKeys, type AccessPresetKey } from "./presets";
import type { AccessScope } from "./types";

const capabilityCodeSet = new Set<string>(capabilityCodes);
const accessPresetKeySet = new Set<string>(accessPresetKeys);

const capabilityCodeSchema = z.string().refine(
  (value): value is CapabilityCode => capabilityCodeSet.has(value),
  "Capability desconhecida.",
);

const accessPresetSchema = z.string().refine(
  (value): value is AccessPresetKey => accessPresetKeySet.has(value),
  "Preset desconhecido.",
);

const baseAccessScopeInputSchema = z.object({
  kind: z.enum(["global", "location"]),
  locationId: z.number().int().positive().optional(),
  preset: accessPresetSchema.nullish(),
  capabilities: z.array(capabilityCodeSchema).default([]),
}).superRefine((scope, context) => {
  if (scope.kind === "global" && scope.locationId !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["locationId"], message: "Um scope global não tem localização." });
  }
  if (scope.kind === "location" && scope.locationId === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["locationId"], message: "Indique a localização do scope." });
  }
  if (!scope.preset && scope.capabilities.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilities"], message: "O scope tem de atribuir um preset ou capabilities." });
  }
  if (new Set(scope.capabilities).size !== scope.capabilities.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilities"], message: "Não repita capabilities no mesmo scope." });
  }
  if (scope.kind === "location") {
    if (scope.preset === "administrator") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["preset"], message: "Administrator só pode ser atribuído globalmente." });
    }
    for (const capability of scope.capabilities) {
      if (!canGrantCapabilityAtLocation(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities"],
          message: `${capability} não pode ser atribuída por localização.`,
        });
      }
    }
  }
});

export const canonicalAccessScopeInputSchema = baseAccessScopeInputSchema.transform((scope): AccessScope => (
  scope.kind === "global"
    ? {
        kind: "global",
        ...(scope.preset ? { preset: scope.preset } : {}),
        capabilities: scope.capabilities,
      }
    : {
        kind: "location",
        locationId: scope.locationId!,
        ...(scope.preset ? { preset: scope.preset } : {}),
        capabilities: scope.capabilities,
      }
));

export const canonicalAccessScopesSchema = z.array(canonicalAccessScopeInputSchema)
  .max(100)
  .superRefine((scopes, context) => {
    const keys = new Set<string>();
    scopes.forEach((scope, index) => {
      const key = scope.kind === "global" ? "global" : `location:${scope.locationId}`;
      if (keys.has(key)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Existe mais de um scope para o mesmo contexto." });
      }
      keys.add(key);
    });
  });

export const canonicalUserCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  professionalId: z.number().int().positive().nullish(),
  access: canonicalAccessScopesSchema.refine(
    (scopes) => scopes.length > 0,
    "Indique o acesso inicial.",
  ),
  inviteExpiresInHours: z.number().int().min(1).max(168).optional(),
});

export const canonicalUserIdentityUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(160).optional(),
}).refine((value) => Object.keys(value).length > 0, "Indique uma alteração.");

export const canonicalUserStatusUpdateSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

export const canonicalProfessionalLinkSchema = z.object({
  professionalId: z.number().int().positive().nullable(),
});

export const canonicalAccessReplaceSchema = z.object({
  mode: z.enum(["replace_all", "replace_location"]),
  locationId: z.number().int().positive().optional(),
  scopes: canonicalAccessScopesSchema,
}).superRefine((value, context) => {
  if (value.mode === "replace_all" && value.locationId !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["locationId"], message: "replace_all não recebe localização." });
  }
  if (value.mode === "replace_location") {
    if (value.locationId === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["locationId"], message: "Indique a localização a substituir." });
      return;
    }
    if (value.scopes.length > 1 || value.scopes.some(
      (scope) => scope.kind !== "location" || scope.locationId !== value.locationId,
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopes"],
        message: "Uma substituição local só pode conter o scope da localização indicada.",
      });
    }
  }
});

export const canonicalInviteOptionsSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

export const canonicalInviteTokenSchema = z.object({
  token: z.string().trim().min(32).max(500),
});

export const canonicalInviteAcceptanceSchema = z.object({
  token: canonicalInviteTokenSchema.shape.token,
  password: z.string().min(8).max(200),
});

export const canonicalPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ["newPassword"],
  message: "A nova palavra-passe deve ser diferente da atual.",
});

export type CanonicalUserCreateInput = z.infer<typeof canonicalUserCreateSchema>;
export type CanonicalUserIdentityUpdateInput = z.infer<typeof canonicalUserIdentityUpdateSchema>;
export type CanonicalAccessReplaceInput = z.infer<typeof canonicalAccessReplaceSchema>;
