"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Landmark,
  Link2,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

export interface ConnectedAccountSummary {
  id: string;
  provider: "PLAID" | "MOCK";
  institutionName: string;
  status: "PENDING" | "INITIAL_SYNC" | "SYNCING" | "CONNECTED" | "NEEDS_ATTENTION" | "TEMPORARILY_UNAVAILABLE" | "DISCONNECTING" | "DISCONNECTED";
  lastSuccessfulSyncAt?: string;
  safeMessage?: string;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    maskLast4?: string;
    balanceStatus: "AVAILABLE" | "UNAVAILABLE" | "STALE";
    lastUpdatedAt: string;
  }>;
}

type LinkMode =
  | { kind: "new" }
  | { kind: "reconnect"; connectionId: string };

interface StoredLinkState {
  token: string;
  expiresAt: number;
  mode: LinkMode;
}

const LINK_STATE_KEY = "moneyos:plaid-link-state";

function readStoredLinkState(): StoredLinkState | undefined {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(LINK_STATE_KEY) ?? "null",
    ) as Partial<StoredLinkState> | null;
    if (
      !parsed ||
      typeof parsed.token !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now() ||
      (parsed.mode?.kind !== "new" &&
        !(
          parsed.mode?.kind === "reconnect" &&
          typeof parsed.mode.connectionId === "string"
        ))
    ) {
      return undefined;
    }
    return parsed as StoredLinkState;
  } catch {
    return undefined;
  }
}

function clearStoredLinkState() {
  window.sessionStorage.removeItem(LINK_STATE_KEY);
  const url = new URL(window.location.href);
  if (url.searchParams.has("oauth_state_id")) {
    url.searchParams.delete("oauth_state_id");
    window.history.replaceState({}, "", url);
  }
}

function label(status: ConnectedAccountSummary["status"]): string {
  return {
    PENDING: "Connecting",
    INITIAL_SYNC: "Initial sync",
    SYNCING: "Syncing",
    CONNECTED: "Connected",
    NEEDS_ATTENTION: "Needs attention",
    TEMPORARILY_UNAVAILABLE: "Temporarily unavailable",
    DISCONNECTING: "Disconnecting",
    DISCONNECTED: "Disconnected",
  }[status];
}

function badgeClass(status: ConnectedAccountSummary["status"]): string {
  if (status === "CONNECTED") return "badge-positive";
  if (status === "NEEDS_ATTENTION" || status === "TEMPORARILY_UNAVAILABLE") {
    return "badge-attention";
  }
  return "";
}

function lastUpdated(connection: ConnectedAccountSummary): string {
  if (!connection.lastSuccessfulSyncAt) return "Not synchronized yet";
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(connection.lastSuccessfulSyncAt))}`;
}

export function ConnectedAccounts({
  initialConnections,
  demoMode,
  providerConfigured,
}: {
  initialConnections: ConnectedAccountSummary[];
  demoMode: boolean;
  providerConfigured: boolean;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState<LinkMode>({ kind: "new" });
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async () => {
    const response = await fetch("/api/connections", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { connections: ConnectedAccountSummary[] };
    setConnections(body.connections);
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(async (publicToken) => {
    try {
      setBusy(linkMode.kind === "new" ? "connect" : linkMode.connectionId);
      const endpoint = linkMode.kind === "new"
        ? "/api/connections/exchange"
        : `/api/connections/${linkMode.connectionId}/refresh`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: linkMode.kind === "new" ? JSON.stringify({ publicToken }) : undefined,
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Connection could not be completed.");
      setNotice(linkMode.kind === "new" ? "Account connected. Initial synchronization has started." : "Institution reconnected. Synchronization has started.");
      setError(undefined);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection could not be completed.");
    } finally {
      setBusy(undefined);
      setLinkToken(null);
      setReceivedRedirectUri(undefined);
      clearStoredLinkState();
    }
  }, [linkMode, reload]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess,
    onExit: () => {
      setLinkToken(null);
      setReceivedRedirectUri(undefined);
      clearStoredLinkState();
    },
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("oauth_state_id")) return;
    const returnedUri = window.location.href;
    const timer = window.setTimeout(() => {
      const stored = readStoredLinkState();
      if (!stored) {
        setError("This institution return expired. Start the connection again.");
        return;
      }
      setLinkMode(stored.mode);
      setReceivedRedirectUri(returnedUri);
      setLinkToken(stored.token);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, open, ready]);

  useEffect(() => {
    if (!connections.some((connection) => ["PENDING", "INITIAL_SYNC", "SYNCING"].includes(connection.status))) return;
    const timer = window.setInterval(reload, 2_500);
    return () => window.clearInterval(timer);
  }, [connections, reload]);

  async function requestLinkToken(connectionId?: string) {
    setBusy(connectionId ?? "connect");
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch("/api/connections/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      });
      const body = await response.json() as {
        linkToken?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!response.ok || !body.linkToken) {
        throw new Error(body.error ?? "Account connection is unavailable.");
      }
      const mode: LinkMode = connectionId
        ? { kind: "reconnect", connectionId }
        : { kind: "new" };
      window.sessionStorage.setItem(
        LINK_STATE_KEY,
        JSON.stringify({
          token: body.linkToken,
          expiresAt: Date.parse(body.expiresAt ?? "") || Date.now() + 20 * 60 * 1_000,
          mode,
        } satisfies StoredLinkState),
      );
      setLinkMode(mode);
      setLinkToken(body.linkToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account connection is unavailable.");
    } finally {
      setBusy(undefined);
    }
  }

  async function refresh(connectionId: string) {
    setBusy(connectionId);
    setError(undefined);
    try {
      const response = await fetch(`/api/connections/${connectionId}/refresh`, { method: "POST" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Refresh could not be started.");
      setNotice("Synchronization requested.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Refresh could not be started.");
    } finally {
      setBusy(undefined);
    }
  }

  async function disconnect(connectionId: string) {
    if (!window.confirm("Disconnect this institution? Imported history will be preserved, but balances and transactions will stop updating.")) return;
    setBusy(connectionId);
    setError(undefined);
    try {
      const response = await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Connection could not be disconnected.");
      setNotice("Institution disconnected. Imported history was preserved.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection could not be disconnected.");
    } finally {
      setBusy(undefined);
    }
  }

  if (demoMode) {
    return (
      <div className="panel connection-panel">
        <div className="connection-toolbar">
          <div><strong>MoneyOS Demo Provider</strong><span>4 demo accounts with realistic financial history</span></div>
          <span className="badge badge-positive">Connected</span>
          <button className="button button-secondary" disabled title="Real connections are disabled in public demo mode"><Link2 size={14} /> Connect account</button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel connection-panel">
      <div className="connection-toolbar">
        <div><strong>Financial institutions</strong><span>Balances use stored synchronized data between provider updates.</span></div>
        <button className="button button-primary" disabled={!providerConfigured || busy === "connect"} onClick={() => requestLinkToken()} title={providerConfigured ? "Connect a financial institution" : "Account connection is unavailable in this deployment"}>
          {busy === "connect" ? <LoaderCircle className="spin" size={14} /> : <Link2 size={14} />} Connect account
        </button>
      </div>
      {!providerConfigured && (
        <div className="connection-empty"><AlertTriangle size={17} /><div><strong>Account connection unavailable</strong><span>This deployment is running without a financial-data provider.</span></div></div>
      )}
      {providerConfigured && connections.length === 0 && (
        <div className="connection-empty"><Landmark size={17} /><div><strong>No institutions connected</strong><span>Connect an account to import balances and transactions.</span></div></div>
      )}
      {connections.map((connection) => (
        <div className="connection-row" key={connection.id}>
          <span className="provider-icon"><Landmark size={16} /></span>
          <div className="connection-copy">
            <strong>{connection.institutionName}</strong>
            <span>{connection.accounts.length === 0 ? "Accounts pending" : connection.accounts.map((account) => account.maskLast4 ? `${account.name} ···· ${account.maskLast4}` : account.name).join(" · ")}</span>
            <small>{connection.safeMessage ?? lastUpdated(connection)}</small>
          </div>
          <span className={`badge ${badgeClass(connection.status)}`}>{["INITIAL_SYNC", "SYNCING", "DISCONNECTING"].includes(connection.status) && <LoaderCircle className="spin" size={10} />}{label(connection.status)}</span>
          <div className="connection-actions">
            {connection.status === "NEEDS_ATTENTION" && <button className="button button-secondary" disabled={busy === connection.id} onClick={() => requestLinkToken(connection.id)}><Link2 size={13} /> Reconnect</button>}
            {connection.status !== "DISCONNECTED" && connection.status !== "DISCONNECTING" && <button className="icon-button" aria-label={`Refresh ${connection.institutionName}`} title="Refresh" disabled={busy === connection.id || ["INITIAL_SYNC", "SYNCING"].includes(connection.status)} onClick={() => refresh(connection.id)}><RefreshCw className={busy === connection.id ? "spin" : ""} size={14} /></button>}
            {connection.status !== "DISCONNECTED" && <button className="icon-button" aria-label={`Disconnect ${connection.institutionName}`} title="Disconnect" disabled={busy === connection.id} onClick={() => disconnect(connection.id)}><Unplug size={14} /></button>}
          </div>
        </div>
      ))}
      {(error || notice) && <p className={error ? "form-error connection-message" : "save-success connection-message"}>{error ?? notice}</p>}
    </div>
  );
}
