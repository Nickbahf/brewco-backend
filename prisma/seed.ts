import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const LEAVE_TYPES = [
  "Sick Leave",
  "Vacation Leave",
  "Emergency Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Bereavement Leave",
  "Study / Research Leave",
  "Unpaid Leave",
];

const CATEGORIES = ["Coffee", "Pastry", "Merch", "Bottled", "Services"] as const;

const PRODUCTS: { category: (typeof CATEGORIES)[number]; name: string; price: string; stock: number }[] = [
  { category: "Coffee", name: "House Blend Espresso", price: "120.00", stock: 200 },
  { category: "Coffee", name: "Caramel Macchiato", price: "155.00", stock: 180 },
  { category: "Pastry", name: "Croissant", price: "85.00", stock: 42 },
  { category: "Merch", name: "Brew & Co. Tote Bag", price: "350.00", stock: 18 },
  { category: "Bottled", name: "Cold Brew 1L", price: "220.00", stock: 30 },
  { category: "Services", name: "Monthly Membership", price: "1200.00", stock: 999 },
  { category: "Services", name: "Daily Pass", price: "150.00", stock: 999 },
  { category: "Services", name: "Loyalty Package", price: "500.00", stock: 999 },
  { category: "Services", name: "Event Ticket", price: "300.00", stock: 999 },
];

async function main() {
  const branch = await prisma.branch.upsert({
    where: { id: "seed-branch-makati" },
    update: {},
    create: { id: "seed-branch-makati", name: "Brew & Co. Makati", address: "Makati, Metro Manila" },
  });

  for (const name of ["Morning", "Afternoon", "Evening"]) {
    const times: Record<string, [string, string]> = {
      Morning: ["06:00", "14:00"],
      Afternoon: ["14:00", "22:00"],
      Evening: ["18:00", "02:00"],
    };
    await prisma.shift.upsert({
      where: { branchId_name: { branchId: branch.id, name } },
      update: {},
      create: { branchId: branch.id, name, startTime: times[name][0], endTime: times[name][1] },
    });
  }
  const morning = await prisma.shift.findFirstOrThrow({ where: { branchId: branch.id, name: "Morning" } });

  for (const t of LEAVE_TYPES) {
    await prisma.leaveType.upsert({ where: { name: t }, update: {}, create: { name: t } });
  }

  for (const c of CATEGORIES) {
    await prisma.productCategory.upsert({ where: { name: c }, update: {}, create: { name: c } });
  }
  for (const p of PRODUCTS) {
    const cat = await prisma.productCategory.findUniqueOrThrow({ where: { name: p.category } });
    await prisma.product.upsert({
      where: { categoryId_name: { categoryId: cat.id, name: p.name } },
      update: { price: p.price, stock: p.stock },
      create: { categoryId: cat.id, name: p.name, price: p.price, stock: p.stock },
    });
  }

  const users: { code: string; email: string; pass: string; name: string; role: Role; position: string }[] = [
    { code: "ADM-0012", email: "admin@email.com", pass: "admin123", name: "Maria Santos", role: "ADMIN", position: "Branch Admin" },
    { code: "EMP-0047", email: "rica@brewco.com", pass: "employee123", name: "Rica Bautista", role: "EMPLOYEE", position: "Senior Barista" },
    { code: "EMP-0051", email: "jun@brewco.com", pass: "employee123", name: "Jun Dela Cruz", role: "EMPLOYEE", position: "Cashier" },
    { code: "EMP-0032", email: "mia@brewco.com", pass: "employee123", name: "Mia Santos", role: "EMPLOYEE", position: "Shift Manager" },
    { code: "EMP-0058", email: "paolo@brewco.com", pass: "employee123", name: "Paolo Reyes", role: "EMPLOYEE", position: "Barista" },
    { code: "EMP-0061", email: "cath@brewco.com", pass: "employee123", name: "Cath Manalo", role: "EMPLOYEE", position: "Receptionist" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        employeeCode: u.code,
        email: u.email,
        passwordHash: await argon2.hash(u.pass, { type: argon2.argon2id }),
        name: u.name,
        role: u.role,
        position: u.position,
        branchId: branch.id,
        shiftId: morning.id,
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
