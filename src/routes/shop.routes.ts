import { Router } from "express";
import { ZodError } from "zod";
import { zodError } from "../lib/http";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth";
import { categories, checkout, createProduct, dailyRevenue, deactivateProduct, listProducts, salesReport, updateProduct } from "../services/shop.service";

export const shopRoutes = Router();

shopRoutes.use(requireAuth);

shopRoutes.get("/products", async (_req, res) => {
  return res.json(await listProducts());
});

shopRoutes.get("/categories", async (_req, res) => {
  return res.json(await categories());
});

shopRoutes.post("/products", requireRole("ADMIN"), async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.status(201).json(await createProduct(auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

shopRoutes.patch("/products/:id", requireRole("ADMIN"), async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.json(await updateProduct(auth.sub, req.params.id, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

shopRoutes.post("/orders", async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  try {
    return res.status(201).json(await checkout(auth.sub, req.body));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    return res.status(400).json({ error: (e as Error).message });
  }
});

shopRoutes.get("/reports/sales", requireRole("ADMIN"), async (req, res) => {
  try {
    return res.json(await salesReport(req.query));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    throw e;
  }
});

shopRoutes.get("/reports/daily", requireRole("ADMIN"), async (req, res) => {
  try {
    return res.json(await dailyRevenue(req.query));
  } catch (e) {
    if (e instanceof ZodError) return zodError(res, e);
    throw e;
  }
});

shopRoutes.delete("/products/:id", requireRole("ADMIN"), async (req, res) => {
  const auth = (req as AuthedRequest).auth;
  return res.json(await deactivateProduct(auth.sub, req.params.id));
});
