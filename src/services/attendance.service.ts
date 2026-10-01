import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isUniqueViolation } from "../lib/http";

export const ScanInput = z.object({
  // The QR carries ONLY the employee code (e.g. "EMP-0047").
  code: z.string().trim().min(1).max(32),
  // Client-generated per scan attempt. Retries reuse it (safe); a new scan
  // mints a new one. This is what makes double-submit safe, NOT the employee
  // code — every scan must be allowed to log.
  clientKey: z.string().trim().min(1).max(64).optional(),
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
  const { code, clientKey } = ScanInput.parse(raw);
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
      data: { userId: user.id, action, qrId: clientKey ?? randomUUID() },
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
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

export async function listLogs(callerId: string, canViewAll: boolean, raw: unknown) {
  const { employeeCode, from, to, limit } = AttendanceQuery.parse(raw);
  let code = employeeCode;
  if (!canViewAll) {
    // Restricted callers can only ever see their own logs.
    const self = await prisma.user.findUnique({ where: { id: callerId } });
    code = self?.employeeCode;
  }
  const user = code
    ? await prisma.user.findUnique({ where: { employeeCode: code.toUpperCase() } })
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

/** Personal summary for the logged-in employee: status, today's first IN, hours. */
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

  // Flexible schedule: no fixed shifts — everyone just banks hours toward the daily target.
  const TARGET_HOURS = 8;
  const pairMs = (list: { action: string; occurredAt: Date }[], includeOpen: boolean) => {
    let ms = 0;
    let open: Date | null = null;
    for (const l of list) {
      if (l.action === "TIME_IN") open = l.occurredAt;
      else if (l.action === "TIME_OUT" && open) {
        ms += l.occurredAt.getTime() - open.getTime();
        open = null;
      }
    }
    if (includeOpen && open) ms += Date.now() - open.getTime();
    return ms;
  };
  const todayLogs = logs.filter((l) => phDay(l.occurredAt) === today);
  const todayMs = pairMs(todayLogs, true);
  const weekMs = pairMs(logs, true);
  const round1 = (ms: number) => Math.round((ms / 3600000) * 10) / 10;

  return {
    status,
    nextAction: status === "IN" ? "TIME_OUT" : "TIME_IN",
    todayFirstInPH: todayIn ? toPH(todayIn.occurredAt) : null,
    todayHours: round1(todayMs),
    targetHours: TARGET_HOURS,
    weekHours: round1(weekMs),
    logsThisWeek: logs.length,
  };
}

/** Everyone currently clocked in (latest log is TIME_IN). No shift table needed. */
export async function onDutyNow() {
  const logs = await prisma.attendanceLog.findMany({
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: { user: { select: { employeeCode: true, name: true } } },
  });
  const seen = new Set<string>();
  const out: { employeeCode: string; name: string; sincePH: string }[] = [];
  for (const l of logs) {
    if (seen.has(l.userId)) continue;
    seen.add(l.userId);
    if (l.action === "TIME_IN") {
      out.push({ employeeCode: l.user.employeeCode, name: l.user.name, sincePH: toPH(l.occurredAt) });
    }
  }
  return out;
}
