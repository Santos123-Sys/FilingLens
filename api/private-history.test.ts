import {describe,it,expect,vi} from "vitest";
import {Hono} from "hono";
import {registerPrivateHistory} from "./private-history";
describe("private history session security",()=>{
 it("fails closed when session key or DB is absent",async()=>{
  vi.stubEnv("HISTORY_SESSION_SECRET","");
  vi.stubEnv("DATABASE_URL","");
  const app=new Hono();registerPrivateHistory(app);
  expect((await app.request("/api/history/session")).status).toBe(503);
  vi.unstubAllEnvs();
 });
 it("issues a strict HttpOnly session cookie but requires CSRF for writes",async()=>{
  vi.stubEnv("HISTORY_SESSION_SECRET","x".repeat(64));vi.stubEnv("DATABASE_URL","mysql://unreachable");
  const app=new Hono();registerPrivateHistory(app);
  const r=await app.request("/api/history/session");
  expect(r.status).toBe(200);
  expect(r.headers.get("set-cookie")).toContain("HttpOnly");
  expect(r.headers.get("set-cookie")).toContain("SameSite=Strict");
  const cookie=r.headers.get("set-cookie")!.split(";")[0];
  expect((await app.request("/api/history/save",{method:"POST",headers:{"Cookie":cookie,"Content-Type":"application/json"},body:"{}"})).status).toBe(403);
  const session=await r.json() as {csrf:string};
  expect((await app.request("/api/history/save",{method:"POST",headers:{"Cookie":cookie,"Content-Type":"application/json","X-History-CSRF":session.csrf},body:"{}"})).status).toBe(400);
  vi.unstubAllEnvs();
 });
 it("rejects forged session cookies",async()=>{
  vi.stubEnv("HISTORY_SESSION_SECRET","x".repeat(64));vi.stubEnv("DATABASE_URL","mysql://unreachable");
  const app=new Hono();registerPrivateHistory(app);
  const r=await app.request("/api/history/mine",{headers:{"Cookie":"fl_history_session="+"a".repeat(64)+"."+"b".repeat(64)}});
  expect(r.status).toBe(401);
  vi.unstubAllEnvs();
 });
});
