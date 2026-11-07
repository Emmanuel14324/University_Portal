import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Examination results" };

export default function StudentResultsPage() {
  return <PortalPage area="student" page="results" />;
}
