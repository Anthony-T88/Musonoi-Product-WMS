'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {test}=require('node:test'),{chromium}=require('playwright');
const {exceptionScenarios}=require('./uiux-routes.cjs');
const root=path.resolve(__dirname,'../../dist');
const media={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'};
const errorId='d34eed7d-404a-400a-8e1b-6b0644c420ec';

test('WMS exception states preserve recovery, access and write semantics in the browser',async()=>{
 let mode='unavailable',browser;
 const seen=new Set();
 const config={version:require('../../server/release.cjs').version,frontendRevision:(await fs.readFile(path.join(root,'release.js'),'utf8')).match(/revision:'([^']+)'/)[1]};
 const site=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/v1/config'){
   const failed=mode==='unavailable';
   res.writeHead(failed?503:200,{'content-type':'application/json'});
   return res.end(JSON.stringify(failed?{error:'internal-only detail',errorId}:config));
  }
  if(url.pathname==='/api/v1/me'){
   res.writeHead(401,{'content-type':'application/json'});
   return res.end(JSON.stringify({error:'Sign in',code:mode==='expired'?'SESSION_EXPIRED':'SESSION_REPLACED'}));
  }
  if(url.pathname==='/boot.js'&&mode==='startup'){res.writeHead(404);return res.end();}
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!/^[\w./-]+$/.test(file)||file.split('/').includes('..')){res.writeHead(404);return res.end();}
  try{
   const data=await fs.readFile(path.join(root,file));
   res.writeHead(200,{'content-type':(media[path.extname(file)]||'text/plain')+'; charset=utf-8'});
   res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+site.address().port;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
  const state=key=>page.locator('[data-exception="'+key+'"]');
  for(const key of ['startup','unavailable','expired','replaced']){
   mode=key;
   await page.goto(origin);
   await state(key).waitFor();
   seen.add(key);
   assert(await state(key).locator('h1').isVisible());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
   if(key==='unavailable'){
    assert(!(await state(key).textContent()).includes('internal-only detail'));
    await state(key).locator('summary').click();
    assert.equal(await state(key).locator('code').textContent(),errorId);
    await state(key).locator('[data-exception-action=copy]').click();
    await state(key).getByRole('status').waitFor();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),errorId);
   }
   if(key==='expired'||key==='replaced'){
    assert(await page.locator('#login-panel').isHidden());
    await state(key).locator('[data-exception-action=signIn]').click();
    await page.locator('#login-username').waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'login-username');
   }
  }
  await page.goto(origin+'/offline.html');
  assert(await page.getByRole('heading',{name:'当前设备未连接网络'}).isVisible());
  seen.add('offline');
  await page.evaluate(()=>localStorage.setItem('musonoi-language','en'));
  await page.reload();
  assert(await page.getByRole('heading',{name:'Your device is offline'}).isVisible());
  await page.goto(origin+'/wms-unavailable.html');
  assert(await page.getByRole('heading',{name:'仓储服务暂不可用'}).isVisible());

  await page.setContent('<nav class="mobile-primary"><a href="/overview">Overview</a></nav><div class="breadcrumb"><strong>Inventory</strong></div>'+
   '<main id="inventory" hidden></main><main id="dashboard" hidden></main><main id="field" hidden></main>'+
   '<main id="business-page" hidden><h1 id="business-title"></h1><section id="page-content"></section></main><dialog id="dialog"><div id="dialog-content"></div></dialog>'+
   '<form id="arrival-test"><label>Trailer 2<input name="trailer_two" required></label><div class="wms-arrival-actions"><button>Confirm</button></div></form><input id="stock-filter" value="MUS-007"><div id="query-error"></div>');
  await page.evaluate(()=>{
   window.AppSignedIn=true;
   window.AppConfig={version:'4.9.0'};
   window.I18n={language:'en',usesEnglish:true,label:(_,english)=>english,apply(){}};
   window.ProductContext={cobaltPage:()=>false,isCopper:()=>true,globalPage:()=>false};
   window.CurrentUser={permissions:['dashboard:read','inventory:read']};
   window.SinglePlan={form(){},detail(){}};
   window.Shipping={detail(){}};
   window.LoadingPlans={};
   window.Management={list(){}};
   window.OperationConfirm={ask:async()=>true};
   window.notify=()=>{};
   window.$=id=>document.getElementById(id);
   scrollTo=()=>{};
   history.replaceState({},'','/inventory');
  });
  // setContent reuses the current document, which has already fired DOMContentLoaded.
  for(const name of ['exception-pages.js','router.js','vehicle-arrivals.js']){
   await page.addScriptTag({url:origin+'/'+name});
  }
  await page.evaluate(id=>{
   Router.add(/^\/overview$/,()=>{});
   Router.add(/^\/loading-plans$/,()=>{});
   Router.add(/^\/inventory$/,()=>{throw Object.assign(Error('private detail'),{statusCode:500,errorId:id});});
   return Router.show();
  },errorId);
  await state('server').waitFor();
  assert(!(await state('server').textContent()).includes('private detail'));
  assert.equal(await state('server').locator('code').textContent(),errorId);
  seen.add('server');
  await page.evaluate(()=>{history.replaceState({},'','/workbench/permissions');return Router.show();});
  await state('forbidden').waitFor();
  assert.equal(await state('forbidden').locator('a').getAttribute('href'),'/overview');
  seen.add('forbidden');
  await page.evaluate(()=>{history.replaceState({},'','/loading-plans/missing-document');return Router.show();});
  await state('notFound').waitFor();
  assert.equal(await state('notFound').locator('a').getAttribute('href'),'/loading-plans');
  seen.add('notFound');
  await page.evaluate(()=>{
   WmsException.query($('query-error'),{code:'REQUEST_TIMEOUT'},()=>{
    window.retried=$('stock-filter').value;
   },()=>$('stock-filter').focus());
  });
  await state('timeout').locator('[data-exception-action=retry]').click();
  assert.equal(await page.evaluate(()=>window.retried),'MUS-007');
  await state('timeout').locator('[data-exception-action=filters]').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'stock-filter');
  seen.add('timeout');

  await page.evaluate(async()=>{
   window.operationCalls=[];
   window.forcePending=false;
   window.API={
    async request(url,options){
     operationCalls.push([url,options?.method||'GET']);
     if(!options)return {items:[{dispatch_vehicle_id:'example',arrival_id:'existing',trailer_two:'LATEST'}]};
     if(forcePending)throw Object.assign(Error('unknown'),{uncertain:true,operationKey:'original-key'});
     throw Object.assign(Error('到场登记版本已变化，请刷新'),{statusCode:409});
    },
    async check(key){operationCalls.push([key,'CHECK']);return {committed:false};}
   };
   const form=$('arrival-test');
   const actions=form.querySelector('.wms-arrival-actions');
   actions.insertAdjacentHTML('beforeend','<button type="button" data-arrival-save>Save</button>');
   await LoadingYard.bindArrival(form,{dispatch_vehicle_id:'example',shipment_month:'2026-11'},'/loading-plans/arrivals/example','/loading-plans',{},()=>{});
  });
  await page.getByRole('button',{name:'Confirm',exact:true}).click();
  assert.equal(await page.evaluate(()=>operationCalls.length),0);
  seen.add('validation');
  await page.locator('[name=trailer_two]').fill('MY INPUT');
  await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await state('conflict').locator('[data-exception-action=latest]').click();
  await state('conflict').getByRole('status').waitFor();
  assert((await state('conflict').getByRole('status').textContent()).includes('LATEST'));
  assert.equal(await page.locator('[name=trailer_two]').inputValue(),'MY INPUT');
  seen.add('conflict');
  await page.evaluate(()=>{window.forcePending=true;});
  await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await state('unknown').locator('[data-exception-action=check]').click();
  await state('unknown').getByRole('status').waitFor();
  assert(await page.getByRole('button',{name:'Confirm',exact:true}).isDisabled());
  assert.deepEqual(await page.evaluate(()=>operationCalls.at(-1)),['original-key','CHECK']);
  assert.equal(await page.locator('[name=trailer_two]').inputValue(),'MY INPUT');
  seen.add('unknown');
  assert.deepEqual([...seen].sort(),exceptionScenarios.map(([key])=>key).sort());
 }finally{
  await browser?.close();
  await new Promise(resolve=>site.close(resolve));
 }
});
