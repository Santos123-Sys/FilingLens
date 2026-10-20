import type { Hono } from "hono";
import mysql from "mysql2/promise";
import { z } from "zod";
import { requireAnalysisAccess, AnalysisAccessError } from "../analysis-access";
import { HANDOFF_HEADER } from "../../contracts/analysis-access";
import { DcfDebateBrief } from "../../contracts/dcf-swarm";
import { loadPublicFinanceSnapshot } from "../public-finance-api";
import { runDebate, debateHash } from "./orchestrator";
import { withExecutionScope } from "../ai/execution";
import {reviewAvailability} from './live-evaluation';
const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("read"),
      issuerId: z.string().max(30),
      runId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("run"),
      issuerId: z.string().max(30),
      runId: z.string().uuid(),
      brief: DcfDebateBrief,
    })
    .strict(),
]);
export const DEBATE_DDL = `CREATE TABLE IF NOT EXISTS dcf_debate_runs (
 id CHAR(36) PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL, issuer_id VARCHAR(30) NOT NULL,
 request_hash CHAR(64) NOT NULL, status VARCHAR(30) NOT NULL, output_json MEDIUMTEXT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX dcf_scope (workspace_id,issuer_id,created_at))`;
const connect = () => mysql.createConnection(process.env.DATABASE_URL!);
export function registerDcfSwarm(
  app: Hono,
  deps = {
    authorize: requireAnalysisAccess,
    connect,
    load: loadPublicFinanceSnapshot,
    run: runDebate,
    availability: reviewAvailability,
  }
) {
  app.post("/api/dcf-swarm", async c => {
    c.header("Cache-Control", "no-store");
    c.header("Vary", HANDOFF_HEADER);
    let db: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      const ctx = await deps.authorize(c.req.header(HANDOFF_HEADER));
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 8000)
        return c.json({ error: "payload_too_large" }, 413);
      const input = inputSchema.parse(JSON.parse(raw));
      if (input.issuerId !== ctx.issuerId)
        return c.json({ error: "issuer_mismatch" }, 403);
      if (!process.env.DATABASE_URL)
        return c.json({ error: "debate_store_unavailable" }, 503);
      db = await deps.connect();
      // The application account deliberately has DML privileges only.
      // Deployment migrations own DDL; requests verify the required table.
      await db.query('SELECT id FROM dcf_debate_runs LIMIT 0');
      const availability=deps.availability(),enabled=availability.enabled;
      if (input.action === "read") {
        const [rows] = await db.query(
          "SELECT id,status,output_json,created_at FROM dcf_debate_runs WHERE workspace_id=? AND issuer_id=?" +
            (input.runId ? " AND id=?" : "") +
            " ORDER BY created_at DESC LIMIT 1",
          [ctx.workspaceId, ctx.issuerId, ...(input.runId ? [input.runId] : [])]
        );
        const row = (
          rows as {
            id: string;
            status: string;
            output_json: string | null;
            created_at: Date;
          }[]
        )[0];
        return c.json({
          ...availability,
          run: row
            ? {
                id: row.id,
                status:
                  row.status === "running" &&
                  Date.now() - new Date(row.created_at).getTime() > 150000
                    ? "interrupted"
                    : row.status,
                result: row.output_json ? JSON.parse(row.output_json) : null,
              }
            : null,
        });
      }
      if (!enabled)
        return c.json({ error: "debate_disabled_pending_evaluation" }, 503);
      const lock = "dcf:" + debateHash(ctx.workspaceId).slice(0, 50);
      const [locked] = await db.query("SELECT GET_LOCK(?,2) AS acquired", [
        lock,
      ]);
      if (Number((locked as { acquired: number }[])[0]?.acquired) !== 1)
        return c.json({ error: "debate_busy" }, 429);
      try {
        const hash = debateHash({ issuerId: ctx.issuerId, brief: input.brief });
        const [existing] = await db.query(
          "SELECT workspace_id,request_hash,status,output_json FROM dcf_debate_runs WHERE id=?",
          [input.runId]
        );
        const row = (
          existing as {
            workspace_id: string;
            request_hash: string;
            status: string;
            output_json: string | null;
          }[]
        )[0];
        if (row) {
          if (row.workspace_id !== ctx.workspaceId || row.request_hash !== hash)
            return c.json({ error: "run_conflict" }, 409);
          return c.json({
            status: row.status,
            result: row.output_json ? JSON.parse(row.output_json) : null,
            reused: true,
          });
        }
        const [count] = await db.query(
          "SELECT COUNT(*) AS n FROM dcf_debate_runs WHERE workspace_id=? AND created_at>UTC_TIMESTAMP()-INTERVAL 1 DAY",
          [ctx.workspaceId]
        );
        if (Number((count as { n: number }[])[0]?.n) >= 3)
          return c.json({ error: "daily_debate_limit" }, 429);
        await db.query(
          "INSERT INTO dcf_debate_runs(id,workspace_id,issuer_id,request_hash,status) VALUES(?,?,?,?,?)",
          [input.runId, ctx.workspaceId, ctx.issuerId, hash, "running"]
        );
      } finally {
        await db.query("SELECT RELEASE_LOCK(?)", [lock]);
      }
      const [jurisdiction, registryId] = ctx.issuerId.split(":");
      try {
        const snapshot = await deps.load(
          jurisdiction as "us" | "br",
          registryId,
          false
        );
        const result = await withExecutionScope(
          "dcf-swarm",
          input.runId,
          c.req.raw.signal,
          () =>
            deps.run(ctx.issuerId, snapshot, input.brief, input.runId, {
              signal: c.req.raw.signal,
              mode:availability.mode,
            }),
          100000
        );
        await db.query(
          "UPDATE dcf_debate_runs SET status=?,output_json=? WHERE id=? AND workspace_id=?",
          [result.status, JSON.stringify(result), input.runId, ctx.workspaceId]
        );
        return c.json({ status: result.status, result,mode:availability.mode });
      } catch {
        await db.query(
          "UPDATE dcf_debate_runs SET status=? WHERE id=? AND workspace_id=?",
          ["failed_closed", input.runId, ctx.workspaceId]
        );
        return c.json({ error: "debate_failed_sources_or_provider" }, 503);
      }
    } catch (e) {
      return c.json(
        {
          error:
            e instanceof AnalysisAccessError
              ? e.message
              : e instanceof z.ZodError
                ? "invalid_debate_request"
                : "debate_unavailable",
        },
        e instanceof AnalysisAccessError
          ? e.status
          : e instanceof z.ZodError
            ? 422
            : 503
      );
    } finally {
      await db?.end();
    }
  });
}
