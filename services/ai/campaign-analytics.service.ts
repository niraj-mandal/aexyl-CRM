import { db } from "@/db";
import {
  outreachSequences,
  sequenceSteps,
  sequenceEnrollments,
  sequenceEvents,
  leads,
  contacts,
  companies,
  activities,
  intentSignals,
  deals,
} from "@/db/schema";
import { and, eq, sql, desc, gte, count } from "drizzle-orm";

/**
 * Campaign analytics — aggregates performance data from sequences, outreach,
 * intent signals, and deal outcomes to answer "what's working?" (step 19).
 *
 * All queries are workspace-scoped and read-only.
 */

export interface CampaignOverview {
  totalSequences: number;
  activeSequences: number;
  totalEnrolled: number;
  totalReplied: number;
  totalMeetings: number;
  overallReplyRate: number;
  overallMeetingRate: number;
  topSequences: SequencePerformance[];
  channelBreakdown: ChannelStats[];
  intentDistribution: IntentBucket[];
  conversionFunnel: FunnelStep[];
  recentSignals: SignalSummary[];
  insights: string[];
}

export interface SequencePerformance {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  replied: number;
  meetings: number;
  replyRate: number;
  meetingRate: number;
}

export interface ChannelStats {
  channel: string;
  stepCount: number;
  sentCount: number;
  replyCount: number;
  replyRate: number;
}

export interface IntentBucket {
  label: string;
  count: number;
  avgScore: number;
}

export interface FunnelStep {
  stage: string;
  count: number;
  percentage: number;
}

export interface SignalSummary {
  type: string;
  count: number;
  avgScore: number;
}

export class CampaignAnalyticsService {
  static async getOverview(workspaceId: string): Promise<CampaignOverview> {
    const insights: string[] = [];

    const sequences = await db
      .select()
      .from(outreachSequences)
      .where(eq(outreachSequences.workspaceId, workspaceId))
      .orderBy(desc(outreachSequences.totalReplied));

    const totalSequences = sequences.length;
    const activeSequences = sequences.filter((s) => s.status === "ACTIVE").length;
    const totalEnrolled = sequences.reduce((sum, s) => sum + s.totalEnrolled, 0);
    const totalReplied = sequences.reduce((sum, s) => sum + s.totalReplied, 0);
    const totalMeetings = sequences.reduce((sum, s) => sum + s.totalMeetings, 0);
    const overallReplyRate = totalEnrolled > 0 ? Math.round((totalReplied / totalEnrolled) * 100) : 0;
    const overallMeetingRate = totalEnrolled > 0 ? Math.round((totalMeetings / totalEnrolled) * 100) : 0;

    const topSequences: SequencePerformance[] = sequences.slice(0, 5).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      enrolled: s.totalEnrolled,
      replied: s.totalReplied,
      meetings: s.totalMeetings,
      replyRate: s.totalEnrolled > 0 ? Math.round((s.totalReplied / s.totalEnrolled) * 100) : 0,
      meetingRate: s.totalEnrolled > 0 ? Math.round((s.totalMeetings / s.totalEnrolled) * 100) : 0,
    }));

    const channelBreakdown = await CampaignAnalyticsService.getChannelStats(workspaceId, sequences.map((s) => s.id));
    const intentDistribution = await CampaignAnalyticsService.getIntentDistribution(workspaceId);
    const conversionFunnel = await CampaignAnalyticsService.getConversionFunnel(workspaceId);
    const recentSignals = await CampaignAnalyticsService.getRecentSignalSummary(workspaceId);

    if (overallReplyRate > 0) {
      if (overallReplyRate >= 15) insights.push(`Strong reply rate at ${overallReplyRate}% — above industry average.`);
      else if (overallReplyRate < 5) insights.push(`Reply rate is ${overallReplyRate}% — consider testing shorter, more personalized messages.`);
    }
    if (totalMeetings > 0 && overallMeetingRate >= 5) {
      insights.push(`Meeting conversion at ${overallMeetingRate}% — sequences are driving real pipeline.`);
    }
    const bestSeq = topSequences.find((s) => s.replyRate > 20);
    if (bestSeq) {
      insights.push(`"${bestSeq.name}" has a ${bestSeq.replyRate}% reply rate — consider cloning its approach for other ICPs.`);
    }
    const hotSignals = recentSignals.filter((s) => s.avgScore >= 70);
    if (hotSignals.length > 0) {
      insights.push(`${hotSignals.reduce((sum, s) => sum + s.count, 0)} high-intent signals detected — these leads may be ready for direct outreach.`);
    }
    if (totalSequences === 0) {
      insights.push("No sequences created yet — create your first outreach sequence to start tracking campaign performance.");
    }

    return {
      totalSequences, activeSequences, totalEnrolled, totalReplied,
      totalMeetings, overallReplyRate, overallMeetingRate,
      topSequences, channelBreakdown, intentDistribution,
      conversionFunnel, recentSignals, insights,
    };
  }

  private static async getChannelStats(workspaceId: string, sequenceIds: string[]): Promise<ChannelStats[]> {
    if (sequenceIds.length === 0) return [];

    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(sql`${sequenceSteps.sequenceId} = ANY(${sequenceIds})`);

    const channelMap = new Map<string, { stepCount: number; sentCount: number; replyCount: number }>();
    for (const step of steps) {
      const ch = step.channel ?? "EMAIL";
      const existing = channelMap.get(ch) ?? { stepCount: 0, sentCount: 0, replyCount: 0 };
      existing.stepCount++;
      channelMap.set(ch, existing);
    }

    return Array.from(channelMap.entries()).map(([channel, stats]) => ({
      channel,
      ...stats,
      replyRate: stats.sentCount > 0 ? Math.round((stats.replyCount / stats.sentCount) * 100) : 0,
    }));
  }

  private static async getIntentDistribution(workspaceId: string): Promise<IntentBucket[]> {
    const signals = await db
      .select({
        signalType: intentSignals.signalType,
        cnt: count(),
        avgScore: sql<number>`COALESCE(AVG(${intentSignals.score}), 0)`,
      })
      .from(intentSignals)
      .where(eq(intentSignals.workspaceId, workspaceId))
      .groupBy(intentSignals.signalType)
      .orderBy(desc(sql`AVG(${intentSignals.score})`));

    return signals.map((s) => ({
      label: s.signalType,
      count: Number(s.cnt),
      avgScore: Math.round(Number(s.avgScore)),
    }));
  }

  private static async getConversionFunnel(workspaceId: string): Promise<FunnelStep[]> {
    const leadCounts = await db
      .select({
        status: leads.status,
        cnt: count(),
      })
      .from(leads)
      .where(eq(leads.workspaceId, workspaceId))
      .groupBy(leads.status);

    const stageOrder = ["NEW", "CONTACTED", "QUALIFIED", "NURTURE", "CONVERTED", "LOST", "UNQUALIFIED"];
    const total = leadCounts.reduce((sum, r) => sum + Number(r.cnt), 0);

    return stageOrder
      .map((stage) => {
        const row = leadCounts.find((r) => r.status === stage);
        const c = row ? Number(row.cnt) : 0;
        return { stage, count: c, percentage: total > 0 ? Math.round((c / total) * 100) : 0 };
      })
      .filter((s) => s.count > 0);
  }

  private static async getRecentSignalSummary(workspaceId: string): Promise<SignalSummary[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const signals = await db
      .select({
        signalType: intentSignals.signalType,
        cnt: count(),
        avgScore: sql<number>`COALESCE(AVG(${intentSignals.score}), 0)`,
      })
      .from(intentSignals)
      .where(and(
        eq(intentSignals.workspaceId, workspaceId),
        gte(intentSignals.occurredAt, thirtyDaysAgo),
      ))
      .groupBy(intentSignals.signalType)
      .orderBy(desc(sql`COUNT(*)`));

    return signals.map((s) => ({
      type: s.signalType,
      count: Number(s.cnt),
      avgScore: Math.round(Number(s.avgScore)),
    }));
  }
}
