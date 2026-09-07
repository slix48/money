import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/navigation";

describe("safeInternalPath", () => {
  it("preserves an internal application path with query and hash", () => {
    expect(safeInternalPath("/transactions?status=pending#results")).toBe(
      "/transactions?status=pending#results",
    );
  });

  it.each([
    undefined,
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example/path",
    "javascript:alert(1)",
  ])("uses the fallback for an unsafe destination: %s", (candidate) => {
    expect(safeInternalPath(candidate)).toBe("/overview");
  });
});
