import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/data/errors";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  updateTransaction: vi.fn(),
}));

vi.mock("@/auth/dal", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/data/get-repository", () => ({
  getFinancialRepository: async () => ({
    updateTransaction: mocks.updateTransaction,
  }),
}));

import { PATCH } from "@/app/api/transactions/[id]/route";

function request(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/transactions/transaction-a", {
    method: "PATCH",
    headers: {
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ notes: "Reviewed" }),
  });
}

describe("transaction mutation route", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.updateTransaction.mockReset();
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-a",
      name: "User A",
      email: "a@example.com",
      isDemo: false,
    });
  });

  it("rejects cross-origin requests before repository access", async () => {
    const response = await PATCH(request("https://attacker.example"), {
      params: Promise.resolve({ id: "transaction-a" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.updateTransaction).not.toHaveBeenCalled();
  });

  it("derives ownership from the session and maps foreign ids to not found", async () => {
    mocks.updateTransaction.mockRejectedValue(new NotFoundError());
    const response = await PATCH(request(), {
      params: Promise.resolve({ id: "user-b-transaction" }),
    });

    expect(mocks.updateTransaction).toHaveBeenCalledWith(
      "user-a",
      "user-b-transaction",
      { notes: "Reviewed" },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Transaction not found",
    });
  });

  it("requires an authenticated session", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await PATCH(request(), {
      params: Promise.resolve({ id: "transaction-a" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.updateTransaction).not.toHaveBeenCalled();
  });
});
