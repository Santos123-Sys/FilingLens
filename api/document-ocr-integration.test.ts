import { afterEach,describe,it,expect,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
vi.mock('./pdf',()=>({default:vi.fn(async()=>({text:' '}))}));
import { registerDocumentIntegration } from './document-integration';

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('scanned PDF integration',()=>{
  it('calls private OCR only after empty PDF text and validates original hash',async()=>{
    const bytes=Buffer.from('%PDF-synthetic-test');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    vi.stubEnv('FILINGLENS_CORPUS_TOKEN','x'.repeat(32));
    vi.stubEnv('FINANCIAL_DATA_SERVICE_URL','http://data-tools.internal:8000');
    const upstream=vi.fn(async(_url:string,init:RequestInit)=>{
      expect(_url).toBe('http://data-tools.internal:8000/v1/documents/ocr');
      expect(init.headers).toMatchObject({authorization:'Bearer '+'x'.repeat(32)});
      return Response.json({text:'Recognized disclosure text. '.repeat(8),sha256,parser:'ocrmypdf-17.13.0-tesseract-eng-por-v1',pageCount:1});
    });
    vi.stubGlobal('fetch',upstream);
    const api=new Hono();registerDocumentIntegration(api);
    const request={method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'x'.repeat(32)},body:JSON.stringify({base64:bytes.toString('base64'),name:'scan.pdf'})};
    const res=await api.request('/api/integration/v1/documents/extract',request);
    expect(res.status).toBe(200);
    expect((await res.json() as {sha256:string}).sha256).toBe(sha256);
    expect(upstream).toHaveBeenCalledTimes(1);
    upstream.mockImplementationOnce(async()=>Response.json({text:'Recognized disclosure text. '.repeat(8),sha256:'0'.repeat(64),parser:'ocr-v1',pageCount:1}));
    expect((await api.request('/api/integration/v1/documents/extract',request)).status).toBe(422);
  });
});
