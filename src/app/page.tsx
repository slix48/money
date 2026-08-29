import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/dal";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/overview" : "/login");
}
