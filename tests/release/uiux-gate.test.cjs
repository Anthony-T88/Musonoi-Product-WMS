'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {test}=require('node:test'),{crc32,deflateSync}=require('node:zlib'),{createHash}=require('node:crypto');
const M=require('./uiux-matrix.cjs'),R=require('./uiux-routes.cjs'),{compareLayout}=require('./uiux-quality.cjs');

function png(width,height){
 const chunk=(name,bytes)=>{
  const header=Buffer.alloc(8),crc=Buffer.alloc(4),code=Buffer.from(name);
  header.writeUInt32BE(bytes.length);code.copy(header,4);
  crc.writeUInt32BE(crc32(Buffer.concat([code,bytes])));
  return Buffer.concat([header,bytes,crc]);
 };
 const dimensions=Buffer.alloc(13);dimensions.writeUInt32BE(width);dimensions.writeUInt32BE(height,4);
 dimensions[8]=8;dimensions[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',dimensions),
  chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}

test('strict quick and full UI matrices reject missing routes, forged images, wrong pages and visible regressions',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wms-uiux-gate-'));
 try{
  const fixtures=Object.fromEntries(R.pages({}).filter(s=>s.fixture).map(s=>[s.fixture,R.missingId]));
  Object.assign(fixtures,{project:R.missingId,warehouse:R.missingId,cuGroupChild:R.missingId,cuGroupLocked:true});
  const routes=R.pages(fixtures),specs=new Map(routes.map(s=>[s.key,s])),sizes=new Map();
  const records=mode=>M.matrix(mode).map(entry=>{
   const {screenshot,...r}=entry,renderedUrl=M.expectedLanding(specs.get(r.key),r.product,fixtures);
   const row={...r,renderedUrl,outcome:r.denied?'denied':'rendered',httpStatus:r.denied?403:200,
    ...(r.apiDenial?{apiStatus:403,apiPath:M.protectedEndpoint(r.key,fixtures)}:{}),
    metrics:{verifiedControls:Object.fromEntries(M.selectors(r.key,r.product,renderedUrl).map(s=>[s,true])),
     overflow:0,actionClips:[],filterClips:[],noName:[],duplicates:[],contrastCandidates:[],forbiddenFields:[]}};
   if(screenshot){
    row.screenshot=M.imageName(row);
    const {width,height}=row.size,key=width+'x'+height;
    if(!sizes.has(key)){const bytes=png(width,height);sizes.set(key,{bytes,hash:createHash('sha256').update(bytes).digest('hex')});}
    const {bytes,hash}=sizes.get(key);
    row.sha256=hash;
    fs.writeFileSync(path.join(dir,row.screenshot),bytes);
   }
   return row;
  });
  const evidence=mode=>{
   const cases=records(mode);
   return {mode,commit:'a'.repeat(40),fixtures,routes,unmapped:[],
    registered:R.BOTH.flatMap(product=>M.inventory.registry[product].map(pattern=>({product,pattern,examples:['reviewed']}))),
    cases,screenshots:cases.filter(r=>r.screenshot).map(r=>r.screenshot)};
  };
  const full=evidence('full'),base=evidence('quick');
  assert(compareLayout(full,dir,'full').required>compareLayout(base,dir,'quick').required);
  const run=(title,change,reason)=>t.test(title,()=>{
   const copy=structuredClone(base);
   change(copy);
   assert.throws(()=>compareLayout(copy,dir,'quick'),reason);
  });
  await run('route registration removed',e=>e.registered.shift(),/Route registry mismatch/);
  await run('route registrations emptied',e=>{e.registered=[];},/Empty route registry/);
  await run('scenario row removed',e=>e.cases.splice(7,1),/Missing required case/);
  await run('synthetic fixture omitted',e=>{e.cases.find(r=>r.key==='cu-receipt-edit').outcome='fixture-missing';},/Missing required fixture/);
  await run('wrong URL despite successful HTTP and matching controls',e=>{e.cases.find(r=>r.key==='inventory').renderedUrl='/overview';},/Wrong landing URL/);
  await run('key control hidden',e=>{const r=e.cases.find(x=>x.key==='permissions'&&!x.denied);r.metrics.verifiedControls['#role-save']=false;},/Missing key control/);
  await run('clipped filter',e=>e.cases.find(r=>r.key==='loading-search').metrics.filterClips.push('Search'),/filterClips regression/);
  await run('inaccessible button',e=>e.cases.find(r=>r.key==='map').metrics.noName.push('button'),/noName regression/);
  await run('duplicate heading',e=>e.cases.find(r=>r.key==='map').metrics.duplicates.push('Stock Map'),/duplicates regression/);
  await run('low contrast',e=>e.cases.find(r=>r.key==='permissions').metrics.contrastCandidates.push({target:'#role-save',ratio:2.2}),/Unreviewed low contrast/);
  const file=path.join(dir,base.cases[0].screenshot);
  await t.test('fake and wrong-size screenshot files',()=>{
   const original=fs.readFileSync(file);
   try{
    fs.writeFileSync(file,'This is not a PNG');
    assert.throws(()=>compareLayout(base,dir,'quick'),/Invalid PNG/);
    fs.writeFileSync(file,png(40,40));
    assert.throws(()=>compareLayout(base,dir,'quick'),/Wrong screenshot width/);
   }finally{fs.writeFileSync(file,original);}
  });
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

