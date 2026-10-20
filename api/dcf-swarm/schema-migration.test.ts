import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {DEBATE_DDL} from './routes';
it('the dedicated migrator creates the exact debate schema and exits before credential operations',()=>{
 const code=readFileSync(new URL('../../ops/phase1-schema-migrator.ts.txt',import.meta.url),'utf8'),normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
 expect(normalize(code)).toContain(normalize(DEBATE_DDL));
 const branch=code.slice(code.indexOf("if(Bun.env.DCF_SCHEMA_ONLY==='true')"),code.indexOf('const statements ='));
 expect(branch).toContain('dcf_live_evaluations');expect(branch).toContain("console.log('DCF_SCHEMA_VERIFIED');return;");expect(branch).not.toMatch(/CREATE USER|ALTER USER|GRANT /);
});
