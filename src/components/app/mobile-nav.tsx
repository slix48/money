"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";
import type { UserSummary } from "@/domain/types";
import { Logo } from "@/components/ui/logo";
import { Navigation } from "@/components/app/navigation";
import { LogoutButton } from "@/components/app/logout-button";

export function MobileNav({ user }: { user: UserSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-button mobile-menu-button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <Menu size={20} />
      </button>
      {open && (
        <div className="mobile-nav-layer" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="mobile-nav-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <aside className="mobile-nav-panel">
            <div className="sidebar-brand-row">
              <Logo />
              <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X size={19} />
              </button>
            </div>
            <Navigation onNavigate={() => setOpen(false)} />
            <div className="sidebar-account">
              <span className="avatar">{user.name.slice(0, 1)}</span>
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
            </div>
            <LogoutButton />
          </aside>
        </div>
      )}
    </>
  );
}
