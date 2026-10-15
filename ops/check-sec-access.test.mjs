import {describe,it,expect} from 'vitest';
import {assertSecAccessReviewed} from './check-sec-access.mjs';
describe('SEC access review gate',()=>{
 it('rejects paused, missing and malformed policies before any acquisition',()=>{
  for(const config of [null,{}, {schema:'filinglens.sec_acquisition_access.v1',state:'paused'},
   {schema:'filinglens.sec_acquisition_access.v1',state:'reviewed',reviewReference:'https://attacker.example/approved'}])
   expect(()=>assertSecAccessReviewed(config)).toThrow();
 });
 it('accepts an explicit repository review reference',()=>{
  expect(()=>assertSecAccessReviewed({schema:'filinglens.sec_acquisition_access.v1',state:'reviewed',
   reviewReference:'https://github.com/Santos123-Sys/FilingLens/issues/123'})).not.toThrow();
 });
});
