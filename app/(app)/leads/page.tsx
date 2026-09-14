import { redirect } from "next/navigation";

// The real, database-backed leads experience lives under /sales/leads.
// This legacy route is kept as a redirect so old links and bookmarks work.
export default function LeadsRedirectPage() {
  redirect("/sales/leads");
}
