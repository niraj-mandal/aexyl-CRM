import { db } from "./index";
import { projects, companies, deals } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Seeds real delivery projects for companies that have a WON deal (delivery
 * follows the sale), plus an in-flight project for the largest open deal.
 * Idempotent: skips entirely if any projects already exist.
 */
async function main() {
  console.log("🚢 Seeding Aexyl CRM projects...");

  const workspace = await db.query.workspaces.findFirst();
  if (!workspace) throw new Error("No workspace found — run db/seed.ts first.");

  const existing = await db.query.projects.findFirst({ where: eq(projects.workspaceId, workspace.id) });
  if (existing) {
    console.log(`Projects already seeded (${existing.code}). Skipping.`);
    return;
  }

  const allCompanies = await db.query.companies.findMany({ where: eq(companies.workspaceId, workspace.id) });
  const allDeals = await db.query.deals.findMany({ where: eq(deals.workspaceId, workspace.id) });
  const companyByName = new Map(allCompanies.map((c) => [c.name, c]));

  const wonDeals = allDeals.filter((d) => d.stage === "WON");
  const rows: (typeof projects.$inferInsert)[] = [];
  let n = 0;
  const code = () => `PRJ-${String(++n).padStart(3, "0")}`;

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // One delivery project per WON deal — the sale became real work.
  for (const deal of wonDeals) {
    const company = allCompanies.find((c) => c.id === deal.companyId);
    rows.push({
      workspaceId: workspace.id,
      companyId: deal.companyId ?? company?.id,
      dealId: deal.id,
      name: deal.name,
      code: code(),
      status: "DELIVERED",
      health: "HEALTHY",
      progress: 100,
      budget: deal.value,
      startDate: new Date(now - 60 * day),
      dueDate: new Date(now - 10 * day),
      deliveredAt: new Date(now - 12 * day),
      ownerId: deal.ownerId,
      notes: `Scope inherited from WON deal "${deal.name}" (${Number(deal.value).toLocaleString()} USD).`,
    });
  }

  // In-flight delivery for the largest open deal that isn't already covered.
  const largestOpen = allDeals
    .filter((d) => d.stage !== "WON" && d.stage !== "LOST")
    .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))[0];
  if (largestOpen && !rows.some((r) => r.dealId === largestOpen.id)) {
    rows.push({
      workspaceId: workspace.id,
      companyId: largestOpen.companyId,
      dealId: largestOpen.id,
      name: largestOpen.name,
      code: code(),
      status: "IN_PROGRESS",
      health: "AT_RISK",
      progress: 35,
      budget: largestOpen.value,
      startDate: new Date(now - 20 * day),
      dueDate: new Date(now + 25 * day),
      ownerId: largestOpen.ownerId,
      notes: "Kickoff complete; environment provisioning pending client security review.",
    });
  }

  // A genuinely new engagement for a company without a project yet.
  const horizon = companyByName.get("Horizon Tech Solutions");
  if (horizon && !rows.some((r) => r.companyId === horizon.id)) {
    rows.push({
      workspaceId: workspace.id,
      companyId: horizon.id,
      name: "Horizon Mobile App Rollout",
      code: code(),
      status: "ONBOARDING",
      health: "HEALTHY",
      progress: 5,
      budget: "45000",
      startDate: new Date(now - 2 * day),
      dueDate: new Date(now + 75 * day),
      ownerId: null,
      notes: "New statement of work signed; discovery workshop scheduled.",
    });
  }

  if (rows.length > 0) {
    await db.insert(projects).values(rows);
  }
  console.log(`✅ Seeded ${rows.length} project(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
