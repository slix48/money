import type { Metadata } from "next";
import { format } from "date-fns";
import {
  Ban,
  CheckCircle2,
  Database,
  KeyRound,
  Landmark,
  LineChart,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { requireUser } from "@/auth/dal";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import { calculateNetWorth } from "@/domain/calculations";
import { formatCurrency, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const worth = calculateNetWorth(snapshot.accounts);
  return (
    <div className="page-stack settings-page">
      <PageHeader eyebrow="Workspace" title="Settings" description="Accounts, data sources, profile, and the security boundaries protecting this workspace." />
      <section className="settings-section">
        <div className="settings-label"><UserRound size={16} /><div><h2>Profile</h2><p>Current authenticated identity</p></div></div>
        <div className="panel settings-panel">
          <div className="profile-row"><span className="avatar large">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><span>{user.email}</span></div><span className="badge badge-demo">{user.isDemo ? "Demo account" : "Member"}</span></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-label"><Landmark size={16} /><div><h2>Accounts</h2><p>{formatCurrency(worth.netWorthCents, true)} tracked net worth</p></div></div>
        <div className="panel">
          <div className="table-wrap"><table className="data-table settings-accounts"><thead><tr><th>Account</th><th>Institution</th><th>Type</th><th>Connection</th><th>Updated</th><th className="text-right">Balance</th></tr></thead><tbody>{snapshot.accounts.map((account) => <tr key={account.id}><td><div className="merchant-cell"><span className="merchant-icon">{account.name.slice(0, 1)}</span><div className="merchant-copy"><strong>{account.name}</strong><span>{account.currency}</span></div></div></td><td>{account.institution}</td><td>{titleCase(account.type)}</td><td><span className={`badge ${account.connectionStatus === "CONNECTED" ? "badge-positive" : account.connectionStatus === "NEEDS_ATTENTION" ? "badge-attention" : ""}`}><CheckCircle2 size={10} /> {titleCase(account.connectionStatus)}</span></td><td>{format(account.lastUpdatedAt, "MMM d, h:mm a")}</td><td className={`amount-cell ${account.balanceCents < 0 ? "negative" : ""}`}>{formatCurrency(account.balanceCents)}</td></tr>)}</tbody></table></div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-label"><Database size={16} /><div><h2>Providers</h2><p>Replaceable integration boundaries</p></div></div>
        <div className="provider-grid">
          <article className="panel provider-card"><span className="provider-icon"><Database size={17} /></span><div><strong>Financial data</strong><p>MoneyOS Demo Provider</p></div><span className="badge badge-positive">Connected</span><small>MockFinancialDataProvider</small></article>
          <article className="panel provider-card"><span className="provider-icon blue"><LineChart size={17} /></span><div><strong>Market data</strong><p>Development price set</p></div><span className="badge badge-demo">Demo prices</span><small>MockMarketDataProvider</small></article>
          <article className="panel provider-card"><span className="provider-icon attention"><Ban size={17} /></span><div><strong>Financial actions</strong><p>Transfers, trades, cancellation</p></div><span className="badge">Unavailable in V1</span><small>V1ActionsUnavailable</small></article>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-label"><ShieldCheck size={16} /><div><h2>Security</h2><p>Active workspace protections</p></div></div>
        <div className="panel security-grid">
          <div><span className="state-icon"><KeyRound size={17} /></span><strong>Secure sessions</strong><p>HttpOnly, SameSite cookies with server-side validation.</p></div>
          <div><span className="state-icon"><LockKeyhole size={17} /></span><strong>User isolation</strong><p>Every financial query and mutation is scoped to the session owner.</p></div>
          <div><span className="state-icon"><ShieldCheck size={17} /></span><strong>AI permissioning</strong><p>Read-only allowlist. No direct database access or financial actions.</p></div>
        </div>
      </section>
    </div>
  );
}
