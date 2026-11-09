'use strict';

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('./environment.cjs'),R=require('./uiux-routes.cjs');
const presets=path.join(__dirname,'uiux-baselines');
const requiredTokens=['canvas','surface','text','muted','border','brand','danger','warning','success','focus',
 'title','section','body','caption','gap','radius','control','touch'];
const core=new Set(['login','overview','inventory','map','customers','sales','receipts','receipt-new','preparation','arrivals',
 'loading-search','outbounds','metal','stocktakes','reports','accounts','permissions','audit']);
const deniedCases=new Set([
 'logistics_field_operator/CU_CATHODE/receipts', 'logistics_field_operator/CU_CATHODE/receipt-new',
 'site_supervisor/CU_CATHODE/receipts', ...R.BOTH.flatMap(product=>[
  'production_manager/'+product+'/stocktakes', 'production_operator/'+product+'/permissions', 'production_operator/'+product+'/audit'
 ])
]);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function lint(){
 const css=fs.readFileSync(path.join(E.root,'dist/uiux-governance.css'),'utf8');
 const root=css.match(/:root\s*\{([^}]+)\}/)?.[0];
 assert(root,'Shared tokens must be declared in :root');
 const tokens=[...root.matchAll(/(--uix-[\w-]+)\s*:/g)].map(m=>m[1]);
 assert.equal(new Set(tokens).size,tokens.length,'Duplicate token declaration');
 for(const token of requiredTokens)assert(tokens.includes('--uix-'+token),'Missing design token: '+token);
 const rules=css.replace(root,'');
 for(const token of tokens)assert(rules.includes('var('+token+')'),'Unused design token '+token);
 assert(!/font-size\s*:\s*(?:\d|\.)/.test(rules),'Use tokens for shared font sizes');
 assert(!/#[0-9a-f]{3,8}\b(?=\s*[;}])/i.test(rules),'Use tokens for shared color values');
 assert(!/!important\b/.test(rules),'Use a narrowly scoped selector for governance styles');
 for(const block of rules.matchAll(/\{([^{}]+)\}/g)){
  const names=[...block[1].matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map(m=>m[1]);
  assert.equal(new Set(names).size,names.length,'Duplicate declaration in governance rule');
 }
 const {pages}=R,inventory=pages({});
 assert.equal(new Set(inventory.map(row=>row.key)).size,inventory.length,'Duplicate audit scenario key');
 for(const key of core)assert(inventory.some(row=>row.key===key),'Core page missing: '+key);
 const shell=fs.readFileSync(path.join(E.root,'dist/index.html'),'utf8');
 assert.equal((shell.match(/href="\/uiux-governance\.css[?"]/g)||[]).length,1,'Load governance stylesheet once');
 return {tokens:tokens.length,scenarios:inventory.length,core:core.size};
}

function compareLayout(evidence){
 const errors=[];
 if(evidence.unmapped.length)errors.push(...evidence.unmapped.map(x=>'Unmapped route '+x.product+' '+x.pattern));
 for(const row of evidence.cases){
  const id=[row.key,row.product||'public',row.language,row.role,row.size?.width].join('/');
  const expectedDenial=deniedCases.has([row.role,row.product,row.key].join('/'));
  if(expectedDenial&&row.outcome!=='denied')errors.push(id+': expected permission denial');
  if(!['rendered','fixture-missing'].includes(row.outcome)&&!(row.outcome==='denied'&&expectedDenial)){
   errors.push(id+': '+(row.reason||row.errors?.join('; ')||row.outcome));
  }
  if(row.outcome!=='rendered'||!row.metrics)continue;
  if(row.metrics.overflow>2)errors.push(id+': document overflow '+row.metrics.overflow+'px');
  if(!core.has(row.key))continue;
  if(row.metrics.actionClips.length)errors.push(id+': clipped actions '+row.metrics.actionClips.join(', '));
  if(row.metrics.filterClips?.length)errors.push(id+': filters outside the form '+row.metrics.filterClips.join(', '));
 }
 for(const key of core){
  const spec=evidence.routes.find(row=>row.key===key);
  for(const product of spec?.products?.length?spec.products:[null])for(const language of ['zh-CN','en']){
   const hit=evidence.cases.find(r=>r.key===key&&r.product===product&&r.language===language&&r.size.width===1366);
   if(!hit||hit.outcome!=='rendered'||!hit.screenshot)errors.push('Missing core evidence '+key+'/'+(product||'public')+'/'+language);
  }
 }
 assert(!errors.length,errors.join('\n'));
}

async function compareScreenshots(dir){
 const baseline=read(path.join(presets,'review.json'));
 if(baseline.platform!==process.platform)throw Error('Pixel comparison requires '+baseline.platform+'; run the layout gate on other platforms');
 const {browser:capturedBrowser}=read(path.join(dir,'coverage.json'));
 assert.equal(capturedBrowser,baseline.browser,'Capture with the reviewed browser version before comparing screenshots');
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const scores=[];
 try{
  const page=await browser.newPage();
  for(const shot of baseline.images){
   const imgs=[path.join(presets,shot.file),path.join(dir,shot.file)].map(p=>'data:image/png;base64,'+fs.readFileSync(p).toString('base64'));
   const score=await page.evaluate(async({imgs,clip})=>{
    const decode=async src=>{
     const image=new Image();image.src=src;await image.decode();
     const c=document.createElement('canvas');c.width=256;c.height=Math.round(256*clip.height/clip.width);
     const ctx=c.getContext('2d');
     ctx.drawImage(image,clip.x,clip.y,clip.width,clip.height,0,0,c.width,c.height);
     return ctx.getImageData(0,0,c.width,c.height).data;
    };
    const [a,b]=await Promise.all(imgs.map(decode));let changed=0,sum=0;
    for(let i=0;i<a.length;i+=4){
     const delta=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
     sum+=delta;if(delta>32)changed++;
    }
    return {mean:sum/(a.length/4)/255,changed:changed/(a.length/4)};
   },{imgs,clip:shot.clip});
   scores.push({file:shot.file,...score});
   assert(score.mean<=shot.meanTolerance&&score.changed<=shot.changedTolerance,
    'Review screenshot '+shot.file+' '+JSON.stringify(score));
  }
 }finally{await browser.close();}
 return scores;
}

async function main(){
 const mode=process.argv[2]||'static',dir=path.resolve(process.argv[3]||path.join(E.runtime,'uiux','current'));
 assert(['static','layout','compare'].includes(mode),'Use static, layout or compare');
 const result=lint();
 if(mode==='layout'||mode==='compare')compareLayout(read(path.join(dir,'coverage.json')));
 if(mode==='compare')result.screenshots=await compareScreenshots(dir);
 console.log(JSON.stringify({status:'PASS',mode,...result}));
}

if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={lint,compareLayout,compareScreenshots};
