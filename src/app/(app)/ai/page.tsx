import type { Metadata } from "next";
import { LockKeyhole, ShieldCheck, Wrench } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { financialToolCatalog } from "@/ai/tool-registry";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AIPage() {
  await requireUser();
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Financial intelligence" title="Ask MoneyOS" description="Investigate your financial data conversationally with controlled, read-only calculation tools." />
      <div className="ai-layout">
        <AssistantChat />
        <aside className="ai-controls-panel">
          <section className="panel panel-padding">
            <div className="section-heading"><div><h2>Permission boundary</h2><p>Current assistant access</p></div><ShieldCheck size={17} className="positive" /></div>
            <div className="permission-list">
              <div><LockKeyhole size={14} /><span><strong>Read only</strong><small>No database mutations</small></span><b>On</b></div>
              <div><Wrench size={14} /><span><strong>Allowlisted tools</strong><small>{financialToolCatalog.length} calculation functions</small></span><b>On</b></div>
              <div><ShieldCheck size={14} /><span><strong>User scoped</strong><small>Session owner filters</small></span><b>On</b></div>
            </div>
          </section>
          <section className="panel tool-catalog-panel">
            <div className="panel-header"><div><h2>Available tools</h2><p>Structured financial functions</p></div></div>
            <div className="tool-catalog">
              {financialToolCatalog.map((tool) => <div key={tool.name}><span>{tool.name}</span><b>{tool.access}</b></div>)}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
