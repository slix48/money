import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { GoalsView } from "@/components/goals/goals-view";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Progress" title="Goals" description="Set concrete targets and estimate completion from your actual contribution pace." actions={<a className="button button-secondary" href="#goals"><Plus size={15} /> Add goal below</a>} />
      <div id="goals"><GoalsView initialGoals={snapshot.goals} initialContributions={snapshot.goalContributions} accounts={snapshot.accounts} anchor={snapshot.generatedAt} /></div>
    </div>
  );
}
