import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isUniqueViolation } from "../lib/http";

export const ScanInput = z.object({
  // The QR carries ONLY the employee code (e.g. "EMP-0047").
  code: z.string().trim().min(1).max(32),
});

function toPH(iso: Date): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(iso);
}

/** Current clock status is DERIVED from the latest log — no separate column to drift. */
export async function clockStatus(employeeCode: string) {
  const code = employeeCode.trim().toUpperCase();
  const user = await prisma.user.findUnique({ where: { employeeCode: code } });
  if (!user) throw new Error(`Unknown employee ID "${code}".`);
  const last = await prisma.attendanceLog.findFirst({
    where: { userId: user.id },
    orderBy: { occurredAt: "desc" },
  });
  const status = last?.action === "TIME_IN" ? "IN" : "OUT";
  return { employeeCode: user.employeeCode, name: user.name, status, nextAction: status === "IN" ? "TIME_OUT" : "TIME_IN" };
}

/**
 * Backend entry point for a scan. Timestamp + action are auto-detected
 * server-side; the QR contributes only the employee code.
 * Idempotent: qrId UNIQUE means a re-scan of the same code logs once.
 */
export async function scan(raw: unknown) {
  const { code } = ScanInput.parse(raw);
  const normalized = code.toUpperCase();
  const user = await prisma.user.findUnique({ where: { employeeCode: normalized } });
  if (!user || !user.active) throw new Error(`Unknown employee ID "${code}".`);

  const last = await prisma.attendanceLog.findFirst({
    where: { userId: user.id },
    orderBy: { occurredAt: "desc" },
  });
  const action = last?.action === "TIME_IN" ? "TIME_OUT" : "TIME_IN";

  try {
    const row = await prisma.attendanceLog.create({
      data: { userId: user.id, action, qrId: normalized },
    });
    return {
      employeeCode: user.employeeCode,
      name: user.name,
      action: row.action,
      timestampPH: toPH(row.occurredAt),
      timestampUTC: row.occurredAt.toISOString(),
      now: row.action === "TIME_IN" ? "IN" : "OUT",
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        employeeCode: user.employeeCode,
        name: user.name,
        action,
        timestampPH: null,
        timestampUTC: null,
        now: action === "TIME_IN" ? "IN" : "OUT",
        duplicate: true as const,
      };
    }
    throw e;
  }
}

export const AttendanceQuery = z.object({
  employeeCode: z.string().trim().min(1).max(32).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listLogs(raw: unknown) {
  const { employeeCode, from, to, limit } = AttendanceQuery.parse(raw);
  const user = employeeCode
    ? await prisma.user.findUnique({ where: { employeeCode: employeeCode.toUpperCase() } })
    : null;
  const rows = await prisma.attendanceLog.findMany({
    where: {
      ...(user ? { userId: user.id } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: { user: { select: { employeeCode: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeCode: r.user.employeeCode,
    name: r.user.name,
    action: r.action,
    timestampPH: toPH(r.occurredAt),
    timestampUTC: r.occurredAt.toISOString(),
  }));
}

export const ManualEntryInput = z.object({
  employeeCode: z.string().trim().min(1).max(32),
  action: z.enum(["TIME_IN", "TIME_OUT"]),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Admin manual check-in/out. qrId is namespaced so it never collides with scans. */
export async function manualEntry(adminId: string, raw: unknown) {
  const input = ManualEntryInput.parse(raw);
  const user = await prisma.user.findUnique({
    where: { employeeCode: input.employeeCode.toUpperCase() },
  });
  if (!user || !user.active) throw new Error(`Unknown employee ID "${input.employeeCode}".`);
  return prisma.$transaction(async (tx) => {
    const row = await tx.attendanceLog.create({
      data: {
        userId: user.id,
        action: input.action,
        qrId: `MANUAL-${Date.now()}-${user.employeeCode.toUpperCase()}`,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: "attendance.manual",
        entity: "AttendanceLog",
        entityId: row.id,
      },
    });
    return {
      employeeCode: user.employeeCode,
      name: user.name,
      action: row.action,
      timestampPH: toPH(row.occurredAt),
      timestampUTC: row.occurredAt.toISOString(),
    };
  });
}

/** Personal summary for the logged-in employee: status, today's first IN, week hours. */
export async function mySummary(userId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const logs = await prisma.attendanceLog.findMany({
    where: { userId, occurredAt: { gte: weekAgo } },
    orderBy: { occurredAt: "asc" },
  });
  const last = logs[logs.length - 1];
  const status = last?.action === "TIME_IN" ? "IN" : "OUT";

  const phDay = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = phDay(new Date());
  const todayIn = logs.find((l) => l.action === "TIME_IN" && phDay(l.occurredAt) === today);

  let weekMs = 0;
  let openIn: Date | null = null;
  for (const l of logs) {
    if (l.action === "TIME_IN") {
      openIn = l.occurredAt;
    } else if (l.action === "TIME_OUT" && openIn) {
      weekMs += l.occurredAt.getTime() - openIn.getTime();
      openIn = null;
    }
  }
  const weekHours = Math.round((weekMs / 3600000) * 10) / 10;

  return {
    status,
    nextAction: status === "IN" ? "TIME_OUT" : "TIME_IN",
    todayFirstInPH: todayIn ? toPH(todayIn.occurredAt) : null,
    weekHours,
    logsThisWeek: logs.length,
  };
}
