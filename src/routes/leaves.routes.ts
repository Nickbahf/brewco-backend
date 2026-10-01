import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, requirePermission, hasPermission, type AuthedRequest } from "../middleware/auth";
import { decideLeave, fileLeave, leaveTypes, listLeaves } from "../services/leave.service";

export const leaveRoutes = Router();

leaveRoutes.use(requireAuth);

leaveRoutes.get("/types", async (_req, res) => {
  return res.json(await leaveTypes());
});

leaveRoutes.get("/", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.json(await listLeaves(auth.sub, hasPermission(auth, "leaves.view"), req.query));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    throw e;
  }
});

leaveRoutes.post("/", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.status(201).json(await fileLeave(auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

leaveRoutes.patch("/:id", requirePermission("leaves.decide"), async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.json(await decideLeave(auth.sub, req.params.id, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});
