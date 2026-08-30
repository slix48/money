import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "@/domain/demo-data";
import { generateInsights, getWhatChanged } from "@/domain/insights";

const anchor = new Date(2026, 7, 28, 12);

describe("financial insight engine", () => {
  it("generates findings from stored data and ranks bill changes", () => {
    const findings = generateInsights(createDemoSnapshot(anchor), anchor);

    expect(findings.length).toBeLessThanOrEqual(6);
    expect(findings.some((finding) => finding.title.includes("MetroNet Fiber"))).toBe(true);
    expect(findings.some((finding) => finding.type === "INCOME_CHANGE")).toBe(true);
    expect(findings.some((finding) => finding.type === "INVESTMENT_CONTRIBUTION")).toBe(true);
    expect(
      findings.filter((finding) =>
        ["BILL_CHANGE", "SUBSCRIPTION_CHANGE"].includes(finding.type),
      ),
    ).toHaveLength(2);
  });

  it("returns only material, prioritized monthly changes", () => {
    const changes = getWhatChanged(createDemoSnapshot(anchor), anchor);

    expect(changes.length).toBeLessThanOrEqual(8);
    expect(changes.some((change) => change.area === "Spending")).toBe(true);
    expect(changes.some((change) => change.area === "Bills")).toBe(true);
    expect(changes[0].importance).toBeGreaterThanOrEqual(changes[1].importance);
    expect(changes.some((change) => change.title.includes("Net worth"))).toBe(true);
    expect(
      changes.every(
        (change) => change.area === "Bills" || Math.abs(change.changeCents) >= 2_000,
      ),
    ).toBe(true);
  });
});
