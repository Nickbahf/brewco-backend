import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { clockStatus, listLogs, manualEntry, mySummary, scan } from "../services/attendance.service";

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
attendanceRoutes.post("/scan", requireRole("ADMIN"), async (req, res) => {
  try {
    return res.status(201).json(await scan(req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(404).json({ error: (e as Error).message });
  }
});

attendanceRoutes.get("/logs", async (req, res) => {
  try {
    return res.json(await listLogs(req.query));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    throw e;
  }
});

attendanceRoutes.get("/me/summary", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  return res.json(await mySummary(auth.sub));
});

attendanceRoutes.post("/manual", requireRole("ADMIN"), async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.status(201).json(await manualEntry(auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});
