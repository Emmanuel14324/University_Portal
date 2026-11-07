import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Student management" };

export default function AdminStudentsPage() {
  return <PortalPage area="admin" page="students" />;
}
