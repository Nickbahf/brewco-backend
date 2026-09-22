import type { Response } from "express";
import { ZodError } from "zod";

export function zodError(res: Response, e: ZodError) {
  return res.status(400).json({
    error: "validation_error",
    details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

// Prisma P2002 = unique violation. Used for idempotent attendance (qrId).
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}
