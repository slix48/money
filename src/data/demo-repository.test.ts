import { describe, expect, it } from "vitest";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";
import { DemoFinancialRepository } from "@/data/demo-repository";
import { NotFoundError } from "@/data/errors";

describe("user-scoped financial repository", () => {
  it("rejects attempts to read another owner's snapshot", async () => {
    const repository = new DemoFinancialRepository(createDemoSnapshot());

    await expect(repository.getSnapshot(DEMO_USER_ID, "another-user")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repository.getSnapshot("another-user")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not reveal whether another user's transaction id exists", async () => {
    const snapshot = createDemoSnapshot();
    snapshot.transactions.push({
      ...snapshot.transactions[0],
      id: "private-transaction",
      userId: "another-user",
    });
    const repository = new DemoFinancialRepository(snapshot);

    await expect(
      repository.updateTransaction(DEMO_USER_ID, "private-transaction", { notes: "attempt" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      repository.updateTransaction(DEMO_USER_ID, "does-not-exist", { notes: "attempt" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("allows the owner to update only the requested transaction fields", async () => {
    const snapshot = createDemoSnapshot();
    const repository = new DemoFinancialRepository(snapshot);
    const transaction = snapshot.transactions[0];

    await repository.updateTransaction(DEMO_USER_ID, transaction.id, {
      category: "Other",
      notes: "Reviewed",
      isRecurring: true,
    });

    expect(transaction).toMatchObject({ category: "Other", notes: "Reviewed", isRecurring: true });
  });

  it("enforces user ownership for new goals and linked accounts", async () => {
    const snapshot = createDemoSnapshot();
    const repository = new DemoFinancialRepository(snapshot);
    const input = {
      type: "CUSTOM" as const,
      name: "New goal",
      targetAmountCents: 100_000,
      currentAmountCents: 10_000,
      monthlyTargetCents: 5_000,
      color: "#3f826d",
    };

    await expect(repository.createGoal("another-user", input)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      repository.createGoal(DEMO_USER_ID, { ...input, linkedAccountId: "another-account" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const created = await repository.createGoal(DEMO_USER_ID, {
      ...input,
      linkedAccountId: snapshot.accounts[0].id,
    });
    expect(created.userId).toBe(DEMO_USER_ID);
    expect(snapshot.goals).toContainEqual(created);
  });
});
