import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  hasCapability,
  hasCapabilityAtLocation,
  hasOwnCapability,
  type CapabilityCode,
  type OwnCapabilityCode,
} from "@shared/auth";
import {
  authRuntimeMode,
  type CanonicalAuthContext,
} from "./auth-runtime";

const canonicalRequestContexts = new WeakMap<Request, CanonicalAuthContext>();

export function setCanonicalRequestAuthContext(
  request: Request,
  context: CanonicalAuthContext,
) {
  canonicalRequestContexts.set(request, context);
}

export function getCanonicalRequestAuthContext(request: Request) {
  return canonicalRequestContexts.get(request);
}

export function hasAnyCanonicalAccessAtLocation(
  context: CanonicalAuthContext,
  locationId: number,
) {
  return context.access.globalCapabilities.length > 0
    || context.access.locationCapabilities.some(
      (entry) => entry.locationId === locationId && entry.capabilities.length > 0,
    );
}

export function getCanonicalAccessibleLocationIds(context: CanonicalAuthContext) {
  if (context.access.globalCapabilities.length > 0) return null;
  return new Set(
    context.access.locationCapabilities
      .filter((entry) => entry.capabilities.length > 0)
      .map((entry) => entry.locationId),
  );
}

export function hasCanonicalCapability(
  context: CanonicalAuthContext,
  capability: CapabilityCode,
  locationId?: number,
) {
  return locationId === undefined
    ? hasCapability(context.access, capability)
    : hasCapabilityAtLocation(context.access, capability, locationId);
}

export function hasCanonicalOwnCapability(
  context: CanonicalAuthContext,
  capability: OwnCapabilityCode,
  ownerProfessionalId: number,
  locationId: number,
) {
  return context.professionalId === ownerProfessionalId
    && hasOwnCapability(context.access, capability, locationId);
}

export function hasCanonicalOwnOrTeamCapability(
  context: CanonicalAuthContext,
  options: {
    ownCapability: OwnCapabilityCode;
    teamCapability: CapabilityCode;
    ownerProfessionalId: number;
    locationId: number;
  },
) {
  return hasCapabilityAtLocation(
    context.access,
    options.teamCapability,
    options.locationId,
  ) || hasCanonicalOwnCapability(
    context,
    options.ownCapability,
    options.ownerProfessionalId,
    options.locationId,
  );
}

export function hasCanonicalAnyOwnOrTeamCapability(
  context: CanonicalAuthContext,
  options: readonly {
    ownCapability: OwnCapabilityCode;
    teamCapability: CapabilityCode;
    ownerProfessionalId: number;
    locationId: number;
  }[],
) {
  return options.some((entry) => hasCanonicalOwnOrTeamCapability(context, entry));
}

export function redactTeamAgendaAppointment<T extends Record<string, unknown>>(
  appointment: T,
) {
  return {
    ...appointment,
    customerEmail: null,
    customerPhone: "",
    cancelToken: "",
    paymentMethod: "pending",
    depositRequired: false,
    depositReason: null,
    createdAt: null,
    extras: undefined,
    canManage: false,
  };
}

function rejectCanonicalAuthorization(
  request: Request,
  response: Response,
) {
  return response.status(getCanonicalRequestAuthContext(request) ? 403 : 401).json({
    message: "Não autorizado",
  });
}

export function enforceCanonicalCapability(
  request: Request,
  response: Response,
  capability: CapabilityCode,
  locationId?: number,
) {
  if (authRuntimeMode !== "canonical") return true;
  const context = getCanonicalRequestAuthContext(request);
  if (context && hasCanonicalCapability(context, capability, locationId)) return true;
  rejectCanonicalAuthorization(request, response);
  return false;
}

export function enforceCanonicalAnyCapability(
  request: Request,
  response: Response,
  capabilities: readonly CapabilityCode[],
  locationId?: number,
) {
  if (authRuntimeMode !== "canonical") return true;
  const context = getCanonicalRequestAuthContext(request);
  if (context && capabilities.some((capability) =>
    hasCanonicalCapability(context, capability, locationId))) return true;
  rejectCanonicalAuthorization(request, response);
  return false;
}

export function enforceCanonicalOwnOrTeamCapability(
  request: Request,
  response: Response,
  options: {
    ownCapability: OwnCapabilityCode;
    teamCapability: CapabilityCode;
    ownerProfessionalId: number;
    locationId: number;
  },
) {
  if (authRuntimeMode !== "canonical") return true;
  const context = getCanonicalRequestAuthContext(request);
  if (context && hasCanonicalOwnOrTeamCapability(context, options)) return true;
  rejectCanonicalAuthorization(request, response);
  return false;
}

export function enforceCanonicalAnyOwnOrTeamCapability(
  request: Request,
  response: Response,
  options: readonly {
    ownCapability: OwnCapabilityCode;
    teamCapability: CapabilityCode;
    ownerProfessionalId: number;
    locationId: number;
  }[],
) {
  if (authRuntimeMode !== "canonical") return true;
  const context = getCanonicalRequestAuthContext(request);
  if (context && hasCanonicalAnyOwnOrTeamCapability(context, options)) return true;
  rejectCanonicalAuthorization(request, response);
  return false;
}

export function requireCapabilityAtLocation(
  capability: CapabilityCode,
  legacyMiddleware: RequestHandler,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    if (authRuntimeMode !== "canonical") {
      return legacyMiddleware(request, response, next);
    }
    const locationId = Number(response.locals.locationId);
    if (!Number.isSafeInteger(locationId) || locationId <= 0) {
      return response.status(400).json({ message: "Localização inválida." });
    }
    if (!enforceCanonicalCapability(request, response, capability, locationId)) return;
    next();
  };
}

