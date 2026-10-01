import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { env } from "./lib/env";
import { apiLimiter, enforceHttps, securityHeaders } from "./middleware/security";
import { deobfuscate } from "./middleware/obfuscate";
import { adminRoutes } from "./routes/admin.routes";
import { attendanceRoutes } from "./routes/attendance.routes";
import { authRoutes } from "./routes/auth.routes";
import { leaveRoutes } from "./routes/leaves.routes";
import { requestRoutes } from "./routes/requests.routes";
import { shopRoutes } from "./routes/shop.routes";

dotenv.config();

const app = express();
// Behind Render's proxy: trust it so req.ip is the real client IP (matters for rate limits).
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(enforceHttps);
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/", apiLimiter);
app.use("/api/", deobfuscate);
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/shop", shopRoutes);
app.use("/api/admin", adminRoutes);

// Fallback error handler — never leak stack traces to clients.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
);

app.listen(env.PORT, () => {
  console.log(`Brew & Co. API listening on :${env.PORT}`);
});
