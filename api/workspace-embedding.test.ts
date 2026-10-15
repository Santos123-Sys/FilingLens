import {describe,it,expect} from 'vitest';
import {framePolicy} from './workspace-embedding';
import {publicationNotice} from '../src/lib/workspace-bridge';
const id='flv1_'+'a'.repeat(64);
describe('unified workspace origin boundaries',()=>{
 it('permits only the configured HTTPS root to frame the app',()=>{
  expect(framePolicy('https://gpi.example/')).toBe("frame-ancestors 'self' https://gpi.example");
  for(const url of ['http://gpi.example','https://user:password@gpi.example','https://gpi.example/path','https://gpi.example/#bad',undefined])expect(framePolicy(url)).toBe("frame-ancestors 'none'");
 });
 it('notifies exactly the server return origin without tickets or financial inputs',()=>{
  expect(publicationNotice('https://gpi.example/#valuation='+id+'&candidate=XNAS%3AAAPL',id)).toEqual({origin:'https://gpi.example',event:{type:'filinglens.valuation.published.v1',candidateKey:'XNAS:AAPL',valuationVersionId:id}});
  for(const url of ['https://gpi.example/#candidate=XNAS:AAPL','javascript:alert(1)','https://user:secret@gpi.example/#valuation='+id+'&candidate=XNAS:AAPL'])expect(publicationNotice(url,id)).toBeNull();
  expect(publicationNotice('https://gpi.example/#valuation='+id+'&candidate=XNAS:AAPL','flv1_'+'b'.repeat(64))).toBeNull();
 });
});
