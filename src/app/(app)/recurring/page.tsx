import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { RecurringCenter } from "@/components/recurring/recurring-center";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";

export const metadata: Metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Obligations"
        title="Recurring"
        description="Confirmed bills, probable subscriptions, next charges, and meaningful price changes."
      />
      <RecurringCenter initialItems={snapshot.recurring} />
    </div>
  );
}
