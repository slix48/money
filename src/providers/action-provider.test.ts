import { describe, expect, it } from "vitest";
import { V1ActionsUnavailable } from "@/providers/action-provider";

describe("V1 financial action boundary", () => {
  const provider = new V1ActionsUnavailable();
  const action = {
    type: "TRANSFER" as const,
    fromAccountId: "checking",
    toAccountId: "savings",
    amountCents: 10_000,
    currency: "USD",
  };

  it("advertises actions as unavailable and confirmation-gated", async () => {
    await expect(provider.getCapability(action)).resolves.toMatchObject({
      available: false,
      requiresExplicitConfirmation: true,
      requiresStepUpAuthentication: true,
    });
    await expect(
      provider.getCancellationCapability("user-a", "recurring-a"),
    ).resolves.toMatchObject({
      available: false,
      recurringId: "recurring-a",
    });
  });

  it("fails closed during preparation and execution", async () => {
    await expect(
      provider.prepare("user-a", action, "idempotency-a"),
    ).rejects.toThrow("not available");
    await expect(
      provider.prepareCancellation("user-a", "recurring-a", "idempotency-b"),
    ).rejects.toThrow("not available");
    await expect(
      provider.execute({} as never, {} as never, {} as never),
    ).rejects.toThrow("not available");
    await expect(
      provider.executeCancellation({} as never, {} as never, {} as never),
    ).rejects.toThrow("not available");
  });
});
