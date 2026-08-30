import { describe, expect, it } from "vitest";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";
import { normalizeMerchant } from "@/domain/calculations";
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

  it("surfaces a manually identified recurring transaction for review", async () => {
    const snapshot = createDemoSnapshot();
    const repository = new DemoFinancialRepository(snapshot);
    const transaction = snapshot.transactions.find(
      (item) => item.merchant === "Nobu",
    )!;

    await repository.updateTransaction(DEMO_USER_ID, transaction.id, {
      isRecurring: true,
    });

    expect(
      snapshot.recurring.find(
        (item) =>
          item.accountId === transaction.accountId &&
          item.merchant === transaction.merchant,
      ),
    ).toMatchObject({
      status: "POSSIBLE",
      frequency: "VARIABLE",
      confidence: 0.5,
    });
  });

  it("keeps recurring classification in sync when a transaction is recategorized", async () => {
    const snapshot = createDemoSnapshot();
    const repository = new DemoFinancialRepository(snapshot);
    const recurring = snapshot.recurring.find(
      (item) => item.isSubscription && item.status === "ACTIVE" &&
        snapshot.transactions.some(
          (transaction) =>
            transaction.isRecurring &&
            transaction.accountId === item.accountId &&
            normalizeMerchant(transaction.merchant) === normalizeMerchant(item.merchant),
        ),
    )!;
    const transaction = snapshot.transactions.find(
      (item) =>
        item.isRecurring &&
        item.accountId === recurring.accountId &&
        normalizeMerchant(item.merchant) === normalizeMerchant(recurring.merchant),
    )!;

    await repository.updateTransaction(DEMO_USER_ID, transaction.id, {
      category: "Other",
    });

    expect(recurring).toMatchObject({ category: "Other", isSubscription: false });
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

  it("enforces ownership for recurring and income stream updates", async () => {
    const snapshot = createDemoSnapshot();
    const privateRecurring = {
      ...snapshot.recurring[0],
      id: "private-recurring",
      userId: "another-user",
    };
    const privateIncome = {
      ...snapshot.incomeStreams[0],
      id: "private-income",
      userId: "another-user",
    };
    snapshot.recurring.push(privateRecurring);
    snapshot.incomeStreams.push(privateIncome);
    const repository = new DemoFinancialRepository(snapshot);

    await expect(
      repository.updateRecurring(DEMO_USER_ID, privateRecurring.id, {
        status: "IGNORED",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      repository.updateIncomeStream(DEMO_USER_ID, privateIncome.id, {
        name: "Attempted rename",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("scopes goal contributions to the session owner", async () => {
    const snapshot = createDemoSnapshot();
    const privateGoal = {
      ...snapshot.goals[0],
      id: "private-goal",
      userId: "another-user",
    };
    snapshot.goals.push(privateGoal);
    const repository = new DemoFinancialRepository(snapshot);
    const input = {
      amountCents: 25_000,
      date: new Date(),
      source: "MANUAL" as const,
    };

    await expect(
      repository.addGoalContribution(DEMO_USER_ID, privateGoal.id, input),
    ).rejects.toBeInstanceOf(NotFoundError);
    const car = snapshot.goals.find((goal) => goal.id === "goal-car")!;
    const before = car.currentAmountCents;
    const contribution = await repository.addGoalContribution(
      DEMO_USER_ID,
      car.id,
      input,
    );

    expect(contribution.userId).toBe(DEMO_USER_ID);
    expect(car.currentAmountCents).toBe(before + input.amountCents);
  });
});
