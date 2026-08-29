"use client";

import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/domain/demo-data";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(demoMode ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(demoMode ? DEMO_PASSWORD : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Unable to sign in.");
        return;
      }
      const requested = searchParams.get("next");
      const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/overview";
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Unable to reach MoneyOS. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-heading">
        <p className="eyebrow">Secure access</p>
        <h1>Sign in to your financial workspace</h1>
        <p>Your financial records stay separated by account and user.</p>
      </div>
      {demoMode && (
        <div className="demo-callout">
          <LockKeyhole size={17} />
          <div>
            <strong>Demo account ready</strong>
            <span>Six months of realistic, clearly labeled mock data.</span>
          </div>
        </div>
      )}
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          minLength={8}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" type="submit" disabled={pending}>
        {pending ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
        <span>{pending ? "Signing in" : demoMode ? "Open demo workspace" : "Sign in"}</span>
      </button>
      <p className="auth-legal">
        MoneyOS V1 provides tracking and analysis. It cannot move money, cancel services, or place trades.
      </p>
    </form>
  );
}
