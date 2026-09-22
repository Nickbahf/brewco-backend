import { z } from "zod";
import { prisma } from "../lib/prisma";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

// Discriminated by category so each form validates its own fields —
// no nullable junk columns, no JSON blobs (stays 1NF).
export const FileRequestInput = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("TIME_CORRECTION"),
    date: dateStr,
    reason: z.string().trim().min(3).max(1000),
    correctClockIn: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
    correctClockOut: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
  }),
  z.object({
    category: z.literal("OVERTIME"),
    date: dateStr,
    reason: z.string().trim().min(3).max(1000),
    hours: z.number().positive().max(24),
  }),
  z.object({
    category: z.literal("SHIFT_SWAP"),
    date: dateStr,
    reason: z.string().trim().min(3).max(1000),
    swapWithCode: z.string().trim().min(1).max(32),
    desiredDate: dateStr,
  }),
]);

export async function fileRequest(userId: string, raw: unknown) {
  const input = FileRequestInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const base = await tx.generalRequest.create({
      data: { userId, category: input.category, date: new Date(input.date), reason: input.reason },
    });
    if (input.category === "TIME_CORRECTION") {
      await tx.timeCorrection.create({
        data: { requestId: base.id, correctClockIn: input.correctClockIn, correctClockOut: input.correctClockOut },
      });
    } else if (input.category === "OVERTIME") {
      await tx.overtimeClaim.create({ data: { requestId: base.id, hours: input.hours } });
    } else {
      await tx.shiftSwap.create({
        data: { requestId: base.id, swapWithId: input.swapWithCode.toUpperCase(), desiredDate: new Date(input.desiredDate) },
      });
    }
    return base;
  });
}

export async function listRequests(userId: string) {
  return prisma.generalRequest.findMany({
    where: { userId },
    orderBy: { filedAt: "desc" },
    include: { correction: true, overtime: true, swap: true },
  });
}
