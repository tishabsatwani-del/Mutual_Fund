const { chromium } = require('playwright');
/* Where screenshots and generated test files go. */
const fs = require('fs');
const TMP = process.env.PRC_TMP || '/tmp/prc';
const CHROME = process.env.PRC_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE_URL = process.env.PRC_URL || 'http://127.0.0.1:8781/tool/';
let pass=0; const fails=[];
function ok(n,c,d){ if(c){pass++;console.log('  pass  '+n);} else {fails.push(n);console.log('  FAIL  '+n+(d?'  -- '+d:''));} }
fs.mkdirSync(TMP + '/shots', { recursive: true });
(async()=>{
  const b=await chromium.launch({executablePath: CHROME});
  const c=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE_URL + '#portfolio',{waitUntil:'networkidle'});
  /* The screen is a door now; typing is behind "No file to hand?". */
  await p.click('#pf-manual');
  await p.waitForTimeout(200);

  await p.selectOption('#pf-group','on');
  ok('naming a holding is offered once grouping is on', await p.locator('#pf-rows .in-tag').first().isVisible());

  /* Fund A: a big, early, mediocre holding.  Fund B: a small, late, brilliant one.
     Each fund's own return is known; the portfolio must NOT be their average. */
  const rows=p.locator('#pf-rows .entry');
  const data=[
    ['2021-01-01','Money in','500000','Fund A'],
    ['2026-01-01','Worth today','700000','Fund A'],
    ['2025-01-01','Money in','50000','Fund B'],
    ['2026-01-01','Worth today','75000','Fund B'],
  ];
  for (let i=0;i<data.length;i++){
    if (await rows.count() <= i) await p.click('#pf-add');
    const r=rows.nth(i);
    await r.locator('.in-date').fill(data[i][0]);
    await r.locator('.in-kind').selectOption(data[i][1]);
    await r.locator('.in-amt').fill(data[i][2]);
    await r.locator('.in-tag').fill(data[i][3]);
  }
  while (await rows.count() > data.length) await rows.nth(data.length).locator('.del').click();

  await p.click('#pf-calc');
  await p.waitForSelector('#pf-out .result');
  const txt=await p.locator('#pf-out').innerText();
  ok('each holding is measured on its own', /Fund A/.test(txt) && /Fund B/.test(txt), txt.slice(0,200));
  ok('the whole portfolio is shown on the same table', /whole portfolio/i.test(txt));

  /* Fund A: 500000 -> 700000 over 5 years = 6.96%/yr.  Fund B: 50000 -> 75000 over 1 year = 50%.
     Portfolio XIRR must sit near A, not near the midpoint of 6.96 and 50. */
  const cells = await p.locator('#pf-out table.data tr').allInnerTexts();
  const row = cells.find(t=>/whole portfolio/i.test(t));
  const portfolio = parseFloat(row.match(/(-?\d+\.\d)%/)[1]);
  const a = parseFloat(cells.find(t=>/^Fund A/.test(t)).match(/(-?\d+\.\d)%/)[1]);
  const bb = parseFloat(cells.find(t=>/^Fund B/.test(t)).match(/(-?\d+\.\d)%/)[1]);
  ok('Fund A alone measures 7.0%', Math.abs(a-7.0)<0.15, 'got '+a);
  ok('Fund B alone measures 50.0%', Math.abs(bb-50.0)<0.15, 'got '+bb);
  ok('the portfolio is money-weighted, not an average of the funds',
     portfolio > a && portfolio < 12 && Math.abs(portfolio-(a+bb)/2) > 10, 'portfolio '+portfolio);
  console.log('    Fund A '+a+'%,  Fund B '+bb+'%,  portfolio '+portfolio+'%  (simple average would be '+((a+bb)/2).toFixed(1)+'%)');
  await p.locator('#pf-out').screenshot({path:TMP + '/shots/10-grouped.png'});
  ok('no script errors', errs.length===0, errs.join('|'));
  await b.close();
  console.log('\n'+pass+' passed, '+fails.length+' failed');
  if(fails.length) process.exit(1);
})();
