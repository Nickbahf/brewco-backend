import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../lib/env";

const JwtPayload = z.object({
  sub: z.string(),
  role: z.enum(["ADMIN", "EMPLOYEE"]),
});

export type JwtPayload = z.infer<typeof JwtPayload>;

export interface AuthedRequest extends Request {
  auth: JwtPayload;
}

export function signToken(sub: string, role: "ADMIN" | "EMPLOYEE"): string {
  return jwt.sign({ sub, role }, env.JWT_SECRET, { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const payload = JwtPayload.parse(jwt.verify(header.slice(7), env.JWT_SECRET));
    (req as AuthedRequest).auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}

export function requireRole(...roles: ("ADMIN" | "EMPLOYEE")[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (!auth || !roles.includes(auth.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}
