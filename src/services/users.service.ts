import { randomBytes } from "crypto";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../lib/prisma";

// Unambiguous alphabet — safe to read over a shoulder or dictate.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 10): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const CreateUserInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
  employeeCode: z.string().trim().min(1).max(32).optional(),
  position: z.string().trim().max(120).optional(),
  role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]).default("EMPLOYEE"),
  branchId: z.string().min(1).max(64),
  shiftId: z.string().min(1).max(64).optional(),
});

function nextEmployeeCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Admin creates an account. The system mints a ONE-TIME temp password
 * (shown to the admin exactly once); the account starts flagged and the
 * holder is forced through the new-password form on first login.
 */
export async function createUser(raw: unknown) {
  const input = CreateUserInput.parse(raw);
  const tempPassword = generateTempPassword();
  const roleRow = await prisma.role.findUnique({ where: { name: input.role } });
  if (!roleRow) throw new Error(`Unknown role "${input.role}".`);
  try {
    const user = await prisma.user.create({
      data: {
        employeeCode: (input.employeeCode ?? nextEmployeeCode(input.role === "ADMIN" ? "ADM" : "EMP")).toUpperCase(),
        email: input.email,
        passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
        name: input.name,
        roleId: roleRow.id,
        position: input.position || null,
        branchId: input.branchId,
        shiftId: input.shiftId || null,
        mustChangePassword: true,
      },
    });
    return {
      id: user.id,
      employeeCode: user.employeeCode,
      email: user.email,
      name: user.name,
      role: input.role,
      tempPassword, // reveal once — never stored or logged
    };
  } catch (e) {
    if (
      typeof e === "object" && e !== null && "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      throw new Error("Email or employee code is already taken.");
    }
    throw e;
  }
}

export async function orgMeta() {
  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
    include: { shifts: { orderBy: { name: "asc" } } },
  });
  return { branches, roles: ["ADMIN", "EMPLOYEE"] as const };
}

/**
 * Admin password reset for forgetful staff. Mints a fresh temp password,
 * re-flags the account so first login forces the new-password form.
 * Returned ONCE — never stored or logged.
 */
export async function resetPassword(actorId: string, userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target) throw new Error("User not found.");
  if (target.role.name === "ADMIN" && actorId !== userId) {
    throw new Error("Admin accounts are protected — only the holder can reset it.");
  }
  const tempPassword = generateTempPassword();
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
      mustChangePassword: true,
    },
  });
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    email: user.email,
    name: user.name,
    tempPassword,
  };
}

/** Soft delete: account is deactivated + archived, history (logs, orders) stays intact. */
export async function archiveUser(adminId: string, userId: string) {
  if (adminId === userId) throw new Error("You cannot archive your own account.");
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target) throw new Error("User not found.");
  if (target.role.name === "ADMIN") throw new Error("Admin accounts are protected — they cannot be archived.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: userId },
      data: { active: false, archived: true },
    });
    await tx.auditLog.create({
      data: { actorId: adminId, action: "user.archived", entity: "User", entityId: userId },
    });
    return { id: row.id, employeeCode: row.employeeCode, archived: true };
  });
}

export async function restoreUser(adminId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: userId },
      data: { active: true, archived: false },
    });
    await tx.auditLog.create({
      data: { actorId: adminId, action: "user.restored", entity: "User", entityId: userId },
    });
    return { id: row.id, employeeCode: row.employeeCode, archived: false };
  });
}

/** Deactivate/reactivate: login blocked, but the row stays visible (unlike archive). */
export async function setActive(adminId: string, userId: string, active: boolean) {
  if (adminId === userId) throw new Error("You cannot change your own active status.");
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target) throw new Error("User not found.");
  if (target.role.name === "ADMIN") throw new Error("Admin accounts are protected.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.user.update({ where: { id: userId }, data: { active } });
    await tx.auditLog.create({
      data: { actorId: adminId, action: active ? "user.reactivated" : "user.deactivated", entity: "User", entityId: userId },
    });
    return { id: row.id, employeeCode: row.employeeCode, active: row.active };
  });
}

export async function archivedUsers() {
  return prisma.user.findMany({
    where: { archived: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      employeeCode: true,
      name: true,
      email: true,
      role: true,
      position: true,
      branch: { select: { name: true } },
    },
  });
}
