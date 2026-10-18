const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || '@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const dataset = require('../public/evaluations/five-year-cohort-cvm-v3.json');
const summary = require('../src/data/five-year-qualification-summary.json');
const server = spawn(process.execPath, ['dist/railway.js'], {
  cwd: process.cwd(), env: { ...process.env, PORT: '4183', NODE_ENV: 'production' }, stdio: 'ignore',
});
let browser;
async function downloadJson(page, button) {
  const event = page.waitForEvent('download');
  await button.click();
  return JSON.parse(await fs.readFile(await (await event).path(), 'utf8'));
}
(async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:4183/api/status')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const results = [];
  const eligible = dataset.cohort.filter(i => [2021, 2022, 2023, 2024, 2025].every(y => dataset.observations.some(o => o.issuer === i.code && o.fiscalYear === y && o.value > 0 && o.publishedOn < '2026-07-01')));
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4183/valuation/validation');
    const panel = page.getByRole('region', { name: 'Five-year planning and horizon evidence' });
    await expect(panel).toContainText('120 previously unused CVM');
    await expect(panel).toContainText('113.88');
    await expect(panel).toContainText('Empirical precision is not established for years 3–5');
    await expect(panel.getByRole('table').first().locator('tbody tr')).toHaveCount(5);
    await panel.getByText('Forward accuracy tracking · outcomes pending, not proven',{exact:true}).click();
    await expect(panel).toContainText('91 eligible and 29 retained exclusions');
    await expect(panel).toContainText('Registration independently observed by GitHub');
    await expect(panel).toContainText('Reporting year not complete');
    await expect(panel.getByRole('link',{name:'Inspect successful CI timestamp receipt'})).toHaveAttribute('href','https://github.com/Santos123-Sys/FilingLens/actions/runs/39115630450');
    await expect(panel.getByRole('table').nth(1).locator('tbody tr')).toHaveCount(5);
    const watch=await downloadJson(page,panel.getByRole('link',{name:'Download frozen forward forecasts'}));
    if(watch.payload.forecasts.length!==91||watch.payload.exclusions.length!==29||!watch.digest)throw Error('Forward cohort denominator lost');
    await panel.getByText('Forward accuracy tracking · outcomes pending, not proven',{exact:true}).click();
    await panel.getByLabel('Five-year model issuer', { exact: true }).selectOption(eligible[0].code);
    const build = panel.getByRole('button', { name: 'Build source-dated five-year plan', exact: true });
    await build.focus(); await page.keyboard.press('Enter');
    await expect(panel).toContainText('source cutoff 2026-07-01 (exclusive)');
    await expect(panel.getByRole('table').nth(1).locator('tbody tr')).toHaveCount(5);
    const sourceExport = await downloadJson(page, panel.getByRole('button', { name: 'Export five-year scenario and evidence' }));
    if (sourceExport.rows.length !== 5 || sourceExport.modelBands.length !== 5 || !sourceExport.modelReference.trainingIds.length || sourceExport.reviewStatus !== 'draft') throw Error('Model export lost evidence or review status');
    if(sourceExport.modelBands.slice(2).some(b=>b.interval!==null||b.status!=='withheld_failed_horizon_precision_gate'))throw Error('Failed precision escaped in export');
    await expect(panel).toContainText('Precision gate enforced: years 3–5 are planning-only');
    await expect(panel.getByRole('table').nth(1)).toContainText('Withheld · precision gate failed');
    await panel.getByLabel('Planning growth year 1', { exact: true }).fill('0');
    await expect(panel).toContainText('Edited scenario: empirical bands');
    const editedExport = await downloadJson(page, panel.getByRole('button', { name: 'Export five-year scenario and evidence' }));
    if (editedExport.modelBands !== null || editedExport.evidenceStatus !== 'edited_or_manual_no_empirical_calibration' || editedExport.intervals !== null) throw Error('Edited plan retained calibration');
    await panel.getByLabel('Review five-year planning assumptions').check();
    await panel.getByLabel('Planning growth year 2', { exact: true }).fill('1');
    await expect(panel.getByLabel('Review five-year planning assumptions')).not.toBeChecked();
    await panel.getByLabel('Five-year forecast origin').fill('2010-07-01'); await build.click();
    await expect(panel.getByRole('status')).toContainText('Five consecutive positive annual inputs are required');
    await panel.getByLabel('Five-year forecast origin').fill('2026-08-01'); await build.click();
    await expect(panel.getByRole('alert')).toContainText('July');
    await panel.getByLabel('Five-year forecast origin').fill('2026-07-01');
    let release, entered;
    const gate = new Promise(r => release = r), requestEntered = new Promise(r => entered = r);
    await page.route('**/api/forecast/plan', async route => { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); });
    await build.click(); await requestEntered;
    await panel.getByLabel('Five-year model issuer', { exact: true }).selectOption(eligible[1].code); release();
    await expect(panel.getByRole('button', { name: 'Export five-year scenario and evidence' })).toHaveCount(0);
    await page.unroute('**/api/forecast/plan');
    await page.route('**/api/forecast/plan', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Evaluation unavailable; retry.' }) }), { times: 1 });
    await build.click(); await expect(panel.getByRole('alert')).toContainText('Evaluation unavailable');
    await build.click(); await expect(panel.getByRole('button', { name: 'Export five-year scenario and evidence' })).toBeVisible();
    const full = await downloadJson(page, panel.getByRole('link', { name: 'Download five-year test, calibration references and exclusions' }));
    if (full.cases.length !== 1800 || full.datasetSha256 !== summary.datasetSha256 || !full.cases.some(c => c.status === 'excluded')) throw Error('Full trace mismatch');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('Validation page overflows viewport');
    await panel.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR || '/tmp'}/five-year-evidence-${width}.png` });
    await page.goto('http://127.0.0.1:4183/valuation/reference/apple');
    const value = page.getByRole('button', { name: 'Inspect Implied value/share', exact: true });
    await expect(value).toContainText('118.74');
    const apply = page.getByRole('button', { name: 'Apply reviewed five-year drivers to DCF', exact: true });
    await expect(apply).toBeDisabled();
    for (let i = 1; i <= 5; i++) await page.getByLabel(`Planning growth year ${i}`, { exact: true }).fill('0');
    await expect(value).toContainText('118.74');
    await page.getByLabel('Five-year scenario rationale').fill('Zero growth sensitivity: keep revenue flat for five years.');
    await expect(apply).toBeDisabled();
    await page.getByLabel('Review five-year planning assumptions').check();
    await apply.focus(); await page.keyboard.press('Enter');
    await expect(value).toHaveCount(0);
    await expect(page.getByLabel('Terminal incremental ROIC', { exact: true })).toHaveValue('20');
    await page.getByRole('button', { name: 'Calculate valuation', exact: true }).click();
    await expect(value).toBeVisible();
    if ((await value.textContent()).includes('118.74')) throw Error('Applied five-year drivers failed to change valuation');
    const audit = await downloadJson(page, page.getByRole('button', { name: 'Export assumptions, sources and calculations', exact: true }));
    const ledger = audit.valuation?.assumptions?.dcf;
    if (!ledger) throw Error(`Audit assumptions missing: ${Object.keys(audit).join(',')}`);
    const growth = ledger.filter(r => /^dcf\.revenue_growth_y[1-5]$/.test(r.id));
    if (growth.length !== 5 || growth.some(r => r.final_value !== 0 || r.confidence !== 'low' || !r.rationale.includes('empirical bands and cohort qualification do not transfer'))) throw Error('Reviewed driver audit missing');
    await page.getByLabel('Planning growth year 5', { exact: true }).fill('25');
    await expect(page.getByText(/Year-five growth differs from the reviewed terminal growth/)).toBeVisible();
    await expect(page.getByLabel('Review five-year planning assumptions')).not.toBeChecked();
    await expect(value).toBeVisible(); // Separate draft edits do not silently change the applied ledger.
    await page.getByLabel('Planning growth year 1', { exact: true }).fill('');
    await expect(apply).toBeDisabled();
    await expect(page.getByText('Blank rates are not treated as zero.', { exact: false })).toBeVisible();
    await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR || '/tmp'}/five-year-dcf-${width}.png` });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
      throw Error('DCF page overflows viewport');
    }
    if (errors.length) throw Error(errors.join('\n'));
    results.push({ width, passed: ['five-horizon evidence and precision limits', 'source-dated path', 'exports and edit invalidation', 'missing history / invalid date', 'stale response suppression', 'error recovery', 'review-only DCF transfer', 'recalculation and ledger audit', 'terminal warning', 'keyboard controls', 'viewport fit'] });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill(); });
