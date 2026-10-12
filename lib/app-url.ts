/**
 * Public origin for links sent to other people (invite emails, copied invite links).
 * Must be the production site: Vercel preview/branch URLs sit behind Vercel's own
 * login wall, so an invitee who isn't on the Vercel team can't open them.
 *
 * Order: explicit NEXT_PUBLIC_APP_URL → Vercel's production domain (set automatically
 * on Vercel) → null, letting callers fall back to the current host (local dev).
 */
export function publicAppOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProd =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}
