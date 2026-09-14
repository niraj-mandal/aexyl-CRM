import { db } from "@/db";
import { deals, projects } from "@/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";

/**
 * Revenue & Predictive Intelligence (spec §17-19).
 *
 * All figures are computed from real deal/project rows. Predictions are shown
 * with evidence + methodology; never presented as certainty.
 */

/** Stage weights used for weighted pipeline when a deal has no explicit probability. */
const STAGE_WEIGHTS: Record<string, number> = {
  QUALIFIED: 0.3,
  CALL_BOOKED: 0.45,
  PROPOSAL: 0.6,
  NEGOTIATION: 0.8,
  WON: 1,
  LOST: 0,
};

export interface PipelineStagePoint {
  stage: string;
  count: number;
  value: number;
}

export interface RevenueIntelligence {
  currency: string;
  openPipelineValue: number;
  weightedPipelineValue: number;
  wonValue90d: number;
  lostValue90d: number;
  winRate: number | null;
  avgDealSize: number | null;
  /** Days from deal creation to WON, averaged over recent wins. */
  avgSalesCycleDays: number | null;
  /** Deals won per week over the last 90 days. */
  salesVelocityPerWeek: number | null;
  /** Next-30-day revenue forecast: wins' historical rate applied to weighted pipeline. */
  forecast30d: number | null;
  forecastMethod: string;
  pipelineByStage: PipelineStagePoint[];
  revenueConcentration: { topClientShare: number | null; topClientName: string | null };
  evidence: string[];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export async function getRevenueIntelligence(workspaceId: string): Promise<RevenueIntelligence> {
  const since90d = new Date(Date.now() - 90 * 24 * 3600 * 1000);

  const rows = await db
    .select({
      stage: deals.stage,
      value: deals.value,
      probability: deals.probability,
      expectedCloseDate: deals.expectedCloseDate,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
      companyName: sql<string | null>`(select c.name from companies c where c.id = ${deals.companyId})`,
    })
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), isNotNull(deals.stage)));

  let openValue = 0;
  let weighted = 0;
  let won90 = 0;
  let lost90 = 0;
  const wonDurations: number[] = [];
  const stageMap = new Map<string, PipelineStagePoint>();
  const clientWin = new Map<string, number>();

  for (const r of rows) {
    const v = num(r.value);
    const stage = r.stage.toUpperCase();
    const pt = stageMap.get(stage) ?? { stage, count: 0, value: 0 };
    if (stage !== "WON" && stage !== "LOST") {
      pt.count += 1;
      pt.value += v;
      openValue += v;
      const p = r.probability > 0 ? r.probability / 100 : (STAGE_WEIGHTS[stage] ?? 0.3);
      weighted += v * Math.min(p, 1);
    } else if (stage === "WON" && r.updatedAt >= since90d) {
      won90 += v;
      if (v > 0) wonDurations.push((r.updatedAt.getTime() - r.createdAt.getTime()) / 86_400_000);
      const name = r.companyName ?? "Direct";
      clientWin.set(name, (clientWin.get(name) ?? 0) + v);
    } else if (stage === "LOST" && r.updatedAt >= since90d) {
      lost90 += v;
    }
    stageMap.set(stage, pt);
  }

  const closed90 = won90 + lost90;
  const winRate = closed90 > 0 ? won90 / closed90 : null;
  const wonCount = wonDurations.length;
  const avgDealSize = wonCount > 0 ? won90 / wonCount : null;
  const avgSalesCycleDays =
    wonDurations.length > 0 ? wonDurations.reduce((a, b) => a + b, 0) / wonDurations.length : null;
  const salesVelocityPerWeek = wonCount > 0 ? (wonCount / 90) * 7 : null;

  // Forecast: expected weekly win throughput × weighted pipeline, expressed as 30d revenue.
  let forecast30d: number | null = null;
  let forecastMethod = "insufficient closed-deal history — forecast unavailable (no fake data)";
  if (winRate !== null && won90 > 0) {
    forecast30d = weighted * winRate * (30 / 90);
    forecastMethod = "weighted pipeline × 90d win rate × (30/90)";
  }

  const pipelineByStage = [...stageMap.values()]
    .filter((s) => s.stage !== "WON" && s.stage !== "LOST")
    .sort((a, b) => b.value - a.value);

  const top = [...clientWin.entries()].sort((a, b) => b[1] - a[1])[0];
  const revenueConcentration = {
    topClientShare: top && won90 > 0 ? top[1] / won90 : null,
    topClientName: top?.[0] ?? null,
  };

  const evidence: string[] = [];
  const openCount = pipelineByStage.reduce((a, s) => a + s.count, 0);
  if (openCount > 0) evidence.push(`${openCount} open deals across ${pipelineByStage.length} stages`);
  if (winRate !== null) evidence.push(`${Math.round(winRate * 100)}% win rate over last 90d`);
  if (avgSalesCycleDays !== null) evidence.push(`avg cycle ${Math.round(avgSalesCycleDays)}d`);
  if (top) evidence.push(`${top[0]} = ${Math.round((top[1] / won90) * 100)}% of 90d won revenue`);

  return {
    currency: "USD",
    openPipelineValue: openValue,
    weightedPipelineValue: weighted,
    wonValue90d: won90,
    lostValue90d: lost90,
    winRate,
    avgDealSize,
    avgSalesCycleDays,
    salesVelocityPerWeek,
    forecast30d,
    forecastMethod,
    pipelineByStage,
    revenueConcentration,
    evidence,
  };
}

export interface PredictiveRisk {
  id: string;
  kind: "DEAL" | "PROJECT";
  name: string;
  risk: "close_slip" | "delay";
  probability: number;
  evidence: string[];
  method: string;
}

/**
 * Predictive risks with evidence (spec §17). Deterministic heuristics —
 * each carries its evidence and method; no fabricated precision.
 */
export async function getPredictiveRisks(workspaceId: string): Promise<PredictiveRisk[]> {
  const risks: PredictiveRisk[] = [];
  const now = Date.now();

  const openDeals = await db
    .select()
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), sql`${deals.stage} not in ('WON','LOST')`));

  for (const d of openDeals) {
    const ev: string[] = [];
    let prob = 0;
    const ageDays = (now - new Date(d.createdAt).getTime()) / 86_400_000;
    const staleDays = (now - new Date(d.updatedAt).getTime()) / 86_400_000;

    if (d.expectedCloseDate) {
      const overdue = (now - new Date(d.expectedCloseDate).getTime()) / 86_400_000;
      if (overdue > 0) {
        prob += Math.min(overdue / 30, 0.5);
        ev.push(`expected close was ${Math.round(overdue)}d ago`);
      }
    }
    if (staleDays > 14) {
      prob += 0.25;
      ev.push(`no update for ${Math.round(staleDays)}d`);
    }
    if (ageDays > 60) {
      prob += 0.15;
      ev.push(`open ${Math.round(ageDays)}d`);
    }
    if (prob > 0) {
      risks.push({
        id: d.id,
        kind: "DEAL",
        name: d.name,
        risk: "close_slip",
        probability: Math.min(prob, 0.95),
        evidence: ev,
        method: "heuristic: overdue close date, staleness, age",
      });
    }
  }

  const openProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), sql`${projects.status} in ('ONBOARDING','IN_PROGRESS','BLOCKED')`));

  for (const p of openProjects) {
    const ev: string[] = [];
    let prob = p.status === "BLOCKED" ? 0.4 : 0;
    if (p.status === "BLOCKED") ev.push("status is BLOCKED");
    const staleDays = (now - new Date(p.updatedAt).getTime()) / 86_400_000;
    if (staleDays > 10) {
      prob += 0.25;
      ev.push(`no update for ${Math.round(staleDays)}d`);
    }
    if (prob > 0) {
      risks.push({
        id: p.id,
        kind: "PROJECT",
        name: p.name,
        risk: "delay",
        probability: Math.min(prob, 0.95),
        evidence: ev,
        method: "heuristic: blocked status, staleness",
      });
    }
  }

  return risks.sort((a, b) => b.probability - a.probability).slice(0, 12);
}
