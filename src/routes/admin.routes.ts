import { Router } from "express";
import { ZodError, z } from "zod";
import { zodError } from "../lib/http";
import { prisma } from "../lib/prisma";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth";
import { createUser, archivedUsers, archiveUser, restoreUser, resetPassword, setActive, orgMeta } from "../services/users.service";

export const adminRoutes = Router();

adminRoutes.use(requireAuth);

adminRoutes.get("/staff", requirePermission("users.view"), async (_req, res) => {
  const staff = await prisma.user.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      employeeCode: true,
      name: true,
      email: true,
      role: { select: { name: true } },
      position: true,
      active: true,
      branch: { select: { name: true } },
      shift: { select: { name: true, startTime: true, endTime: true } },
    },
  });
  return res.json(staff.map((s) => ({ ...s, role: s.role.name })));
});

adminRoutes.get("/audit", requirePermission("audit.view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? "30"), 100);
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Number.isFinite(limit) && limit > 0 ? limit : 30,
    include: { actor: { select: { employeeCode: true, name: true } } },
  });
  return res.json(logs);
});

adminRoutes.get("/meta", requirePermission("users.view"), async (_req, res) => {
  return res.json(await orgMeta());
});

adminRoutes.post("/users", requirePermission("users.create"), async (req, res) => {
  try {
    return res.status(201).json(await createUser(req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

adminRoutes.post("/users/:id/reset-password", requirePermission("users.password"), async (req, res) => {
  const auth = (req as unknown as AuthedRequest).auth;
  try {
    return res.json(await resetPassword(auth.sub, req.params.id));
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
});

adminRoutes.delete("/users/:id", requirePermission("users.archive"), async (req, res) => {
  const auth = (req as unknown as AuthedRequest).auth;
  try {
    return res.json(await archiveUser(auth.sub, req.params.id));
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
});

adminRoutes.get("/archived", requirePermission("users.view"), async (_req, res) => {
  return res.json(await archivedUsers());
});

adminRoutes.post("/users/:id/restore", requirePermission("users.archive"), async (req, res) => {
  const auth = (req as unknown as AuthedRequest).auth;
  try {
    return res.json(await restoreUser(auth.sub, req.params.id));
  } catch {
    return res.status(404).json({ error: "User not found." });
  }
});

adminRoutes.patch("/users/:id/active", requirePermission("users.status"), async (req, res) => {
  const auth = (req as unknown as AuthedRequest).auth;
  try {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    return res.json(await setActive(auth.sub, req.params.id, active));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});
