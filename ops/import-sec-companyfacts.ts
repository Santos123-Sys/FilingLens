/**
 * Offline operator task: import one or more CIKs from SEC's full official companyfacts.zip.
 * Fetch the ZIP through permitted SEC access, then run this CLI with a privileged
 * DATABASE_URL. Does NOT request or circumvent blocked SEC data APIs.
 *
 * DATABASE_URL=mysql://... npx tsx ops/import-sec-companyfacts.ts \
 *   --archive /secure/companyfacts.zip --cik 0000320193 --retrieved-day 2026-10-08
 */
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import mysql from "mysql2/promise";
import {verifyBulkMember,parseBulkCiks,OFFICIAL_COMPANYFACTS_ARCHIVE} from "../contracts/sec-bulk-import";
async function sha256File(path:string){
 const hash=createHash("sha256");
 for await(const data of createReadStream(path))hash.update(data);
 return hash.digest("hex");
}
async function main(){
 const args=process.argv.slice(2);
 const value=(key:string)=>{const i=args.indexOf("--"+key);return i<0?undefined:args[i+1]};
 const archive=value("archive"),day=value("retrieved-day");
 const ciks=parseBulkCiks(value("cik"),value("ciks"));
 if(!archive||!day||!/^20\d{2}-\d{2}-\d{2}$/.test(day))
  throw new Error("Required: --archive <official companyfacts.zip> (--cik CIK | --ciks CIK,CIK) --retrieved-day YYYY-MM-DD");
 const url=process.env.DATABASE_URL;
 if(!url)throw new Error("Privileged DATABASE_URL required (not the restricted app DB user)");
 const age=(Date.now()-Date.parse(day+"T00:00:00Z"))/86400000;
 if(!Number.isFinite(age)||age<0||age>14)throw new Error("SEC bulk archive date must be within 14 days");
 if((await stat(archive)).size<100000)throw new Error("Official SEC ZIP archive unexpectedly small");
 const archiveSha256=await sha256File(archive);
 // Validate EVERY selected member before writing any database row.
 // The archive hash binds all imported company members to the same operator source.
 const verified=ciks.map(cik=>{
  const raw=execFileSync("unzip",["-p",archive,"CIK"+cik+".json"],{
    encoding:"buffer",maxBuffer:12_000_000,timeout:180000,
  }) as Buffer;
  return {cik,...verifyBulkMember(cik,raw)};
 });
 const conn=await mysql.createConnection(url);
 try{
  await conn.beginTransaction();
  for(const {cik,payloadJson,payloadSha256} of verified){
   await conn.execute(`INSERT INTO sec_companyfacts_snapshots
    (cik,retrieved_day,archive_sha256,payload_sha256,source_url,payload_json)
    VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
    retrieved_day=VALUES(retrieved_day),archive_sha256=VALUES(archive_sha256),
    payload_sha256=VALUES(payload_sha256),source_url=VALUES(source_url),
    payload_json=VALUES(payload_json),imported_at=CURRENT_TIMESTAMP`,
    [cik,day,archiveSha256,payloadSha256,OFFICIAL_COMPANYFACTS_ARCHIVE,payloadJson]);
  }
  await conn.commit();
  console.log(JSON.stringify({imported:true,count:verified.length,ciks,
   retrievedDay:day,archiveSha256,source:OFFICIAL_COMPANYFACTS_ARCHIVE}));
 }catch(e){
  await conn.rollback();
  throw e;
 }finally{await conn.end();}
}
main().catch(e=>{console.error("SEC bulk import failed",e instanceof Error?e.message:"unknown");process.exitCode=1;});
