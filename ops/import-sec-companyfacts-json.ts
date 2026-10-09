/**
 * Two strictly separated paths:
 *
 * (1) Official, unmodified SEC CompanyFacts JSON: privileged MySQL import,
 *     with issuer/taxonomy, retrieval-day and SHA-256 checks.
 * (2) User-supplied lossy "transformed" + "key financials" JSON: read-only
 *     fixture reconciliation. NEVER opens a DB connection or inserts a cache row.
 *
 * Official:
 * DATABASE_URL="mysql://..." npx tsx ops/import-sec-companyfacts-json.ts \
 *   --file /secure/CIK0000320193.json --cik 0000320193 --retrieved-day 2026-10-09
 *
 * Transformed fixture:
 * npx tsx ops/import-sec-companyfacts-json.ts --format transformed --fixture-only \
 *   --file tests/fixtures/sec/apple_sec_companyfacts_transformed.json \
 *   --key-financials tests/fixtures/sec/apple_sec_key_financials.json \
 *   --cik 0000320193
 */
import {readFile, stat} from "node:fs/promises";
import mysql from "mysql2/promise";
import {prepareSecOperatorJson} from "../contracts/sec-operator-json";
import {inspectSecTransformedFixture} from "../contracts/sec-transformed-fixture";
import {validateSecReceipt} from "../contracts/sec-official-acquisition";

async function boundedFile(path: string, min: number, max: number): Promise<Buffer> {
 const size = (await stat(path)).size;
 if (size < min || size > max) throw new Error("SEC JSON file size invalid");
 return readFile(path);
}
async function main() {
 const args = process.argv.slice(2);
 const permitted = new Set(["file", "cik", "retrieved-day", "format", "key-financials", "receipt"]);
 const values: Record<string, string> = {};
 let fixtureOnly = false;
 for (let i = 0; i < args.length;) {
  if (args[i] === "--fixture-only") {
   if (fixtureOnly) throw new Error("duplicate --fixture-only");
   fixtureOnly = true;
   i++;
   continue;
  }
  const arg = args[i], value = args[i + 1];
  const key = arg?.startsWith("--") ? arg.slice(2) : "";
  if (!key || !permitted.has(key) || key in values || !value ||
      value.startsWith("--")) throw new Error("invalid, unknown or duplicated SEC import option");
  values[key] = value;
  i += 2;
 }
 if (values.format === "transformed") {
  if (!fixtureOnly || !values.file || !values["key-financials"] ||
      !/^\d{10}$/.test(values.cik ?? "") || values["retrieved-day"] || values.receipt)
   throw new Error("transformed input requires --fixture-only, --file, --key-financials and --cik; retrieval day is forbidden");
  const [transformed, financials] = await Promise.all([
   boundedFile(values.file, 100, 1_000_000),
   boundedFile(values["key-financials"], 100, 100_000),
  ]);
  const report = inspectSecTransformedFixture(
   JSON.parse(transformed.toString("utf8")),
   JSON.parse(financials.toString("utf8")), values.cik,
  );
  // Deliberately no mysql connection and no production-cache write.
  console.log(JSON.stringify(report));
  return;
 }
 if (values.format !== undefined && values.format !== "official")
  throw new Error("unknown SEC JSON import format");
 if (fixtureOnly || values["key-financials"] ||
     !values.file || !/^\d{10}$/.test(values.cik ?? "") ||
     !values["retrieved-day"])
  throw new Error("official import requires --file, --cik, --retrieved-day; transformed options are forbidden");
 if (!process.env.DATABASE_URL) throw new Error("privileged DATABASE_URL required");
 const bytes = await boundedFile(values.file, 100, 12_000_000);
 // Official parser rejects the transformed files because they lack
 // {cik, entityName, facts} with original accession-linked XBRL observations.
 if (values.receipt) {
  const receiptBytes = await boundedFile(values.receipt, 100, 25_000);
  const receipt = validateSecReceipt(values.cik, bytes, JSON.parse(receiptBytes.toString("utf8")));
  if (receipt.retrievedDay !== values["retrieved-day"])
   throw new Error("Official SEC retrieval date and receipt disagree");
 }
 const prepared = prepareSecOperatorJson(values.cik, bytes, values["retrieved-day"]);
 const db = await mysql.createConnection(process.env.DATABASE_URL);
 try {
  await db.execute(`INSERT INTO sec_companyfacts_snapshots
  (cik,retrieved_day,archive_sha256,payload_sha256,source_url,payload_json)
  VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
  retrieved_day=VALUES(retrieved_day), archive_sha256=VALUES(archive_sha256),
  payload_sha256=VALUES(payload_sha256),source_url=VALUES(source_url),
  payload_json=VALUES(payload_json),imported_at=CURRENT_TIMESTAMP`, [
   prepared.cik, prepared.retrievedDay, prepared.sourceFileSha256,
   prepared.payloadSha256, prepared.sourceUrl, prepared.payloadJson,
  ]);
  console.log(JSON.stringify({imported: true, cik: prepared.cik,
   sourceMode: prepared.sourceMode, sourceUrl: prepared.sourceUrl,
   retrievedDay: prepared.retrievedDay,
   sourceFileSha256: prepared.sourceFileSha256,
   payloadSha256: prepared.payloadSha256}));
 } finally { await db.end(); }
}
main().catch(e => {
 console.error("SEC_SINGLE_JSON_IMPORT_FAILED", e instanceof Error ? e.message : "unknown");
 process.exitCode = 1;
});
