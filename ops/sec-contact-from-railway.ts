/**
 * Provision the already-configured SEC operator contact from Railway into one
 * manually triggered GitHub Actions job. GitHub OIDC authorizes the read;
 * the email does not need to be stored in a GitHub secret or committed to git.
 */
import {appendFile} from "node:fs/promises";
import {SEC_IMPORT_AUDIENCE} from "./railway-sec-oidc-importer";

const RAILWAY_CONTACT_URL="https://filinglens-sec-oidc-importer-production.up.railway.app/v1/sec/contact";
const requireEnv=(key:string):string=>{
 const value=process.env[key];
 if(!value)throw new Error(`Missing GitHub Actions environment ${key}`);
 return value;
};
export function validOperatorContact(value:unknown):value is string{
 return typeof value==="string"&&value.length<=160&&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)&&!/[\r\n]/.test(value);
}
export function safeOidcEndpoint(input:string):URL{
 const url=new URL(input);
 if(url.protocol!=="https:"||!url.hostname.endsWith(".actions.githubusercontent.com")||
  url.username||url.password||url.hash)throw new Error("Invalid GitHub OIDC origin");
 return url;
}
export async function provisionContact(request:typeof fetch=fetch){
 const endpoint=safeOidcEndpoint(requireEnv("ACTIONS_ID_TOKEN_REQUEST_URL"));
 endpoint.searchParams.set("audience",SEC_IMPORT_AUDIENCE);
 const tokenRes=await request(endpoint.toString(),{
  redirect:"error",signal:AbortSignal.timeout(15_000),
  headers:{Authorization:`bearer ${requireEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}`,
   Accept:"application/json"},
 });
 if(!tokenRes.ok)throw new Error("GitHub OIDC token request failed");
 const tokenResponse=await tokenRes.json() as {value?:unknown};
 if(typeof tokenResponse.value!=="string"||tokenResponse.value.length<100||
  tokenResponse.value.length>12_000)throw new Error("Missing GitHub OIDC token");
 const response=await request(RAILWAY_CONTACT_URL,{
  method:"GET",redirect:"error",signal:AbortSignal.timeout(15_000),
  headers:{Authorization:`Bearer ${tokenResponse.value}`,Accept:"application/json"},
 });
 if(!response.ok)throw new Error(`Railway contact lookup rejected (${response.status})`);
 const reply=await response.json() as {email?:unknown};
 if(!validOperatorContact(reply.email))throw new Error("Invalid or missing configured SEC contact");
 // Mask before writing the job-scoped variable. No email is printed to logs.
 process.stdout.write(`::add-mask::${reply.email}\n`);
 await appendFile(requireEnv("GITHUB_ENV"),`SEC_CONTACT_EMAIL=${reply.email}\n`,{encoding:"utf8"});
 process.stdout.write("SEC contact loaded securely from Railway for this workflow run.\n");
}
if(process.argv[1]?.endsWith("sec-contact-from-railway.ts"))
 provisionContact().catch(err=>{
  console.error("SEC_CONTACT_PROVISIONING_FAILED",err instanceof Error?err.message:"unknown");
  process.exitCode=1;
 });
