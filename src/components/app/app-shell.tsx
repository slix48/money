import type { ReactNode } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import type { UserSummary } from "@/domain/types";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Navigation } from "@/components/app/navigation";
import { LogoutButton } from "@/components/app/logout-button";
import { MobileNav } from "@/components/app/mobile-nav";

export function AppShell({ user, children }: { user: UserSummary; children: ReactNode }) {
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <Logo />
          {user.isDemo && <span className="badge badge-demo">Demo</span>}
        </div>
        <Navigation />
        <div className="sidebar-spacer" />
        <div className="privacy-note">
          <LockKeyhole size={15} />
          <span>Read-only financial intelligence</span>
        </div>
        <div className="sidebar-account">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <LogoutButton />
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div className="mobile-brand">
            <MobileNav user={user} />
            <Logo compact />
          </div>
          <div className="sync-state">
            <CheckCircle2 size={15} />
            <span>Demo data synced</span>
          </div>
          <div className="topbar-actions">
            {user.isDemo && <span className="badge badge-demo mobile-demo-badge">Demo data</span>}
            <ThemeToggle />
            <LogoutButton compact />
          </div>
        </header>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
