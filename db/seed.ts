import { db } from "./index";
import {
  workspaces,
  users,
  roles,
  permissions,
  rolePermissions,
  workspaceMemberships,
  companies,
  contacts,
  leads,
  deals,
  activities,
} from "./schema";

async function main() {
  console.log("🌱 Starting Aexyl CRM database seeding...");

  // 1. Create Default Workspace
  console.log("Creating default workspace...");
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Aexyl Global Technologies",
      slug: "aexyl-global",
    })
    .onConflictDoNothing()
    .returning();

  const activeWorkspaceId = workspace?.id || (await db.query.workspaces.findFirst())?.id;

  if (!activeWorkspaceId) {
    throw new Error("Failed to initialize workspace.");
  }

  // 2. Create Default System Admin User
  console.log("Creating default operator user...");
  const [operatorUser] = await db
    .insert(users)
    .values({
      clerkId: "user_seed_operator_01",
      email: "niraj@aexyl.com",
      firstName: "Niraj",
      lastName: "Operator",
    })
    .onConflictDoNothing()
    .returning();

  const activeUserId = operatorUser?.id || (await db.query.users.findFirst())?.id;

  if (!activeUserId) {
    throw new Error("Failed to initialize primary user.");
  }

  // 3. Create Admin Role & Permissions
  console.log("Creating roles & permissions...");
  const [adminRole] = await db
    .insert(roles)
    .values({
      workspaceId: activeWorkspaceId,
      name: "Super Administrator",
    })
    .returning();

  if (adminRole) {
    await db
      .insert(workspaceMemberships)
      .values({
        workspaceId: activeWorkspaceId,
        userId: activeUserId,
        roleId: adminRole.id,
      })
      .onConflictDoNothing();
  }

  // 4. Seed Enterprise Companies
  console.log("Seeding companies...");
  const companyData = [
    {
      workspaceId: activeWorkspaceId,
      name: "Apex Holdings",
      website: "https://apexholdings.com",
      industry: "Real Estate & Logistics",
      location: "New York, NY",
      size: "250-500",
      source: "Inbound Enterprise",
      status: "ACTIVE",
      ownerId: activeUserId,
      notes: "Key enterprise client interested in automated property telemetry.",
    },
    {
      workspaceId: activeWorkspaceId,
      name: "Strata Systems",
      website: "https://stratasystems.io",
      industry: "Cloud Infrastructure",
      location: "San Francisco, CA",
      size: "100-250",
      source: "Outreach Campaign",
      status: "ACTIVE",
      ownerId: activeUserId,
      notes: "Evaluating ERP platform migration.",
    },
    {
      workspaceId: activeWorkspaceId,
      name: "Vanguard SaaS",
      website: "https://vanguardsaas.com",
      industry: "Fintech",
      location: "Austin, TX",
      size: "50-100",
      source: "Partner Referral",
      status: "ACTIVE",
      ownerId: activeUserId,
      notes: "Interested in AI Lead Scoring integration.",
    },
    {
      workspaceId: activeWorkspaceId,
      name: "Horizon Tech Solutions",
      website: "https://horizontech.dev",
      industry: "Cybersecurity",
      location: "Chicago, IL",
      size: "500-1000",
      source: "Organic Search",
      status: "ACTIVE",
      ownerId: activeUserId,
      notes: "High intent security audit prospect.",
    },
  ];

  const insertedCompanies = await db.insert(companies).values(companyData).returning();

  // 5. Seed Contacts
  console.log("Seeding contacts...");
  const contactData = [
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[0]?.id,
      firstName: "Alexander",
      lastName: "Vance",
      email: "a.vance@apexholdings.com",
      phone: "+1 (555) 234-5678",
      jobTitle: "VP of Operations",
      linkedinUrl: "https://linkedin.com/in/alexander-vance",
      status: "ACTIVE",
    },
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[1]?.id,
      firstName: "Elena",
      lastName: "Rostova",
      email: "elena@stratasystems.io",
      phone: "+1 (555) 876-5432",
      jobTitle: "Chief Technology Officer",
      linkedinUrl: "https://linkedin.com/in/elena-rostova",
      status: "ACTIVE",
    },
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[2]?.id,
      firstName: "Marcus",
      lastName: "Chen",
      email: "mchen@vanguardsaas.com",
      phone: "+1 (555) 345-6789",
      jobTitle: "Head of Growth",
      linkedinUrl: "https://linkedin.com/in/marcus-chen",
      status: "ACTIVE",
    },
  ];

  const insertedContacts = await db.insert(contacts).values(contactData).returning();

  // 6. Seed Leads
  console.log("Seeding leads...");
  const leadData = [
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[0]?.id,
      contactId: insertedContacts[0]?.id,
      ownerId: activeUserId,
      source: "INBOUND",
      status: "QUALIFIED",
      stage: "DEMO_COMPLETED",
      score: 88,
      temperature: "HOT",
      notes: "Requires custom multi-tenant pipeline view.",
    },
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[1]?.id,
      contactId: insertedContacts[1]?.id,
      ownerId: activeUserId,
      source: "OUTBOUND",
      status: "CONTACTED",
      stage: "DISCOVERY_CALL",
      score: 64,
      temperature: "WARM",
      notes: "Requested detailed SOC2 compliance specs.",
    },
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[2]?.id,
      contactId: insertedContacts[2]?.id,
      ownerId: activeUserId,
      source: "REFERRAL",
      status: "NEW",
      stage: "INITIAL_OUTREACH",
      score: 45,
      temperature: "COLD",
      notes: "Referred by partner account rep.",
    },
  ];

  const insertedLeads = await db.insert(leads).values(leadData).returning();

  // 7. Seed Deals (Kanban Pipeline)
  console.log("Seeding sales pipeline deals...");
  const dealData = [
    {
      workspaceId: activeWorkspaceId,
      leadId: insertedLeads[0]?.id,
      companyId: insertedCompanies[0]?.id,
      name: "Apex Real Estate Platform",
      value: "62000.00",
      currency: "USD",
      stage: "QUALIFIED",
      probability: 70,
      ownerId: activeUserId,
      expectedCloseDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      notes: "High priority opportunity for Q4.",
    },
    {
      workspaceId: activeWorkspaceId,
      leadId: insertedLeads[1]?.id,
      companyId: insertedCompanies[1]?.id,
      name: "Cloud ERP Modernization",
      value: "38000.00",
      currency: "USD",
      stage: "PROPOSAL",
      probability: 60,
      ownerId: activeUserId,
      expectedCloseDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
      notes: "Proposal sent to CTO.",
    },
    {
      workspaceId: activeWorkspaceId,
      leadId: insertedLeads[2]?.id,
      companyId: insertedCompanies[2]?.id,
      name: "AI Analytics Add-on",
      value: "24000.00",
      currency: "USD",
      stage: "QUALIFIED",
      probability: 40,
      ownerId: activeUserId,
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      notes: "Upsell opportunity.",
    },
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[3]?.id,
      name: "Enterprise Security Audit & Portal",
      value: "120000.00",
      currency: "USD",
      stage: "NEGOTIATION",
      probability: 85,
      ownerId: activeUserId,
      expectedCloseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      notes: "Contract review phase.",
    },
    {
      workspaceId: activeWorkspaceId,
      companyId: insertedCompanies[0]?.id,
      name: "Brand Identity & Web OS",
      value: "95000.00",
      currency: "USD",
      stage: "WON",
      probability: 100,
      ownerId: activeUserId,
      expectedCloseDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      notes: "Successfully closed deal.",
    },
  ];

  const insertedDeals = await db.insert(deals).values(dealData).returning();

  // 8. Seed Activities
  console.log("Seeding engagement activities...");
  await db.insert(activities).values([
    {
      workspaceId: activeWorkspaceId,
      leadId: insertedLeads[0]?.id,
      dealId: insertedDeals[0]?.id,
      actorId: activeUserId,
      type: "MEETING",
      title: "Executive Demo & Architecture Briefing",
      description: "Demonstrated real-time telemetry dashboard and CRM pipeline views.",
    },
    {
      workspaceId: activeWorkspaceId,
      leadId: insertedLeads[1]?.id,
      dealId: insertedDeals[1]?.id,
      actorId: activeUserId,
      type: "CALL",
      title: "Discovery Call with CTO",
      description: "Reviewed database migration constraints and security compliance.",
    },
  ]);

  console.log("✅ Database seeding complete!");
}

main()
  .catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
