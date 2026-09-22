import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { fileRequest, listRequests } from "../services/requests.service";

export const requestRoutes = Router();

requestRoutes.use(requireAuth);

requestRoutes.get("/", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  return res.json(await listRequests(auth.sub));
});

requestRoutes.post("/", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.status(201).json(await fileRequest(auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});
