import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";

function deviceKey(req: Request): string {
  // HWID: app-generated device id (X-Device-Id). Falls back to IP-only so
  // anonymous clients are still throttled, just under a shared bucket.
  // ipKeyGenerator() is REQUIRED by express-rate-limit so IPv6 clients
  // can't bypass the limiter (server throws at boot without it).
  const hwid = req.headers["x-device-id"];
  const id = Array.isArray(hwid) ? hwid[0] : hwid;
  const clean = typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : "unknown";
  return `${ipKeyGenerator(req.ip ?? "")}:${clean}`;
}

/** Helmet: XSS + sniffing + clickjacking headers, incl. a strict CSP. */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // API has no embeddable resources; keep compat
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "no-referrer" },
});

/** Force HTTPS in production (Render terminates TLS and sets x-forwarded-proto). */
export function enforceHttps(req: Request, res: Response, next: NextFunction) {
  const proto = req.headers["x-forwarded-proto"];
  const host = req.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.");
  if (!local && proto && proto !== "https") {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  return next();
}

/** Global throttle: 300 req / 15 min per IP+device. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: deviceKey,
  message: { error: "rate_limited", message: "Too many requests — slow down." },
});

/** Login: 5 attempts / 30s per IP+device. Kills credential stuffing without long lockouts. */
export const loginLimiter = rateLimit({
  windowMs: 30 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: deviceKey,
  message: { error: "rate_limited", message: "Too many login attempts — try again in 30 seconds." },
});

/** Scans + checkouts: 60 writes / min per IP+device. Stops replay floods. */
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: deviceKey,
  message: { error: "rate_limited", message: "Too many requests — slow down." },
});
