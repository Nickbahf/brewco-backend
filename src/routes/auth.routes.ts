import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { loginLimiter } from "../middleware/security";
import { login, me, changePassword, completeSetup, logout } from "../services/auth.service";

export const authRoutes = Router();

authRoutes.post("/login", loginLimiter, async (req, res) => {
  try {
    const hwid = req.headers["x-device-id"];
    const deviceId = typeof hwid === "string" ? hwid : undefined;
    return res.json(
      await login(req.body, { ip: req.ip, userAgent: req.headers["user-agent"], deviceId })
    );
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(401).json({ error: (e as Error).message });
  }
});

authRoutes.get("/me", requireAuth, async (req, res) => {
  try {
    return res.json(await me((req as AuthedRequest).auth.sub));
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
});

authRoutes.patch("/password", requireAuth, async (req, res) => {
  try {
    return res.json(await changePassword((req as AuthedRequest).auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

authRoutes.post("/complete-setup", requireAuth, async (req, res) => {
  try {
    return res.json(await completeSetup((req as AuthedRequest).auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

authRoutes.post("/logout", requireAuth, async (req, res) => {
  await logout((req as AuthedRequest).auth.sid);
  return res.json({ ok: true });
});
