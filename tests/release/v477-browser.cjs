'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const current=require('../../.runtime/v477-test-config.json');
const baseline=require('../../../musonoi-v4.7.6/.runtime/v476-test-config.json');
const CU='CU_CATHODE',CO='CO_HYDROXIDE';
const output=path.resolve(__dirname,'../../docs/v4.7.7/evidence');
const findings=[];
const record=(name,details)=>{findings.push({name,...details});console.log('PASS '+name);};

async function session(browser,fixture,role='admin'){
 const origin=fixture.appCfg.origin,user=fixture.accounts.find(account=>account.role===role);
 assert.match(origin,/^http:\/\/127\.0\.0\.1:(4187|4189)$/);assert.equal(fixture.appCfg.environment,'test');
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:user.username,password:user.password}});
 assert.equal(login.status(),200);
 const page=await context.newPage();page.setDefaultTimeout(11000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
 const ready=()=>page.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&!Router.rendering&&document.getElementById('session-restore').hidden);
 await page.goto(origin+'/overview');await ready();
 const go=async(product,route)=>{
  await page.evaluate(code=>localStorage.setItem(ProductContext.key,code),product);
  await page.goto(origin+route);await ready();
 };
 return {context,page,go,ready,errors};
}
async function screenshot(page,name){
 await page.evaluate(()=>document.querySelector('#task-notice[open] [data-task-dismiss]')?.click());
 return page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
}
async function mapShots(browser,fixture,phase){
 const {context,page,go,errors}=await session(browser,fixture);
 try{
  for(const width of [1440,1280]){
   await page.setViewportSize({width,height:width===1440?900:800});
   await go(CU,'/stock-map?'+new URLSearchParams({project_id:fixture.project,warehouse_id:fixture.warehouse}));
   if(await page.evaluate(()=>I18n.language)!=='zh-CN'){
    await page.locator('.top-actions [data-language]').selectOption('zh-CN');
    await page.waitForFunction(()=>I18n.language==='zh-CN');
   }
   await page.locator('.wms-map-zones [data-map-region="P5"]').waitFor();
   await page.evaluate(()=>document.fonts.ready);
   const labels=await page.locator('.wms-map-zones :is([data-map-region="P3"],[data-map-region="P5"])').evaluateAll(nodes=>nodes.map(n=>({
    text:n.textContent,font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight,visible:n.offsetWidth>0,clipped:n.scrollWidth>n.clientWidth+1
   })));
   assert.equal(labels.length,2);assert(labels.every(label=>label.visible&&!label.clipped));
   if(phase==='after')assert(labels.every(label=>parseFloat(label.font)===14),JSON.stringify(labels));
   if(width===1440){
    await screenshot(page,phase+'-copper-map-default-1440');
    await page.locator('#v271-map-out').evaluate(button=>button.click());
    assert.equal(await page.evaluate(()=>MapView.zoom),1);
    await screenshot(page,phase+'-copper-map-min-1440');
    await page.locator('.wms-map-zones').screenshot({path:path.join(output,phase+'-copper-map-titles-1440.png')});
    const frame=page.locator('#stock-map-canvas');
    await frame.screenshot({path:path.join(output,phase+'-copper-map-canvas-1440.png')});
    for(const code of ['P3','P5']){
     const cell=frame.locator('#stock-map-svg [data-map-cell="'+code+'"] rect'),box=await cell.boundingBox();
     if(box)await page.screenshot({path:path.join(output,phase+'-copper-map-'+code+'.png'),
      clip:{x:Math.max(0,box.x-12),y:Math.max(0,box.y-12),width:box.width+24,height:box.height+24}});
    }
    if(phase==='after'){
     const onCanvas=await frame.locator('.v271-temporary-label').evaluateAll(nodes=>nodes.map(node=>{
      const rect=node.getBoundingClientRect(),tile=document.querySelector('#stock-map-svg [data-map-cell="'+node.dataset.mapCell+'"] rect').getBoundingClientRect();
      return {code:node.dataset.mapCell,text:node.innerText,titleVisible:!node.firstElementChild.hidden,within:rect.left>=tile.left&&rect.right<=tile.right&&rect.top>=tile.top&&rect.bottom<=tile.bottom};
     }));
     assert.equal(onCanvas.length,2);assert(onCanvas.every(label=>label.titleVisible&&label.within),JSON.stringify(onCanvas));
     const sizes=()=>frame.locator('.v271-temporary-label > span').evaluateAll(nodes=>nodes.map(n=>parseFloat(getComputedStyle(n).fontSize)));
     const baseSizes=await sizes();
     await page.locator('#v271-map-in').evaluate(button=>button.click());
     const zoomedSizes=await sizes();
     assert(baseSizes.every((size,index)=>size<=13&&zoomedSizes[index]>size));
     await page.locator('#v271-map-out').evaluate(button=>button.click());
     assert.deepEqual(await sizes(),baseSizes);
     record('Copper canvas labels fit inside both areas and scale',{width,defaultZoom:100,minZoom:100,baseSizes,zoomedSizes,labels:onCanvas});
    }
   }
   record(phase+' Copper toolbar labels',{width,labels});
  }
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
  await mapShots(browser,baseline,'before');
  await mapShots(browser,current,'after');
  const {context,page,go,ready,errors}=await session(browser,current);
  try{
   for(const [product,slug] of [[CU,'copper'],[CO,'cobalt']]){
    await go(product,'/overview');
    await page.locator('.oa-stock-trends').waitFor();
    const plots=page.locator('.oa-stock-trends [data-oa-plot]');
    assert.equal(await plots.count(),1);
    await page.locator('.oa-stock-trends svg').first().waitFor();
    const values=await plots.evaluate(el=>JSON.parse(el.dataset.rows));
    assert(values.some(row=>row.stock_prepared_net_mt!==null));
    assert(values.some(row=>row.stock_prepared_net_mt===null));
    await screenshot(page,slug+'-overview-1440');
    await page.locator('.oa-stock-trends').screenshot({path:path.join(output,slug+'-overview-trend.png')});
    const zero=await page.locator('.oa-kpis').first().innerText();
    assert.match(zero,/(?:^|\D)0\s+(?:批次|捆|袋|包|车|%)/);
    assert.doesNotMatch(zero,/\d+\.0{4}\s*(?:批次|捆|袋|包|车)/);
    assert.match(zero,/[1-9]\d*\s*(?:批次|捆|袋|包|车)/);
    if(product===CO)assert.match(zero,/在库库存预估金属量/);
    record(slug+' overview integer counts and traceable trend',{zero:true,positive:true,missing:true,series:await plots.count()});
   }
   await go(CU,'/stock-map');
   const switcher=page.locator('button').filter({hasText:/^氢氧化钴$/}).last();
   await switcher.click();await ready();await page.locator('.map465').waitFor();
   assert(await page.evaluate(()=>Boolean(CobaltMap465.data.site_plan)),'Open the approved cobalt site map first');
   await screenshot(page,'cobalt-map-default');
   await go(CO,'/stock-map?'+new URLSearchParams({project_id:current.project,warehouse_id:current.warehouse}));
   await page.locator('.map465').waitFor();
   const rows=await page.evaluate(()=>CobaltMap465.data.locations.map(r=>({id:r.id,code:r.code,qty:r.bags,batch:r.preparation_batch_no,work:r.work_status})));
   const occupied=rows.find(row=>row.qty>0),empty=rows.find(row=>!row.qty&&!row.batch);assert(occupied&&empty);
   await page.reload();await ready();await page.locator('.map465').waitFor();
   const input=page.locator('input[name=location_query]');
   await input.fill(empty.code);await input.press('Enter');
   await page.locator('#co-map-detail').getByText(/没有在位实物/).waitFor();
   await input.fill(occupied.code);await input.press('Enter');
   await page.locator('#co-map-detail h4').getByText(occupied.batch,{exact:true}).waitFor();
   await page.locator('#co-map-detail dd').filter({hasText:new RegExp('^'+occupied.qty+'$')}).first().waitFor();
   await page.locator('#co-map-fit').click();
   const zoom=await page.locator('#co-map-svg').getAttribute('viewBox');
   await page.locator('#co-map-in').click();assert.notEqual(await page.locator('#co-map-svg').getAttribute('viewBox'),zoom);
   await page.locator('[data-map-clear]').click();
   const bag=await page.evaluate(async id=>(await API.request('/cobalt/stock/batches/'+id+'?page_size=20')).items[0]?.bag_no,
    await page.evaluate(id=>CobaltMap465.data.locations.find(r=>r.id===id).occupied_by,occupied.id));
   await input.fill(bag);await input.press('Enter');
   await page.locator('#co-map-detail h4').getByText(occupied.batch,{exact:true}).waitFor();
   const stockBatch=await page.evaluate(async ({code,id})=>{
    const result=await API.request('/cobalt/stock?'+new URLSearchParams({batch:code,location_id:id}));
    return result.items.find(row=>row.preparation_batch_no===code);
   },{code:occupied.batch,id:occupied.id});
   assert.equal(stockBatch.bags,occupied.qty);
   assert(stockBatch.location_codes.includes(occupied.code));
   await screenshot(page,'cobalt-map-occupied');
   await page.locator('#co-map-detail button[aria-label]').first().click();
   await page.locator('[data-co-location="'+occupied.id+'"]').press('Enter');await page.locator('#co-map-detail h4').getByText(occupied.batch,{exact:true}).waitFor();
   await page.locator('[data-map-clear]').click();await input.fill('NO-MATCH-V477');await input.press('Enter');
   await page.locator('.wms-map-controls [role=status]').getByText('未找到匹配货位').waitFor();
   const mapEndpoint=url=>url.pathname==='/api/v1/cobalt/stock/map';
   for(const [status,code] of [[503,'SYS-15'],[403,'SYS-14']]){
    await page.route(mapEndpoint,route=>route.fulfill({status,json:{error:'Synthetic map response'}}));
    await page.reload();await ready();
    await page.locator('[data-sys-code="'+code+'"]').waitFor();
    await page.unroute(mapEndpoint);
   }
   await page.reload();await ready();await page.locator('.map465').waitFor();
   record('Cobalt map first visit, reload, switch, empty, occupied, zoom and bag search',{
    locations:rows.length,stock:occupied.qty,stockListAgrees:true,errorFeedback:[503,403]
   });
   const requests=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
   const query='?stock_state=ALL&sort=net&project_id=obsolete&warehouse_id=obsolete&occupancy=FREE&unlocated=1';
   await go(CO,'/inventory'+query);await page.locator('.co2-batches tbody tr').first().waitFor();
   assert(!requests.some(p=>p.includes('/stock/batches/')||p.endsWith('/stock/history')));
   assert.equal(await page.locator('.co2-detail').count(),0);
   for(const key of ['project_id','warehouse_id','occupancy','unlocated']){
    assert.equal(await page.locator('#co-stock-filter [name='+key+']').count(),0);
    assert(!new URL(page.url()).searchParams.has(key));
   }
   assert.equal(await page.locator('#co2-sort').inputValue(),'net');
   for(const width of [1440,1280,390]){
    await page.setViewportSize({width,height:width===390?844:900});
    const layout=await page.locator('.co2-filter').evaluate(filter=>{
     const table=document.querySelector('.co2-batches').closest('.co2-panel'),a=filter.getBoundingClientRect(),b=table.getBoundingClientRect();
     return {aligned:Math.abs(a.left-b.left)<2&&Math.abs(a.right-b.right)<2,overflow:document.documentElement.scrollWidth>innerWidth+2};
    });assert(layout.aligned&&!layout.overflow);
    await screenshot(page,'cobalt-inventory-'+width);
   }
   await page.locator('.co2-batches a[href$="sort=net"],.co2-batches a[href*="/archive"]').filter({hasText:'详情'}).first().click();
   await page.locator('.inventory-archive').waitFor();
   await page.getByText('返回批次列表',{exact:true}).click();await page.locator('.co2-batches').waitFor();
   assert.equal(await page.locator('#co2-sort').inputValue(),'net');assert.equal(await page.locator('#co-stock-filter [name=stock_state]').inputValue(),'ALL');
   // Use the real authorized stock rows with a smaller page size to exercise page two.
   const stockEndpoint=url=>url.pathname==='/api/v1/cobalt/stock'&&url.searchParams.has('page');
   await page.route(stockEndpoint,async route=>{
    const source=new URL(route.request().url()),number=Number(source.searchParams.get('page'));
    source.searchParams.set('page','1');source.searchParams.set('page_size','50');
    const response=await route.fetch({url:source.href}),actual=await response.json();
    await route.fulfill({response,json:{...actual,items:actual.items.slice(number-1,number),page:number,page_size:1}});
   });
   await go(CO,'/inventory?stock_state=ALL&sort=net');
   const next=page.locator('.co2-pager').getByRole('link',{name:'下一页',exact:true});
   await next.click();
   await page.waitForFunction(()=>new URLSearchParams(location.search).get('batch_page')==='2'&&!Router.rendering);
   const archive=page.locator('.co2-batches').getByRole('link',{name:'详情',exact:true}).first();
   assert.equal(new URL(await archive.getAttribute('href'),current.appCfg.origin).searchParams.get('batch_page'),'2');
   await archive.click();await page.locator('.inventory-archive').waitFor();
   await page.getByText('返回批次列表',{exact:true}).click();await page.locator('.co2-batches').waitFor();
   assert.equal(new URL(page.url()).searchParams.get('batch_page'),'2');
   assert.equal(await page.locator('#co2-sort').inputValue(),'net');
   assert.equal(await page.locator('#co-stock-filter [name=stock_state]').inputValue(),'ALL');
   await page.unroute(stockEndpoint);
   record('Cobalt stock list, filters, sort, archive and return',{widths:[1440,1280,390],removedFilters:4,pageTwoRestored:true,testPageSize:1});
   await page.setViewportSize({width:1440,height:900});
   await go(CO,'/cobalt-metal');await page.locator('#co-metal-filter').waitFor();
   assert.equal(await page.locator('.co-metal-kpis .oa-kpis-cobalt').count(),0);
   assert.equal(await page.locator('.co-metal-kpis .oa-kpis-confirmation .oa-kpi').count(),3);
   assert.equal(await page.getByRole('heading',{name:'ARECOMS金属量确认',exact:true}).count(),0);
   await page.getByRole('link',{name:'正式出库金属量明细'}).click();await page.locator('#co-metal-filter').waitFor();
   await screenshot(page,'cobalt-metal-outbound');
   record('Cobalt metal inventory and ARECOMS entry',{removedTopCards:6});
   await go(CU,'/historical-movements');await page.locator('#historical-upload').waitFor();
   await screenshot(page,'historical-ledger-1440');
   await page.locator('.top-actions [data-language]').selectOption('en');
   await page.waitForFunction(()=>I18n.language==='en');
   await go(CO,'/historical-movements');await page.locator('#historical-upload').waitFor();
   await page.setViewportSize({width:390,height:844});
   await screenshot(page,'historical-ledger-390');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
  const viewer=await session(browser,current,'limited_viewer');
  try{
   await viewer.go(CU,'/historical-movements');
   assert.equal(await viewer.page.locator('#historical-upload').count(),0);
   assert.equal(await viewer.page.locator('.sidebar [data-primary-route="historical-movements"]').count(),0);
   record('Historical movement interface and permission',{admin:true,viewerDenied:true,widths:[1440,390]});
  }finally{await viewer.context.close();}
 }finally{
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(findings,null,2)+'\n');
  await browser.close();
 }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
