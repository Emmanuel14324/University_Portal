import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "User management" };

export default function AdminUsersPage() {
  return <PortalPage area="admin" page="users" />;
}
