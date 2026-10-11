import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import pdfParse from './pdf';
import { dataToolsBaseUrl } from './data-tools-client';
import { classifyFiling } from './classification';

export function corpusAuthorized(header:string|undefined,token=process.env.FILINGLENS_CORPUS_TOKEN) {
  const actual=Buffer.from(header?.startsWith('Bearer ')?header.slice(7):'');
  const expected=Buffer.from(token??'');
  return expected.length>=32&&expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export async function extractCorpusDocument(bytes:Buffer,name:string) {
  if(!bytes.length||bytes.length>8_000_000)throw new Error('document_size_limit');
  let text:string,parser:string;
  if(bytes.subarray(0,5).toString()==='%PDF-') {
    const parsed=await pdfParse(bytes,{maxPages:1000,maxTextChars:2_000_000});text=parsed.text;parser='pdf-parse-1.1.1-fulltext-v1';
  } else {
    text=bytes.toString('utf8');parser='utf8-text-v1';
    if(/\.(html?|xhtml)$/i.test(name)||/^\s*(?:<!doctype html|<html)/i.test(text)) {
      text=text.replace(/<(script|style|ix:header)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
        .replace(/<\/(?:p|div|tr|h[1-6]|table)>/gi,'\n').replace(/<\/(?:td|th)>/gi,' | ')
        .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'')
        .replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'')
        .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');parser='html-text-v1';
    }else if(!/\.(txt|csv)$/i.test(name))throw new Error('unsupported_document');
  }
  text=text.replace(/\r\n/g,'\n').replace(/[ \t]+\n/g,'\n').trim();
  if(text.length<100||text.length>2_000_000||text.includes('\u0000'))throw new Error('unusable_text_or_ocr_required');
  return {text,parser,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const Upload=z.object({base64:z.string().min(1).max(10_666_672).regex(/^[A-Za-z0-9+/]*={0,2}$/),name:z.string().min(1).max(180)}).strict();
export function registerDocumentIntegration(app:Hono) {
  app.use('/api/integration/v1/documents/*',async(c,next)=>{
    c.header('Cache-Control','no-store');c.header('Vary','Authorization');
    if(!corpusAuthorized(c.req.header('Authorization')))return c.json({error:'unauthorized'},401);
    await next();
  });
  app.post('/api/integration/v1/documents/extract',async c=>{
    try{const input=Upload.parse(await c.req.json());return c.json(await extractCorpusDocument(Buffer.from(input.base64,'base64'),input.name));}
    catch{return c.json({error:'document_invalid_or_ocr_required'},422);}
  });
  for(const path of ['acquire','presentation'] as const)app.post(`/api/integration/v1/documents/${path}`,async c=>{
    const base=dataToolsBaseUrl();if(!base)return c.json({error:'data_tools_unavailable'},503);
    try{
      const raw=await c.req.text();if(Buffer.byteLength(raw)>200_000)return c.json({error:'payload_too_large'},413);
      const res=await fetch(`${base}/v1/documents/${path}`,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.FILINGLENS_CORPUS_TOKEN}`},body:raw,signal:AbortSignal.timeout(80_000)});
      if(!res.ok){await res.body?.cancel();return c.json({error:'document_service_failed'},503);}
      return new Response(res.body,{headers:{'Content-Type':path==='presentation'?'application/vnd.openxmlformats-officedocument.presentationml.presentation':'application/json','Cache-Control':'no-store','Content-Disposition':path==='presentation'?'attachment; filename="GPI-Research.pptx"':'inline'}});
    }catch{return c.json({error:'document_service_unavailable'},503);}
  });
  // A short-lived, unguessable, single-use handle; the owner-scoped source is resolved by GPI.
  app.post('/api/gpi-handoff',async c=>{
    try{
      const body=z.object({ticket:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await c.req.json());
      const base=new URL(process.env.GPI_API_URL??'');
      if(base.protocol!=='https:'||base.pathname!=='/'||base.username||base.password||base.search||base.hash)throw new Error();
      const res=await fetch(new URL('/api/corpus/handoff',base),{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.FILINGLENS_CORPUS_TOKEN}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
      if(!res.ok){await res.body?.cancel();return c.json({error:'handoff_expired_or_unavailable'},404);}
      const data=z.object({text:z.string().min(100).max(500_000),jurisdiction:z.enum(['us','br']),company:z.string(),documents:z.array(z.unknown()).max(120)}).parse(await res.json());
      return c.json({...data,classification:{...classifyFiling(data.text,data.jurisdiction),needsConfirmation:true}},{headers:{'Cache-Control':'no-store'}});
    }catch{return c.json({error:'handoff_unavailable'},503);}
  });
}
