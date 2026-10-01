import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { requirePermission, hasPermission } from "../middleware/auth";
import { writeLimiter } from "../middleware/security";
import { clockStatus, listLogs, manualEntry, mySummary, onDutyNow, scan } from "../services/attendance.service";

export const attendanceRoutes = Router();

attendanceRoutes.use(requireAuth);

// Any authenticated staff can be scanned; status is public to logged-in users.
attendanceRoutes.get("/status", async (req, res) => {
  try {
    const code = String(req.query.employeeCode ?? "");
    if (!code) return res.status(400).json({ error: "employeeCode is required." });
    return res.json(await clockStatus(code));
  } catch (e) {
    return res.status(404).json({ error: (e as Error).message });
  }
});

// Scanning writes rows → admin only (employee QR is scanned BY admin).
attendanceRoutes.post("/scan", requirePermission("attendance.scan"), writeLimiter, async (req, res) => {
  try {
    return res.status(201).json(await scan(req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(404).json({ error: (e as Error).message });
  }
});

attendanceRoutes.get("/logs", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.json(await listLogs(auth.sub, hasPermission(auth, "attendance.view"), req.query));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    throw e;
  }
});

attendanceRoutes.get("/me/summary", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  return res.json(await mySummary(auth.sub));
});

attendanceRoutes.get("/on-duty", requirePermission("attendance.view"), async (_req, res) => {
  return res.json(await onDutyNow());
});

attendanceRoutes.post("/manual", requirePermission("attendance.manual"), writeLimiter, async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.status(201).json(await manualEntry(auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});
