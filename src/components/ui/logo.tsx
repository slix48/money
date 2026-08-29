import Link from "next/link";
import { Landmark } from "lucide-react";
import { cn } from "@/lib/cn";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link href="/overview" className={cn("brand-mark", className)} aria-label="MoneyOS overview">
      <span className="brand-icon" aria-hidden="true">
        <Landmark size={17} strokeWidth={2.1} />
      </span>
      {!compact && <span>MoneyOS</span>}
    </Link>
  );
}
