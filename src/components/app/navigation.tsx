"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  Goal,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const navigation = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/income", label: "Income", icon: CircleDollarSign },
  { href: "/recurring", label: "Recurring", icon: RefreshCw },
  { href: "/investments", label: "Investments", icon: ChartNoAxesCombined },
  { href: "/goals", label: "Goals", icon: Goal },
  { href: "/ai", label: "AI", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      {navigation.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("nav-item", active && "active")}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
