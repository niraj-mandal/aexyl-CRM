import { dispatchPendingAgentEventsAction } from "@/app/actions/agent-automation.actions";

export default async function AgentAutomationsPage() {
  const result = await dispatchPendingAgentEventsAction(10);
  const dispatched = result.result.filter((r) => r.status === "DISPATCHED").length;
  const skipped = result.result.filter((r) => r.status === "SKIPPED").length;
  const failed = result.result.filter((r) => r.status === "FAILED").length;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <div>
        <p className="text-xs font-medium tracking-[0.22em] text-muted-foreground">AEXYL AGENTS</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Event Automation</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Verified workspace events can wake the right agent. Every run still passes through
          autonomy, budget, allowlist, and approval policy before it can act.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border bg-background/70 p-5">
          <p className="text-xs text-muted-foreground">Dispatched</p>
          <p className="mt-2 text-2xl font-semibold">{dispatched}</p>
        </div>
        <div className="rounded-2xl border bg-background/70 p-5">
          <p className="text-xs text-muted-foreground">Skipped by policy</p>
          <p className="mt-2 text-2xl font-semibold">{skipped}</p>
        </div>
        <div className="rounded-2xl border bg-background/70 p-5">
          <p className="text-xs text-muted-foreground">Failed</p>
          <p className="mt-2 text-2xl font-semibold">{failed}</p>
        </div>
      </section>

      <section className="rounded-2xl border bg-background/70 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-medium">Bounded event → agent routing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              High-intent replies → Sales · business signals → Scout · due follow-ups → Follow-up ·
              project risk → Operations.
            </p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Policy gated</span>
        </div>
      </section>
    </main>
  );
}
