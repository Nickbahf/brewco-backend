import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { login, me, changePassword, completeSetup } from "../services/auth.service";

export const authRoutes = Router();

authRoutes.post("/login", async (req, res) => {
  try {
    return res.json(await login(req.body));
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
