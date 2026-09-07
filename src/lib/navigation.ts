const INTERNAL_ORIGIN = "https://moneyos.invalid";

export function safeInternalPath(
  candidate: string | null | undefined,
  fallback = "/overview",
): string {
  if (!candidate || !candidate.startsWith("/")) return fallback;
  try {
    const parsed = new URL(candidate, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
