import { describe, expect, it } from "vitest";
import { isSameOrigin, rateLimit } from "@/lib/security";

describe("request security", () => {
  it("accepts same-origin mutations and rejects foreign origins", () => {
    expect(
      isSameOrigin(new Request("http://localhost:3000/api/test", { headers: { origin: "http://localhost:3000" } })),
    ).toBe(true);
    expect(
      isSameOrigin(new Request("http://localhost:3000/api/test", { headers: { origin: "https://attacker.example" } })),
    ).toBe(false);
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/test", {
          headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
  });

  it("enforces fixed-window request limits", () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit("test", key, 2, 60_000, 1_000).allowed).toBe(true);
    expect(rateLimit("test", key, 2, 60_000, 1_001).allowed).toBe(true);
    expect(rateLimit("test", key, 2, 60_000, 1_002).allowed).toBe(false);
    expect(rateLimit("test", key, 2, 60_000, 61_001).allowed).toBe(true);
  });
});
