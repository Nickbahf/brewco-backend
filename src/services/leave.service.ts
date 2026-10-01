import { z } from "zod";
import { prisma } from "../lib/prisma";

export const FileLeaveInput = z.object({
  leaveTypeId: z.string().cuid(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  reason: z.string().trim().min(3).max(1000),
});

export const DecideLeaveInput = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const LeaveQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  mine: z.coerce.boolean().default(false),
});

export async function fileLeave(userId: string, raw: unknown) {
  const input = FileLeaveInput.parse(raw);
  if (input.dateTo < input.dateFrom) throw new Error("End date cannot be before start date.");
  return prisma.leaveRequest.create({
    data: {
      userId,
      leaveTypeId: input.leaveTypeId,
      dateFrom: new Date(input.dateFrom),
      dateTo: new Date(input.dateTo),
      reason: input.reason,
    },
    include: { leaveType: true },
  });
}

export async function listLeaves(userId: string, canViewAll: boolean, raw: unknown) {
  const { status, mine } = LeaveQuery.parse(raw);
  const scopedToSelf = !canViewAll || mine;
  return prisma.leaveRequest.findMany({
    where: {
      ...(scopedToSelf ? { userId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { filedAt: "desc" },
    include: {
      user: { select: { employeeCode: true, name: true } },
      leaveType: { select: { name: true } },
    },
  });
}

/** Approve/reject + audit row in ONE transaction — atomic by construction. */
export async function decideLeave(adminId: string, leaveId: string, raw: unknown) {
  const { status } = DecideLeaveInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await tx.leaveRequest.update({
      where: { id: leaveId },
      data: { status, decidedById: adminId, decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: status === "APPROVED" ? "leave.approved" : "leave.rejected",
        entity: "LeaveRequest",
        entityId: leaveId,
      },
    });
    return row;
  });
}

export async function leaveTypes() {
  return prisma.leaveType.findMany({ orderBy: { name: "asc" } });
}
