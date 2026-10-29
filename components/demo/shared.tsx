import { Clock, Dumbbell, ShieldCheck, Star, Users } from "lucide-react";
import type { DemoStyle } from "@/lib/demo";

/** Everything a demo template needs: only facts already on the lead, plus the links built from them. */
export type DemoProps = {
  gym: {
    name: string;
    city: string | null;
    address: string | null;
    phone: string | null;
    wa: string | null;
    reviews: { rating: number; reviews: number } | null;
    mapsUrl: string;
  };
  style: DemoStyle;
  /** WhatsApp link with a prefilled message, or the Maps page when there's no number. */
  waLink: (text: string) => string;
  join: string;
  tel: string | null;
  where: string;
};

export const PROGRAMS = [
  { img: "/demo/strength.webp", title: "Strength Training", body: "Free weights, racks and machines with guidance on form." },
  { img: "/demo/women.webp", title: "Women's Fitness", body: "Comfortable sessions built around your own goals." },
  { img: "/demo/classes.webp", title: "Group Workouts", body: "Train alongside people who push you to show up." },
];
export const FEATURES = [
  { icon: Dumbbell, title: "Full equipment", body: "Everything you need, from cardio to heavy lifts." },
  { icon: Users, title: "Trainers on the floor", body: "Ask for help any time, beginners welcome." },
  { icon: Clock, title: "Morning & evening", body: "Timings that fit around work and college." },
  { icon: ShieldCheck, title: "Clean & safe", body: "A space you'll actually want to come back to." },
];
export const PLANS = [
  { name: "Monthly", note: "Start without a long commitment" },
  { name: "Quarterly", note: "Most members pick this one", popular: true },
  { name: "Yearly", note: "Best value for the committed" },
];

/** Google rating is shown only when there are enough reviews to mean something. */
export const showReviews = (r: DemoProps["gym"]["reviews"]): r is { rating: number; reviews: number } => Boolean(r && r.reviews >= 5);

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className="flex gap-1" aria-label={`${rating.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={className} fill={i < Math.round(rating) ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

export function mapEmbed(gym: DemoProps["gym"]) {
  return `https://www.google.com/maps?q=${encodeURIComponent([gym.name, gym.address ?? gym.city].filter(Boolean).join(", "))}&output=embed`;
}

export function DemoBanner({ name, className }: { name: string; className: string }) {
  return <p className={`px-4 py-2 text-center text-[11px] ${className}`}>Demo preview designed for {name} by AEXYL · not the official website yet</p>;
}
