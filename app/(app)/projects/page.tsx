import { Display, MonoLabel } from "@/components/ui/typography";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { ProjectService } from "@/services/crm.service";
import { CrmService } from "@/services/crm.service";
import { requireWorkspace } from "@/lib/auth/workspace";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { CreateProjectButton, ProjectControls } from "@/components/crm/ProjectBoard";
import { FolderKanban, Clock, Building2, User, CheckCircle2, AlertTriangle } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "secondary" | "primary" | "outline" | "danger"> = {
  DELIVERED: "secondary",
  IN_PROGRESS: "primary",
  ONBOARDING: "outline",
  BLOCKED: "danger",
  CANCELLED: "outline",
};

const HEALTH_STYLE: Record<string, string> = {
  HEALTHY: "text-secondary",
  AT_RISK: "text-tertiary",
  OFF_TRACK: "text-danger",
};

const HEALTH_ICON: Record<string, typeof CheckCircle2> = {
  HEALTHY: CheckCircle2,
  AT_RISK: AlertTriangle,
  OFF_TRACK: AlertTriangle,
};

function formatDate(d: Date | string | null) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function ProjectsPage() {
  const { workspaceId } = await requireWorkspace();
  const [projects, companies] = await Promise.all([
    ProjectService.getProjects(workspaceId),
    CrmService.getCompanies(workspaceId),
  ]);

  const companyOptions = companies.map((c) => ({ id: c.id, name: c.name }));
  const active = projects.filter((p) => p.status !== "DELIVERED" && p.status !== "CANCELLED");
  const delivered = projects.filter((p) => p.status === "DELIVERED");
  const atRisk = active.filter((p) => p.health !== "HEALTHY");
  const avgProgress =
    active.length > 0
      ? Math.round(active.reduce((sum, p) => sum + p.progress, 0) / active.length)
      : 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
      <LiveRefresher intervalMs={20000} />

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <div>
          <MonoLabel className="text-primary block mb-1">OPERATIONS // DELIVERABLES</MonoLabel>
          <Display>Projects Directory</Display>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="font-mono-code text-[11px]">
            {active.length} ACTIVE · {delivered.length} DELIVERED
          </Badge>
          <Badge variant="outline" className="font-mono-code text-[11px]">
            AVG PROGRESS: {avgProgress}%
          </Badge>
          {atRisk.length > 0 && (
            <Badge variant="danger" className="font-mono-code text-[11px]">
              {atRisk.length} AT RISK
            </Badge>
          )}
          <CreateProjectButton companies={companyOptions} />
        </div>
      </div>

      {projects.length === 0 ? (
        <GlassPanel className="p-12 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FolderKanban className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-text-primary">No projects yet</h2>
          <p className="mt-2 max-w-md text-sm text-text-muted">
            Create your first delivery project and attach it to a client. Projects won from
            deals can also be tracked here as they move into delivery.
          </p>
          <div className="mt-6">
            <CreateProjectButton companies={companyOptions} />
          </div>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => {
            const HealthIcon = HEALTH_ICON[project.health] ?? CheckCircle2;
            const due = formatDate(project.dueDate);
            const overdue =
              due !== null &&
              project.status !== "DELIVERED" &&
              project.status !== "CANCELLED" &&
              new Date(project.dueDate as Date) < new Date();
            const ownerName = project.owner
              ? [project.owner.firstName, project.owner.lastName].filter(Boolean).join(" ")
              : null;

            return (
              <GlassPanel key={project.id} className="p-6 transition-all hover:border-primary/40 group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <MonoLabel>
                      {project.code} {project.company ? `• ${project.company.name}` : ""}
                    </MonoLabel>
                    <h3 className="mt-1 text-base font-semibold text-text-primary truncate group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                  </div>
                  <Badge variant={STATUS_VARIANT[project.status] ?? "outline"}>
                    {project.status.replace("_", " ")}
                  </Badge>
                </div>

                {/* Progress bar */}
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-xs font-mono-code">
                    <span className="text-text-muted">MILESTONE PROGRESS</span>
                    <span className="text-text-primary font-semibold">{project.progress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-surface-low overflow-hidden border border-border-subtle">
                    <div
                      className={`h-full transition-all duration-500 ${
                        project.health === "OFF_TRACK"
                          ? "bg-danger"
                          : project.health === "AT_RISK"
                            ? "bg-tertiary"
                            : "bg-gradient-to-r from-primary to-secondary"
                      }`}
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                </div>

                {/* Meta row */}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                  {project.company && (
                    <Link
                      href="/sales/companies"
                      className="flex items-center hover:text-text-primary transition-colors"
                    >
                      <Building2 className="mr-1 h-3 w-3" /> {project.company.name}
                    </Link>
                  )}
                  {due && (
                    <span className={`flex items-center ${overdue ? "text-danger font-medium" : ""}`}>
                      <Clock className="mr-1 h-3 w-3" /> {overdue ? "Overdue — " : "Target: "} {due}
                    </span>
                  )}
                  {ownerName && (
                    <span className="flex items-center">
                      <User className="mr-1 h-3 w-3" /> {ownerName}
                    </span>
                  )}
                  <span className={`flex items-center font-mono-code ${HEALTH_STYLE[project.health] ?? ""}`}>
                    <HealthIcon className="mr-1 h-3 w-3" /> {project.health.replace("_", " ")}
                  </span>
                  {project.budget && (
                    <span className="font-mono-code">${Number(project.budget).toLocaleString()} budget</span>
                  )}
                  {project.status === "DELIVERED" && project.deliveredAt && (
                    <span className="flex items-center text-secondary font-mono-code">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Delivered {formatDate(project.deliveredAt)}
                    </span>
                  )}
                </div>

                {/* Live controls */}
                <div className="mt-5 pt-3 border-t border-border-subtle/50 flex items-center justify-between">
                  <ProjectControls
                    project={{
                      id: project.id,
                      name: project.name,
                      code: project.code,
                      status: project.status,
                      progress: project.progress,
                      health: project.health,
                      budget: project.budget,
                      dueDate: project.dueDate ? project.dueDate.toISOString() : null,
                      notes: project.notes,
                      company: project.company ?? null,
                      owner: project.owner ?? null,
                    }}
                  />
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}
