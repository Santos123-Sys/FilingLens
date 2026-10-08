import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerHistoryApi } from "./history-api";
describe("internal history auth gate",()=>{
 it("keeps history unavailable without DB and token",async()=>{
  vi.stubEnv("HISTORY_API_TOKEN","");
  vi.stubEnv("DATABASE_URL","");
  const app=new Hono();registerHistoryApi(app);
  const r=await app.request("/api/internal/history/company/1");
  expect(r.status).toBe(503);vi.unstubAllEnvs();
 });
 it("rejects unauthorized requests before DB access",async()=>{
  vi.stubEnv("HISTORY_API_TOKEN","a".repeat(40));
  vi.stubEnv("DATABASE_URL","mysql://unreachable");
  const app=new Hono();registerHistoryApi(app);
  expect((await app.request("/api/internal/history/company/1")).status).toBe(401);
  expect((await app.request("/api/internal/history/company/1",{headers:{Authorization:"Bearer wrong"}})).status).toBe(401);
  expect((await app.request("/api/internal/history/company/0",{headers:{Authorization:"Bearer "+"a".repeat(40)}})).status).toBe(400);
  vi.unstubAllEnvs();
 });
 it("rejects invalid ingestion payload before DB access",async()=>{
  vi.stubEnv("HISTORY_API_TOKEN","a".repeat(40));vi.stubEnv("DATABASE_URL","mysql://unreachable");
  const app=new Hono();registerHistoryApi(app);
  const r=await app.request("/api/internal/history/ingest",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+"a".repeat(40)},body:"{}"});
  expect(r.status).toBe(400);vi.unstubAllEnvs();
 });
});
