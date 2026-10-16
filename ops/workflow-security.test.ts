import {readFileSync,readdirSync} from 'node:fs';
import {it,expect} from 'vitest';
it('pins every workflow action and keeps PR validation free of deployment credentials',()=>{
 for(const file of readdirSync('.github/workflows').filter(p=>p.endsWith('.yml'))){
  const text=readFileSync('.github/workflows/'+file,'utf8');
  for(const [,action] of text.matchAll(/uses:\s*([^\s#]+)/g))expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
  expect(text).not.toContain('pull_request_target:');
 }
 const ci=readFileSync('.github/workflows/ci.yml','utf8');
 expect(ci).toContain('contents: read');expect(ci).toContain('persist-credentials: false');
 expect(ci).not.toContain('secrets.');expect(ci).not.toMatch(/(?:contents|actions|packages|id-token): write/);
 expect(ci).toContain('npm audit --omit=dev --audit-level=moderate');
});
