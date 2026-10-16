const {chromium,expect}=require(process.env.PLAYWRIGHT_TEST_MODULE||'@playwright/test');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const dataset=require('../public/evaluations/forecast-cohort-cvm.json');
const summary=require('../src/data/forecast-qualification-summary.json');
const server=spawn(process.execPath,['dist/railway.js'],{cwd:process.cwd(),env:{...process.env,PORT:'4181',NODE_ENV:'production'},stdio:'ignore'});
let browser;
(async()=>{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4181/api/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const results=[];
  const eligible=summary.byIssuer.filter(i=>[2023,2024,2025].every(y=>dataset.observations.some(o=>o.issuer===i.code&&o.fiscalYear===y&&o.value>0&&o.publishedOn<'2026-07-01')));
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:4181/valuation/validation');
    const panel=page.getByRole('region',{name:'Expanded forecast evidence · 60-company CVM cohort'});
    await expect(panel).toContainText('136 paired forecasts');
    await expect(panel).toContainText('26.84%');
    await expect(panel.getByRole('table').first()).toContainText('Historical selector v2');
    await page.getByLabel('Expanded forecast horizon').selectOption('4');
    await expect(panel).toContainText('Qualification at this horizon: comparison only');
    await expect(panel.getByRole('table').first()).toContainText('204,338');
    await panel.getByText('Coverage exclusions for this split and horizon',{exact:true}).click();
    await expect(panel).toContainText('missing retained target vintage: 15');
    await panel.getByText('One-year locked-test sectors and worst cases',{exact:true}).click();
    await expect(panel).toContainText('insufficient issuers');
    await page.getByLabel('Expanded forecast horizon').selectOption('1');
    await page.getByLabel('CVM scenario issuer').selectOption(eligible[0].code);
    await panel.getByRole('button',{name:'Inspect source-dated scenario',exact:true}).click();
    await expect(panel).toContainText('source cutoff 2026-07-01 (exclusive)');
    await expect(panel).toContainText('Historical cohort qualification does not guarantee this future result');
    const download=page.waitForEvent('download');
    await panel.getByRole('button',{name:'Export scenario, qualification and filing vintages'}).click();
    const exported=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));
    if(exported.proposal.issuer!==eligible[0].code||exported.proposal.forecasts.length!==5||!exported.observations.length||exported.qualification.qualifiedHorizons.join()!=='1')throw Error('Scenario export lost scope or sources');
    await page.getByLabel('Expanded forecast horizon').selectOption('2');
    await expect(panel).toContainText('This horizon is not qualified for an automatic proposal');
    // Ignore an old result after the issuer changes while the response is delayed.
    let release,entered;const gate=new Promise(r=>release=r),requestEntered=new Promise(r=>entered=r);
    await page.route('**/api/forecast/quality',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});});
    await panel.getByRole('button',{name:'Inspect source-dated scenario',exact:true}).click();await requestEntered;
    await page.getByLabel('CVM scenario issuer').selectOption(eligible[1].code);release();
    await expect(panel.getByRole('button',{name:'Export scenario, qualification and filing vintages'})).toHaveCount(0);
    await page.unroute('**/api/forecast/quality');
    await page.route('**/api/forecast/quality',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Evaluation unavailable; try again.'})}),{times:1});
    await panel.getByRole('button',{name:'Inspect source-dated scenario',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Evaluation unavailable');
    await panel.getByRole('button',{name:'Inspect source-dated scenario',exact:true}).click();await expect(panel.getByRole('button',{name:'Export scenario, qualification and filing vintages'})).toBeVisible();
    const allDownload=page.waitForEvent('download');await panel.getByRole('link',{name:'Download every forecast and exclusion'}).click();
    const all=JSON.parse(await fs.readFile(await(await allDownload).path(),'utf8'));
    if(all.cases.length!==3300||!all.cases.some(r=>r.status==='excluded')||all.datasetSha256!==summary.datasetSha256)throw Error('Full evidence export mismatch');
    await page.screenshot({path:`${process.env.QA_SCREENSHOT_DIR||'/tmp'}/forecast-qualification-${width}.png`});
    if(errors.length)throw Error(errors.join('\n'));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('Page overflows viewport');
    results.push({width,passed:['locked test matrix','horizon failure visibility','exclusions','sparse sectors','issuer scenario','qualification export','late-response invalidation','error recovery','full trace export','viewport fit']});
    await page.close();
  }
  console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill();});
