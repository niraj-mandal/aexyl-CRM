"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Search, Command as CmdIcon, CalendarDays, Users, Kanban, Briefcase, Settings, Sparkles, Megaphone, Send } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <AnimatePresence>
      {open && (
        <Command.Dialog 
          open={open} 
          onOpenChange={setOpen}
          label="Global Command Menu"
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] sm:pt-[20vh]"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-md"
            onClick={() => setOpen(false)}
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative z-50 w-full max-w-[620px] overflow-hidden rounded-2xl border border-border-strong bg-surface-glass-floating shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-2xl mx-4"
          >
            <Command className="w-full flex flex-col bg-transparent text-text-primary">
              <div className="flex items-center border-b border-border-subtle/80 px-4">
                <Search className="h-4 w-4 text-primary" />
                <Command.Input 
                  placeholder="Type a command or search Aexyl OS..." 
                  className="flex h-13 w-full rounded-md bg-transparent py-3.5 px-3 outline-none text-sm placeholder:text-text-muted"
                  autoFocus
                />
                <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border-subtle bg-surface-high px-1.5 font-mono-code text-[10px] text-text-muted">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-[320px] overflow-y-auto p-2 scrollbar-hide">
                <Command.Empty className="py-8 text-center text-xs font-mono-code text-text-muted">
                  No matching commands found.
                </Command.Empty>

                <Command.Group heading="QUICK NAVIGATION" className="px-2 text-[10px] font-mono-code tracking-widest text-text-muted uppercase mb-2 mt-2">
                  <Command.Item onSelect={() => runCommand(() => router.push("/"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <CmdIcon className="mr-2.5 h-3.5 w-3.5 text-primary" />
                      <span>Command Center Dashboard</span>
                    </div>
                    <kbd className="font-mono-code text-[10px] text-text-muted">↵</kbd>
                  </Command.Item>

                  <Command.Item onSelect={() => runCommand(() => router.push("/calendar"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <CalendarDays className="mr-2.5 h-3.5 w-3.5 text-text-muted" />
                      <span>Calendar — meetings &amp; deadlines</span>
                    </div>
                    <kbd className="font-mono-code text-[10px] text-text-muted">↵</kbd>
                  </Command.Item>

                  <Command.Item onSelect={() => runCommand(() => router.push("/sales/leads"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <Users className="mr-2.5 h-3.5 w-3.5 text-text-muted" />
                      <span>Leads Directory</span>
                    </div>
                    <kbd className="font-mono-code text-[10px] text-text-muted">G L</kbd>
                  </Command.Item>

                  <Command.Item onSelect={() => runCommand(() => router.push("/sales/pipeline"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <Kanban className="mr-2.5 h-3.5 w-3.5 text-text-muted" />
                      <span>Sales Pipeline Kanban</span>
                    </div>
                    <kbd className="font-mono-code text-[10px] text-text-muted">G P</kbd>
                  </Command.Item>

                  <Command.Item onSelect={() => runCommand(() => router.push("/outreach"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <Send className="mr-2.5 h-3.5 w-3.5 text-text-muted" />
                      <span>Outreach Engine & AI Composer</span>
                    </div>
                    <kbd className="font-mono-code text-[10px] text-text-muted">G O</kbd>
                  </Command.Item>

                  <Command.Item onSelect={() => runCommand(() => router.push("/sales/companies"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <Briefcase className="mr-2.5 h-3.5 w-3.5 text-text-muted" />
                      <span>Clients Directory</span>
                    </div>
                    <kbd className="font-mono-code text-[10px] text-text-muted">G C</kbd>
                  </Command.Item>

                  <Command.Item onSelect={() => runCommand(() => router.push("/intelligence"))} className={cn("flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors hover:bg-primary/10 aria-selected:bg-primary/20 aria-selected:text-text-primary")}>
                    <div className="flex items-center">
                      <Sparkles className="mr-2.5 h-3.5 w-3.5 text-secondary" />
                      <span>Executive Thinking Matrix</span>
                    </div>
                    <span className="rounded bg-secondary/20 px-1.5 py-0.5 font-mono-code text-[9px] text-secondary">AI</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>

              <div className="flex items-center justify-between border-t border-border-subtle/80 px-4 py-2 text-[10px] font-mono-code text-text-muted bg-surface-lowest/50">
                <span>AEXYL ⌘K ENGINE</span>
                <div className="flex items-center space-x-3">
                  <span>Navigation: <kbd className="text-text-secondary">↑↓</kbd></span>
                  <span>Select: <kbd className="text-text-secondary">↵</kbd></span>
                </div>
              </div>
            </Command>
          </motion.div>
        </Command.Dialog>
      )}
    </AnimatePresence>
  );
}
