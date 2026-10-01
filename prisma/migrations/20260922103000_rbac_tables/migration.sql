-- RBAC tables + migrate User.role (enum) to User.roleId (FK), preserving rows.
-- NOTE: the old enum type is dropped BEFORE creating the Role table because
-- Postgres tables and types share one namespace.

-- 1. Backfill FK from the old enum (roles seeded afterwards with fixed ids).
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
UPDATE "User" SET "roleId" = CASE WHEN "role" = 'ADMIN' THEN 'role-admin' ELSE 'role-employee' END;
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "Role";

-- 2. New RBAC tables.
CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

CREATE TABLE "Permission" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId"),
  CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3. Seed roles (stable ids so grants are deterministic).
INSERT INTO "Role" ("id", "name", "description") VALUES
  ('role-admin', 'ADMIN', 'Full access to everything'),
  ('role-manager', 'MANAGER', 'Operations access with restrictions'),
  ('role-employee', 'EMPLOYEE', 'Self-service access only');

ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
