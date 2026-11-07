import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Results management" };

export default function AdminResultsPage() {
  return <PortalPage area="admin" page="results" />;
}
