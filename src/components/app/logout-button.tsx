"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={compact ? "icon-button" : "sidebar-utility"}
      onClick={logout}
      disabled={pending}
      title="Sign out"
      aria-label="Sign out"
    >
      <LogOut size={16} />
      {!compact && <span>{pending ? "Signing out" : "Sign out"}</span>}
    </button>
  );
}
