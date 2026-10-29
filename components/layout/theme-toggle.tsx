"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Choice = "dark" | "light" | "system";
const NEXT: Record<Choice, Choice> = { dark: "light", light: "system", system: "dark" };
const LABEL: Record<Choice, string> = { dark: "Dark", light: "Light", system: "Match device" };
const KEY = "aexyl-theme";

function apply(choice: Choice) {
  const light = choice === "light" || (choice === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

/** Cycles Dark → Light → Match device. The choice is a per-browser preference (localStorage). */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("dark");

  useEffect(() => {
    const id = requestAnimationFrame(() => setChoice(read()));
    return () => cancelAnimationFrame(id);
  }, []);

  // Follow the device while on "Match device".
  useEffect(() => {
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const next = NEXT[choice];
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;

  return (
    <button
      type="button"
      onClick={() => {
        setChoice(next);
        apply(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // storage blocked (private mode): the choice just won't persist
        }
      }}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[choice]}`}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-[var(--fill-hover)] hover:text-text-primary md:h-auto md:w-auto md:p-2"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
