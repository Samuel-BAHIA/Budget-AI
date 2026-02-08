import { redirect } from "next/navigation";

export default function DashboardHome() {
  // Default entry: start with the simplified view (by expense posts)
  redirect("/dashboard/postes");
}
