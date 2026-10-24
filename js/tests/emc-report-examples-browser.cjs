const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||undefined,args:['--no-sandbox']});try{
for(const kind of ['category','selection'])for(const width of [1440,390,320]){
const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('assets/reports/report.html?example='+kind,process.env.EMC_TEST_URL||'http://127.0.0.1:5173/').href);await page.waitForFunction(k=>document.documentElement.dataset.reportReady===k,kind);await page.waitForTimeout(200);
assert.match(await page.locator('.example-notice').innerText(),/报告示例/);assert.ok(await page.locator('#reportContent').innerText());
if(kind==='category')assert.equal(await page.locator('[_echarts_instance_]').count(),4);else{await page.waitForFunction(()=>document.querySelectorAll('.navdot').length===5);assert.equal(await page.locator('.navdot').count(),5);}
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:`/tmp/emc-report-${kind}-${width}.png`});await page.close();console.log('PASS',kind,width);}
const page=await browser.newPage();await page.goto(new URL('assets/reports/report.html?example=../../private',process.env.EMC_TEST_URL||'http://127.0.0.1:5173/').href);await page.locator('.report-error').waitFor();console.log('PASS rejects unknown report');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
