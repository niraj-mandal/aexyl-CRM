import Link from "next/link";
import { Display, PageTitle, Body } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { requireWorkspace } from "@/lib/auth/workspace";
import { listConnectionViews } from "@/services/integrations/registry";
import { listFlags } from "@/lib/flags";
import { FLAG_DEFINITIONS } from "@/lib/flags";
import { ConnectorCard } from "@/components/settings/ConnectorCard";
import { FlagToggle } from "@/components/settings/FlagToggle";
import { Plug } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { workspaceId } = await requireWorkspace();
  const [connections, flags] = await Promise.all([listConnectionViews(workspaceId), listFlags(workspaceId)]);

  const connectedCount = connections.filter((c) => c?.status === "CONNECTED").length;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-text-muted"><Link href="/settings" className="hover:text-text-primary">Settings</Link></p>
        <Display>Integrations</Display>
        <Body>
          {connectedCount} of {connections.length} connectors connected. Credentials stay server-side and are
          never exposed to agents or the browser — agents reach providers only through permissioned tools.
        </Body>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-primary" />
          <PageTitle>Connectors</PageTitle>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {connections.map((c) =>
            c ? <ConnectorCard key={c.key} connector={c} /> : null
          )}
        </div>
      </section>

      <section className="space-y-4">
        <PageTitle>Feature Flags</PageTitle>
        <GlassCard className="divide-y divide-border-subtle/50 p-0">
          {FLAG_DEFINITIONS.map((def) => {
            const row = flags.find((f) => f.flagKey === def.key);
            return (
              <FlagToggle
                key={def.key}
                flagKey={def.key}
                label={def.key}
                description={row?.description ?? def.description}
                enabled={row?.enabled ?? false}
              />
            );
          })}
        </GlassCard>
      </section>
    </div>
  );
}
