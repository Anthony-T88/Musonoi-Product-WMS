'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const XLSX=require('xlsx');
const E=require('./environment.cjs');
const {migrate}=require('../../scripts/production-db.cjs');
const CU='CU_CATHODE',CO='CO_HYDROXIDE',imports='/historical-movements/batch';

function packing(product,warehouse,number,rows,day='2020-03-05'){
 const co=product===CO,values=Array.from({length:29},()=>[]);
 values[0]=['PACKING LIST'];values[2]=['','','','Packing List No:',number];values[3]=['','','','Lot No:',number+'-LOT'];
 values[6]=['','','','Shipping Date:',day];
 values[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
 values.push(...rows.map(([unit,seal],idx)=>[idx+1,'Synthetic',unit,co?null:48,seal,647,650]),['Total',null,null,null,null,647*rows.length,650*rows.length]);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(values),'PL');
 return {file_name:number+'.xlsx',file_base64:XLSX.write(book,{bookType:'xlsx',type:'base64'}),warehouse_id:warehouse};
}

test('historical administrator reviews and cobalt map recovery in isolated TEST',async t=>{
 const {name,client}=await E.database();let app,browser;
 try{
  await migrate(client,{apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD,environment:'test'});
  const f=await E.seed(client,name),port=4398,origin='http://127.0.0.1:'+port;
  app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin}});
  const sessions=new Map(),account=role=>f.accounts.find(a=>a.role===role);
  async function request(role,product,path,payload,expected=200){
   if(!sessions.has(role)){
    const a=account(role),response=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.73.0.'+(f.accounts.indexOf(a)+1),
     headers:{origin},payload:{username:a.username,password:a.password}});
    assert.equal(response.statusCode,200);
    sessions.set(role,{cookie:response.cookies.map(c=>c.name+'='+c.value).join('; '),'x-csrf-token':response.json().csrfToken});
   }
   const response=await app.inject({method:payload?'POST':'GET',url:'/api/v1'+path,payload,
    headers:{origin,...sessions.get(role),'x-product-code':product,'idempotency-key':randomUUID()}});
   assert.equal(response.statusCode,expected,path+' '+response.body.slice(0,260));
   return response.json();
  }
  async function batch(product,action,file,role='admin'){
   return (await request(role,product,imports+'/'+action,{files:[file]})).results[0];
  }
  await t.test('bulk preparation submits and approves through existing copper and cobalt authorization',async()=>{
   const P=require('./preparation-fixture.cjs');
   for(const product of [CU,CO]){
    const base=(product===CO?'/cobalt':'')+'/preparation-plans';
    const plan=await P.salesPlan(request,f,product);
    const items=[551,552].map(n=>({sales_plan_id:plan,batch_no:P.batch(product,n),shipment_month:P.localMonth()}));
    const created=await request('export_supervisor',product,base+'/batch',{items,submit:true});
    assert(created.items.every(item=>item.state==='PENDING'));
    const pending=await Promise.all(created.items.map(item=>request('export_supervisor',product,base+'/'+item.id)));
    const selection=pending.map(({id,version})=>({id,version}));
    await request('export_supervisor',product,base+'/batch/approve',{items:selection},403);
    await request('logistics_manager',product,base+'/batch/approve',{items:[selection[0],{...selection[1],version:99}]},409);
    assert.equal((await request('logistics_manager',product,base+'/'+selection[0].id)).state,'PENDING');
    assert((await request('logistics_manager',product,base+'/batch/approve',{items:selection})).items.every(item=>item.state==='APPROVED'));
    const draft=await P.draft(request,product,plan,P.batch(product,553));
    assert.equal((await request('export_supervisor',product,base+'/batch/submit',{items:[{id:draft.id,version:draft.version}]})).items[0].state,'PENDING');
   }
  });
  await t.test('invoice numbering skips imported invoice and packing numbers without jumping to the historical maximum',async()=>{
   const P=require('../../server/export-license-plans.cjs'),actor=account('admin').id;
   for(const [document,invoice] of [['Synthetic-First','QA-FORM-1'],['QA-FORM-02-PL',null],['Synthetic-Late','QA-FORM-998']]){
    await client.query(`INSERT INTO historical_movement_documents(product_code,movement_type,document_no,document_key,business_date,
     date_evidence,source_name,source_sha256,source_data,source_facts,imported_by)
     VALUES($1,'OUTBOUND',$2,upper($2),'2020-01-01','synthetic','synthetic.xlsx','test','',jsonb_build_object('invoice_no',$3::text),$4)`,[CU,document,invoice,actor]);
   }
   assert.deepEqual(await P.invoiceCandidate(client,{proforma_no:'QA-FORM',next_serial:'1'}),{invoice:'QA-FORM-03',serial:'3'});
  });
  await t.test('receipt workbook accepts an unpadded bundle serial and returns two digits',async()=>{
   const book=new(require('exceljs').Workbook)(),sheet=book.addWorksheet('Receipts');
   sheet.addRows([['捆包编号','捆包片数','生产日期','入库时间'],['MUS-2026-100-1',48,'2026-11-11','2026-11-11 10:30']]);
   const parsed=await require('../../server/production-receipt-reader.cjs').parse(Buffer.from(await book.xlsx.writeBuffer()));
   assert.equal(parsed.lines[0].bundle_no,'MUS-2026-100-01');
  });
  const reason='Matched historical packing list and original seal record';
  for(const product of [CU,CO])await t.test(product+' duplicate reviews, source rows, totals and replay',async()=>{
   const p=product===CU?'CU':'CO',file=(suffix,rows)=>packing(product,f.warehouse,p+'-'+suffix,rows);
   const first=file('FIRST',[[p+'-1',p+'-S1'],[p+'-2',p+'-S1']]),preview=await batch(product,'preview',first);
   assert.equal(preview.importable,false);assert.equal(preview.reviewable,true);
   assert.equal(preview.accepted_quantity,2);assert(preview.rows.every(row=>row.flags.includes('DUPLICATE_SEAL')));
   const input={...first,preview_token:preview.preview_token};
   assert.equal((await batch(product,'confirm',input)).code,'EXCEPTION_REASON_REQUIRED');
   await request('production_operator',product,imports+'/confirm',{files:[{...input,exception_reason:reason}]},403);
   const imported=await batch(product,'confirm',{...input,exception_reason:reason});
   assert.equal(imported.status,'IMPORTED');
   const next=file('SECOND',[[p+'-1',p+'-S1'],[p+'-3',p+'-S2'],[p+'-3',p+'-S3']]),review=await batch(product,'preview',next);
   assert.deepEqual(review.rows.map(row=>row.flags),[['UNIT_CONFLICT','SEAL_CONFLICT'],[],['DUPLICATE_UNIT']]);
   assert.equal(review.accepted_quantity,1);
   assert.equal((await batch(product,'confirm',{...next,preview_token:preview.preview_token,exception_reason:reason})).code,'REVIEW_REQUIRED');
   const candidate={...next,preview_token:review.preview_token,exception_reason:reason};
   const attempts=await Promise.all([batch(product,'confirm',candidate),batch(product,'confirm',candidate)]);
   assert.deepEqual(attempts.map(a=>a.status).sort(),['ALREADY_IMPORTED','IMPORTED']);
   const record=await request('admin',product,'/historical-movements/'+attempts[0].id);
   assert.equal(record.exception_review.reason,reason);
   assert.equal(record.rows.length,3);
   assert.deepEqual(record.rows.map(row=>Boolean(row.excluded)),[true,false,true]);
   assert.equal(record.documents.length,4);
   assert.equal(record.quantity,1);assert.equal(Number(record.net_kg),647);
   const stock=(await client.query('SELECT unit_id FROM historical_outbound_units WHERE source_id=$1',[record.id])).rows;
   assert.deepEqual(stock,[{unit_id:p+'-3'}]);
   const invalid=packing(product,f.warehouse,p+'-INVALID',[[p+'-1',p+'-S1']],'not a date'),bad=await batch(product,'preview',invalid);
   assert.equal(bad.reviewable,false);
   assert.equal((await batch(product,'confirm',{...invalid,preview_token:bad.preview_token,exception_reason:reason})).code,'REVIEW_REQUIRED');
   const backfill=(product===CO?'/cobalt':'')+'/historical-backfill';
   const stockId=product===CO?record.id:(await client.query('SELECT id FROM historical_outbound_units WHERE source_id=$1',[record.id])).rows[0].id;
   assert.equal((await request('admin',product,backfill+'/stock/batch/'+stockId)).rows.length,1);
   await request('admin',product,'/historical-movements/'+record.id+'/void',{reason:'Void synthetic historical document'});
   const voided=await request('admin',product,'/historical-movements/'+record.id);
   assert(voided.voided_at);
   assert.deepEqual(voided.documents,[]);
   assert.equal(voided.rows.length,3);
   assert.equal((await client.query('SELECT count(*)::int n FROM historical_outbound_units WHERE source_id=$1',[record.id])).rows[0].n,0);
   await request('admin',product,backfill+'/stock/batch/'+stockId,null,404);
   for(const doc of record.documents){
    const params=new URLSearchParams({kind:doc.kind});
    await request('admin',product,backfill+'/documents/'+doc.id+'?'+params,null,404);
    assert(!(await request('admin',product,backfill+'/documents?'+params)).items.some(item=>item.id===doc.id));
   }
   assert.deepEqual((await client.query('SELECT count(*)::int n FROM historical_outbound_units WHERE source_id=$1',[imported.id])).rows[0],{n:2});
  });
  const {provision}=require('../../scripts/preproduction-cobalt-map.cjs');
  const target={projectCode:'AUDIT',warehouseCode:'CO-APPROVED',username:account('admin').username};
  const {rows:[mapWarehouse]}=await client.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'CO-APPROVED','Synthetic cobalt warehouse') RETURNING id",[f.project]);
  await t.test('preproduction provision restores the approved map, guards ownership and is idempotent',async()=>{
   await assert.rejects(provision(client,{...target,username:account('site_supervisor').username}),{code:'CO_SITE_TARGET_OR_ACTOR_NOT_FOUND'});
   await assert.rejects(provision(client,{...target,warehouseCode:'AUDIT-WH'}),{code:'CO_SITE_EXISTING_ZONES_REQUIRE_REVIEW'});
   const dry=await provision(client,target);
   assert.equal(dry.status,'CO_SITE_DRY_RUN_ROLLED_BACK');assert.equal(dry.locations,93);
   assert.equal((await client.query('SELECT count(*)::int n FROM co_locations WHERE warehouse_id=$1',[mapWarehouse.id])).rows[0].n,0);
   const applied=await provision(client,{...target,apply:true});
   assert.equal(applied.status,'CO_SITE_APPLIED');assert.equal(applied.locations,93);assert.equal(applied.occupied,0);
   assert.equal((await provision(client,{...target,apply:true})).already_configured,true);
   assert.equal((await request('admin',CO,'/cobalt/stock/map?warehouse_id='+mapWarehouse.id)).locations.length,93);
  });
  await request('admin',CO,'/cobalt/stock/map?warehouse_id='+randomUUID(),null,403);
  await app.listen({port,host:'127.0.0.1'});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});
  const context=await browser.newContext({viewport:{width:1440,height:900}}),admin=account('admin');
  const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:admin.username,password:admin.password}});
  assert.equal(login.status(),200);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({id,product})=>localStorage.setItem('musonoi-product:'+id,product),{id:admin.id,product:CO});
  await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.locator('[data-task-dismiss]').click());
  await t.test('cobalt scoped map restores stale warehouse, locations, and unrelated stock filters',async()=>{
   for(const query of ['', '?warehouse_id='+randomUUID(), '?zone_id=obsolete', '?location_id='+randomUUID(),
    '?unit=old-stock-archive&page=0&stock_state=obsolete']){
    await page.goto(origin+'/stock-map'+query);
    await page.locator('#co-map-svg.site-plan-svg').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('warehouse_id'),mapWarehouse.id);
    for(const key of ['unit','page','stock_state'])assert.equal(new URL(page.url()).searchParams.has(key),false);
    assert(await page.locator('[data-co-location]').count()>=93);
   }
   await page.locator('#co-map-in').click();
   await page.waitForFunction(()=>document.getElementById('co-map-svg').getAttribute('viewBox')!==CobaltMap465.data.site_plan.bounds.join(' '));
   await page.locator('#co-map-fit').click();
   await page.waitForFunction(()=>document.getElementById('co-map-svg').getAttribute('viewBox')===CobaltMap465.data.site_plan.bounds.join(' '));
   assert.equal(await page.locator('.wms-map-advanced').count(),0);
   assert(await page.locator('#co-stock-filter select[name=customer_id]').isVisible());
   assert.equal(await page.locator('#co-stock-filter').getByRole('button',{name:/^(重置|清除条件|Reset|Clear Filters)$/}).count(),1);
   assert.equal(await page.locator('#co-stock-filter :is([name=history],[name=phase],[name=occupancy])').count(),0);
   for(const width of [390,1440]){
    await page.setViewportSize({width,height:900});
    const aligned=await page.locator('#co-stock-filter').evaluate(form=>{
     const fields=[...form.querySelectorAll('select')].map(e=>e.getBoundingClientRect().bottom);
     return Math.max(...fields)-Math.min(...fields)<3&&document.documentElement.scrollWidth<=innerWidth+2;
    });
    assert(aligned,'Cobalt map filter row at '+width);
   }
   const widths=await page.locator('#co-map-svg').evaluate(async svg=>{
    const bounds=svg.getBoundingClientRect(),samples=[];
    for(let i=0;i<12;i++){
     if(i<6)svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-65,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2,bubbles:true,cancelable:true}));
     await new Promise(requestAnimationFrame);
     samples.push(svg.viewBox.baseVal.width);
    }
    return samples;
   });
   assert(widths.at(-1)<widths[0]&&widths.every((w,i)=>!i||w<=widths[i-1]),'Successive zoom-in frames must never jump back');
   const input=page.locator('input[name=location_query]');await input.fill('CO-A-01');await input.press('Enter');
   await page.locator('#co-map-detail').getByText('CO-A-01',{exact:true}).first().waitFor();
   const options='**/api/v1/cobalt/options';
   await page.route(options,route=>route.fulfill({status:503,json:{error:'Synthetic options error'}}));
   await page.reload();
   await page.locator('#co-map-svg.site-plan-svg').waitFor();
   await page.locator('#co-stock-error').getByText(/地图筛选项加载失败/).waitFor();
   assert.equal(await page.locator('#co-stock-filter').count(),0);
   await page.unroute(options);
   await page.reload();
   await page.locator('#co-stock-filter').waitFor({state:'attached'});
  });
  await t.test('cobalt master data uses authorized cobalt zones and locations',async()=>{
   const masters=product=>context.request.get(origin+'/api/v1/cobalt/masters',{headers:{'X-Product-Code':product}});
   assert.equal((await masters(CU)).status(),409);
   const response=await masters(CO);assert.equal(response.status(),200);
   const data=await response.json();
   assert(data.locations.some(l=>l.code==='CO-A-01'&&l.warehouse_id===mapWarehouse.id));
   await page.goto(origin+'/customers/master-data/locations/new');
   await page.waitForURL('**/customers/master-data?type=locations');
   await page.locator('#s46-master-table').getByText('CO-A-01',{exact:true}).first().waitFor();
  });
  await t.test('administrator review dialog and historical source details',async()=>{
   await page.goto(origin+'/workbench/historical-movements');
   const form=page.locator('#historical-upload');await form.locator('select').selectOption(f.warehouse);
   const file=packing(CO,f.warehouse,'CO-BROWSER',[['CO-1','CO-S1'],['CO-4','CO-S4']]);
   await form.locator('input[type=file]').setInputFiles({name:file.file_name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(file.file_base64,'base64')});
   await form.locator('button').click();
   await page.locator('[data-import-state="review"]').waitFor();
   assert(await page.locator('#historical-confirm').isDisabled());
   await page.locator('[data-history-review]').click();
   await page.locator('#operation-confirm-comment').fill(reason);
   await page.locator('#operation-confirm-accept').click();
   await page.locator('[data-history-file] [data-import-state="imported"]').waitFor();
   await page.locator('[data-history-file] a').first().click();
   await page.getByText(reason,{exact:true}).waitFor();
   await page.getByText(/仅保留原表记录/).waitFor();
   await page.locator('#historical-void textarea').fill('Void synthetic browser import');
   await page.locator('#historical-void button').click();
   await page.locator('#operation-confirm-accept').click();
   await page.locator('[data-import-state="voided"]').waitFor();
   assert.equal(await page.getByRole('heading',{name:'关联单据',exact:true}).count(),0);
   await page.getByText('Void synthetic browser import',{exact:true}).waitFor();
  });
  await t.test('historical import names damaged headers, invalid cells and mismatching totals',async()=>{
   await page.goto(origin+'/workbench/historical-movements');
   const form=page.locator('#historical-upload');
   await form.locator('select').selectOption(f.warehouse);
   const examples=[
    ['HEADER',{'F29':'NET WEIGHT (LB)','G29':'GROSS WEIGHT (LB)'}],
    ['CELLS',{'E7':'bad-date','D30':0,'F30':'unknown'}],
    ['TOTAL',{'F31':648,'G31':652}]
   ];
   const files=examples.map(([name,edits])=>{
    const input=packing(CU,f.warehouse,'DIAGNOSTIC-'+name,[['DIAGNOSTIC-'+name,'SEAL-'+name]]);
    const book=XLSX.read(input.file_base64,{type:'base64'});
    for(const [cell,value] of Object.entries(edits))XLSX.utils.sheet_add_aoa(book.Sheets.PL,[[value]],{origin:cell});
    return {name:input.file_name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     buffer:XLSX.write(book,{bookType:'xlsx',type:'buffer'})};
   });
   await form.locator('input[type=file]').setInputFiles(files);
   await form.locator('button').click();
   const preview=page.locator('#historical-preview');
   await preview.getByText(/PL!F29.*应为 NET WEIGHT \(KG\).*NET WEIGHT \(LB\)/).waitFor();
   await preview.getByText(/PL!G29.*GROSS WEIGHT \(KG\).*GROSS WEIGHT \(LB\)/).waitFor();
   await preview.getByText(/PL!E7.*bad-date/).waitFor();
   await preview.getByText(/发现 1 条明细异常，见原表第 30 行/).waitFor();
   await preview.getByText(/PL!D30.*片数.*原值 0.*PL!F30.*净重.*unknown/).waitFor();
   await preview.getByText(/PL!F31.*原单 648 kg.*明细合计 647 kg/).waitFor();
   await preview.getByText(/PL!G31.*原单 652 kg.*明细合计 650 kg/).waitFor();
   assert.equal(await preview.locator('[data-import-state="correction"]').count(),3);
   assert(await page.locator('#historical-confirm').isDisabled());
   await page.evaluate(()=>I18n.set('en'));
   await preview.getByText(/PL!F29.*Expected NET WEIGHT \(KG\).*Found NET WEIGHT \(LB\)/).waitFor();
   await preview.getByText(/PL!F31.*648 kg.*Detail rows total 647 kg/).waitFor();
   await page.evaluate(()=>I18n.set('zh-CN'));
  });
  await t.test('creator sees Submit for Review and approver can approve selected plans on the list',async()=>{
   await page.goto(origin+'/preparation/work-plans/new');
   await page.locator('#preparation-plan-batch [data-submit-for-review]').waitFor();
   assert(await page.locator('#preparation-plan-batch').getByRole('button',{name:'保存草稿',exact:true}).isVisible());
   await page.goto(origin+'/preparation/work-plans?state=PENDING');
   const check=page.locator('[data-preparation-select]').first(),approve=page.locator('[data-preparation-operation="approve"]');
   await check.waitFor();assert(await approve.isDisabled());await check.check();
   const response=page.waitForResponse(r=>r.url().endsWith('/preparation-plans/batch/approve')&&r.request().method()==='POST');
   await approve.click();await page.locator('#operation-confirm-accept').click();
   const result=await response;assert.equal(result.status(),200);assert.equal((await result.json()).items[0].state,'APPROVED');
  });
  await t.test('copper map and stock documents display the same P3 slot and retain its location ID',async()=>{
   const {rows:[slot]}=await client.query("INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_usage) VALUES($1,$2,'P4-01','P4-01','FORMAL') RETURNING id",[f.project,f.warehouse]);
   await page.close();
   const cu=await context.newPage();
   await cu.addInitScript(id=>localStorage.setItem('musonoi-product:'+id,'CU_CATHODE'),admin.id);
   await cu.addLocatorHandler(cu.locator('#task-notice[open]'),()=>cu.locator('[data-task-dismiss]').click());
   const scope='?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse});
   await cu.goto(origin+'/stock-map'+scope);
   const field=cu.locator('.wms-map-search select[name=customer_id]');
   await field.waitFor({timeout:8000}).catch(async e=>{throw Error(e.message+' '+(await cu.locator('body').innerText()).slice(-1600));});
   for(const width of [390,1440]){
    await cu.setViewportSize({width,height:900});
    assert(await field.evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-document.querySelector('.wms-map-search input').getBoundingClientRect().bottom)<3));
   }
   const query=cu.locator('.wms-map-search input');await query.fill('P3-01');await query.press('Enter');
   await cu.locator('#stock-map-detail').getByText('P3-01',{exact:true}).first().waitFor();
   assert.match(await cu.locator('#stock-map-svg [data-map-cell="P4-01"]').getAttribute('aria-label'),/^P3-01/);
   for(const [url,selector] of [['/stock-map/relocate','target_location_id'],['/stocktaking/new','location_id']]){
    await cu.goto(origin+url+scope);
    const option=cu.locator('select[name='+selector+'] option[value="'+slot.id+'"]');
    await option.waitFor({state:'attached'});assert.equal(await option.textContent(),'P3-01');
   }
   await cu.close();
  });
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();if(app)await app.close();await client.end();}
});
