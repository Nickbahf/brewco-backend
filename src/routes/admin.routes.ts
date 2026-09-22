import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { createUser, orgMeta } from "../services/users.service";

export const adminRoutes = Router();

adminRoutes.use(requireAuth, requireRole("ADMIN"));

adminRoutes.get("/staff", async (_req, res) => {
  const staff = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      employeeCode: true,
      name: true,
      email: true,
      role: true,
      position: true,
      active: true,
      branch: { select: { name: true } },
      shift: { select: { name: true, startTime: true, endTime: true } },
    },
  });
  return res.json(staff);
});

adminRoutes.get("/audit", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? "30"), 100);
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Number.isFinite(limit) && limit > 0 ? limit : 30,
    include: { actor: { select: { employeeCode: true, name: true } } },
  });
  return res.json(logs);
});

adminRoutes.get("/meta", async (_req, res) => {
  return res.json(await orgMeta());
});

adminRoutes.post("/users", async (req, res) => {
  try {
    return res.status(201).json(await createUser(req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});
