const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const f=require('../../.runtime/v478-test-config.json'),origin=f.appCfg.origin;
const output='.runtime/v480-evidence';
assert.equal(origin,'http://127.0.0.1:4191');
assert.equal(f.appCfg.environment,'test');
assert.equal(new URL(f.appCfg.databaseUrl).pathname,'/'+f.database);
assert.match(f.database,/^musonoi_audit_[a-f0-9]{10}_test$/);

async function occupyCobaltLocation(location){
 const product='CO_HYDROXIDE',sessions=new Map(),customer=f.customers[product];
 const app=await require('../../server/app.cjs').build({config:f.appCfg});
 const api=async(role,_product,route,body)=>{
  if(!sessions.has(role)){
   const account=f.accounts.find(a=>a.role===role),remoteAddress='127.62.0.'+(sessions.size+10);
   const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress,headers:{origin},
    payload:{username:account.username,password:account.password}});
   assert.equal(login.statusCode,200,role);
   sessions.set(role,{remoteAddress,cookie:login.cookies.map(c=>c.name+'='+c.value).join('; '),csrf:login.json().csrfToken});
  }
  const {remoteAddress,cookie,csrf}=sessions.get(role);
  const response=await app.inject({url:'/api/v1'+route,method:body?'POST':'GET',remoteAddress,headers:{origin,cookie,
   'x-product-code':product,'x-csrf-token':csrf,'idempotency-key':require('node:crypto').randomUUID()},...(body?{payload:body}:{})});
  assert.equal(response.statusCode,200,route+' '+response.body.slice(0,180));
  return response.json();
 };
 try{
  const P=require('./preparation-fixture.cjs'),month=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit'}).format(new Date());
  const contract=await api('admin',product,'/cobalt/sales/contracts',{project_id:location.project_id,customer_id:customer.id,
   contract_no:'TEST-MAP-'+Date.now(),effective_date:'2020-01-01',end_date:'2099-12-31',active:true});
  const sales=await api('sales_operator',product,'/cobalt/sales/plans',{project_id:location.project_id,warehouse_id:location.warehouse_id,
   customer_id:customer.id,contract_id:contract.id,target_weight:'30',shipment_month:month,planned_vehicle_count:1,status:'OPEN',remark:'Synthetic V4.7.8 site zoom check'});
  const salesPath='/cobalt/sales-workflow/plans/'+sales.id;
  for(const role of ['sales_manager','commerce_manager']){
   const review=await api(role,product,salesPath);
   await api(role,product,salesPath+'/review',{version:review.approval_version,decision:'APPROVED'});
  }
  const plan=await P.approved(api,product,sales.id,P.batch(product,800+Number(location.code.match(/\d+$/)?.[0]||0)));
  const created=await api('logistics_field_operator',product,'/cobalt/preparations',{preparation_plan_id:plan.id,total_bags:1});
  const path='/cobalt/preparations/'+created.id,work=path+'/work';
  await api('logistics_field_operator',product,path+'/submit',{version:created.version});
  let state=await api('logistics_field_operator',product,work);
  const seal='TEST-MAP-'+Date.now();
  await api('logistics_field_operator',product,work+'/save',{batch_version:state.work.version,arecoms_quantity_mt:'',
   bags:state.bags.map(bag=>({bag_id:bag.bag_id,version:bag.version,actual_gross_kg:'650',seal_no:seal,sampled:true}))});
  state=await api('logistics_field_operator',product,work);
  const place={preparation_id:created.id,batch_version:state.work.version,selection:'ALL',target_location_id:location.id,target_version:location.version,source:'PREPARATION'};
  const preview=await api('site_supervisor',product,'/cobalt/stock/place-preview',place);
  await api('site_supervisor',product,'/cobalt/stock/place',{...place,preview_hash:preview.preview_hash});
  await api('logistics_field_operator',product,work+'/submit',{batch_version:state.work.version});
  state=await api('site_supervisor',product,work);
  await api('site_supervisor',product,work+'/approve',{batch_version:state.work.version});
  const receipt=await api('production_manager',product,path);
  await api('production_manager',product,path+'/production-approve',{version:receipt.version});
  return seal;
 }finally{await app.close();}
}

(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const admin=f.accounts.find(a=>a.role==='admin');
  const signIn=async()=>{
   const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:admin.username,password:admin.password}});
   assert.equal(login.status(),200);
  };
  await signIn();
  const page=await context.newPage();page.setDefaultTimeout(12000);
  await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
  const ready=()=>page.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&!Router.rendering&&document.getElementById('session-restore').hidden);
  const go=async(product,url)=>{await page.evaluate(p=>localStorage.setItem(ProductContext.key,p),product);await page.goto(origin+url);await ready();};
  const lang=async(value)=>{
   if(await page.evaluate(()=>I18n.language)!==value){
    await page.locator('.top-actions [data-language]').selectOption(value);await page.waitForFunction(v=>I18n.language===v,value);
   }
  };
  await page.goto(origin+'/overview');await ready();await lang('zh-CN');
  const navigation=await page.evaluate(async()=>{
   const target=document.getElementById('page-content'),frames=[];
   const original=Router.performShow;
   Router.performShow=async function(...args){
    await original.apply(this,args);
    await new Promise(resolve=>requestAnimationFrame(()=>{
     frames.push(getComputedStyle(target).visibility);
     resolve();
    }));
   };
   try{await Router.go('/workbench');}finally{Router.performShow=original;}
   return {frames,ready:getComputedStyle(target).visibility};
  });
  assert.deepEqual(navigation,{frames:['hidden'],ready:'visible'});
  await go('CU_CATHODE','/workbench');
  await page.locator('.s46-hub-card[href="/workbench/historical-movements"]').click();
  await page.locator('#historical-upload input[multiple]').waitFor();
  assert.equal(await page.locator('#historical-upload [name=movement_type],#historical-upload [name=business_date],#historical-upload [name=date_evidence]').count(),0);
  assert.equal(await page.locator('.sidebar [data-primary-route="historical-movements"]').count(),0);
  await page.screenshot({path:output+'/history-zh.png'});
  const XLSX=require('xlsx'),id='UI-'+Date.now();
  const file=(number,day)=>{
   const data=Array.from({length:29},()=>[]);
   data[0]=['PACKING LIST'];data[2]=['','','','Packing List No:',id+'-'+number];data[3]=['','','','Lot No:',id+'-LOT'];
   data[6]=['','','','Shipping Date:',day];data[28]=['No','Description','Bundle No','Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
   data.push([1,'Synthetic',id+'-UNIT-'+number,48,'SYN-SEAL',647,650],['Total',null,null,null,null,647,650]);
   const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),'PL');
   return {name:'synthetic-'+number+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{bookType:'xlsx',type:'buffer'})};
  };
  const form=page.locator('#historical-upload');
  await form.locator('[name=warehouse_id]').selectOption(f.warehouse);
  await form.locator('[name=source]').setInputFiles([file(1,'2020-03-05'),file(2,'')]);
  await form.getByRole('button',{name:'预览',exact:true}).click();
  const valid=page.locator('[data-history-file="0"]'),invalid=page.locator('[data-history-file="1"]');
  await valid.getByText(/可导入/).waitFor();await invalid.locator(':scope > summary').click();
  await invalid.getByText(/发运日期缺失/).waitFor();
  await invalid.locator('input[type=file]').setInputFiles(file(2,'2020-03-05'));
  await invalid.getByText(/可导入/).waitFor();
  await page.locator('#historical-confirm').click();
  await page.locator('dialog[open] .operation-confirm-actions .primary').click();
  await valid.getByText(/导入成功/).waitFor();await invalid.getByText(/导入成功/).waitFor();
  await page.screenshot({path:output+'/history-batch-zh.png'});

  await lang('en');await page.getByRole('heading',{name:'Upload Packing Lists',exact:true}).waitFor();
  await page.screenshot({path:output+'/history-en.png'});
  await lang('zh-CN');await page.getByRole('heading',{name:'上传装箱单',exact:true}).waitFor();
  const proofs=[{batchBrowser:true,replacedOnlyInvalidFile:true}];
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   const cu=product==='CU_CATHODE';
   await lang('zh-CN');
   await go(product,cu?'/inventory?search=TEST-CU-UNIT':'/inventory?bag=TEST-CO-UNIT');
   assert.equal(await page.locator(cu?'#status':'#co-stock-filter [name=stock_state]').inputValue(),'ALL');
   const historyRow=page.locator('table tbody tr').filter({has:page.locator('a[href^="/inventory/historical/"]')}).first();
   await historyRow.getByText('历史数据导入',{exact:true}).waitFor();
   const facts=await historyRow.evaluate(row=>[...row.cells].map((cell,i)=>({heading:row.closest('table').tHead.rows[0].cells[i].textContent.replace('↕','').trim(),sort:row.closest('table').tHead.rows[0].cells[i].dataset.sort,value:cell.textContent.trim()})));
   assert.equal(facts.find(cell=>cell.value==='历史数据导入').heading,'备注');
   assert.equal(facts.find(cell=>cell.sort==='date'||cell.heading==='入库日期')?.value,cu?'':'2020-03-02',JSON.stringify(facts));
   assert(facts.some(cell=>cell.heading==='批次号'&&cell.value.includes('-LOT')));
   assert(!facts.some(cell=>cell.value.includes('历史导入数据')||cell.value.includes('发运 ')));
   await historyRow.locator('a[href^="/inventory/historical/"]').click();
   await page.getByRole('heading',{name:cu?'捆包详情档案':'批次详情档案',exact:true}).first().waitFor().catch(async e=>{console.log(page.url(),await page.locator('#business-title').textContent(),(await page.locator('#page-content').innerText()).slice(0,400));throw e;});
   await page.locator('a[href^="/outbounds/historical/"]').first().click();
   await page.getByRole('heading',{name:'历史装车单',exact:true}).first().waitFor();
   await lang('en');await page.getByRole('heading',{name:'Historical Loading Order',exact:true}).first().waitFor();
   await page.reload();await ready();await page.getByRole('heading',{name:'Historical Loading Order',exact:true}).first().waitFor();
   await page.screenshot({path:output+'/'+(cu?'cu':'co')+'-historical-loading-en.png'});
   await lang('zh-CN');await page.getByRole('heading',{name:'历史装车单',exact:true}).first().waitFor();
   await page.locator('a[href^="/receipts/historical/"]').first().click();
   await page.getByRole('heading',{name:'历史入库单',exact:true}).first().waitFor();
   if(cu)await page.getByText(/历史补录记账日/).waitFor();
   for(const [url,area] of [['/receipts','receipts'],['/loading-plans/query','loading-plans'],['/outbounds','outbounds']]){
    await go(product,url);
    const regular=page.locator('#page-content table tbody a[href^="/'+area+'/historical/"]').first();
    await regular.waitFor().catch(async error=>{console.error(product,area,page.url(),(await page.locator('#page-content').innerText()).slice(0,250));throw error;});
    assert.equal(await page.locator('[data-historical-business]').count(),0);
    const href=await regular.getAttribute('href');
    if(await regular.getAttribute('data-op-select')){
     await regular.click();
     const preview=page.locator('#op-preview');
     await preview.getByText('历史导入数据',{exact:true}).waitFor();
     assert.equal(await preview.locator('[data-op-open-detail]').getAttribute('href'),href);
     await preview.locator('[data-op-open-detail]').click();
    }else await regular.click();
    await ready().catch(async error=>{
     console.error(product,area,page.url(),await page.locator('body').innerText().then(text=>text.slice(0,250)));throw error;
    });
    await page.locator('[data-historical-page]').waitFor();
   }
   await go(product,cu?'/overview':'/overview?from=2020-03-05&to=2020-03-05');
   if(cu){
    const form=page.locator('#dashboard-form');
    await form.locator('[name=from]').fill('2020-03-05');await form.locator('[name=to]').fill('2020-03-05');
    const refreshed=page.waitForResponse(response=>response.ok()&&response.url().includes('/v34/overview?')&&new URL(response.url()).searchParams.get('from')==='2020-03-05');
    await form.locator('button[type=submit],button.primary').first().click();
    await refreshed;
   }
   const filter=page.locator(cu?'#dashboard-form':'#co-overview-filter');
   assert.deepEqual(await filter.locator('input,select').evaluateAll(els=>els.map(node=>node.name)),['from','to','customer_id','contract_no']);
   const overview=page.locator('.oa-chart').filter({has:page.locator('[data-oa-plot=net]')});
   const plot=overview.locator('[data-oa-plot="net"]');
   await plot.locator('svg').waitFor();
   await plot.scrollIntoViewIfNeeded();
   await plot.hover({position:{x:130,y:70}});
   await plot.getByRole('tooltip').waitFor();
   assert.match(await plot.getByRole('tooltip').innerText(),/2020-03-05[\s\S]*出库净重/);
   await plot.getByRole('tooltip').screenshot({path:output+'/'+(cu?'cu':'co')+'-overview-tooltip.png'});
   if(!cu){
    const cards=page.locator('.oa-kpis-cobalt .oa-kpi > span');
    assert.deepEqual(await cards.allTextContents(),['备货作业中吨包','已备货待出库库存','装车中库存','在库库存预估金属量','ARECOMS确认车数与钴金属量','已出库重量']);
   }
   await filter.screenshot({path:output+'/'+(cu?'cu':'co')+'-overview-filters.png'});
   const bounds=await filter.evaluate(form=>{
    const first=form.querySelector('input').getBoundingClientRect(),last=form.querySelector('.wms-filter-actions').getBoundingClientRect(),outer=form.getBoundingClientRect();
    return {left:first.left-outer.left,right:outer.right-last.right,inputBottom:first.bottom,actionBottom:last.bottom};
   });
   assert(Math.abs(bounds.left-bounds.right)<4&&Math.abs(bounds.inputBottom-bounds.actionBottom)<5,JSON.stringify({product,bounds}));
   await page.screenshot({path:output+'/'+(cu?'cu':'co')+'-overview.png'});
   await overview.getByText('查看图表数据',{exact:true}).click();
   const period=overview.getByRole('row').filter({hasText:'2020-03-05'});
   await period.waitFor();assert(Number((await period.locator('td').nth(2).innerText()).replaceAll(',',''))>0);
   assert.equal(await page.locator('[data-history-overview]').count(),0);
   const endpoint=cu?'/v34/overview':'/cobalt/overview';
   await filter.locator('[name=contract_no]').fill('no-such-contract-'+id);
   const scoped=page.waitForResponse(response=>response.ok()&&new URL(response.url()).pathname==='/api/v1'+endpoint&&new URL(response.url()).searchParams.has('contract_no'));
   await filter.locator('button.primary').click();
   const scopedData=await (await scoped).json();
   assert.equal(scopedData.historical_imports,null);
   assert.equal(scopedData.chart_trend.rows.reduce((sum,r)=>sum+r.vehicles,0),0);
   proofs.push({product,defaultStockIncludesHistorical:true,businessLists:true,historicalOverview:true});
   const query=cu?'?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse}):'';
   for(const language of ['zh-CN','en']){
    await lang(language);
    await go(product,'/stock-map'+query);
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:900});
     const advanced=page.locator('.wms-map-advanced');
     if(cu){
      const cards=page.locator('#stock-map-metrics article');
      await cards.last().waitFor();
      assert.equal(await cards.count(),5);
      assert.equal(await advanced.count(),0);
      assert.equal(await page.locator('.map-app').evaluate(node=>node.firstElementChild.id),'stock-map-metrics');
      const labels=await cards.locator('span').allTextContents();
      assert.deepEqual(labels,language==='en'?['Occupied Locations','Unoccupied Locations','Occupied Locations in P1','Occupied Locations in P2','Occupied Locations in P3']:['已占用货位数','未占用货位数','P1库区占用货位数','P2库区占用货位数','P3库区占用货位数']);
      const zones=await page.locator('.wms-map-zones button').allTextContents();
      assert(zones.includes(language==='en'?'P3 Zone':'P3库区'));
      assert(!zones.some(label=>/P[45]/.test(label)));
      const position=await page.locator('#page-back').evaluate(button=>[button.getBoundingClientRect().left,document.getElementById('business-title').getBoundingClientRect().left]);
      assert(position[0]<=position[1]+1);
      assert(await page.locator('#stock-map-svg [data-map-cell^="P4-"] .map-code').first().textContent().then(code=>code.startsWith('P3-')));
      await page.screenshot({path:output+'/cu-map-'+language+'-'+width+'.png'});
      proofs.push({product,language,width,metrics:labels});
      continue;
     }
     await advanced.locator('summary').click();
     await advanced.locator('.wms-map-filter-fields').waitFor();
     const layout=await advanced.locator('.wms-map-filter-row').evaluate(form=>{
      const buttons=form.querySelector('.wms-filter-actions'),fields=form.querySelector('.wms-map-filter-fields'),bounds=form.getBoundingClientRect();
      return {left:Math.abs(fields.getBoundingClientRect().left-bounds.left)<3,right:Math.abs(buttons.getBoundingClientRect().right-bounds.right)<3,
       overflow:document.documentElement.scrollWidth>innerWidth+2,bounds:[bounds.x,bounds.width,buttons.getBoundingClientRect().x,buttons.getBoundingClientRect().width],css:[getComputedStyle(form).display,getComputedStyle(form).justifyContent,getComputedStyle(buttons).marginInlineStart,buttons.className,getComputedStyle(form).paddingRight,getComputedStyle(form).marginRight,[...form.children].map(n=>[n.className,n.tagName,n.getBoundingClientRect().width,getComputedStyle(n).position])]};
     });
     assert(layout.left&&layout.right&&!layout.overflow,JSON.stringify({product,language,width,layout}));
     await advanced.screenshot({path:output+'/'+(cu?'cu':'co')+'-map-tools-'+language+'-'+width+'.png'});
     await advanced.locator('summary').click();assert.equal(await advanced.getAttribute('open'),null);
     proofs.push({product,language,width,filters:layout});
    }
    await page.setViewportSize({width:1440,height:900});
   }
   if(!cu){
    await page.locator('#co-map-fit').click();
    let occupied=await page.evaluate(()=>CobaltMapSite.data.locations.find(l=>l.bags>0&&!l.temporary));
    let seal;
    if(!occupied){
     const slot=await page.evaluate(()=>{
      const canvas=document.getElementById('co-map-canvas').getBoundingClientRect();
      return CobaltMapSite.data.locations.find(l=>{
       const node=document.querySelector('[data-co-location="'+l.id+'"]'),r=node.getBoundingClientRect();
       return !l.occupied_by&&!l.temporary&&r.left>=canvas.left&&r.right<=canvas.right&&r.top>=canvas.top&&r.bottom<=canvas.bottom;
      });
     });
     assert(slot,'No visible empty surveyed location for the synthetic occupied case');
     seal=await occupyCobaltLocation(slot);
     await signIn();
     await page.reload();await ready();await page.locator('#co-map-fit').click();
     occupied=await page.evaluate(id=>CobaltMapSite.data.locations.find(l=>l.id===id),slot.id);
     assert.equal(occupied.bags,1);
    }
    const result=await page.locator('#co-map-svg').evaluate(svg=>{
     const codes=[...svg.querySelectorAll('[data-co-location]')].map(group=>{
      const text=group.querySelector('text'),first=text.querySelector('tspan')||text;
      return {code:first.textContent,actual:group.getAttribute('aria-label').split(' · ')[0],
       font:Number.parseFloat(getComputedStyle(text).fontSize)*Math.abs(svg.getScreenCTM().a),
       visible:getComputedStyle(text).visibility!=='hidden',bounds:first.getBoundingClientRect().toJSON()};
     });
     const overlap=codes.some((a,i)=>codes.slice(i+1).some(b=>a.bounds.left<b.bounds.right&&a.bounds.right>b.bounds.left&&a.bounds.top<b.bounds.bottom&&a.bounds.bottom>b.bounds.top));
     const canvas=svg.parentElement;
     return {codes,overlap,full:canvas.classList.contains('co-site-overview')&&canvas.scrollWidth<=canvas.clientWidth+1&&canvas.scrollHeight<=canvas.clientHeight+1&&
      svg.getAttribute('viewBox')===CobaltMapSite.data.site_plan.bounds.join(' ')};
    });
    assert.equal(result.codes.length,93);
    assert(result.full,'Fit shows the full site without scrolling');
    assert(result.codes.every(row=>row.code===row.actual&&row.visible&&row.font>0),JSON.stringify(result.codes.filter(row=>row.code!==row.actual||!row.visible||row.font<=0).slice(0,4)));
    assert(!result.overlap,'Location labels overlap at minimum zoom');
    await page.locator('#co-map-canvas').screenshot({path:output+'/co-map-minimum.png'});
    const cell=page.locator('[data-co-location="'+occupied.id+'"]');
    await cell.click();
    const detail=page.locator('#co-map-detail:not([hidden])');
    await detail.getByRole('heading',{name:occupied.code,exact:true}).waitFor();
    await detail.locator('.map465-bags article').first().waitFor();
    const factsAligned=await detail.locator('dl').evaluate(node=>{
     const rows=[...node.children].map(row=>row.getBoundingClientRect());
     return rows.length>1&&rows.every((row,index)=>Math.abs(row.left-rows[0].left)<1&&(!index||row.top>=rows[index-1].bottom));
    });
    assert(factsAligned,'Location detail facts are aligned in one column');
    if(seal)await detail.getByText(seal,{exact:false}).waitFor();
    await page.screenshot({path:output+'/co-map-minimum-occupied.png'});
    await detail.locator('.map465-close').click();
    const empty=page.locator('[data-co-location][data-stock-state="EMPTY"]').first();
    await empty.press('Enter');await detail.getByText('No physical stock is recorded here.').waitFor();
    await detail.locator('.map465-close').click();
    const canvas=page.locator('#co-map-canvas'),svg=page.locator('#co-map-svg');
    const size=await svg.boundingBox();
    const transition=page.evaluate(()=>new Promise(resolve=>{
     const svg=document.getElementById('co-map-svg'),samples=[];
     const start=performance.now();
     const read=()=>{samples.push(svg.viewBox.baseVal.width);if(performance.now()-start<450)requestAnimationFrame(read);else resolve(samples);};
     requestAnimationFrame(read);
    }));
    await page.locator('#co-map-in').click();
    const zoomFrames=await transition;
    assert(new Set(zoomFrames).size>=4,'Zoom traverses intermediate scales');
    assert.equal((await svg.boundingBox()).width,size.width,'Zoom preserves canvas width');
    const before=await svg.getAttribute('viewBox'),box=await canvas.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+25,{steps:6});await page.mouse.up();
    assert.notEqual(await svg.getAttribute('viewBox'),before,'Zoomed cobalt map can pan');
    await page.locator('#co-map-out').click();
    await page.waitForFunction(()=>document.getElementById('co-map-svg').getAttribute('viewBox')===CobaltMapSite.data.site_plan.bounds.join(' '));
    proofs.push({cobaltMinimum:true,codes:result.codes.length,minimumFont:Math.min(...result.codes.map(row=>row.font)),noOverlap:true,
     emptyKeyboardDetail:true,occupiedClickDetail:true,occupiedBags:occupied.bags,detailFactsAligned:factsAligned,zoomedPan:true});
   }
  }
  fs.writeFileSync(output+'/browser.json',JSON.stringify(proofs,null,2)+'\n');
  console.log(JSON.stringify(proofs));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
