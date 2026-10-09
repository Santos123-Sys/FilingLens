/**
 * Operator-only import for an official single-CIK JSON download from SEC
 * CompanyFacts. This code NEVER contacts the SEC and must not be used with a
 * mirror, model-generated payload or file of unknown provenance.
 *
 * DATABASE_URL="mysql://..." npx tsx ops/import-sec-companyfacts-json.ts \\
 *  --file /secure/CIK0000320193.json --cik 0000320193 --retrieved-day 2026-10-09
 */
import {readFile,stat} from "node:fs/promises";
import mysql from "mysql2/promise";
import {prepareSecOperatorJson} from "../contracts/sec-operator-json";
async function main(){
 const args=process.argv.slice(2);
 const permitted=new Set(["file","cik","retrieved-day"]);
 const values:Record<string,string>={};
 if(args.length!==6)throw new Error("required: --file PATH --cik 0000000000 --retrieved-day YYYY-MM-DD");
 for(let i=0;i<args.length;i+=2){
  const key=args[i]?.replace(/^--/,"");
  if(!args[i]?.startsWith("--")||!key||!permitted.has(key)||key in values||!args[i+1])
   throw new Error("invalid, unknown or duplicated import option");
  values[key]=args[i+1];
 }
 if(Object.keys(values).length!==3)throw new Error("missing import options");
 if(!process.env.DATABASE_URL)throw new Error("privileged DATABASE_URL required");
 const size=(await stat(values.file)).size;
 if(size<100||size>12_000_000)throw new Error("SEC JSON file size invalid");
 const bytes=await readFile(values.file);
 const prepared=prepareSecOperatorJson(values.cik,bytes,values["retrieved-day"]);
 const db=await mysql.createConnection(process.env.DATABASE_URL);
 try{
  await db.execute(`INSERT INTO sec_companyfacts_snapshots
  (cik,retrieved_day,archive_sha256,payload_sha256,source_url,payload_json)
  VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
  retrieved_day=VALUES(retrieved_day), archive_sha256=VALUES(archive_sha256),
  payload_sha256=VALUES(payload_sha256),source_url=VALUES(source_url),
  payload_json=VALUES(payload_json),imported_at=CURRENT_TIMESTAMP`,[
   prepared.cik,prepared.retrievedDay,prepared.sourceFileSha256,
   prepared.payloadSha256,prepared.sourceUrl,prepared.payloadJson,
  ]);
  console.log(JSON.stringify({imported:true,cik:prepared.cik,
   sourceMode:prepared.sourceMode,sourceUrl:prepared.sourceUrl,
   retrievedDay:prepared.retrievedDay,
   sourceFileSha256:prepared.sourceFileSha256,
   payloadSha256:prepared.payloadSha256}));
 }finally{await db.end();}
}
main().catch(e=>{
 console.error("SEC_SINGLE_JSON_IMPORT_FAILED",e instanceof Error?e.message:"unknown");
 process.exitCode=1;
});
