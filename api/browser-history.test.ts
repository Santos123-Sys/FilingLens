import {describe,it,expect,vi} from "vitest";
import {Hono} from "hono";
import {registerBrowserHistoryApi} from "./browser-history";
function app(){const a=new Hono();registerBrowserHistoryApi(a);return a;}
describe("private history session boundaries",()=>{
 it("fails closed when missing storage configuration",async()=>{
  vi.stubEnv("HISTORY_COOKIE_SECRET","");vi.stubEnv("DATABASE_URL","");
  expect((await app().request("http://localhost/api/history/session")).status).toBe(503);
  vi.unstubAllEnvs();
 });
 it("requires a same-origin request to create a private workspace",async()=>{
  vi.stubEnv("HISTORY_COOKIE_SECRET","x".repeat(48));vi.stubEnv("DATABASE_URL","mysql://unreachable");vi.stubEnv("NODE_ENV","test");
  expect((await app().request("http://localhost/api/history/session",{method:"POST"})).status).toBe(403);
  expect((await app().request("http://localhost/api/history/session",{method:"POST",headers:{Origin:"https://attacker.example"}})).status).toBe(403);
  vi.unstubAllEnvs();
 });
 it("issues HttpOnly signed session only after opt-in and rejects forged cookies",async()=>{
  vi.stubEnv("HISTORY_COOKIE_SECRET","x".repeat(48));vi.stubEnv("DATABASE_URL","mysql://unreachable");vi.stubEnv("NODE_ENV","test");
  const a=app();
  const created=await a.request("http://localhost/api/history/session",{method:"POST",headers:{Origin:"http://localhost"}});
  expect(created.status).toBe(200);
  const cookie=created.headers.get("set-cookie")??"";
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  const token=cookie.split(";")[0];
  const active=await a.request("http://localhost/api/history/session",{headers:{Cookie:token}});
  expect((await active.json()).enabled).toBe(true);
  const forged=await a.request("http://localhost/api/history/session",{headers:{Cookie:token.slice(0,-2)+"ff"}});
  expect((await forged.json()).enabled).toBe(false);
  vi.unstubAllEnvs();
 });
 it("does not query storage for anonymous browser session",async()=>{
  vi.stubEnv("HISTORY_COOKIE_SECRET","x".repeat(48));vi.stubEnv("DATABASE_URL","mysql://unreachable");
  const a=app();
  expect((await a.request("http://localhost/api/history/company?jurisdiction=us&registryId=1234567890")).status).toBe(401);
  vi.unstubAllEnvs();
 });
});
