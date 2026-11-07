import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Academic management" };

export default function AdminAcademicsPage() {
  return <PortalPage area="admin" page="academics" />;
}
