import { prisma } from "./src/lib/prisma";
import { createUser } from "./src/services/users.service";

// Elunari Enterprise roster. Temp passwords print ONCE — distribute them,
// holders set their own password on first login.
const ROSTER: { surname: string; position: string; role: "MANAGER" | "EMPLOYEE" }[] = [
  { surname: "David", position: "Marketing Staff", role: "EMPLOYEE" },
  { surname: "Reyes", position: "Marketing Staff", role: "EMPLOYEE" },
  { surname: "Niño", position: "Finance Manager", role: "MANAGER" },
  { surname: "Ichon", position: "Finance Staff", role: "EMPLOYEE" },
  { surname: "Gomez", position: "Finance Staff", role: "EMPLOYEE" },
  { surname: "Garzon", position: "Asst. General Manager", role: "MANAGER" },
  { surname: "De Guzman", position: "General Manager", role: "MANAGER" },
  { surname: "Sumayan", position: "R&D Manager", role: "MANAGER" },
  { surname: "Valdez", position: "R&D Staff", role: "EMPLOYEE" },
  { surname: "Lim", position: "Production Manager", role: "MANAGER" },
  { surname: "Regoso", position: "Production Staff", role: "EMPLOYEE" },
  { surname: "Flores", position: "Production Staff", role: "EMPLOYEE" },
  { surname: "Olediana", position: "Production Staff", role: "EMPLOYEE" },
  { surname: "Garcia", position: "Marketing Manager", role: "MANAGER" },
  { surname: "Quirino", position: "Marketing Staff", role: "EMPLOYEE" },
  { surname: "Alarcon", position: "Marketing Staff", role: "EMPLOYEE" },
  { surname: "Ogario", position: "Production Staff", role: "EMPLOYEE" },
  { surname: "Mejorado", position: "R&D Staff", role: "EMPLOYEE" },
];

async function main() {
  await prisma.branch.updateMany({ data: { name: "Elunari Makati" } });
  const branch = await prisma.branch.findFirstOrThrow();

  console.log("CODE       | EMAIL                    | ROLE     | TEMP PASSWORD | NAME / POSITION");
  console.log("-----------+--------------------------+----------+---------------+------------------------------");
  for (const r of ROSTER) {
    const email = `${r.surname.toLowerCase().replace(/[^a-z]/g, "")}@elunari.com`;
    const created = await createUser({
      name: `${r.surname.charAt(0).toUpperCase() + r.surname.slice(1)}`,
      email,
      position: r.position,
      role: r.role,
      branchId: branch.id,
    });
    console.log(
      `${created.employeeCode.padEnd(10)} | ${created.email.padEnd(24)} | ${r.role.padEnd(8)} | ${created.tempPassword}      | ${r.surname} — ${r.position}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
