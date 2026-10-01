import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../lib/env";
import { SESSION_TTL_MS, validateSession } from "../services/session.service";

const JwtPayload = z.object({
  sub: z.string(),
  sid: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
});

export type JwtPayload = z.infer<typeof JwtPayload>;

export { SESSION_TTL_MS };

export interface AuthedRequest extends Request {
  auth: JwtPayload;
}

export function signToken(sub: string, sid: string, role: string, permissions: string[]): string {
  return jwt.sign({ sub, sid, role, permissions }, env.JWT_SECRET, {
    expiresIn: SESSION_TTL_MS / 1000,
  });
}

export function hasPermission(auth: JwtPayload | undefined, key: string): boolean {
  return !!auth && auth.permissions.includes(key);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  let payload: JwtPayload;
  try {
    payload = JwtPayload.parse(jwt.verify(header.slice(7), env.JWT_SECRET));
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    // Stateful gate: the session row must still exist, be active, and be
    // inside its window; the owner account must be active/unarchived.
    const live = await validateSession(payload.sid);
    if (!live || live.userId !== payload.sub) {
      return res.status(401).json({ error: "session_expired" });
    }
  } catch {
    return res.status(503).json({ error: "unavailable" });
  }
  (req as AuthedRequest).auth = payload;
  return next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (!auth || !roles.includes(auth.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}

/** Adaptive gate: passes if the session carries ANY of the given permission keys. */
export function requirePermission(...keys: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (!auth || !keys.some((k) => auth.permissions.includes(k))) {
      return res.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}
