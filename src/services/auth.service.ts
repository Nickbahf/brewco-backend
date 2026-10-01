import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken } from "../middleware/auth";
import { killSession, openSession, type SessionMeta } from "./session.service";

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function login(raw: unknown, meta: SessionMeta = {}) {
  const { email, password } = LoginInput.parse(raw);
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      branch: true,
      shift: true,
      role: { include: { grants: { include: { permission: true } } } },
    },
  });
  // Same-shape failure: never reveal whether the email exists.
  if (!user || !user.active || user.archived) throw new Error("Invalid email or password.");
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) throw new Error("Invalid email or password.");

  const permissions = user.role.grants.map((g) => g.permission.key);
  // Concurrent sessions: a new login opens a fresh session row; sessions
  // on other devices are left untouched.
  const session = await openSession(user.id, meta);
  const token = signToken(user.id, session.id, user.role.name, permissions);
  return {
    token,
    user: {
      id: user.id,
      employeeCode: user.employeeCode,
      email: user.email,
      name: user.name,
      role: user.role.name,
      permissions,
      position: user.position,
      branch: user.branch.name,
      shift: user.shift?.name ?? null,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function logout(sessionId: string) {
  await killSession(sessionId);
  return { ok: true };
}

export const ChangePasswordInput = z.object({
  current: z.string().min(1),
  next: z.string().min(8).max(128),
});

export async function changePassword(userId: string, raw: unknown) {
  const { current, next } = ChangePasswordInput.parse(raw);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("Account not found.");
  const ok = await argon2.verify(user.passwordHash, current);
  if (!ok) throw new Error("Current password is incorrect.");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await argon2.hash(next, { type: argon2.argon2id }) },
  });
  return { ok: true };
}

export const CompleteSetupInput = z.object({
  next: z.string().min(8).max(128),
});

/**
 * First-login password set. No current-password check: the session token
 * itself was just issued against the temp password, which proves knowledge.
 * Only works while the account is still flagged.
 */
export async function completeSetup(userId: string, raw: unknown) {
  const { next } = CompleteSetupInput.parse(raw);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("Account not found.");
  if (!user.mustChangePassword) throw new Error("Password is already set.");
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await argon2.hash(next, { type: argon2.argon2id }),
      mustChangePassword: false,
    },
  });
  return { ok: true };
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      branch: true,
      shift: true,
      role: { include: { grants: { include: { permission: true } } } },
    },
  });
  if (!user || !user.active || user.archived) throw new Error("Account not found.");
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    email: user.email,
    name: user.name,
    role: user.role.name,
    permissions: user.role.grants.map((g) => g.permission.key),
    position: user.position,
    branch: user.branch.name,
    shift: user.shift ? { name: user.shift.name, start: user.shift.startTime, end: user.shift.endTime } : null,
    hiredAt: user.hiredAt,
  };
}
