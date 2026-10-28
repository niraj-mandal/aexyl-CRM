import { requireAdminPage } from "@/lib/auth/workspace";

/** Insights is all revenue and pipeline risk: admins only. Its data is admin-only on the server too. */
export default async function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return children;
}
