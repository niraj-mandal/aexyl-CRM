import { MonoLabel } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { rupees } from "@/lib/stages";
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

/** "IN_PROGRESS" → "In progress" */
const sentence = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

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
    <div className="space-y-6 animate-in fade-in duration-150">
      <LiveRefresher intervalMs={60000} />

      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description={`${active.length} active · ${delivered.length} delivered · ${avgProgress}% average progress`}
        actions={
          <>
            {atRisk.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1 text-xs font-medium text-danger">
                <AlertTriangle className="h-3.5 w-3.5" /> {atRisk.length} at risk
              </span>
            )}
            <CreateProjectButton companies={companyOptions} />
          </>
        }
      />

      {projects.length === 0 ? (
        <GlassPanel>
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            body="When you mark a gym Won, its website project is created here automatically. You can also start one by hand."
            action={<CreateProjectButton companies={companyOptions} />}
          />
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
              <GlassPanel key={project.id} className="group p-5 transition-transform duration-200 hover:-translate-y-0.5">
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
                    {sentence(project.status)}
                  </Badge>
                </div>

                {/* Progress bar */}
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Progress</span>
                    <span className="num font-medium text-text-primary">{project.progress}%</span>
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
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
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
                  <span className={`flex items-center ${HEALTH_STYLE[project.health] ?? ""}`}>
                    <HealthIcon className="mr-1 h-3 w-3" /> {sentence(project.health)}
                  </span>
                  {project.budget && (
                    <span className="num">{rupees(Number(project.budget))} budget</span>
                  )}
                  {project.status === "DELIVERED" && project.deliveredAt && (
                    <span className="flex items-center text-secondary">
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
