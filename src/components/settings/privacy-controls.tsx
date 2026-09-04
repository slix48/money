"use client";

import { Download, LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PrivacyControls({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "sessions" | null>(null);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function downloadExport() {
    setBusy("export");
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/privacy/export", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Could not create the export.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `moneyos-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("Your MoneyOS data export was downloaded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the export.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeSessions() {
    if (!window.confirm("Sign out every MoneyOS session, including this device?")) return;
    setBusy("sessions");
    setError(undefined);
    try {
      const response = await fetch("/api/privacy/sessions/revoke", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Could not revoke sessions.");
      }
      router.replace("/login");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke sessions.");
      setBusy(null);
    }
  }

  return (
    <div className="panel settings-panel privacy-controls">
      <div>
        <strong>Download your data</strong>
        <p>Export your profile and stored financial records as JSON. Authentication credentials and provider tokens are excluded.</p>
        <button
          type="button"
          className="button button-secondary"
          disabled={demoMode || busy !== null}
          title={demoMode ? "Demo data is temporary and cannot be exported" : "Download MoneyOS data"}
          onClick={() => void downloadExport()}
        >
          {busy === "export" ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
          {busy === "export" ? "Preparing" : "Download data"}
        </button>
      </div>
      <div>
        <strong>Active sessions</strong>
        <p>Revoke every server-side session token and sign out all devices.</p>
        <button
          type="button"
          className="button button-secondary"
          disabled={demoMode || busy !== null}
          title={demoMode ? "Unavailable for the shared demo" : "Sign out all devices"}
          onClick={() => void revokeSessions()}
        >
          {busy === "sessions" ? <LoaderCircle size={14} className="spin" /> : <LogOut size={14} />}
          Sign out everywhere
        </button>
      </div>
      {(error || message) && (
        <p className={error ? "form-error privacy-message" : "save-success privacy-message"} role={error ? "alert" : "status"}>
          {error ?? message}
        </p>
      )}
    </div>
  );
}
