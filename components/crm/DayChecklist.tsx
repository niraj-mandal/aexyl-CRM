"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { completeTaskAction } from "@/app/actions/crm.actions";
import { markContactedAction } from "@/app/actions/outreach.actions";
import { queueWithUndo } from "@/components/ui/undo-toast";

export interface ChecklistItem {
  key: string;
  /** What ticking it does; null = informational (meetings, deadlines). */
  action: { type: "followUp"; leadId: string } | { type: "task"; taskId: string } | null;
  title: string;
  meta: string;
  time: string | null;
  color: string;
  href: string | null;
  overdue?: boolean;
}

export interface DoneItem {
  key: string;
  title: string;
  meta: string;
  href: string | null;
}

async function run(action: NonNullable<ChecklistItem["action"]>) {
  if (action.type === "task") {
    const res = await completeTaskAction(action.taskId);
    return res.success ? { ok: true as const, message: "Task done." } : { ok: false as const, error: "Couldn't find that task." };
  }
  const res = await markContactedAction(action.leadId, "CALL", "Checked off in My Day");
  return res.ok ? { ok: true as const, message: "Logged. Next follow-up in 3 days." } : res;
}

/** Today's to-dos with real checkboxes; ticking does the work (with a 5 s undo). */
export function DayChecklist({ items, done }: { items: ChecklistItem[]; done: DoneItem[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (key: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const tick = (item: ChecklistItem) => {
    if (!item.action || checked.has(item.key)) return;
    toggle(item.key, true);
    queueWithUndo(`Done · ${item.title}`, () => run(item.action!), {
      onDone: () => router.refresh(),
      onUndo: () => toggle(item.key, false),
    });
  };


  return (
    <div className="mt-4 space-y-5">
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing left on today&apos;s list.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const isChecked = checked.has(item.key);
            const label = (
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-medium transition-colors ${isChecked ? "text-text-muted line-through" : "text-text-primary group-hover:text-primary"}`}>
                  {item.title}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {item.overdue && !isChecked && <span className="font-semibold text-danger">Overdue · </span>}
                  {item.meta}
                </span>
              </span>
            );
            return (
              <li key={item.key} className="group flex items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-surface-high/30">
                <span className="num w-12 shrink-0 pt-1 text-right text-xs text-text-muted">{item.time ?? ""}</span>
                {item.action ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    aria-label={`Mark done: ${item.title}`}
                    onClick={() => tick(item)}
                    disabled={isChecked}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      isChecked ? "border-success bg-success text-white" : "border-border-strong hover:border-primary"
                    }`}
                  >
                    {isChecked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </button>
                ) : (
                  <span className="mt-1.5 flex h-5 w-5 shrink-0 items-start justify-center">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                  </span>
                )}
                {item.href ? (
                  <Link href={item.href} className="min-w-0 flex-1">
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-text-muted">Done today · {done.length}</p>
          <ul className="space-y-1">
            {done.map((d) => (
              <li key={d.key} className="flex items-center gap-3 px-1 py-1">
                <span className="w-12 shrink-0" />
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-success/80 text-white">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text-muted line-through">
                  {d.href ? <Link href={d.href} className="hover:text-text-secondary">{d.title}</Link> : d.title}
                  <span className="ml-1.5 text-xs no-underline">· {d.meta}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
