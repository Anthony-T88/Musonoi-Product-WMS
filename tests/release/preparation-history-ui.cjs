'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const X=require('xlsx'),{chromium}=require('playwright'),E=require('./environment.cjs'),P=require('./preparation-fixture.cjs');
const {migrate}=require('../../scripts/production-db.cjs');
const products=['CU_CATHODE','CO_HYDROXIDE'];
const cobalt=product=>product==='CO_HYDROXIDE';
const prefix=product=>cobalt(product)?'/cobalt':'';
const routes={RECEIPT:'/receipts',LOADING_PLAN:'/loading-plans',LOADING_ORDER:'/outbounds',OUTBOUND:'/stock-outbound'};

async function archive(api,f,product,suffix=''){
 const co=cobalt(product),tag=(co?'QA-CO':'QA-CU')+suffix,lot=P.batch(product,suffix?702:701),document='QA-PL-'+tag;
 const rows=Array.from({length:29},()=>[]);
 rows[0]=['PACKING LIST'];rows[2]=['','','','Packing List No:',document];rows[3]=['','','','Lot No:',lot];
 rows[6]=['','','','Shipping Date:','2020-03-05'];rows[21]=['Synthetic '+(co?'CO-AUDIT':'CU-AUDIT'),'','','','QA-TRUCK-'+tag];
 rows[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
 rows.push([1,'Synthetic',tag+'-001',co?null:48,tag+'-SEAL1',647,650],
  [2,'Synthetic',tag+'-002',co?null:48,tag+'-SEAL2',653,656],['Total',null,null,null,null,1300,1306]);
 const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'PL');
 const file={file_name:document+'.xlsx',file_base64:X.write(wb,{type:'base64',bookType:'xlsx'}),warehouse_id:f.warehouse};
 const base='/historical-movements/batch',validated=(await api('admin',product,base+'/preview',{files:[file]})).results[0];
 assert(validated.importable,JSON.stringify(validated.issues));
 const loaded=(await api('admin',product,base+'/confirm',{files:[{...file,preview_token:validated.preview_token}]})).results[0];
 assert.equal(loaded.status,'IMPORTED');
 const record=await api('admin',product,'/historical-movements/'+loaded.id);
 return {source:loaded.id,document,idByKind:Object.fromEntries(record.documents.map(doc=>[doc.kind,doc.id])),unitTag:tag};
}

test('copper and cobalt preparation batches and historical navigation on independent TEST',async t=>{
 const {client:c,name}=await E.database();let app,browser;
 try{
  await migrate(c,{apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD,environment:'test'});
  const f=await E.seed(c,name),port=4397,origin='http://127.0.0.1:'+port;
  app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin}});
  const sessions=new Map();
  async function login(role){
   const account=f.accounts.find(a=>a.role===role),r=await app.inject({method:'POST',url:'/api/v1/auth/login',
    remoteAddress:'127.78.0.'+(f.accounts.indexOf(account)+1),headers:{origin},payload:{username:account.username,password:account.password}});
   assert.equal(r.statusCode,200);
   const headers={origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};
   sessions.set(role,headers);return headers;
  }
  async function request(role,product,url,body,key=crypto.randomUUID()){
   return app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{
    ...(sessions.get(role)||await login(role)),'x-product-code':product,'idempotency-key':key},...(body?{payload:body}:{})});
  }
  async function api(role,product,url,body,expected=200){
   const r=await request(role,product,url,body);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,350));return r.json();
  }
  const fixtures={};
  for(const product of products)await t.test(product+' scoped lookup, validation, atomic save and replay',async()=>{
   const plan=await P.salesPlan(api,f,product),base=prefix(product)+'/preparation-plans';
   const item=n=>({sales_plan_id:plan,shipment_month:P.localMonth(),batch_no:P.batch(product,n)});
   const occupied=await P.approved(api,product,plan,item(780).batch_no);
   const approval=(await api('export_supervisor',product,base+'/'+occupied.id))._approval;
   assert.equal(approval.kind,'preparation-plan');
   assert.deepEqual(approval.history.items.map(row=>[row.action,row.role_code]),[
    ['APPROVE','logistics_manager'],['SUBMIT','export_supervisor'],['CREATE','export_supervisor']
   ]);
   const searched=await api('export_supervisor',product,base+'/occupied?'+new URLSearchParams({search:item(780).batch_no}));
   assert.equal(searched.items.length,1);assert.equal(searched.items[0].state,'APPROVED');
   const customer=searched.items[0].customer_name;
   assert.match(customer,/Synthetic/);
   assert((await api('export_supervisor',product,base+'/occupied?'+new URLSearchParams({search:customer}))).items.some(row=>row.batch_no===item(780).batch_no));
   await api('production_operator',product,base+'/occupied',null,403);
   await api('production_operator',product,base+'/batch',{items:[item(786)]},403);
   const validation=await api('export_supervisor',product,base+'/batch/preview',{items:[item(780),item(781),item(782),item(782)]});
   assert.deepEqual(validation.items.map(r=>r.error),['备货批次号已占用',null,'录入表内重复','录入表内重复']);
   await api('export_supervisor',product,base+'/batch',{items:[item(781),item(780)]},409);
   assert(!(await api('export_supervisor',product,base+'?search='+item(781).batch_no)).total);
   const body={items:[item(783),item(784)]},key=crypto.randomUUID();
   const first=await request('export_supervisor',product,base+'/batch',body,key);
   assert.equal(first.statusCode,200,first.body);
   assert(first.json().items.every(row=>row.state==='DRAFT'));
   const repeated=await request('export_supervisor',product,base+'/batch',body,key);
   assert.deepEqual(repeated.json(),first.json());
   const receipt=await api('export_supervisor',product,base+'/operations/status?'+new URLSearchParams({method:'POST',path:base+'/batch',key}));
   assert.equal(receipt.committed,true);
   const race=await Promise.all([request('export_supervisor',product,base+'/batch',{items:[item(787),item(788)]}),
    request('export_supervisor',product,base+'/batch',{items:[item(787),item(789)]})]);
   assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409]);
   const failedLot=race[0].statusCode===409?788:789;
   assert.equal((await api('export_supervisor',product,base+'?search='+item(failedLot).batch_no)).total,0);
   fixtures[product]={plan,customer,occupied,item,history:await archive(api,f,product)};
  });
  assert(products.every(product=>fixtures[product]),'Required copper and cobalt fixtures were created');
  await app.listen({port,host:'127.0.0.1'});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  await t.test('startup and offline status localize while login language options keep their native names',async()=>{
   const page=await browser.newPage();
   let respond;
   const release=new Promise(resolve=>{respond=resolve;});
   try{
    await page.addInitScript(()=>localStorage.setItem('musonoi-language','en'));
    await page.route('**/api/v1/config',async route=>{await release;await route.continue();});
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('#session-restore').getByText('Opening page…',{exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('#session-restore').innerText(),/\p{Script=Han}/u);
    respond();
    await page.locator('#login-panel').waitFor();
    const languages=page.locator('.login46-languages');
    for(const language of ['en','zh-CN','en']){
     await languages.locator('[data-login-language="'+language+'"]').click();
     await page.waitForFunction(code=>document.documentElement.lang===code,language);
     assert.equal(await languages.locator('.login46-language-label').innerText(),'语言/Language');
     assert.deepEqual(await languages.locator('[data-login-language]').allTextContents(),['中文','English']);
    }
    await page.goto(origin+'/offline.html');
    assert.match(await page.locator('main:visible').innerText(),/Product WMS · Offline/);
    assert.doesNotMatch(await page.locator('main:visible').innerText(),/\p{Script=Han}/u);
   }finally{respond();await page.close();}
  });
  async function open(role,product,width){
   const a=f.accounts.find(x=>x.role===role),ctx=await browser.newContext({viewport:{width,height:900}});
   const r=await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:a.username,password:a.password}});
   assert.equal(r.status(),200);
   const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(code=>localStorage.setItem('musonoi-product',code),product);
   await page.goto(origin+'/overview');
   await page.waitForFunction(()=>window.AppSignedIn&&typeof ProductContext!=='undefined'&&!document.querySelector('#session-restore:not([hidden])'));
   if(await page.evaluate(()=>ProductContext.code)!==product)await page.evaluate(code=>ProductContext.switchTo(code),product);
   await page.waitForFunction(()=>!document.body.classList.contains('boot-pending')&&!Router.rendering);
   await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
   return {ctx,page,errors};
  }
  for(const product of products)await t.test(product+' actual browser entry, save, document links and returns',async()=>{
   const co=cobalt(product),fx=fixtures[product],width=co?390:1440;
   const {ctx,page,errors}=await open('export_supervisor',product,width);
   try{
    await page.evaluate(()=>I18n.change('en'));
    await page.goto(origin+'/preparation/work-plans/'+fx.occupied.id);
    const approvals=page.locator('.preparation-plan-approval-slot .r10-history');
    const languagePicker=page.locator('.top-actions .system-language');
    const assertPicker=async language=>{
     assert.equal(await languagePicker.locator('span').textContent(),'语言/Language');
     assert.deepEqual(await languagePicker.locator('option').allTextContents(),['中文','English']);
     assert.equal(await languagePicker.locator('select').inputValue(),language);
    };
    await approvals.getByRole('heading',{name:'Approval History'}).waitFor();
    await assertPicker('en');
    assert.deepEqual(await approvals.locator('thead th').allTextContents(),['Time','Step / Action','Name','Role','Result','Review Note']);
    assert.equal(await approvals.locator('tr[data-role-basis="RECORDED"]').count(),3);
    await approvals.getByText('Submitted for Review',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Approval history must fit the viewport');
    await page.evaluate(()=>I18n.change('zh-CN'));
    await approvals.getByRole('heading',{name:'审批历史'}).waitFor();
    await assertPicker('zh-CN');
    await page.goto(origin+'/preparation/work-plans');
    await page.locator('#preparation-plan-create').click();
    await page.waitForURL('**/preparation/work-plans/new');
    const body=page.locator('#preparation-batch-table tbody');
    const saveDrafts=page.locator('#preparation-plan-batch').getByRole('button',{name:/^(保存草稿|Save Drafts)$/});
    const sales=body.locator('select').first();await sales.locator('option[value="'+fx.plan+'"]').waitFor({state:'attached'});await sales.selectOption(fx.plan);
    assert.equal(await body.locator('input[name=customer]').first().inputValue(),fx.customer);
    const lookup=page.locator('#preparation-occupied-filter');await lookup.locator('input').fill(fx.occupied.batch_no);
    await lookup.locator('button[type=submit]').click();
    await page.locator('#preparation-occupied-table').getByText(fx.occupied.batch_no,{exact:true}).waitFor().catch(async e=>{
     throw Error(await page.locator('#preparation-occupied-results').innerText(),{cause:e});});
    assert.match(await page.locator('#preparation-occupied-table').innerText(),new RegExp(fx.customer));
    await page.locator('#preparation-batch-paste').click();
    await page.locator('#preparation-paste-text').fill(fx.occupied.batch_no+'\n'+fx.item(791).batch_no);
    await page.locator('#preparation-paste-insert').click();
    assert.equal(await body.locator('tr').count(),2);
    await saveDrafts.click();
    await body.locator('tr').first().locator('[data-batch-validation]').getByText(/占用|occupied/i).waitFor();
    assert.equal(await body.locator('input[name=batch_no]').nth(1).inputValue(),fx.item(791).batch_no);
    await body.locator('input[name=batch_no]').first().fill(fx.item(790).batch_no);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Batch entry must fit the viewport');
    await page.screenshot({path:path.join(E.runtime,'v483-preparation-'+product+'.png'),fullPage:true});
    await saveDrafts.click();
    await page.waitForURL('**/preparation/work-plans?state=DRAFT');
    await page.locator('#preparation-plans-table').getByText(fx.item(790).batch_no,{exact:true}).waitFor();
    assert.equal(await page.locator('.wms-batch-created').count(),2);
    assert.deepEqual(errors,[]);
   }finally{await ctx.close();}
   const hist=await open('admin',product,width);
   try{
    const h=fx.history,loadPath=routes.LOADING_ORDER+'/historical/'+h.idByKind.LOADING_ORDER,
     outPath=routes.OUTBOUND+'/historical/'+h.idByKind.OUTBOUND,
     receiptPath=routes.RECEIPT+'/historical/'+h.idByKind.RECEIPT,
     planPath=routes.LOADING_PLAN+'/historical/'+h.idByKind.LOADING_PLAN,
     listPath='/outbounds?search='+encodeURIComponent(h.document),sourcePath='/workbench/historical-movements/'+h.source+'?product='+product;
    await hist.page.goto(origin+listPath);
    await hist.page.locator('a[href="'+loadPath+'"]').last().click();
    await hist.page.waitForURL(origin+loadPath);
    const ready=()=>hist.page.waitForFunction(()=>Router.current===location.pathname&&!Router.rendering&&!document.body.classList.contains('wms-navigating'));
    async function link(url){
     await hist.page.locator('.wms-historical-links a[href="'+url+'"]').click();
     await hist.page.waitForURL(origin+url);await ready();
    }
    const back=async()=>{
     await ready();
     await hist.page.locator('[data-historical-back]').click().catch(async e=>{
      throw Error(JSON.stringify(await hist.page.evaluate(()=>({location:location.pathname,state:history.state,title:document.querySelector('#business-title').textContent}))),{cause:e});
     });
    };
    await link(outPath);await link(receiptPath);
    assert.match(await hist.page.locator('.wms-historical-detail').innerText(),/历史补录记账日|Historical Posting Date/);
    await link(planPath);await back();await hist.page.waitForURL(origin+receiptPath);
    await back();await hist.page.waitForURL(origin+outPath);
    const archive=hist.page.locator('.wms-historical-links a[href^="/inventory/historical/"]'),stockPath=await archive.getAttribute('href');
    await archive.click();await hist.page.waitForURL(origin+stockPath);await ready();
    assert.match(await hist.page.locator('.wms-historical-detail').innerText(),co?/0\.46800/:/QA-CU-001/);
    await hist.page.screenshot({path:path.join(E.runtime,'v483-historical-'+product+'.png'),fullPage:true});
    await link(sourcePath);await hist.page.locator('#historical-source').waitFor();
    await back();await hist.page.waitForURL(origin+stockPath);await back();await hist.page.waitForURL(origin+outPath);
    await back();await hist.page.waitForURL(origin+loadPath);await back();await hist.page.waitForURL(origin+listPath);
    assert.deepEqual(hist.errors,[]);
   }finally{await hist.ctx.close();}
  });

  for(const product of products)await t.test(product+' open inbound and outbound lists refresh after void',async()=>{
   await login('admin');
   const removed=fixtures[product].history,kept=await archive(api,f,product,'-KEPT');
   fixtures[product].kept=kept;
   const {ctx,page}=await open('admin',product,1440);
   try{
    const pages=await Promise.all([ctx.newPage(),ctx.newPage()]);
    const locations=[['/receipts','RECEIPT'],['/outbounds?state=OUTBOUND','LOADING_ORDER']];
    const links=(i,record)=>pages[i].locator('a[href="'+routes[locations[i][1]]+'/historical/'+record.idByKind[locations[i][1]]+'"]').first();
    await Promise.all(locations.map(async([url],i)=>{
     await pages[i].goto(origin+url);
     await links(i,removed).waitFor({timeout:12000});
     await links(i,kept).waitFor({timeout:12000});
    }));
    await page.goto(origin+'/workbench/historical-movements/'+removed.source+'?product='+product);
    await page.locator('#historical-void textarea').fill('Void a single synthetic source in another tab');
    await page.locator('#historical-void button').click();
    await page.locator('#operation-confirm-accept').click();
    await page.locator('[data-import-state="voided"]').waitFor();
    await Promise.all(locations.map(async([url],i)=>{
     await links(i,removed).waitFor({state:'detached',timeout:6000});
     await links(i,kept).waitFor({timeout:6000});
     assert.equal(pages[i].url(),origin+url);
    }));
   }finally{await ctx.close();}
  });

  await t.test('filter and bulk void mixed-product historical documents with one audit per source',async()=>{
   const [cu,co]=products,endpoint='/historical-movements/batch/void';
   await login('admin');
   const ids=products.map(product=>fixtures[product].kept.source),reason='Synthetic mixed-product bulk correction';
   await api('production_operator',cu,endpoint,{ids,reason},403);
   await api('admin',cu,endpoint,{ids:[ids[0],ids[0].toUpperCase()],reason},400);
   await api('admin',cu,endpoint,{ids:[ids[0],crypto.randomUUID()],reason},404);
   await api('admin',cu,endpoint,{ids:[ids[0],fixtures[cu].history.source],reason},409);
   const active=(await api('admin',cu,'/historical-movements?all_products=1&state=ACTIVE')).items;
   assert.deepEqual(active.map(row=>row.id).sort(),[...ids].sort());
   assert.equal(active.every(row=>!row.voided_at),true);
   await api('admin',cu,'/historical-movements?state=UNKNOWN',null,400);
   const {ctx,page}=await open('admin',co,390);
   try{
    await page.goto(origin+'/workbench/historical-movements');
    const filter=page.locator('#historical-filter'),state=filter.locator('[name=state]');
    await state.selectOption('VOIDED');
    await filter.locator('button[type="submit"]').click();
    await page.locator('#historical-ledger [data-import-state="voided"]').first().waitFor();
    assert.equal(await page.locator('#historical-bulk-void').count(),0);
    await state.selectOption('ACTIVE');
    await filter.locator('button[type="submit"]').click();
    const selected=page.locator('#historical-ledger [data-historical-select]');
    await selected.first().waitFor();
    assert.equal(await selected.count(),2);
    const bulk=page.locator('#historical-bulk-void');
    assert(await bulk.isDisabled());
    for(const width of [390,1440]){
     await page.setViewportSize({width,height:900});
     assert(await bulk.evaluate(button=>Math.abs(button.getBoundingClientRect().right-button.closest('.wms-action-bar').getBoundingClientRect().right)<2));
    }
    await page.locator('#historical-void-all').check();
    await bulk.click();
    await page.locator('#operation-confirm-cancel').click();
    assert.equal(await page.locator('#historical-ledger [data-historical-select]:checked').count(),2);
    await bulk.click();
    await page.locator('#operation-confirm-comment').fill(reason);
    const completed=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');
    await page.locator('#operation-confirm-accept').click();
    const response=await completed;
    assert.equal(response.status(),200,await response.text());
    assert.equal((await response.json()).count,2);
    await page.locator('#historical-void-all').waitFor({state:'detached'});
    assert.equal(new URL(page.url()).searchParams.get('state'),'ACTIVE');
   }finally{await ctx.close();}
   await login('admin');
   assert.equal((await api('admin',co,endpoint,{ids,reason})).count,2);
   const archived=(await api('admin',co,'/historical-movements?all_products=1&state=VOIDED')).items;
   assert.equal(archived.length,4);
   assert.equal(archived.filter(row=>row.void_reason===reason).length,2);
   const {rows:[audit]}=await c.query("SELECT count(*)::int n FROM audit_logs WHERE action='historical_movement_voided' AND entity_id=ANY($1::text[])",[ids]);
   assert.equal(audit.n,2);
   const {rows:[stock]}=await c.query('SELECT count(*)::int n FROM historical_outbound_units WHERE source_id=ANY($1::uuid[])',[ids]);
   assert.equal(stock.n,0);
  });

  for(const product of products)await t.test(product+' saves, confirms and clears the same arrival row',async()=>{
   await login('admin');
   const co=cobalt(product),plan=fixtures[product].plan,plate=co?'QA-CO-YARD':'QA-CU-YARD';
   const dispatch=(co?'/cobalt/sales':'')+'/plans/'+plan+'/dispatch',info=await api('admin',product,dispatch);
   const workbook=X.utils.book_new();
   X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet([['HORSE','TON'],[plate,30]]),'Dispatch');
   const file={file_name:'arrival.xlsx',mapping:{sheet:'Dispatch',header_row:1,truck_column:1,capacity_column:2,capacity_kg:false},
    file_base64:X.write(workbook,{type:'base64',bookType:'xlsx'}),...(co?{plan_version:info.plan.version}:{})};
   const preview=await api('admin',product,dispatch+'/import-preview',file);
   await api('admin',product,dispatch+(co?'/import':''),{...file,shipment_month:preview.shipment_month,preview_sha256:preview.file_sha256});
   const vehicle=(await api('admin',product,dispatch)).vehicles.find(row=>row.truck_no===plate);
   assert(vehicle);
   const endpoint=(co?'/cobalt/sales':'/loading-plans')+'/arrivals';
   const contact={trailer_one:plate+'-TRL',driver_name:plate+' Driver',passport_no:plate+'-PASS',arrived_at:new Date(Date.now()-120000).toISOString(),
    ...(co?{transporter:'Synthetic Carrier',dispatch_version:vehicle.version}:{})};
   const registration=await api('admin',product,endpoint+'/'+vehicle.id,contact);
   await api('production_operator',product,endpoint+'/'+vehicle.id,{action:'CLEAR',version:registration.version},403);
   const preparation=co?await api('admin',product,'/cobalt/preparations',{
    preparation_plan_id:fixtures[product].occupied.id,project_id:f.project,warehouse_id:f.warehouse,total_bags:1}):null;
   const {ctx,page}=await open('admin',product,co?390:1440);
   try{
    const list=origin+'/loading-plans?tab=arrivals&shipment_month='+preview.shipment_month;
    await page.goto(list);
    const row=page.locator((co?'#co-arrivals-table':'#cu-arrivals-table')+' tbody tr').filter({hasText:plate});
    const edit=()=>row.locator('a[href*="vehicle_id"]').click();
    const form=page.locator(co?'#co-arrival-form':'#yard-arrival-form');
    const confirmed=()=>row.locator('a[href^="/loading-plans/new"]').waitFor();
    await confirmed();await edit();
    await form.locator('[name=driver_name]').fill('');
    await form.locator('[data-arrival-save]').click();
    await row.getByText(/待修改确认|Pending Confirmation/).waitFor();
    assert.equal(await row.count(),1);
    assert.equal(await page.locator('[data-document-draft-row]').count(),0);
    assert.equal(await row.locator('a[href^="/loading-plans/new"]').count(),0);
    const path=co?'/cobalt/loading/plans':'/loading-plans/unified';
    const blocked=await ctx.request.post(origin+'/api/v1'+path,{headers:{origin,'x-product-code':product,
     'x-csrf-token':await page.evaluate(()=>API.csrfToken),'idempotency-key':crypto.randomUUID()},
     data:{sales_plan_id:plan,arrival_id:registration.id,...(co?{preparation_id:preparation.id}:{})}});
    assert.equal(blocked.status(),409,await blocked.text());
    assert.match(await blocked.text(),/CO_LOADING_ARRIVAL_INVALID|尚未确认/);
    await edit();await form.locator('[name=driver_name]').waitFor();
    assert.equal(await form.locator('[name=driver_name]').inputValue(),'');
    await form.locator('[name=driver_name]').fill(contact.driver_name);
    await form.locator('button[type=submit]').click();
    await page.locator('#operation-confirm-accept').click();
    await confirmed();await edit();
    await form.locator('[data-arrival-clear]').click();
    await page.locator('#operation-confirm-accept').click();
    await row.getByText(/待到厂登记|Awaiting Arrival/).waitFor();
    assert.equal(await row.locator('a[href^="/loading-plans/new"]').count(),0);
    const table=co?'co_vehicle_arrivals':'vehicle_arrivals';
    const {rows:[saved]}=await c.query('SELECT id,registration_phase,arrived_at,trailer_one,driver_name,passport_no FROM '+table+' WHERE dispatch_vehicle_id=$1',[vehicle.id]);
    assert.deepEqual(saved,{id:registration.id,registration_phase:'CLEARED',arrived_at:null,trailer_one:'',driver_name:'',passport_no:''});
   }finally{await ctx.close();}
  });
 }finally{await browser?.close();await app?.close();await c.end();}
});
