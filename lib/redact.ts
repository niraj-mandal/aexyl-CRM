/**
 * Money redaction for Sales team members. Applied on the server before data leaves it,
 * so deal values, budgets and revenue never reach a Sales member's browser.
 */
export function redactDeal<T extends { value?: unknown }>(deal: T): T {
  return { ...deal, value: null };
}

export function redactStats<T extends { pipelineRevenue: unknown; totalPipelineValue: unknown; stageCounts: Record<string, { count: number; value: unknown }> }>(stats: T): T {
  return {
    ...stats,
    pipelineRevenue: null,
    totalPipelineValue: null,
    stageCounts: Object.fromEntries(Object.entries(stats.stageCounts).map(([k, v]) => [k, { ...v, value: null }])),
  };
}
