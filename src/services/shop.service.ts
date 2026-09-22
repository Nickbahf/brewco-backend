import { z } from "zod";
import { prisma } from "../lib/prisma";

export const ProductInput = z.object({
  categoryId: z.string().cuid(),
  name: z.string().trim().min(1).max(120),
  price: z.number().positive().max(1000000),
  stock: z.number().int().min(0),
});

export async function listProducts() {
  return prisma.product.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: { category: { select: { name: true } } },
  });
}

export async function createProduct(adminId: string, raw: unknown) {
  const input = ProductInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await tx.product.create({ data: input });
    await tx.auditLog.create({
      data: { actorId: adminId, action: "product.created", entity: "Product", entityId: row.id },
    });
    return row;
  });
}

export async function updateProduct(adminId: string, id: string, raw: unknown) {
  const input = ProductInput.partial().parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await tx.product.update({ where: { id }, data: input });
    await tx.auditLog.create({
      data: { actorId: adminId, action: "product.updated", entity: "Product", entityId: id },
    });
    return row;
  });
}

export async function deactivateProduct(adminId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.product.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: { actorId: adminId, action: "product.removed", entity: "Product", entityId: id },
    });
    return row;
  });
}

export async function categories() {
  return prisma.productCategory.findMany({ orderBy: { name: "asc" } });
}

/** Daily revenue buckets for the last N days (computed in JS — no raw SQL). */
export async function dailyRevenue(raw: unknown) {
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }).parse(raw);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: since } },
    select: { total: true, createdAt: true },
  });
  const buckets = new Map<string, { total: number; orders: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(d.toISOString().slice(0, 10), { total: 0, orders: 0 });
  }
  for (const o of orders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (b) {
      b.total += Number(o.total);
      b.orders += 1;
    }
  }
  return [...buckets.entries()].map(([date, b]) => ({ date, total: b.total, orders: b.orders }));
}

export const OrderInput = z.object({
  paymentType: z.enum(["CASH", "CARD", "E_WALLET"]),
  items: z
    .array(z.object({ productId: z.string().cuid(), quantity: z.number().int().min(1).max(100) }))
    .min(1)
    .max(50),
});

/**
 * Checkout is ONE transaction: order + items + stock decrement.
 * Price is snapshotted per line so past receipts never mutate.
 */
export async function checkout(cashierId: string, raw: unknown) {
  const input = OrderInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) }, active: true },
    });
    if (products.length !== input.items.length) throw new Error("One or more products are unavailable.");
    for (const item of input.items) {
      const p = products.find((x) => x.id === item.productId);
      if (!p || p.stock < item.quantity) throw new Error(`Insufficient stock for ${p?.name ?? item.productId}.`);
    }
    const total = input.items.reduce((sum, item) => {
      const p = products.find((x) => x.id === item.productId);
      return sum + Number(p?.price ?? 0) * item.quantity;
    }, 0);
    const order = await tx.order.create({
      data: {
        cashierId,
        paymentType: input.paymentType,
        total,
        items: {
          create: input.items.map((item) => {
            const p = products.find((x) => x.id === item.productId);
            return { productId: item.productId, quantity: item.quantity, unitPrice: p?.price ?? 0 };
          }),
        },
      },
      include: { items: true },
    });
    for (const item of input.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }
    return order;
  });
}

export async function salesReport(raw: unknown) {
  const { from, to } = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .parse(raw);
  const where =
    from || to
      ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {};
  const groups = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { order: where },
    _sum: { quantity: true },
  });
  const products = await prisma.product.findMany({
    where: { id: { in: groups.map((g) => g.productId) } },
    include: { category: { select: { name: true } } },
  });
  const revenue = await prisma.order.aggregate({ where, _sum: { total: true }, _count: true });
  return {
    totalRevenue: revenue._sum.total ?? 0,
    orderCount: revenue._count,
    byProduct: groups.map((g) => {
      const p = products.find((x) => x.id === g.productId);
      return { product: p?.name, category: p?.category.name, quantity: g._sum.quantity ?? 0 };
    }),
  };
}
