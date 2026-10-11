import { z } from "zod";
import { AiGateway } from "@/lib/ai/gateway";
import { db } from "@/db";
import { icpProfiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const IcpGenerationSchema = z.object({
  idealCustomerProfile: z.array(z.object({
    industry: z.string(),
    size: z.string(),
    stage: z.string(),
    region: z.string(),
  })).min(1).max(6),
  topBuyerRoles: z.array(z.string()).min(1).max(6),
  keyPainPoints: z.array(z.string()).min(1).max(6),
  sampleCompanies: z.array(z.object({
    name: z.string(),
    initial: z.string().max(1),
    industry: z.string().optional(),
  })).min(3).max(6),
  sampleBuyers: z.array(z.object({
    name: z.string(),
    role: z.string(),
    company: z.string(),
  })).min(2).max(4),
  personalizedOpener: z.string().min(20).max(500),
  openerTargetRole: z.string(),
});

export type IcpGeneration = z.infer<typeof IcpGenerationSchema>;

export class IcpService {
  static async generateProfile(params: {
    workspaceId: string;
    businessDescription: string;
    website?: string;
    targetLocation?: string;
  }): Promise<{ profileId: string; data: IcpGeneration | null }> {
    const [existing] = await db
      .select()
      .from(icpProfiles)
      .where(eq(icpProfiles.workspaceId, params.workspaceId))
      .limit(1);

    const profileId = existing?.id ?? crypto.randomUUID();

    if (!existing) {
      await db.insert(icpProfiles).values({
        id: profileId,
        workspaceId: params.workspaceId,
        businessDescription: params.businessDescription,
        website: params.website ?? null,
        targetLocation: params.targetLocation ?? null,
        status: "GENERATING",
      });
    } else {
      await db
        .update(icpProfiles)
        .set({
          businessDescription: params.businessDescription,
          website: params.website ?? null,
          targetLocation: params.targetLocation ?? null,
          status: "GENERATING",
          updatedAt: new Date(),
        })
        .where(eq(icpProfiles.id, existing.id));
    }

    const result = await AiGateway.structuredOutput({
      system: `You are a B2B sales strategist. Given a business description, generate a complete Ideal Customer Profile (ICP) for outbound sales.

Rules:
- idealCustomerProfile: 4-5 attributes describing the ideal company (industry verticals, company size, funding stage, geography)
- topBuyerRoles: 3-4 job titles of decision makers at these companies
- keyPainPoints: 4-5 specific pain points these buyers face that the product solves
- sampleCompanies: 4-6 real companies that match this ICP (use first letter as "initial")
- sampleBuyers: 2-3 realistic sample buyer personas with name, role, and company from the sample list
- personalizedOpener: A short, personalized outreach opening message (2-3 sentences, casual professional tone)
- openerTargetRole: Which buyer role the opener is written for

The opener should mention a specific pain point and suggest a short meeting. Keep it under 500 chars.`,
      user: `Business: ${params.businessDescription}${params.website ? `\nWebsite: ${params.website}` : ""}${params.targetLocation ? `\nTarget Location: ${params.targetLocation}` : ""}`,
      schema: IcpGenerationSchema,
      workspaceId: params.workspaceId,
    });

    if (result.ok && result.data) {
      await db
        .update(icpProfiles)
        .set({
          idealCustomerProfile: result.data.idealCustomerProfile,
          topBuyerRoles: result.data.topBuyerRoles,
          keyPainPoints: result.data.keyPainPoints,
          sampleCompanies: result.data.sampleCompanies,
          sampleBuyers: result.data.sampleBuyers,
          personalizedOpener: result.data.personalizedOpener,
          openerTargetRole: result.data.openerTargetRole,
          status: "ACTIVE",
          updatedAt: new Date(),
        })
        .where(eq(icpProfiles.id, profileId));
      return { profileId, data: result.data };
    }

    const fallback = IcpService.generateFallback(params);
    await db
      .update(icpProfiles)
      .set({
        ...fallback,
        status: "ACTIVE",
        updatedAt: new Date(),
      })
      .where(eq(icpProfiles.id, profileId));

    return { profileId, data: fallback };
  }

  private static generateFallback(params: {
    businessDescription: string;
    targetLocation?: string;
  }): IcpGeneration {
    const desc = params.businessDescription.toLowerCase();
    const isSaas = /saas|software|platform|app|tool/i.test(desc);
    const isAgency = /agency|consult|service|market/i.test(desc);
    const location = params.targetLocation || "North America";

    return {
      idealCustomerProfile: [
        { industry: isSaas ? "SaaS startups" : isAgency ? "B2B services" : "SMBs", size: "10-200 employees", stage: "Series A-B", region: location },
        { industry: "Technology", size: "50-500 employees", stage: "Growth stage", region: location },
        { industry: "Professional Services", size: "20-100 employees", stage: "Established", region: location },
      ],
      topBuyerRoles: ["Head of Sales", "VP Marketing", "CEO / Founder", "RevOps Manager"],
      keyPainPoints: [
        "Inconsistent pipeline generation",
        "SDR bandwidth constraints",
        "Low response rates on outreach",
        "Difficulty getting qualified meetings",
        "Tools not delivering ROI",
      ],
      sampleCompanies: [
        { name: "TechFlow", initial: "T" },
        { name: "ScaleUp Inc", initial: "S" },
        { name: "GrowthLab", initial: "G" },
        { name: "Nexus Digital", initial: "N" },
      ],
      sampleBuyers: [
        { name: "Alex Rivera", role: "Head of Sales", company: "TechFlow" },
        { name: "Priya Shah", role: "VP Marketing", company: "ScaleUp Inc" },
      ],
      personalizedOpener: `Hi — noticed your team is scaling outbound. Teams at your stage often hit inconsistent pipeline before they add headcount. Worth a 12-min look at how we help similar companies book more qualified demos?`,
      openerTargetRole: "Head of Sales",
    };
  }

  static async getActiveProfile(workspaceId: string) {
    const [profile] = await db
      .select()
      .from(icpProfiles)
      .where(and(eq(icpProfiles.workspaceId, workspaceId), eq(icpProfiles.status, "ACTIVE")))
      .limit(1);
    return profile ?? null;
  }

  static async getProfile(workspaceId: string) {
    const [profile] = await db
      .select()
      .from(icpProfiles)
      .where(eq(icpProfiles.workspaceId, workspaceId))
      .limit(1);
    return profile ?? null;
  }
}
