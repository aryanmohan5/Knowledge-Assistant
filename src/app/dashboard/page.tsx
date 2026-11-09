import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Dashboard } from "./Dashboard";

export const metadata = { title: "Documents · Knowledge Assistant" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");

  const { email, role, organizationName, organizationSlug } = session.user;
  return (
    <Dashboard
      user={{ email: email ?? "", role }}
      organization={{ name: organizationName, slug: organizationSlug }}
    />
  );
}
