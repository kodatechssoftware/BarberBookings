import type { Request } from "express";
import type session from "express-session";
import type { CanonicalSessionIdentity } from "./auth-runtime";

export type RuntimeSession = session.Session & Partial<session.SessionData> & {
  adminId?: number;
  barberId?: number;
  role?: "admin" | "barber";
  userId?: number;
  authVersion?: number;
};

function regenerate(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function save(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

export function destroyAuthenticatedSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => error ? reject(error) : resolve());
  });
}

export async function clearAuthenticatedSessionIdentity(req: Request) {
  const current = req.session as RuntimeSession;
  delete current.userId;
  delete current.authVersion;
  delete current.adminId;
  delete current.barberId;
  delete current.role;
  await save(req);
}

/** Regeneration is deliberately completed before any authenticated identity is written. */
export async function establishCanonicalSession(req: Request, identity: CanonicalSessionIdentity) {
  await regenerate(req);
  const current = req.session as RuntimeSession;
  current.userId = identity.userId;
  current.authVersion = identity.authVersion;
  delete current.adminId;
  delete current.barberId;
  delete current.role;
  await save(req);
}

export async function establishLegacySession(
  req: Request,
  identity: { role: "admin"; adminId: number } | { role: "barber"; barberId: number },
) {
  await regenerate(req);
  const current = req.session as RuntimeSession;
  delete current.userId;
  delete current.authVersion;
  current.role = identity.role;
  if (identity.role === "admin") {
    current.adminId = identity.adminId;
    delete current.barberId;
  } else {
    current.barberId = identity.barberId;
    delete current.adminId;
  }
  await save(req);
}
