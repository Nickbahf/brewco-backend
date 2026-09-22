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
  role: z.enum(["ADMIN", "EMPLOYEE"]).default("EMPLOYEE"),
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
  try {
    const user = await prisma.user.create({
      data: {
        employeeCode: (input.employeeCode ?? nextEmployeeCode(input.role === "ADMIN" ? "ADM" : "EMP")).toUpperCase(),
        email: input.email,
        passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
        name: input.name,
        role: input.role,
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
      role: user.role,
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
