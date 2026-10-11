import {describe,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./sec-bulk-cache',()=>({cachedSecCompanyFacts:async()=>null}));
vi.mock('./regulatory-snapshot-store',()=>({readPublicRegulatorySnapshots:mock.read,persistPublicRegulatorySnapshot:async()=>false}));
vi.mock('./data-tools-client',()=>({dataToolsConfigured:()=>false,dataToolsJson:vi.fn()}));
import {loadPublicFinanceSnapshot} from './public-finance-api';
describe('regulator annual label snapshot compatibility',()=>{
 it('retains FY labels without inventing an issuer fiscal year end',async()=>{
  mock.read.mockResolvedValue([{snapshotDay:'2026-10-11',snapshotHash:'a'.repeat(64),jurisdiction:'us',registryId:'0000320193',provider:'sec_edgar',
   metrics:[2024,2025].map((year,i)=>({key:'revenue',year,value:100+i*10,unit:'USD',period:'FY'+year,status:'single_source',
    source:{provider:'sec_edgar',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',form:'10-K',period:'FY'+year,retrievedAt:'2026-10-11'}}))}]);
  const snapshot=await loadPublicFinanceSnapshot('us','0000320193',false);
  expect(snapshot?.facts).toHaveLength(2);
  expect(snapshot?.facts.map(f=>f.periodEnd)).toEqual([null,null]);
  expect(snapshot?.facts.map(f=>f.periodLabel)).toEqual(['FY2024','FY2025']);
  expect(snapshot?.issuer.registryId).toBe('0000320193');
 });
});

