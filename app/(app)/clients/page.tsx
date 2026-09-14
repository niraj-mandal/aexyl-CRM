import { redirect } from "next/navigation";

// The real, database-backed clients directory lives under /sales/companies.
export default function ClientsRedirectPage() {
  redirect("/sales/companies");
}
