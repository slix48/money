import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/auth/dal";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/ui/logo";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/overview");

  return (
    <main className="auth-page">
      <section className="auth-context">
        <Logo />
        <div className="auth-context-copy">
          <p className="eyebrow">Financial clarity</p>
          <h2>Know what changed, what matters, and what comes next.</h2>
          <p>Balances, cash flow, recurring costs, goals, and investments in one calm workspace.</p>
        </div>
        <div className="auth-flow-preview" aria-hidden="true">
          <div><span>Income</span><strong>$7,395</strong></div>
          <i />
          <div className="auth-flow-branches">
            <span>Living costs</span>
            <span>Debt</span>
            <span>Savings</span>
            <span>Investing</span>
          </div>
        </div>
        <p className="auth-context-foot">Read-only intelligence in V1. No transfers. No trading. No autonomous actions.</p>
      </section>
      <section className="auth-form-side">
        <Suspense fallback={<div className="skeleton skeleton-panel" />}>
          <LoginForm demoMode={env.demoMode} />
        </Suspense>
      </section>
    </main>
  );
}
