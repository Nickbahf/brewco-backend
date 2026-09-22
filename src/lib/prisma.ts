import { PrismaClient } from "@prisma/client";

// Single shared client (Neon pooled URL handles serverless concurrency).
export const prisma = new PrismaClient();
