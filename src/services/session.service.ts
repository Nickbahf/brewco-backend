import { prisma } from "../lib/prisma";

// Hard login expiry: 45 minutes from issue, regardless of activity.
// Idle timeout matches: 45 min of no API activity also kills the session.
export const SESSION_TTL_MS = 45 * 60 * 1000;
export const IDLE_MS = SESSION_TTL_MS;
// Sliding refresh granularity: avoid a DB write on literally every request.
const TOUCH_AFTER_MS = 60 * 1000;

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}

/** Login handshake, atomic: open a new session. Multiple sessions per user are allowed. */
export async function openSession(userId: string, meta: SessionMeta) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    return tx.userSession.create({
      data: {
        userId,
        ip: meta.ip?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        deviceId: meta.deviceId?.slice(0, 64) ?? null,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + IDLE_MS),
        tokenExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });
  });
}

export async function killSession(sessionId: string) {
  await prisma.userSession.updateMany({ where: { id: sessionId }, data: { isActive: false } });
}

/**
 * Returns the session row iff it is live: active flag set, inside BOTH the
 * idle window and the hard 45-min login expiry, and the owner account still
 * active/unarchived. Refreshes the sliding idle window when stale (>60s).
 */
export async function validateSession(sessionId: string) {
  const s = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { user: { select: { id: true, active: true, archived: true } } },
  });
  if (!s || !s.isActive || !s.user.active || s.user.archived) return null;
  if (s.expiresAt.getTime() <= Date.now() || s.tokenExpiresAt.getTime() <= Date.now()) {
    await prisma.userSession.update({ where: { id: s.id }, data: { isActive: false } });
    return null;
  }
  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    const now = new Date();
    await prisma.userSession.update({
      where: { id: s.id },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + IDLE_MS) },
    });
  }
  return s;
}
