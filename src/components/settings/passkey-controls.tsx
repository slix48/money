"use client";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import {
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";

export interface PasskeySummary {
  id: string;
  name: string;
  credentialDeviceType: string;
  credentialBackedUp: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export function PasskeyControls({
  initialPasskeys,
  demoMode,
}: {
  initialPasskeys: PasskeySummary[];
  demoMode: boolean;
}) {
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Primary device");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function addPasskey() {
    setBusy("add");
    setError(undefined);
    setMessage(undefined);
    try {
      const { browserSupportsWebAuthn, startRegistration } = await import(
        "@simplewebauthn/browser"
      );
      if (!browserSupportsWebAuthn()) {
        throw new Error("This browser does not support passkeys.");
      }
      const optionsResponse = await fetch(
        "/api/auth/passkeys/register/options",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      const optionsBody = (await optionsResponse.json()) as {
        error?: string;
        ceremonyToken?: string;
        options?: PublicKeyCredentialCreationOptionsJSON;
      };
      if (
        !optionsResponse.ok ||
        !optionsBody.ceremonyToken ||
        !optionsBody.options
      ) {
        throw new Error(optionsBody.error ?? "Passkey enrollment could not start.");
      }
      const response = await startRegistration({
        optionsJSON: optionsBody.options,
      });
      const verification = await fetch(
        "/api/auth/passkeys/register/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ceremonyToken: optionsBody.ceremonyToken,
            name,
            response,
          }),
        },
      );
      const verified = (await verification.json()) as {
        error?: string;
        credential?: PasskeySummary;
      };
      if (!verification.ok || !verified.credential) {
        throw new Error(verified.error ?? "Passkey enrollment failed.");
      }
      setPasskeys((current) => [...current, verified.credential!]);
      setPassword("");
      setMessage(
        passkeys.length === 0
          ? "Passkey protection is active. Other sessions were revoked."
          : "Passkey added.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? "Passkey enrollment was cancelled or timed out."
          : cause instanceof Error
            ? cause.message
            : "Passkey enrollment failed.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function removePasskey(passkey: PasskeySummary) {
    if (
      !window.confirm(
        "Remove " + passkey.name + "? At least one passkey must remain enrolled.",
      )
    ) {
      return;
    }
    setBusy(passkey.id);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/auth/passkeys/" + passkey.id, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Passkey could not be removed.");
      }
      setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
      setPassword("");
      setMessage("Passkey removed.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Passkey could not be removed.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  const protectionStatus = demoMode
    ? "Passkeys are unavailable for the temporary shared demo."
    : passkeys.length > 0
    ? passkeys.length +
      " passkey" +
      (passkeys.length === 1 ? "" : "s") +
      " enrolled. Password sign-in requires passkey verification."
    : "No passkeys enrolled. Add one to require a device-based second factor after your password.";

  return (
    <div className="panel settings-panel passkey-controls">
      <div className="passkey-enrollment">
        <span className="state-icon"><ShieldCheck size={17} /></span>
        <div>
          <strong>Passkey protection</strong>
          <p>{protectionStatus}</p>
        </div>
        <label className="field compact-field">
          <span>Passkey name</span>
          <input
            value={name}
            maxLength={80}
            disabled={demoMode || Boolean(busy)}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field compact-field">
          <span>Confirm password</span>
          <input
            type="password"
            value={password}
            disabled={demoMode || Boolean(busy)}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button
          className="button button-primary"
          type="button"
          disabled={
            demoMode ||
            Boolean(busy) ||
            password.length < 8 ||
            name.trim().length < 2
          }
          onClick={() => void addPasskey()}
          title={demoMode ? "Passkeys are unavailable in demo mode" : "Add passkey"}
        >
          {busy === "add" ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
          Add passkey
        </button>
      </div>
      <div className="passkey-list" aria-label="Enrolled passkeys">
        {passkeys.length === 0 ? (
          <div className="connection-empty">
            <KeyRound size={17} />
            <div>
              <strong>No enrolled passkeys</strong>
              <span>
                {demoMode
                  ? "The shared demo cannot enroll authentication credentials."
                  : "Enrollment requires your current password."}
              </span>
            </div>
          </div>
        ) : passkeys.map((passkey) => (
          <div className="passkey-row" key={passkey.id}>
            <span className="provider-icon"><KeyRound size={15} /></span>
            <div>
              <strong>{passkey.name}</strong>
              <span>
                Added {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(passkey.createdAt))}
                {passkey.credentialBackedUp ? " · Synced passkey" : " · Device credential"}
              </span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={"Remove " + passkey.name}
              title={passkeys.length < 2 ? "Add a second passkey before removing this one" : "Remove passkey"}
              disabled={Boolean(busy) || passkeys.length < 2 || password.length < 8}
              onClick={() => void removePasskey(passkey)}
            >
              {busy === passkey.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
            </button>
          </div>
        ))}
      </div>
      {(error || message) && (
        <p
          className={error ? "form-error passkey-message" : "save-success passkey-message"}
          role={error ? "alert" : "status"}
        >
          {error ?? message}
        </p>
      )}
    </div>
  );
}
