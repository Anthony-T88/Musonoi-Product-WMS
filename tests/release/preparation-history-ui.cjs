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
  app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin,trustedProxyIps:'127.0.0.1'}});
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
  for(const product of products)await t.test(product+' reopens the same approved plan after formal work cancellation',async()=>{
   const co=cobalt(product),fx=fixtures[product],base=prefix(product)+'/preparation-plans';
   const item=fx.item(798),work=await P.approved(api,product,fx.plan,item.batch_no);
   let url,payload;
   if(co){
    url='/cobalt/preparations';
    payload={project_id:f.project,warehouse_id:f.warehouse,total_bags:1};
   }else{
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const draft=await api('production_operator',product,'/receipts',{project_id:f.project,
     lines:[{bundle_no:'MUS-'+day.slice(0,4)+'-035-798',sheets_per_bundle:48,production_date:day,inbound_at:new Date().toISOString()}]});
    const submitted=await api('production_operator',product,'/receipts/'+draft.id+'/submit',{version:draft.version});
    await api('production_manager',product,'/receipts/'+draft.id+'/confirm',{version:submitted.version});
    const {rows:[bundle]}=await c.query('SELECT id FROM bundles WHERE receipt_id=$1',[draft.id]);
    await c.query("UPDATE stock_map_source SET status='VERIFIED',source_sha256=$1,source_name='Synthetic CI geometry',notes='Synthetic test only'",[crypto.createHash('sha256').update('PREPARATION REUSE GEOMETRY').digest('hex')]);
    await c.query("UPDATE stock_map_cells SET x=0,y=0,width=100,height=100 WHERE code='P1-01'");
    const slot=await api('admin',product,'/masters/locations',{project_id:f.project,warehouse_id:f.warehouse,code:'P1-01',active:true});
    await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code='P1-01' WHERE id=$1",[slot.id]);
    url='/v261/lots';
    payload={planned_location_id:slot.id,items:[{bundle_id:bundle.id,sample_required:false}]};
   }
   const create=plan=>api('admin',product,url,{...payload,preparation_plan_id:plan});
   const first=await create(work.id),lookup=base+'/occupied?'+new URLSearchParams({search:item.batch_no});
   const batch=body=>api('export_supervisor',product,base+'/batch/preview',{items:[body]});
   assert.equal((await batch(item)).items[0].error,'备货批次号已占用');
   assert((await api('export_supervisor',product,lookup)).items.some(row=>row.batch_no===item.batch_no));
   const reason='Synthetic pre-final-approval cancellation';
   if(co){
    const withdrawn=await api('admin',product,url+'/'+first.id+'/withdraw',{version:first.version,reason});
    assert.equal(withdrawn.status,'WITHDRAWN');
   }else{
    const weighed=(await api('admin',product,'/v262/lots/'+first.id+'/weigh',{version:first.version,
     items:(await api('admin',product,url+'/'+first.id)).items.map(row=>({bundle_id:row.id,item_version:row.item_version,gross_weight:'2.0350',seal_no:'REUSE-798'}))})).lot;
    const pending=await api('admin',product,url+'/'+first.id+'/submit',{version:weighed.version});
    const withdrawn=await api('admin',product,'/v262/lots/'+first.id+'/withdraw',{version:pending.version});
    assert.equal((await batch(item)).items[0].error,'备货批次号已占用');
    const cancelled=await api('admin',product,'/v262/lots/'+first.id+'/revoke',
     {version:withdrawn.version,reason,work_stopped:true,physical_state_verified:true,observation:'Synthetic physical state checked'});
    assert.equal(cancelled.workflow_state,'CANCELLED');
   }
   const old=await api('export_supervisor',product,base+'/'+work.id);
   assert.equal(old.state,'APPROVED');
   assert.equal(old[co?'co_preparation_id':'allocation_id'],null);
   assert(!old.actions.edit);
   assert.deepEqual(old.events.filter(event=>event.action==='WORK_CANCEL').map(event=>event.reason),[reason]);
   assert(old._approval.history.items.some(row=>row.action==='WORK_CANCEL'&&row.note===reason));
   assert(old._approval.history.items.some(row=>row.action==='APPROVE'));
   assert((await api('export_supervisor',product,lookup)).items.some(row=>row.batch_no===item.batch_no));
   assert.equal((await batch(item)).items[0].error,'备货批次号已占用');
   const available=await api('admin',product,base+'?executable=1&search='+item.batch_no);
   assert.equal(available.items[0].id,work.id);
   const second=await create(work.id);
   assert.notEqual(second.id,first.id);
   assert.equal(second[co?'preparation_batch_no':'lot_no'],item.batch_no);
   const legacy=await api('admin',product,url+'/'+first.id);
   assert.equal(co?legacy.status:legacy.workflow_state,co?'WITHDRAWN':'CANCELLED');
   assert.equal((await batch(item)).items[0].error,'备货批次号已占用');
  });
  for(const product of products)await t.test(product+' links reviewed historical trips, confirms invoices and records historical exits',async()=>{
   const co=cobalt(product),plan=fixtures[product].plan,alternate=await P.salesPlan(api,f,product);
   const plate=co?'AUDIT-CO-REPEAT':'AUDIT-CU-REPEAT',month=P.localMonth(),day=month+'-01';
   const dispatch=async (plan,truck=plate)=>{
    const base=(co?'/cobalt/sales':'')+'/plans/'+plan+'/dispatch',info=await api('admin',product,base);
    const workbook=X.utils.book_new();
    X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet([['HORSE','TON','TRANSPORTEUR','DESTINATION'],[truck,30,'Synthetic Transport','Synthetic Destination']]),'Dispatch');
    const file={file_name:'historical-trips.xlsx',mapping:{sheet:'Dispatch',header_row:1,truck_column:1,capacity_column:2,capacity_kg:false},
     file_base64:X.write(workbook,{type:'base64',bookType:'xlsx'}),...(co?{plan_version:info.plan.version}:{})};
    const preview=await api('admin',product,base+'/import-preview',file);
    assert.equal(preview.items[0].transporter,'Synthetic Transport');
    await api('admin',product,base+(co?'/import':''),{...file,shipment_month:preview.shipment_month,preview_sha256:preview.file_sha256});
    return (await api('admin',product,base)).vehicles.find(row=>row.truck_no===truck);
   };
   const first=await dispatch(plan),second=await dispatch(alternate);
   assert.equal(first.transporter,'Synthetic Transport');
   assert.equal(second.destination,'Synthetic Destination');
   const contractTable=co?'co_sales_contracts':'customer_contracts';
   const {rows:[contract]}=await c.query('SELECT contract_no FROM '+contractTable+' WHERE id=$1',[f.customers[product].contract]);
   async function importTrip(suffix,shippingDay=day,truck=plate){
    const tag=truck+'-'+suffix,rows=Array.from({length:29},()=>[]);
    rows[0]=['PACKING LIST'];rows[2]=['','','','Packing List No:',tag+'-PL'];rows[3]=['','','','Lot No:',tag+'-LOT'];
    rows[4]=['','','','Contract No:',contract.contract_no];rows[6]=['','','','Shipping Date:',shippingDay];
    rows[21]=['Synthetic '+(co?'CO-AUDIT':'CU-AUDIT'),'','','',truck.replaceAll('-',' ')];
    rows[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
    rows.push([1,'Synthetic',tag+'-UNIT',co?null:48,tag+'-SEAL',647,650],['Total',null,null,null,null,647,650]);
    const workbook=X.utils.book_new();
    X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet(rows),'PL');
    X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet([[],[],['','','','Invoice No:',tag+'-INV']]),'INV');
    const file={file_name:tag+'.xlsx',file_base64:X.write(workbook,{type:'base64',bookType:'xlsx'}),warehouse_id:f.warehouse};
    const base='/historical-movements/batch';
    const [preview]=(await api('admin',product,base+'/preview',{files:[file]})).results;
    assert(preview.importable,JSON.stringify(preview.issues));
    const [result]=(await api('admin',product,base+'/confirm',{files:[{...file,preview_token:preview.preview_token}]})).results;
    assert.equal(result.status,'IMPORTED');
    return {id:result.id,tag};
   }
   const trip=await importTrip('FIRST'),other=await importTrip('SECOND'),older=await importTrip('OLDER','2020-03-05');
   const sales=prefix(product)+'/sales-workflow/plans/';
   const matches=(await api('admin',product,sales+plan+'/historical-matches')).items;
   assert.deepEqual(new Set(matches.map(row=>row.source_id)),new Set([trip.id,other.id]));
   assert(matches.every(row=>row.dispatch_id===first.id&&row.dispatch_matches===2&&row.source_matches===2));
   assert.deepEqual(await api('admin',product,sales+plan+'/historical-matches',{automatic:true}),{linked:0,ambiguous:2});
   const choice={source_id:trip.id,dispatch_id:first.id};
   await api('admin',product,sales+plan+'/historical-matches',choice,409);
   await api('admin',product,sales+plan+'/historical-matches',{...choice,verified_trip:true});
   await api('admin',product,sales+alternate+'/historical-matches',{source_id:older.id,dispatch_id:second.id,verified_trip:true},409);
   fixtures[product].historicalTrip={alternate,other,older};
   let detail=await api('admin',product,sales+plan);
   const batch=detail.posted_batches.find(row=>row.historical_source_id===trip.id);
   assert.equal(batch.source_invoice_no,trip.tag+'-INV');
   assert.equal(Number(batch.net_mt),0.647);
   await api('admin',product,sales+plan+'/confirm-invoice',{loading_id:trip.id,batch_id:trip.id,invoice_no:trip.tag+'-INV'});
   detail=await api('admin',product,sales+plan);
   assert.equal(Number(detail.execution.invoiced),0.647);
   const archived=(await api('admin',product,'/historical-movements?'+new URLSearchParams({batch_no:trip.tag,document_no:trip.tag,business_date:day,from:day,to:day,state:'ACTIVE'}))).items;
   assert.deepEqual(archived.map(row=>row.id),[trip.id]);
   const gate=prefix(product)+'/gate-permits';
   const exited=(await api('admin',product,gate+'?'+new URLSearchParams({state:'EXITED',truck_no:plate.replaceAll('-',' ')}))).items;
   assert.equal(exited.length,3);
   assert(exited.every(row=>row.state==='EXITED'&&row.approved_at===null&&row.actual_exit_at===null&&row.historical_detail_id));
   assert.equal((await api('admin',product,gate+'?state=EXITED&approved_on='+day)).total,0);
   const historyIds=new Set((await api('admin',product,gate+'?state=EXITED')).items.map(row=>row.historical_source_id));
   assert([trip.id,other.id,older.id].every(id=>historyIds.has(id)));
   const numbering=prefix(product)+'/export-permits/invoice-number?'+new URLSearchParams({sales_plan_id:plan});
   assert((await api('admin',product,numbering)).invoice_preview.endsWith('-01'));
   assert.deepEqual(await api('admin',product,numbering+'&'+new URLSearchParams({invoice_no:trip.tag+'-INV'})),{duplicate:true});
   const uniquePlate=plate+'-UNIQUE',uniqueDispatch=await dispatch(plan,uniquePlate);
   const route=(co?'/cobalt/sales':'')+'/plans/'+plan+'/dispatch/vehicles/'+uniqueDispatch.id+'/transport';
   const transport=await api('admin',product,route,{version:uniqueDispatch.transport_version??uniqueDispatch.version,transporter:'Updated Transport',destination:'Updated Destination'});
   assert.equal(transport.destination,'Updated Destination');
   const unique=await importTrip('SINGLE',day,uniquePlate);
   assert.deepEqual(await api('admin',product,sales+plan+'/historical-matches',{automatic:true}),{linked:1,ambiguous:0});
   assert.equal((await c.query('SELECT automatic FROM historical_sales_dispatch_links WHERE source_id=$1',[unique.id])).rows[0].automatic,true);
   assert.equal((await api('admin',product,gate+'?'+new URLSearchParams({batch_no:unique.tag,state:'EXITED'}))).total,1);
  });
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
  let browserLogin=0;
  async function open(role,product,width){
   const a=f.accounts.find(x=>x.role===role),ctx=await browser.newContext({viewport:{width,height:900},extraHTTPHeaders:{'X-Forwarded-For':'127.78.1.'+(++browserLogin)}});
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
    const sales=body.locator('select').first(),option=sales.locator('option[value="'+fx.plan+'"]');
    await option.waitFor({state:'attached'});
    await page.evaluate(()=>I18n.change('en'));
    await page.waitForFunction(id=>document.querySelector('#preparation-plan-batch option[value="'+id+'"]')?.textContent.includes('Shipment Month'),fx.plan);
    assert((await option.textContent()).includes('Shipment Month '+P.localMonth()));
    await page.evaluate(()=>I18n.change('zh-CN'));
    await page.waitForFunction(id=>document.querySelector('#preparation-plan-batch option[value="'+id+'"]')?.textContent.includes('发运月份'),fx.plan);
    assert((await option.textContent()).includes('发运月份 '+P.localMonth()));
    await sales.selectOption(fx.plan);
    assert.equal(await body.locator('input[name=shipment_month]').first().inputValue(),P.localMonth());
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
   const active=(await api('admin',cu,'/historical-movements?all_products=1&state=ACTIVE&document_no=QA-PL-')).items;
   assert.deepEqual(active.map(row=>row.id).sort(),[...ids].sort());
   assert.equal(active.every(row=>!row.voided_at),true);
   await api('admin',cu,'/historical-movements?state=UNKNOWN',null,400);
   const {ctx,page}=await open('admin',co,390);
   try{
    await page.goto(origin+'/workbench/historical-movements');
    const filter=page.locator('#historical-filter'),state=filter.locator('[name=state]');
    await filter.locator('[name=document_no]').fill('QA-PL-');
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
   X.utils.book_append_sheet(workbook,X.utils.aoa_to_sheet([['HORSE','TON'],[plate,30],[plate+'-2',30]]),'Dispatch');
   const file={file_name:'arrival.xlsx',mapping:{sheet:'Dispatch',header_row:1,truck_column:1,capacity_column:2,capacity_kg:false},
    file_base64:X.write(workbook,{type:'base64',bookType:'xlsx'}),...(co?{plan_version:info.plan.version}:{})};
   const preview=await api('admin',product,dispatch+'/import-preview',file);
   await api('admin',product,dispatch+(co?'/import':''),{...file,shipment_month:preview.shipment_month,preview_sha256:preview.file_sha256});
   const vehicles=(await api('admin',product,dispatch)).vehicles;
   const vehicle=vehicles.find(row=>row.truck_no===plate),other=vehicles.find(row=>row.truck_no===plate+'-2');
   assert(vehicle&&other);
   const endpoint=(co?'/cobalt/sales':'/loading-plans')+'/arrivals';
   const contact={trailer_one:plate+'-TRL',driver_name:plate+' Driver',passport_no:plate+'-PASS',arrived_at:new Date(Date.now()-120000).toISOString(),
    ...(co?{transporter:'Synthetic Carrier',dispatch_version:vehicle.version}:{})};
   const registration=await api('admin',product,endpoint+'/'+vehicle.id,{...contact,trailer_two:'N/A'});
   assert.equal(registration.trailer_two,'');
   const otherContact={...contact,trailer_one:plate+'-TRL-2',driver_name:plate+' Driver 2',passport_no:plate+'-PASS-2',
    ...(co?{dispatch_version:other.version}:{})};
   const duplicate=await api('admin',product,endpoint+'/'+other.id,{...otherContact,trailer_two:contact.trailer_one},409);
   assert.match(duplicate.error,/挂车2|Trailer 2/);
   const second=await api('admin',product,endpoint+'/'+other.id,{...otherContact,trailer_two:' n / a '});
   assert.equal(second.trailer_two,'');
   await api('production_operator',product,endpoint+'/'+vehicle.id,{action:'CLEAR',version:registration.version},403);
   const preparation=co?await api('admin',product,'/cobalt/preparations',{
    preparation_plan_id:fixtures[product].occupied.id,project_id:f.project,warehouse_id:f.warehouse,total_bags:1}):null;
   const {ctx,page}=await open('admin',product,co?390:1440);
   try{
    const list=origin+'/loading-plans?tab=arrivals&shipment_month='+preview.shipment_month;
    await page.goto(list);
    const row=page.locator((co?'#co-arrivals-table':'#cu-arrivals-table')+' tbody tr').filter({has:page.getByText(plate,{exact:true})});
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
    await form.locator('[name=trailer_two]').fill('N/A');
    await form.locator('button[type=submit]').click();
    await page.locator('#operation-confirm-accept').click();
    await confirmed();await edit();
    assert.equal(await form.locator('[name=trailer_two]').inputValue(),'');
    await form.locator('[data-arrival-clear]').click();
    await page.locator('#operation-confirm-accept').click();
    await row.getByText(/待到厂登记|Awaiting Arrival/).waitFor();
    assert.equal(await row.locator('a[href^="/loading-plans/new"]').count(),0);
    const table=co?'co_vehicle_arrivals':'vehicle_arrivals';
    const {rows:[saved]}=await c.query('SELECT id,registration_phase,arrived_at,trailer_one,driver_name,passport_no FROM '+table+' WHERE dispatch_vehicle_id=$1',[vehicle.id]);
    assert.deepEqual(saved,{id:registration.id,registration_phase:'CLEARED',arrived_at:null,trailer_one:'',driver_name:'',passport_no:''});
   }finally{await ctx.close();}
  });
  await t.test('Cobalt site and production task labels match the live detail workflow',async()=>{
   sessions.clear();
   const product='CO_HYDROXIDE',operator='logistics_field_operator';
   const plan=await P.approved(api,product,fixtures[product].plan,P.batch(product,795));
   const prep=await api(operator,product,'/cobalt/preparations',{preparation_plan_id:plan.id,project_id:f.project,
    warehouse_id:f.warehouse,total_bags:1,planned_location_id:f.location});
   const url='/cobalt/preparations/'+prep.id;
   await api(operator,product,url+'/submit',{version:prep.version});
   let work=await api(operator,product,url+'/work');
   const [bag]=work.bags;
   await api(operator,product,url+'/work/save',{batch_version:work.work.version,bags:[{
    bag_id:bag.bag_id,version:bag.version,actual_gross_kg:'651',seal_no:'UI6-CO-APPROVAL',sampled:true}]});
   work=await api(operator,product,url+'/work');
   const layout=await api('admin',product,'/cobalt/stock/layout');
   const location=layout.locations.find(l=>l.id===f.location);
   const placement={preparation_id:prep.id,batch_version:work.work.version,selection:'ALL',target_location_id:location.id,target_version:location.version,source:'PREPARATION'};
   const preview=await api('site_supervisor',product,'/cobalt/stock/place-preview',placement);
   await api('site_supervisor',product,'/cobalt/stock/place',{...placement,preview_hash:preview.preview_hash});
   work=await api(operator,product,url+'/work');
   await api(operator,product,url+'/work/submit',{batch_version:work.work.version});
   const compare=async(role,path,stage,step)=>{
    const {ctx,page}=await open(role,product,390);
    try{
     await page.evaluate(()=>I18n.set('zh-CN'));
     await page.goto(origin+'/overview?management=todos');
     const row=page.locator('tbody tr').filter({has:page.locator('a[href="'+path+'"]')});
     await row.locator('.c461-state').filter({hasText:stage}).waitFor();
     await row.getByRole('link',{name:'单据详情',exact:true}).click();
     const badge=page.locator('.co469-state');
     await badge.waitFor();
     assert.equal(await badge.innerText(),stage);
     assert.equal(await page.locator('[data-workflow-kind="co-preparation"] [aria-current="step"] strong').innerText(),step);
    }finally{await ctx.close();}
   };
   await compare('site_supervisor','/preparation/'+prep.id+'/work','待物流现场主管审核','现场主管审核');
   sessions.delete('site_supervisor');
   work=await api('site_supervisor',product,url+'/work');
   await api('site_supervisor',product,url+'/work/approve',{batch_version:work.work.version});
   await compare('production_manager','/receipts/'+prep.id,'待生产管理部经理确认入库','确认入库');
  });
  await t.test('Copper receipt Excel drop retains the native picker and validation on a narrow screen',async()=>{
   const {ctx,page}=await open('admin','CU_CATHODE',390);
   try{
    await page.goto(origin+'/receipts/import');
    const zone=page.locator('.wms-excel-drop'),input=zone.locator('input[type="file"]');
    await zone.waitFor();
    await page.evaluate(async()=>{
     const transfer=new DataTransfer();
     transfer.items.add(new File(['example'],'Receipt.XLSX'));
     document.querySelector('.wms-excel-drop').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    });
    assert.equal(await input.evaluate(el=>el.files[0].name),'Receipt.XLSX');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await input.setInputFiles({name:'Selected.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('placeholder')});
    assert.equal(await input.evaluate(el=>el.files[0].name),'Selected.xlsx');
    await page.evaluate(()=>I18n.change('en'));
    await zone.getByText('Drag Excel files here',{exact:true}).waitFor();
   }finally{await ctx.close();}
  });
  await t.test('Rows per page survive refresh, returning to the route and independent list choices',async()=>{
   const {ctx,page}=await open('admin','CU_CATHODE',1440);
   try{
    const cases=[
     ['/inventory','#page-size',20],
     ['/loading-plans/query','#v34-page-size',50]
    ];
    for(const [path,selector,rows] of cases){
     const select=page.locator(selector);
     await page.goto(origin+path);
     await select.waitFor();
     assert.equal(await select.inputValue(),'10');
     await select.selectOption(String(rows));
     await page.waitForFunction(value=>new URLSearchParams(location.search).get('page_size')===value,String(rows));
     await page.reload();
     await select.waitFor();
     assert.equal(await select.inputValue(),String(rows));
     await page.goto(origin+'/overview');
     await page.goto(origin+path);
     await select.waitFor();
     assert.equal(await select.inputValue(),String(rows));
    }
    // Exercise the shared client table pager with enough rows to expose its size control.
    const attachTable=()=>page.evaluate(()=>{
     const wrap=document.createElement('div');
     wrap.className='business-table';
     wrap.innerHTML='<table id="paging-demo"><thead><tr><th>Name</th><th>Ref</th></tr></thead><tbody>'+
      Array.from({length:32},(_,i)=>'<tr><td>Entry '+i+'</td><td>'+i+'</td></tr>').join('')+'</tbody></table>';
     document.querySelector('#page-content').append(wrap);
    });
    await page.goto(origin+'/workbench');
    await page.locator('#business-title').waitFor();
    await attachTable();
    const client=page.locator('#page-content .v34-pagination select');
    assert.equal(await client.inputValue(),'10');
    await client.selectOption('25');
    assert.equal(await page.locator('#paging-demo tbody tr:visible').count(),25);
    await page.reload();
    await page.locator('#business-title').waitFor();
    await attachTable();
    assert.equal(await client.inputValue(),'25');
    assert.equal(await page.locator('#paging-demo tbody tr:visible').count(),25);
   }finally{await ctx.close();}
  });
  for(const product of products)await t.test(product+' chart dates follow the plotted period and the date labels',async()=>{
   const co=cobalt(product),{ctx,page}=await open('admin',product,1440);
   try{
    await page.goto(origin+'/overview');
    const stockPanels=page.locator('.oa-three > section');
    await stockPanels.first().waitFor();
    const headings=()=>stockPanels.locator('h2').allTextContents();
    const initialHeadings=await headings();
    const filter=page.locator(co?'#co-overview-filter':'#dashboard-form');
    await filter.locator('[name="from"]').fill('2020-03-01');
    await filter.locator('[name="to"]').fill('2020-03-20');
    await filter.locator('button.primary').click();
    const plot=page.locator('[data-oa-plot="net"]');
    await plot.locator('.oa-date-tick').filter({hasText:'2020-03-15'}).waitFor();
    assert.deepEqual(await headings(),initialHeadings);
    if(co)await page.setViewportSize({width:390,height:844});
    const assertPeriod=async(period,kind)=>{
     await page.mouse.move(0,0);
     const tick=plot.locator('.oa-date-tick').filter({hasText:period});
     if(kind==='label'){
      await tick.hover();
     }else{
      const position=await tick.evaluate(label=>{
       const chart=label.ownerSVGElement;
       const box=chart.getBoundingClientRect();
       const point=new DOMPoint(Number(label.getAttribute('x')),82).matrixTransform(chart.getScreenCTM());
       return {x:point.x-box.left,y:point.y-box.top};
      });
      await plot.locator('svg').hover({position});
     }
     const tooltip=plot.getByRole('tooltip');
     await tooltip.waitFor();
     assert.equal((await tooltip.innerText()).split('\n')[0],period,JSON.stringify({period,kind}));
    };
    for(const mode of ['bar','line']){
     await page.locator('[data-oa-key="net"][data-oa-type="'+mode+'"]').click();
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     for(const date of ['2020-03-03','2020-03-15','2020-03-19'])await assertPeriod(date,'plot');
     await assertPeriod('2020-03-15','label');
    }
   }finally{await ctx.close();}
  });
  for(const product of products)await t.test(product+' creation keeps draft by save and offers all eligible licenses',async()=>{
   const co=cobalt(product);
   sessions.delete('export_supervisor');
   sessions.delete('logistics_manager');
   const intake=co?await P.approved(api,product,fixtures[product].plan,P.batch(product,796)):null;
   const {ctx,page}=await open('admin',product,co?390:1440);
   try{
    await page.route(url=>url.pathname.endsWith('/export-permits/options'),route=>{
     const query=new URL(route.request().url()).searchParams;
     const option=i=>({id:'license-'+i,license_no:'QA-PERMIT-'+i,available:'2',unit:'MT',unit_basis:'NET_MT'});
     if(query.has('invoice_preview_id'))return route.fulfill({json:{items:[option(51)],invoice_preview:'QA-INVOICE-051'}});
     const second=query.get('page')==='2';
     return route.fulfill({json:{items:second?[option(51)]:Array.from({length:50},(_,i)=>option(i+1)),has_more:!second}});
    });
    await page.goto(origin+'/loading-plans/new');
    const form=page.locator(co?'#co-loading-form':'#single-plan-form');
    const draft=form.locator('[data-draft-save]');
    await draft.waitFor();
    assert(await draft.evaluate(button=>button.nextElementSibling?.matches('button.primary')&&
     button.nextElementSibling?.type==='submit'&&Boolean(button.closest('.o4-footer'))));
    assert.equal(await form.locator('#loading-permit-picker-search').count(),0);
    await form.locator('[name="sales_plan_id"]').selectOption(fixtures[product].plan);
    const permits=form.locator('.o4-doc-fields select[name="license_id"]');
    assert.equal(await form.locator('select[name="license_id"]').count(),1);
    assert.equal(await form.locator('input[name="export_license_no"]:visible').count(),0);
    await permits.selectOption('license-51');
    await page.waitForFunction(()=>document.querySelector('[name="invoice_no"]')?.placeholder==='QA-INVOICE-051');
    const invoice=form.locator('[name=invoice_no]');
    assert(await invoice.isEditable());
    assert.equal(await invoice.inputValue(),'');
    const existing=co?'AUDIT-CO-REPEAT-FIRST-INV':'AUDIT-CU-REPEAT-FIRST-INV';
    await invoice.fill(existing);
    await form.locator('#loading-permit-picker-invoice-check').getByText(/已使用|already in use/).waitFor();
    assert.equal(await invoice.evaluate(input=>input.validity.customError),true);
    await invoice.fill('QA-MANUAL-AVAILABLE');
    await page.waitForFunction(()=>document.querySelector('[name=invoice_no]')?.validity.valid);
    const receipt='/receipts/new'+(intake?'?preparation_plan='+intake.id:'');
    for(const path of [receipt,'/sales-plans/new','/stocktaking/new','/export-licenses/new']){
     await page.goto(origin+path);
     const pageForm=page.locator('#page-content form').filter({has:page.locator('[data-draft-feedback]')});
     await pageForm.first().waitFor();
     for(const action of await pageForm.locator('[data-draft-save]').all()){
      assert(await action.evaluate(button=>button.nextElementSibling?.type==='submit'),path);
     }
    }
   }finally{await ctx.close();}
  });
  for(const product of products)await t.test(product+' historical sale and departure entry points use aligned filters and open exited records',async()=>{
   const {ctx,page}=await open('admin',product,1440),{alternate,other,older}=fixtures[product].historicalTrip;
   const layout=async(selector,fields)=>{
    const form=page.locator(selector);
    await form.waitFor();
    assert.deepEqual(await form.locator('input,select').evaluateAll(nodes=>nodes.map(node=>node.name)),fields);
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:900});
     const gaps=await form.evaluate(form=>{
      const outer=form.getBoundingClientRect(),first=form.querySelector('input').getBoundingClientRect();
      const actions=form.querySelector('.wms-filter-actions').getBoundingClientRect();
      const style=getComputedStyle(form);
      const left=outer.left+parseFloat(style.paddingLeft)+parseFloat(style.borderLeftWidth);
      const right=outer.right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth);
      return [first.left-left,right-actions.right];
     });
     assert(gaps.every(gap=>Math.abs(gap)<3),JSON.stringify({selector,width,gaps}));
     if(selector==='#gate-filter'&&width===1440){
      const tops=await form.locator('input,select,.wms-filter-actions button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
      assert(Math.max(...tops)-Math.min(...tops)<3,JSON.stringify(tops));
     }
    }
   };
   try{
    await page.goto(origin+'/sales-plans/'+alternate);
    await page.locator('#sales-history-find').click();
    const candidate=page.locator('#sales-history-table tbody tr').filter({hasText:other.tag});
    await candidate.locator('[data-history-match]').click();
    const linked=page.waitForResponse(response=>response.url().endsWith('/historical-matches')&&response.request().method()==='POST');
    await page.locator('#operation-confirm-accept').click();
    const response=await linked;
    assert.equal(response.status(),200,await response.text());
    await page.locator('#sales-invoice-table tbody tr').filter({hasText:other.tag+'-PL'}).waitFor();
    await page.goto(origin+'/workbench/historical-movements');
    await layout('#historical-filter',['batch_no','document_no','business_date','from','to','state']);
    assert.equal(await page.locator('#historical-ledger .v34-pagination').count(),0);
    assert.equal(await page.locator('#historical-ledger .co-pager').count(),1);
    await page.goto(origin+'/outbounds?view=departures&state=EXITED');
    await layout('#gate-filter',['batch_no','truck_no','customer','approved_on','state']);
    const archived=page.locator('#gate-list tbody tr').filter({hasText:older.tag});
    await archived.locator('[data-state=EXITED]').waitFor();
    assert.equal(await page.locator('#gate-confirm-history').count(),0);
    await archived.locator('a[href^="/stock-outbound/historical/"]').click();
    await page.waitForURL('**/stock-outbound/historical/*');
    await page.locator('#page-content').getByText(older.tag+'-PL',{exact:true}).first().waitFor();
   }finally{await ctx.close();}
  });
  for(const product of products)await t.test(product+' export license record book actions align on the right',async()=>{
   const contract=f.customers[product].contract,value='Synthetic Destination for Record Book Layout';
   sessions.delete('admin');
   await api('admin',product,prefix(product)+'/export-permits/record-books',{contract_id:contract,kind:'destination',value});
   const {ctx,page}=await open('admin',product,1440);
   try{
    await page.goto(origin+'/export-licenses/new');
    await page.getByRole('heading',{name:/^(新建出口许可证档案|New Export License Record)$/}).waitFor();
    await page.locator('#export-license-application select[name=contract_id]').selectOption(contract);
    await page.locator('[data-book-open=destination]').click();
    const row=page.locator('#permit-book-dialog [data-book-entries] li').filter({hasText:value});
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:900});
     const bounds=await row.evaluate(li=>{
      const label=li.firstElementChild.getBoundingClientRect(),actions=li.lastElementChild.getBoundingClientRect();
      return {label:label.right,left:actions.left,right:actions.right,edge:li.getBoundingClientRect().right};
     });
     assert(bounds.left>=bounds.label-1&&Math.abs(bounds.right-bounds.edge)<2,JSON.stringify(bounds));
    }
    assert.equal(await page.evaluate(()=>ExportLicenses.quantity('12.345678',{unit_basis:'COBALT_MT'},4)),'12.3457');
   }finally{await ctx.close();}
  });
  for(const product of products)await t.test(product+' My Tasks renders document-specific approval stages',async()=>{
   const co=cobalt(product),{ctx,page}=await open('admin',product,co?390:1440);
   const sharedCases=[
    ['PREPARATION_PLAN_REVIEW','PREPARATION_PLAN','PENDING','待备货计划审核','Pending Preparation Plan Review'],
    ['SALES_REVIEW','SALES','PENDING','待销售经理审批','Pending Sales Manager Approval'],
    ['COMMERCE_REVIEW','SALES','COMMERCE_PENDING','待商务部经理审批','Pending Commercial Manager Approval'],
    ['COMMERCE_CLOSE_REVIEW','SALES_CLOSE','CLOSE_COMMERCE_PENDING','关闭申请待商务部经理审批','Closure Pending Commercial Manager Approval'],
    ['REGISTRATION_REQUEST_REVIEW','REGISTRATION_REQUEST','PENDING','待账号注册审批','Pending Account Registration Approval'],
    ['EXPORT_LICENSE_REVIEW','EXPORT_LICENSE','PENDING','待出口许可证审核 · 延期','Pending Export License Review · Extend']
   ];
   const cases=sharedCases.concat(co?[
    ['CO_RECEIPT_PRODUCTION','RECEIPT','PRODUCTION_PENDING','待生产审核入库','Pending Production Stock Entry Review'],
    ['CO_AMEND_REVIEW','LOT','AMENDMENT_PENDING','待备货更正复核','Pending Preparation Correction Review'],
    ['CO_VEHICLE_REVIEW','LOAD','CANCEL_MATCH','待取消装车匹配审核','Pending Loading Match Cancellation Review'],
    ['CO_VEHICLE_REVIEW','LOAD','CHANGE_VEHICLE','待车辆变更复核','Pending Vehicle Change Review'],
    ['CO_EXCEPTION','LOAD','OPEN','待装车异常复核','Pending Loading Exception Review'],
    ['CO_COUNT_REVIEW','COUNT','SUBMITTED','待盘点独立复核','Pending Independent Inventory Count Review']
   ]:[
    ['RECEIPT_REVIEW','RECEIPT','PENDING','待入库审核','Pending Stock Entry Review'],
    ['LOT_REVIEW','LOT','PENDING','待备货审核','Pending Preparation Review'],
    ['LOAD_REVIEW','LOAD','PENDING','待装车审核','Pending Loading Review'],
    ['LOGISTICS_REVIEW','LOAD','DEPARTED_PENDING','待物流出库审核','Pending Logistics Stock Issue Review'],
    ['FORMAL_OUTBOUND','LOAD','DEPARTED_PENDING','待生产终审出库','Pending Final Production Approval'],
    ['COUNT_REVIEW','COUNT','REVIEW','待盘点差异复核','Pending Inventory Count Discrepancy Review'],
    ['COUNT_APPROVE','COUNT','APPROVAL','待盘点审批','Pending Inventory Count Approval'],
    ['ADJUST_APPROVE','ADJUST','SUBMITTED','待库存调整审批','Pending Stock Adjustment Approval']
   ]);
   const pending=cases.map(([kind,doc_type,status],index)=>({kind,doc_type,status,id:crypto.randomUUID(),document_no:'QA-TASK-'+(index+1),href:'/overview',
    ...(kind==='EXPORT_LICENSE_REVIEW'?{review_action:'EXTEND'}:{})}));
   const history={doc_type:'LOT',status:'PENDING',document_no:'QA-INITIATED-LOT',href:'/overview'};
   const taskPath=co?'/api/v1/cobalt/ui461/tasks':'/api/v1/v34/ui461/tasks';
   try{
    await page.route(url=>url.pathname===taskPath,route=>route.fulfill({json:{pending,initiated:[history],completed:[{...history,kind:'HANDLED'}],
     summary:{approval:pending.length,work:0,due:0,today:0},as_of:new Date().toISOString()}}));
    const todo=origin+'/overview?management=todos';
    for(const [language,expectedIndex] of [['zh-CN',3],['en',4]]){
     await page.evaluate(code=>I18n.change(code),language);
     await page.goto(todo);
     await page.locator('.c461-state').first().waitFor();
     for(const [index,expected] of cases.entries()){
      const row=page.getByRole('row').filter({has:page.getByRole('link',{name:pending[index].document_no,exact:true})});
      assert.equal(await row.locator('.c461-state').innerText(),expected[expectedIndex]);
     }
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'The task list must fit the viewport');
     for(const tab of ['initiated','completed']){
      await page.goto(todo+'&tab='+tab);
      const historyRow=page.getByRole('row').filter({has:page.getByRole('link',{name:history.document_no,exact:true})});
      assert.equal(await historyRow.locator('.c461-state').innerText(),language==='en'?'Pending Preparation Review':'待备货审核');
     }
    }
   }finally{await ctx.close();}
  });
 }finally{await browser?.close();await app?.close();await c.end();}
});
