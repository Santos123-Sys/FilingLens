import {createRequire} from "node:module";
import type {MarketResult} from "../contracts/analysis";
import {APPLE_2025_DISCLOSURE,issuerApple2025Point,issuerSourceHash,verifyIssuerApple2025Point} from "../contracts/issuer-statement-proof";
import type {IssuerDisclosureDocument} from "../contracts/issuer-statement-proof";
const requireNode=createRequire(import.meta.url);
type PdfParser=(bytes:Buffer)=>Promise<{text:string;numpages:number}>;
type Profile=NonNullable<NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"]>[number];
const MAX_PDF=12_000_000;
let cached:{value:IssuerDisclosureDocument;expiresAt:number}|null=null;
let unavailableUntil=0;

/** Only Apple-owned, static disclosure URL; never fetch a model-supplied link. */
export async function fetchAppleIssuerDisclosure(
 requester:typeof fetch=fetch):Promise<IssuerDisclosureDocument|null>{
 if(cached&&Date.now()<cached.expiresAt)return cached.value;
 if(Date.now()<unavailableUntil)return null;
 try{
  const url=APPLE_2025_DISCLOSURE.url;
  const response=await requester(url,{method:"GET",redirect:"error",
   headers:{"Accept":"application/pdf"},signal:AbortSignal.timeout(25_000)});
  if(!response.ok)throw new Error("issuer_pdf_http_"+response.status);
  if(response.url!==url)throw new Error("issuer_pdf_origin_mismatch");
  if(!response.headers.get("content-type")?.toLowerCase().includes("pdf"))
   throw new Error("issuer_pdf_content_type_mismatch");
  if(Number(response.headers.get("content-length")??0)>MAX_PDF||!response.body)
   throw new Error("issuer_pdf_length_invalid");
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const part=await reader.read();if(part.done)break;
   if(part.value){total+=part.value.byteLength;
    if(total>MAX_PDF)throw new Error("issuer_pdf_oversized");
    chunks.push(part.value);}
  }}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks);
  if(bytes.length<1000||!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))
   throw new Error("issuer_pdf_signature_invalid");
  const parse=requireNode("pdf-parse") as PdfParser;
  const doc=await parse(bytes);
  if(!doc||doc.numpages<3||doc.numpages>8||
   typeof doc.text!=="string"||doc.text.length>400_000)
   throw new Error("issuer_pdf_parsing_invalid");
  const value={url,text:doc.text,sha256:issuerSourceHash(bytes),
   retrievedAt:new Date().toISOString()};
  cached={value,expiresAt:Date.now()+86400000};
  return value;
 }catch(error){
  const tag=error instanceof Error?error.name+":"+error.message.slice(0,160):"unknown";
  // Only fixed public URL and status/error class are logged. No private data.
  console.warn("[issuer-pdf-proof] failed closed:",tag);
  unavailableUntil=Date.now()+3600000;
  return null;
 }
}
export async function corroborateIssuerPublishedPeers(
 profiles:Profile[],opts:{retrieve?:()=>Promise<IssuerDisclosureDocument|null>}={}
):Promise<Profile[]>{
 const applicable=profiles.some(p=>(p.dataPoints??[]).some(x=>issuerApple2025Point(p.name,x)));
 if(!applicable)return profiles;
 let document:IssuerDisclosureDocument|null=null;
 try{document=await (opts.retrieve??fetchAppleIssuerDisclosure)();}
 catch{document=null;}
 return profiles.map(peer=>({...peer,
  ...(peer.dataPoints?{dataPoints:peer.dataPoints.map(point=>{
   if(!issuerApple2025Point(peer.name,point))return point;
   // A contradictory official SEC proof must never be silently overridden.
   if(["amount_mismatch","identity_mismatch","source_mismatch"].includes(
     point.primaryVerification?.status??""))return point;
   return {...point,issuerVerification:verifyIssuerApple2025Point(peer.name,point,document)};
  })}:{})
 }));
}
