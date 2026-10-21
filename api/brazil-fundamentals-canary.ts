import type { Hono } from "hono";
/** One-shot public-source acceptance, no user/workspace/holding writes and no SEC requests. */
export async function runBrazilFundamentalsCanary(app: Hono) {
  if (process.env.BRAZIL_FUNDAMENTALS_CANARY_ENABLED !== "true") return;
  const secret = process.env.FILINGLENS_READ_API_TOKEN;
  if (!secret) { console.info(JSON.stringify({ kind: "brazil_fundamentals_canary", status: "not_configured" })); return; }
  for (const query of [
    { operation: "issuers", limit: 1 },
    { operation: "screen", form: "DFP", year: 2025, limit: 1 },
    { operation: "facts", cnpj: "33000167000101", form: "ITR", year: 2026, limit: 1 },
  ]) {
    try {
      const response = await app.request("/api/integration/v1/brazil/fundamentals", {
        method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(query),
      });
      const result = await response.json() as Record<string, unknown>;
      const source = result.source as {archiveSha256?: string} | undefined;
      const expected = { issuers: "cvm-issuers.v1", screen: "cvm-screen.v1", facts: "cvm-companyfacts.v1" }[query.operation];
      const valid = response.ok && result.schemaVersion === expected &&
        typeof source?.archiveSha256 === "string" && /^[a-f0-9]{64}$/.test(source.archiveSha256) &&
        Number(result.total ?? result.totalIssuers) > 0;
      console.info(JSON.stringify({ kind: "brazil_fundamentals_canary", operation: query.operation, form: query.form,
        status: valid ? "passed" : "failed", http: response.status,
        total: result.total ?? result.totalIssuers ?? null, sourceHash: source?.archiveSha256 ?? null, stateless: true }));
    } catch { console.info(JSON.stringify({ kind: "brazil_fundamentals_canary", operation: query.operation, status: "unavailable", stateless: true })); }
  }
}
