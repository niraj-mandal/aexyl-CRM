import { redirect } from "next/navigation";

// The real, database-backed pipeline lives under /sales/pipeline.
export default function PipelineRedirectPage() {
  redirect("/sales/pipeline");
}
