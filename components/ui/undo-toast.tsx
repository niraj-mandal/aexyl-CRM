"use client";

import { useSyncExternalStore } from "react";
import { Check, Loader2, Undo2, X } from "lucide-react";

const UNDO_MS = 5000;

type Result = { ok: true; message?: string } | { ok: false; error: string };
type Toast = { id: number; text: string; phase: "pending" | "saving" | "done" | "error" };

let toast: Toast | null = null;
let pending: { id: number; commit: () => void; undo: () => void } | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: Toast | null) {
  toast = next;
  listeners.forEach((l) => l());
}

function settle(id: number, next: Omit<Toast, "id">) {
  // A newer action is waiting for its undo window; don't cover it.
  if (toast && toast.id !== id && toast.phase === "pending") return;
  set({ id, ...next });
  setTimeout(() => toast?.id === id && set(null), 3500);
}

/**
 * Shows "text · Undo" and only runs `run` after the undo window, so undo is just not sending.
 * shortcut: closing the tab inside the 5 s window drops the action; move to server-side undo if that bites.
 */
export function queueWithUndo(
  text: string,
  run: () => Promise<Result>,
  opts: { onDone?: () => void; onUndo?: () => void } = {},
) {
  pending?.commit(); // a second action confirms the first
  const id = ++seq;
  const commit = async () => {
    clearTimeout(timer);
    if (pending?.id === id) pending = null;
    set({ id, text, phase: "saving" });
    try {
      const res = await run();
      settle(id, res.ok ? { text: res.message ?? text, phase: "done" } : { text: res.error, phase: "error" });
      if (res.ok) opts.onDone?.();
    } catch {
      settle(id, { text: "Couldn't save that. Try again.", phase: "error" });
    }
  };
  const timer = setTimeout(commit, UNDO_MS);
  pending = {
    id,
    commit,
    undo: () => {
      clearTimeout(timer);
      pending = null;
      set(null);
      opts.onUndo?.();
    },
  };
  set({ id, text, phase: "pending" });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Bottom-center pill for queueWithUndo; mount once in the app layout. */
export function UndoToaster() {
  const t = useSyncExternalStore(subscribe, () => toast, () => null);
  if (!t) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-6">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto relative flex max-w-md items-center gap-3 overflow-hidden rounded-full border border-border-strong bg-surface-high/95 py-2 pl-4 pr-2 text-xs text-text-primary shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        {t.phase === "saving" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" />}
        {t.phase === "done" && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
        {t.phase === "error" && <X className="h-3.5 w-3.5 shrink-0 text-danger" />}
        <span className={`truncate ${t.phase === "error" ? "text-danger" : ""}`}>{t.text}</span>
        {t.phase === "pending" ? (
          <button
            type="button"
            onClick={() => pending?.undo()}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1 font-semibold text-white hover:bg-brand/85"
          >
            <Undo2 className="h-3 w-3" /> Undo
          </button>
        ) : (
          <button type="button" onClick={() => set(null)} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-text-muted hover:text-text-primary">
            <X className="h-3 w-3" />
          </button>
        )}
        {t.phase === "pending" && <span key={t.id} className="undo-bar absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
      </div>
    </div>
  );
}
