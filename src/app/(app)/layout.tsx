import type { ReactNode } from "react";
import { requireUser } from "@/auth/dal";
import { AppShell } from "@/components/app/app-shell";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
