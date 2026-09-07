"use client";

import {
  DatabaseZap,
  Download,
  LoaderCircle,
  LogOut,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PrivacyControls({
  demoMode,
  userEmail,
}: {
  demoMode: boolean;
  userEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "export" | "sessions" | "financial-data" | "account" | null
  >(null);
  const [deletion, setDeletion] = useState<"financial-data" | "account">();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
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

  async function deleteData(kind: "financial-data" | "account") {
    const expected =
      kind === "account" ? "DELETE ACCOUNT" : "DELETE FINANCIAL DATA";
    if (confirmation !== expected) {
      setError("Enter the exact confirmation phrase.");
      return;
    }
    setBusy(kind);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(
        kind === "account" ? "/api/privacy/account" : "/api/privacy/financial-data",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password,
            confirmation,
            ...(kind === "account" ? { email: userEmail } : {}),
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Deletion could not be completed.");
      }
      if (kind === "account") {
        router.replace("/login");
        router.refresh();
        return;
      }
      setDeletion(undefined);
      setPassword("");
      setConfirmation("");
      setMessage("Stored financial data was deleted. Your MoneyOS login remains active.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Deletion could not be completed.",
      );
    } finally {
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
      <div className="privacy-danger">
        <div>
          <strong>Delete stored data</strong>
          <p>
            {demoMode
              ? "The shared demo is temporary and cannot be deleted from this workspace."
              : "Revoke connected providers and permanently remove imported financial records, or delete the entire MoneyOS account."}
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={demoMode || busy !== null}
          title={
            demoMode
              ? "Deletion is unavailable for temporary demo data"
              : "Delete stored financial data"
          }
          onClick={() => {
            setDeletion("financial-data");
            setConfirmation("");
            setError(undefined);
          }}
        >
          <DatabaseZap size={14} />
          Delete financial data
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={demoMode || busy !== null}
          title={
            demoMode
              ? "Account deletion is unavailable for the shared demo"
              : "Delete MoneyOS account"
          }
          onClick={() => {
            setDeletion("account");
            setConfirmation("");
            setError(undefined);
          }}
        >
          <Trash2 size={14} />
          Delete account
        </button>
      </div>
      {deletion && (
        <div className="deletion-confirmation">
          <div>
            <strong>
              {deletion === "account" ? "Delete MoneyOS account" : "Delete financial data"}
            </strong>
            <p>Provider disconnection must succeed before local deletion. This action cannot be undone.</p>
          </div>
          <label className="field compact-field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field compact-field">
            <span>
              Enter {deletion === "account" ? "DELETE ACCOUNT" : "DELETE FINANCIAL DATA"}
            </span>
            <input
              value={confirmation}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button button-danger"
            disabled={busy !== null || password.length < 8}
            onClick={() => void deleteData(deletion)}
          >
            {busy === deletion ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
            Confirm deletion
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel deletion"
            title="Cancel"
            disabled={busy !== null}
            onClick={() => {
              setDeletion(undefined);
              setPassword("");
              setConfirmation("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {(error || message) && (
        <p className={error ? "form-error privacy-message" : "save-success privacy-message"} role={error ? "alert" : "status"}>
          {error ?? message}
        </p>
      )}
    </div>
  );
}
