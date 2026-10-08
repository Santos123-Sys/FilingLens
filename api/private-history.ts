import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import mysql from "mysql2/promise";
import { z } from "zod";
import { financialsSchema } from "../contracts/analysis";

const COOKIE="fl_history_session";
const companySchema=z.object({
 name:z.string().trim().min(1).max(255),ticker:z.string().nullable().optional(),
 filingType:z.string().max(64),periodEnd:z.string().max(32),
 filingReference:z.string().nullable().optional(),
});
const analysisSchema=z.object({
 jurisdiction:z.enum(["us","br"]),
 company:companySchema,
 financials:z.object({
  unit:z.string().max(100),
  years:z.array(z.string()).max(5),
  revenue:z.array(z.number().finite()).max(5),
  netIncome:z.array(z.number().finite()).max(5),
  annualHistory:financialsSchema.shape.financials.shape.annualHistory.optional(),
  validationFlags:financialsSchema.shape.financials.shape.validationFlags.optional(),
 }),
});
type Session={token:string;workspaceHash:string;csrf:string};
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const mac=(secret:string,message:string)=>createHmac("sha256",secret).update(message).digest("hex");
function safeEq(a:string,b:string):boolean{
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length && timingSafeEqual(x,y);
}
function sessionFromCookie(header:string|undefined,secret:string):Session|null {
 const value=header?.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
 const parts=value?.split(".");
 if(!parts||parts.length!==2||!/^[a-f0-9]{64}$/.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))return null;
 const token=parts[0];
 if(!safeEq(parts[1],mac(secret,token)))return null;
 return {token,workspaceHash:digest(token),csrf:mac(secret,token+":csrf")};
}
function safeWrite(c:{req:{header:(name:string)=>string|undefined}},session:Session):boolean{
 const site=c.req.header("Sec-Fetch-Site");
 if(site && site!=="same-origin" && site!=="none")return false;
 const csrf=c.req.header("X-History-CSRF")??"";
 return safeEq(csrf,session.csrf);
}
export function registerPrivateHistory(app:Hono) {
 app.get("/api/history/session",c=>{
  const secret=process.env.HISTORY_SESSION_SECRET;
  if(!secret || secret.length<32 || !process.env.DATABASE_URL)return c.json({error:"history_disabled"},503);
  let session=sessionFromCookie(c.req.header("Cookie"),secret);
  if(!session){
   const token=randomBytes(32).toString("hex");
   session={token,workspaceHash:digest(token),csrf:mac(secret,token+":csrf")};
   const cookie=`${COOKIE}=${token}.${mac(secret,token)}; Path=/api/history; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.NODE_ENV==="production"?"; Secure":""}`;
   c.header("Set-Cookie",cookie);
  }
  c.header("Cache-Control","no-store");
  return c.json({enabled:true,csrf:session.csrf,scope:"this-browser",retention:"session-cookie-30-days"});
 });
 app.use("/api/history/*",async(c,next)=>{
  if(c.req.path==="/api/history/session")return next();
  const secret=process.env.HISTORY_SESSION_SECRET;
  if(!secret || secret.length<32 || !process.env.DATABASE_URL)return c.json({error:"history_disabled"},503);
  const session=sessionFromCookie(c.req.header("Cookie"),secret);
  if(!session)return c.json({error:"history_session_required"},401);
  c.set("historySession" as never,session);
  c.header("Cache-Control","no-store");
  await next();
 });
 app.post("/api/history/save",async c=>{
  const secret=process.env.HISTORY_SESSION_SECRET!;
  const session=sessionFromCookie(c.req.header("Cookie"),secret)!;
  if(!safeWrite(c,session))return c.json({error:"csrf_denied"},403);
  if(Number(c.req.header("Content-Length")??0)>250000)return c.json({error:"payload_too_large"},413);
  const parsed=analysisSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"invalid_history_payload"},400);
  const {company,financials,jurisdiction}=parsed.data;
  if(!financials.years.length && !financials.annualHistory?.years.length)return c.json({error:"no_financial_periods"},422);
  const payload=JSON.stringify({jurisdiction,company,financials});
  if(Buffer.byteLength(payload,"utf8")>55000)return c.json({error:"payload_too_large"},413);
  const filingKeyHash=digest([jurisdiction,company.ticker??"",company.name,company.filingType,company.periodEnd,company.filingReference??""].join("|"));
  const db=await mysql.createConnection(process.env.DATABASE_URL!);
  try{
   const [rows]=await db.query("SELECT COUNT(*) AS n FROM private_analysis_history WHERE workspace_hash=?",[session.workspaceHash]);
   const count=Number((rows as Array<{n:number}>)[0]?.n??0);
   const [present]=await db.query("SELECT id FROM private_analysis_history WHERE workspace_hash=? AND filing_key_hash=? LIMIT 1",[session.workspaceHash,filingKeyHash]);
   if(count>=20 && !(present as unknown[]).length)return c.json({error:"history_quota_reached"},429);
   await db.query(`INSERT INTO private_analysis_history
    (workspace_hash,filing_key_hash,jurisdiction,issuer_name,period_end,payload_json)
    VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),saved_at=CURRENT_TIMESTAMP`,
    [session.workspaceHash,filingKeyHash,jurisdiction,company.name,company.periodEnd,payload]);
   return c.json({saved:true,scope:"this-browser",period:company.periodEnd});
  }catch(error){console.error("[private-history] save",error instanceof Error?error.name:"unknown");return c.json({error:"history_store_unavailable"},503);}
  finally{await db.end();}
 });
 app.get("/api/history/mine",async c=>{
  const session=sessionFromCookie(c.req.header("Cookie"),process.env.HISTORY_SESSION_SECRET!)!;
  const db=await mysql.createConnection(process.env.DATABASE_URL!);
  try{
   const [rows]=await db.query(`SELECT issuer_name,period_end,saved_at,payload_json
     FROM private_analysis_history WHERE workspace_hash=? ORDER BY saved_at DESC LIMIT 20`,[session.workspaceHash]);
   const items=(rows as Array<{issuer_name:string;period_end:string;saved_at:Date;payload_json:string}>).map(row=>({
    issuerName:row.issuer_name,periodEnd:row.period_end,savedAt:row.saved_at,
    analysis:JSON.parse(row.payload_json) as unknown,
   }));
   return c.json({scope:"this-browser",items});
  }catch(error){console.error("[private-history] read",error instanceof Error?error.name:"unknown");return c.json({error:"history_store_unavailable"},503);}
  finally{await db.end();}
 });
 app.delete("/api/history/mine",async c=>{
  const session=sessionFromCookie(c.req.header("Cookie"),process.env.HISTORY_SESSION_SECRET!)!;
  if(!safeWrite(c,session))return c.json({error:"csrf_denied"},403);
  const db=await mysql.createConnection(process.env.DATABASE_URL!);
  try{await db.query("DELETE FROM private_analysis_history WHERE workspace_hash=?",[session.workspaceHash]);return c.json({deleted:true});}
  catch(error){console.error("[private-history] delete",error instanceof Error?error.name:"unknown");return c.json({error:"history_store_unavailable"},503);}
  finally{await db.end();}
 });
}
