import { afterEach,describe,it,expect,vi } from 'vitest';
import { Hono } from 'hono';
import app from './boot';
import { corpusAuthorized,extractCorpusDocument,registerDocumentIntegration } from './document-integration';
afterEach(()=>vi.unstubAllEnvs());
describe('GPI document extraction boundary',()=>{
  it('fails closed without a valid dedicated bearer token',async()=>{
    expect(corpusAuthorized('Bearer x')).toBe(false);expect(corpusAuthorized('Bearer '+ 'x'.repeat(32),'x'.repeat(32))).toBe(true);
    const api=new Hono();registerDocumentIntegration(api);
    expect((await api.request('/api/integration/v1/documents/extract',{method:'POST',body:'{}'})).status).toBe(401);
  });
  it('preserves full long text and drops scripts while keeping table cell boundaries',async()=>{
    const input='<html><script>malicious instructions</script><table><tr><th>Period</th><th>USD millions</th></tr><tr><td>2025</td><td>100</td></tr></table>'+ ' narrative '.repeat(40000)+'</html>';
    const output=await extractCorpusDocument(Buffer.from(input),'report.html');
    expect(output.text.length).toBeGreaterThan(320000);expect(output.text).not.toContain('malicious instructions');expect(output.text).toContain('Period | USD millions |');
  });
  it('rejects executable/binary formats and insufficient extraction',async()=>{
    await expect(extractCorpusDocument(Buffer.from('x'.repeat(1000)),'run.exe')).rejects.toThrow();
    await expect(extractCorpusDocument(Buffer.from('%PDF-broken'),'report.pdf')).rejects.toThrow();
    await expect(extractCorpusDocument(Buffer.from('tiny'),'report.txt')).rejects.toThrow();
  });
  it('reaches the integration route through the actual Railway boot app',async()=>{
    registerDocumentIntegration(app);vi.stubEnv('FILINGLENS_CORPUS_TOKEN','x'.repeat(32));
    const res=await app.request('/api/integration/v1/documents/extract',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'x'.repeat(32)},body:JSON.stringify({base64:Buffer.from('Test document paragraph. '.repeat(20)).toString('base64'),name:'test.txt'})});
    expect(res.status).toBe(200);expect((await res.json() as {text:string}).text).toContain('Test document paragraph');
  });
});
