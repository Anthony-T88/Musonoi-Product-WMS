'use strict';

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('./environment.cjs'),R=require('./uiux-routes.cjs'),M=require('./uiux-matrix.cjs');
const {crc32,inflateSync}=require('node:zlib'),{createHash}=require('node:crypto');
const presets=path.join(__dirname,'uiux-baselines');
const requiredTokens=['canvas','surface','text','muted','border','brand','danger','warning','success','focus',
 'title','section','body','caption','gap','radius','control','touch','font','line','label-line','weight-emphasis',
 'panel-gap','shadow-dialog','focus-ring','field-min','filter-min','border-width','compact'];
const core=new Set(['login','overview','inventory','map','customers','sales','receipts','receipt-new','preparation','arrivals',
 'loading-search','outbounds','metal','stocktakes','reports','accounts','permissions','audit']);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function lint(){
 const css=fs.readFileSync(path.join(E.root,'dist/uiux-governance.css'),'utf8');
 const root=css.match(/:root\s*\{([^}]+)\}/)?.[0];
 assert(root,'Shared tokens must be declared in :root');
 const tokens=[...root.matchAll(/(--uix-[\w-]+)\s*:/g)].map(m=>m[1]);
 assert.equal(new Set(tokens).size,tokens.length,'Duplicate token declaration');
 for(const token of requiredTokens)assert(tokens.includes('--uix-'+token),'Missing design token: '+token);
 const guide=fs.readFileSync(path.join(E.root,'docs/uiux/DESIGN.md'),'utf8');
 for(const token of tokens)assert(guide.includes('`'+token+'`'),'Document the shared token '+token);
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
 assert.deepEqual(inventory.map(({key,products,state,template})=>({key,products,state,template})),M.inventory.scenarios);
 for(const product of R.BOTH)assert(M.inventory.registry[product]?.length,'Empty locked route registry '+product);
 for(const key of core)assert(inventory.some(row=>row.key===key),'Core page missing: '+key);
 const shell=fs.readFileSync(path.join(E.root,'dist/index.html'),'utf8');
 assert.equal((shell.match(/href="\/uiux-governance\.css[?"]/g)||[]).length,1,'Load governance stylesheet once');
 return {tokens:tokens.length,scenarios:inventory.length,core:core.size};
}

function checkPng(dir,row){
 const name=M.imageName(row);
 assert.equal(row.screenshot,name,'Expected screenshot '+name);
 const bytes=fs.readFileSync(path.join(dir,name));
 assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid PNG '+name);
 assert(bytes.length>=57&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(8)===13,'Invalid PNG header '+name);
 assert.equal(bytes.readUInt32BE(16),row.size.width,'Wrong screenshot width '+name);
 assert.equal(bytes.readUInt32BE(20),row.size.height,'Wrong screenshot height '+name);
 const data=[];
 let end=false;
 for(let offset=8;offset+12<=bytes.length;){
  const length=bytes.readUInt32BE(offset),next=offset+length+12;
  assert(next<=bytes.length,'Truncated PNG '+name);
  const type=bytes.toString('ascii',offset+4,offset+8);
  assert.equal(crc32(bytes.subarray(offset+4,next-4)),bytes.readUInt32BE(next-4),'Corrupt PNG chunk '+name);
  if(type==='IDAT')data.push(bytes.subarray(offset+8,next-4));
  if(type==='IEND'){end=length===0&&next===bytes.length;break;}
  offset=next;
 }
 assert(end&&data.length,'Incomplete PNG '+name);
 const channels={2:3,6:4}[bytes[25]],length=(row.size.width*channels+1)*row.size.height;
 assert(channels&&bytes[24]===8&&bytes[28]===0,'Unsupported screenshot format '+name);
 assert.equal(inflateSync(Buffer.concat(data),{maxOutputLength:length}).length,length,'Incomplete image pixels '+name);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,'Screenshot digest mismatch '+name);
}

function compareLayout(evidence,dir,mode){
 assert.equal(evidence.mode,mode,'Coverage must be collected for the selected '+mode+' matrix');
 assert.match(evidence.commit,/^[a-f0-9]{40}$/,'Missing source version');
 const errors=[];
 const errorsIf=(condition,message)=>{if(condition)errors.push(message);};
 const {registry,scenarios}=M.inventory;
 const declared=R.pages({}).map(({key,products,state,template})=>({key,products,state,template}));
 assert.deepEqual(declared,scenarios,'Scenario registry changed. Review and update the inventory.');
 const specs=new Map(R.pages(evidence.fixtures).map(r=>[r.key,r]));
 assert.deepEqual(evidence.routes,[...specs.values()],'Scan scenario list does not match the approved inventory');
 for(const product of R.BOTH){
  const entries=evidence.registered.filter(r=>r.product===product);
  assert(entries.length,'Empty route registry '+product);
  assert.deepEqual(entries.map(r=>r.pattern).sort(),registry[product],'Route registry mismatch '+product);
  errorsIf(entries.some(r=>!r.examples?.length),'Registered route without an audit case '+product);
 }
 errorsIf(evidence.unmapped.length,'Unmapped routes '+JSON.stringify(evidence.unmapped));
 const required=M.matrix(mode),byKey=Map.groupBy(evidence.cases,M.rowId);
 const shots=new Set(),review=read(path.join(__dirname,'uiux-accessibility.json'));
 for(const entry of required){
  const id=M.rowId(entry),matches=byKey.get(id)||[];
  byKey.delete(id);
  if(matches.length!==1){errors.push((matches.length?'Duplicate':'Missing required')+' case '+id);continue;}
  const row=matches[0],spec=specs.get(row.key),context=[row.key,row.product||'public',row.language].join('/');
  errorsIf(row.state!==entry.state,'Wrong business state '+id);
  if(row.outcome==='fixture-missing'){
   const exception=M.missingExceptions.find(x=>x.key===row.key&&x.product===row.product&&x.role===row.role&&x.state===row.state);
   errorsIf(!exception?.reason||!(/^\d{4}-\d\d-\d\d$/.test(exception.until||''))||new Date(exception.until+'T23:59:59Z')<new Date(),
    'Missing required fixture '+id+' ('+row.reason+')');
   continue;
  }
  if(entry.denied){
   errorsIf(row.outcome!=='denied'||(entry.apiDenial?row.apiStatus:row.httpStatus)!==403,'Expected HTTP 403 '+id);
   if(entry.apiDenial){
    errorsIf(row.renderedUrl!==M.expectedLanding(spec,row.product,evidence.fixtures),'Wrong denial page '+id);
    errorsIf(row.apiPath!==M.protectedEndpoint(row.key,evidence.fixtures),'Wrong protected endpoint '+id);
    try{checkPng(dir,row);shots.add(row.screenshot);}catch(e){errors.push(id+': '+e.message);}
   }
   continue;
  }
  if(row.outcome!=='rendered'){
   errors.push('Expected rendered page '+id+': '+(row.reason||row.outcome));
   continue;
  }
  const expected=M.expectedLanding(spec,row.product,evidence.fixtures);
  errorsIf(row.renderedUrl!==expected,'Wrong landing URL '+id+' '+row.renderedUrl+' expected '+expected);
  const m=row.metrics||{};
  for(const control of M.selectors(row.key,row.product,expected))errorsIf(m.verifiedControls?.[control]!==true,'Missing key control '+id+' '+control);
  errorsIf(!Number.isFinite(m.overflow)||m.overflow>2,'Document overflow '+id+' '+m.overflow);
  for(const metric of ['actionClips','filterClips','noName','duplicates','contrastCandidates','forbiddenFields']){
   if(!Array.isArray(m[metric])){errors.push('Missing '+metric+' evidence '+id);continue;}
   for(const finding of m[metric]){
    const target=typeof finding==='string'?finding:finding.target;
    const reviewed=review.find(r=>r.context===context&&r.metric===metric&&r.target===target);
    if(reviewed?.disposition==='false-positive'&&reviewed.evidence)continue;
    if(metric==='contrastCandidates'&&!reviewed)errors.push('Unreviewed low contrast '+id+' '+target+' '+finding.ratio);
    else errors.push(metric+' regression '+id+' '+target);
   }
  }
  if(entry.screenshot){
   try{checkPng(dir,row);shots.add(row.screenshot);}
   catch(e){errors.push(id+': '+e.message);}
  }
 }
 errorsIf(byKey.size,'Unexpected scan rows '+[...byKey.keys()].slice(0,6).join(', '));
 errorsIf(JSON.stringify([...shots].sort())!==JSON.stringify([...evidence.screenshots].sort()),'Screenshot inventory mismatch');
 assert(!errors.length,[...new Set(errors)].join('\n'));
 return {required:required.length,screenshots:shots.size,mode};
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
   const score=await page.evaluate(async({imgs,clip,maxOffsetX})=>{
    const load=async src=>{
     const image=new Image();image.src=src;await image.decode();
     return image;
    };
    const pixels=(image,offsetX)=>{
     const c=document.createElement('canvas');c.width=256;c.height=Math.round(256*clip.height/clip.width);
     const ctx=c.getContext('2d');
     ctx.drawImage(image,clip.x+offsetX,clip.y,clip.width,clip.height,0,0,c.width,c.height);
     return ctx.getImageData(0,0,c.width,c.height).data;
    };
    const [baseline,current]=await Promise.all(imgs.map(load)),a=pixels(baseline,0),candidates=[];
    for(let offsetX=-maxOffsetX;offsetX<=maxOffsetX;offsetX++){
     if(clip.x+offsetX<0||clip.x+clip.width+offsetX>current.naturalWidth)continue;
     const b=pixels(current,offsetX);let changed=0,sum=0;
     for(let i=0;i<a.length;i+=4){
      const delta=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
      sum+=delta;if(delta>32)changed++;
     }
     candidates.push({mean:sum/(a.length/4)/255,changed:changed/(a.length/4),offsetX});
    }
    return candidates.sort((a,b)=>a.mean-b.mean||Math.abs(a.offsetX)-Math.abs(b.offsetX))[0];
   },{imgs,clip:shot.clip,maxOffsetX:shot.maxOffsetX||0});
   const pass=score.mean<=shot.meanTolerance&&score.changed<=shot.changedTolerance;
   scores.push({file:shot.file,...score,maxOffsetX:shot.maxOffsetX||0,meanTolerance:shot.meanTolerance,changedTolerance:shot.changedTolerance,pass});
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(dir,'pixel-results.json'),JSON.stringify({status:scores.every(x=>x.pass)?'PASS':'FAIL',browser:capturedBrowser,scores},null,2)+'\n');
 assert(scores.every(x=>x.pass),'Review screenshots '+scores.filter(x=>!x.pass).map(x=>x.file).join(', '));
 return scores;
}

async function main(){
 const mode=process.argv[2]||'static',dir=path.resolve(process.argv[3]||path.join(E.runtime,'uiux','current'));
 assert(['static','layout','compare'].includes(mode),'Use static, layout or compare');
 const matrix=process.argv[4]||'full';
 const result=lint();
 if(mode==='layout'||mode==='compare')result.layout=compareLayout(read(path.join(dir,'coverage.json')),dir,matrix);
 if(mode==='compare')result.screenshots=await compareScreenshots(dir);
 console.log(JSON.stringify({status:'PASS',mode,...result}));
}

if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={lint,compareLayout,compareScreenshots};
