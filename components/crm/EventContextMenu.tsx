"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import {
  clearFollowUpAction,
  deleteMeetingAction,
} from "@/app/actions/crm.actions";
import type { CalendarEvent } from "@/services/calendar.service";
import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 500;
const MENU_W = 180;
const MENU_H = 96;

/**
 * Right-click (and touch long-press) context menu for calendar events.
 *
 * Renders as a passive wrapper (display: contents) around the event's <Link>,
 * so the link's layout and click behavior are untouched — the menu only opens
 * on contextmenu. The menu itself is portaled to <body> so the day cell's
 * overflow-hidden can't clip it, and it repositions to follow its chip on
 * scroll/resize instead of closing. Deletable kinds: MEETING (deletes the
 * scheduled meeting activity) and FOLLOW_UP (clears the lead's
 * nextFollowUpAt). All other kinds render children directly, keeping the
 * native browser menu. Delete is two-stage — first click arms, second click
 * executes — mirroring the repo's stray-click guards.
 */
export function EventContextMenu({
  event,
  children,
}: {
  event: CalendarEvent;
  children: React.ReactNode;
}) {
  const deletable = event.kind === "MEETING" || event.kind === "FOLLOW_UP";
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const router = useRouter();

  const close = useCallback(() => {
    setOpen(false);
    setArmed(false);
    setError(null);
  }, []);

  /** Anchor the menu just below its chip, clamped to the viewport. Stored in
   *  document coordinates (absolute positioning) so the menu stays glued to
   *  its chip in the document — no scroll-following needed. The wrapper is
   *  display:contents (zero box), so measure its first child — the chip. */
  const reposition = useCallback(() => {
    const el = wrapRef.current;
    const target = (el?.firstElementChild as HTMLElement | null) ?? el;
    if (!target) return;
    const r = target.getBoundingClientRect();
    const x = Math.max(
      8,
      Math.min(r.left + r.width / 2 - MENU_W / 2, window.innerWidth - MENU_W - 8)
    );
    const y = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - MENU_H - 8));
    setPos({ x: x + window.scrollX, y: y + window.scrollY });
  }, []);

  const openMenu = useCallback(() => {
    reposition();
    setOpen(true);
  }, [reposition]);

  // While open: re-anchor on resize; dismiss on outside pointer-down or
  // Escape. (Document-space positioning keeps the menu at its chip when the
  // page scrolls, so no scroll handling is needed.)
  useEffect(() => {
    if (!open) return;
    const onOutsidePointerDown = (e: PointerEvent | MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onResize = () => reposition();
    window.addEventListener("pointerdown", onOutsidePointerDown);
    window.addEventListener("mousedown", onOutsidePointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onOutsidePointerDown);
      window.removeEventListener("mousedown", onOutsidePointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, reposition]);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  if (!deletable) return <>{children}</>;

  const cancelLongPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    pressTimer.current = setTimeout(() => {
      suppressClick.current = true; // the tap that follows must not navigate
      openMenu();
    }, LONG_PRESS_MS);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick.current = false;
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    if (!e.nativeEvent.isTrusted) return; // stray/synthetic clicks can't arm
    if (!armed) {
      setArmed(true);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        if (event.kind === "MEETING") await deleteMeetingAction(event.sourceId);
        else await clearFollowUpAction(event.sourceId);
        close();
        router.refresh();
      } catch {
        setError("Delete failed — try again");
        setArmed(false);
      }
    });
  };

  const deleteLabel = event.kind === "MEETING" ? "Delete meeting" : "Clear follow-up";

  return (
    <div
      ref={wrapRef}
      className="contents"
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      onClickCapture={handleClickCapture}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${event.title}`}
            className="absolute z-50 min-w-[175px] rounded-lg border border-border-strong bg-surface-elevated p-1 shadow-xl"
            style={{ left: pos.x, top: pos.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {error && <p className="px-2 py-1 text-[10px] text-danger">{error}</p>}
            {event.href && (
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => {
                  close();
                  router.push(event.href!);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-text-primary hover:bg-surface-lowest/60 disabled:opacity-50 transition-colors"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Open
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={handleDeleteClick}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors disabled:opacity-50",
                armed
                  ? "bg-danger font-medium text-white hover:bg-danger/90"
                  : "text-danger hover:bg-danger/10"
              )}
            >
              {pending ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3 shrink-0" />
              )}
              {pending ? "Deleting…" : armed ? "Click again to confirm" : deleteLabel}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
