"use client";

import { useCountUp } from "@/components/crm/TodayProgress";

/** A number that counts up from 0 when it first appears or changes. */
export function CountUp({ value, format = String }: { value: number; format?: (n: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}
