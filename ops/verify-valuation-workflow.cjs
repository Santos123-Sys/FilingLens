const {chromium,expect}=require(process.env.PLAYWRIGHT_TEST_MODULE||'@playwright/test');
const fs=require('node:fs/promises');
const {spawn}=require('node:child_process');
const server=spawn(process.execPath,['dist/railway.js'],{cwd:process.cwd(),env:{...process.env,PORT:'4177',NODE_ENV:'production'},stdio:'ignore'});
(async()=>{
for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:4177/api/status');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4177/valuation/reference/apple');
 await expect(page.getByRole('button',{name:'Inspect Implied value/share',exact:true})).toBeVisible();
 const trigger=page.getByRole('button',{name:'Inspect Revenue FY2025',exact:true});await trigger.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog')).toContainText('416,161');
 await expect(page.getByRole('dialog').getByRole('link',{name:'Open original source'})).toHaveAttribute('href','https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf');
 await expect(page.getByRole('dialog')).toContainText('FY2025');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await page.getByRole('button',{name:'Inspect Implied value/share',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Equity value / valuation-date diluted shares');
 await page.getByRole('dialog').getByRole('button',{name:/^Equity value:/}).click();
 await expect(page.getByRole('dialog')).toContainText('Enterprise value − net debt');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Save session version',exact:true}).click();
 await page.getByLabel('Terminal incremental ROIC',{exact:true}).fill('15');
 await expect(page.getByRole('button',{name:'Inspect Implied value/share',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Calculate valuation',exact:true}).click();
 await expect(page.getByRole('button',{name:'Inspect Implied value/share',exact:true})).toBeVisible();
 const adjusted=await page.getByRole('button',{name:'Inspect Implied value/share',exact:true}).textContent();
 if(adjusted.includes('118.74'))throw Error('Changed terminal ROIC did not alter valuation');
 await page.getByRole('button',{name:'Restore version 1',exact:true}).click();
 await expect(page.getByLabel('Terminal incremental ROIC',{exact:true})).toHaveValue('20');
 await expect(page.getByRole('button',{name:'Inspect Implied value/share',exact:true})).toContainText('118.74');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export assumptions, sources and calculations',exact:true}).click();const download=await downloadEvent;const data=JSON.parse(await fs.readFile(await download.path(),'utf8'));
 if(data.lineage.nodes['actual:revenue:1'].sources[0].url!=='https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf')throw Error('Export source lost');
 if(data.lineage.calculationVersion!=='fcff-roic.v2')throw Error('Export calculation version missing');
 await page.screenshot({path:`${process.env.QA_SCREENSHOT_DIR||'/tmp'}/valuation-${width}.png`,fullPage:false});
 if(errors.length)throw Error(errors.join('\n'));
 results.push({width,passed:['reported evidence','keyboard return','formula lineage','edit invalidation','recalculation','version recovery','audit export'],nodes:Object.keys(data.lineage.nodes).length});await page.close();
}
await browser.close();server.kill();console.log(JSON.stringify(results,null,2));
})().catch(e=>{server.kill();console.error(e);process.exit(1)});
