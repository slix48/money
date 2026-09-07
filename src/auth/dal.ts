import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSessionContext } from "@/auth/auth-service";
import { SESSION_COOKIE_NAME } from "@/auth/tokens";

export const getCurrentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return resolveSessionContext(token);
});

export const getCurrentUser = cache(async () =>
  (await getCurrentSession())?.user ?? null,
);

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
