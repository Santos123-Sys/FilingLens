import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, cpSync, rmSync } from 'node:fs';
execFileSync('node', ['node_modules/vite/bin/vite.js','build'], {stdio:'inherit'});
await build({entryPoints:['worker/index.ts'],bundle:true,minify:true,platform:'node',format:'esm',target:'es2022',outfile:'dist/server/index.js',external:['node:*','fs','path','url','util','stream','crypto','http','https','zlib','buffer'],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire('/worker.js');"}});
rmSync('dist/client',{recursive:true,force:true});
cpSync('dist/public','dist/client',{recursive:true});
mkdirSync('dist/.openai',{recursive:true});
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
