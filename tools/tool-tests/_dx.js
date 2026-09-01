const { chromium } = require('playwright');
const fs=require('fs');
/* a realistic sparse file: quarterly-ish statement values, 29 rows over ~7y,
   dates irregular so some year-apart pairs DO land inside the tolerance */
(function(){
  const L=['Date,NAV']; let v=100;
  const dates=[];
  let t=Date.UTC(2017,6,3);
  for(let i=0;i<29;i++){ dates.push(t); t+=Math.round((80+(i%5)*8)*86400000); }
  // nudge some anniversaries so a few 6y windows land within tolerance
  dates[26]=Date.UTC(2023,6,1); dates[27]=Date.UTC(2023,9,1); dates[28]=Date.UTC(2024,5,28);
  let prev=dates[0];
  dates.forEach((d,i)=>{ if(i){ v*=Math.pow(1.10,(d-prev)/(365.2425*86400000)); } prev=d;
    L.push(new Date(d).toISOString().slice(0,10)+','+v.toFixed(4)); });
  fs.writeFileSync('/tmp/prc/sparse29.csv',L.join('\n'));
})();
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2})).newPage();
  p.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await p.goto('http://127.0.0.1:8781/tool/#rolling',{waitUntil:'networkidle'});
  await p.click('#r-source .chip[data-source="index"]'); await p.waitForTimeout(300);
  await p.click('#door-a'); await p.waitForTimeout(250);
  await p.setInputFiles('#bm-file','/tmp/prc/sparse29.csv'); await p.waitForTimeout(2000);
  console.log('freq chips:', (await p.locator('#r-freq .chip').allInnerTexts()).join(' | '));
  console.log('disabled  :', await p.locator('#r-freq .chip:disabled').count());
  await p.locator('#r-years .chip[data-years="5"]').click().catch(()=>0);
  await p.waitForTimeout(300);
  await p.click('#r-run'); await p.waitForTimeout(1500);
  const out=(await p.locator('#r-out').innerText()).replace(/\s+/g,' ');
  console.log('OUT:', out.slice(0,600));
  // the summary table clipping check
  const clip = await p.evaluate(()=>{
    const t=document.querySelector('#r-out .summary3'); if(!t) return 'no table';
    const wrap=t.closest('.scroll');
    return { tableW: Math.round(t.getBoundingClientRect().width),
             wrapW: Math.round(wrap.getBoundingClientRect().width),
             wrapScrollW: wrap.scrollWidth, clips: wrap.scrollWidth>wrap.clientWidth+1,
             bodyScrollX: document.documentElement.scrollWidth>window.innerWidth };
  });
  console.log('summary3:', JSON.stringify(clip));
  await p.screenshot({path:'/tmp/prc/shots/E1-sparse.png',fullPage:true});
  await b.close();
})();
