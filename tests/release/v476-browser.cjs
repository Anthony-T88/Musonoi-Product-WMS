'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {Client}=require('pg'),{chromium}=require('playwright'),E=require('./environment.cjs');
const fixture=require(path.join(E.root,process.env.WMS_TEST_FIXTURE||'.runtime/v476-test-config.json')),origin=fixture.appCfg.origin;
const CU='CU_CATHODE',CO='CO_HYDROXIDE',output=path.join(E.root,process.env.WMS_TEST_EVIDENCE||'.runtime/v476-evidence');
const results=[];
async function main(){
 assert.match(origin,/^http:\/\/127\.0\.0\.1:(4187|4191|4392)$/);
 assert.equal(fixture.appCfg.environment,'test');
 assert.match(fixture.database,/^musonoi_audit_[0-9a-f]{10}_test$/);
 assert.equal(new URL(fixture.appCfg.databaseUrl).pathname,'/'+fixture.database);
 fs.mkdirSync(output,{recursive:true});
 const db=new Client(E.options(fixture.database));await db.connect();
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE}).catch(async error=>{
  await db.end();throw error;
 });
 async function login(role){
  const user=fixture.accounts.find(a=>a.role===role);
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const response=await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:user.username,password:user.password}});
  assert.equal(response.status(),200,role);
  return {ctx,csrf:(await response.json()).csrfToken,user};
 }
 const read=async(sql,args)=>(await db.query(sql,args)).rows;
 const one=async(sql,args)=>(await read(sql,args))[0];
 const request=async(session,product,url,method='GET',data,expected=200)=>{
  const switchProduct=await session.ctx.request.post(origin+'/api/v1/product-context',{
   headers:{origin,'x-csrf-token':session.csrf},data:{productCode:product}
  });
  assert.equal(switchProduct.status(),200);
  const response=await session.ctx.request.fetch(origin+'/api/v1'+url,{
   method,headers:{origin,'x-product-code':product,'x-csrf-token':session.csrf,'idempotency-key':randomUUID()},...(data?{data}:{})
  });
  const json=await response.json();
  assert.equal(response.status(),expected,JSON.stringify({url,status:response.status(),error:json.error}));
  return json;
 };
 const check=async(name,run)=>{
  if(process.env.WMS_V476_FOCUS&&!name.includes(process.env.WMS_V476_FOCUS))return;
  try{await run();results.push({name,status:'PASS'});console.log('PASS '+name);}
  catch(error){results.push({name,status:'FAIL',message:error.message});console.log('FAIL '+name+' '+error.message.split('\n')[0]);}
 };
 const shot=(p,name)=>p.screenshot({path:path.join(output,name+'.png'),fullPage:true,animations:'disabled'});
 try{
  const admin=await login('admin'),manager=await login('logistics_manager'),viewer=await login('limited_viewer'),
   supervisor=await login('export_supervisor');
  const page=await admin.ctx.newPage();page.setDefaultTimeout(8500);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
  const ready=()=>page.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&!Router.rendering&&document.getElementById('session-restore').hidden);
  await page.goto(origin+'/overview');await ready();
  const go=async(product,route)=>{
   await page.evaluate(code=>localStorage.setItem(ProductContext.key,code),product);
   await page.goto(origin+route);await ready();
  };
  const title=async(expected)=>assert.equal(await page.locator('#business-title').innerText(),expected);
  await check('administrator preparation lifecycle and segregation',async()=>{
   for(const [product,table,prefix] of [[CU,'sales_plans',''],[CO,'co_sales_plans','/cobalt']]){
    const api=prefix+'/preparation-plans';
    const sales=await one(`SELECT p.id,p.customer_id FROM ${table} p LEFT JOIN sales_plan_approvals a ON a.plan_id=p.id AND a.product_code=$1
     WHERE p.status='OPEN' AND coalesce(a.state,'APPROVED')='APPROVED' ORDER BY p.created_at DESC LIMIT 1`,[product]);
    assert(sales);
    const year=2100+Math.floor(Math.random()*500),suffix=product===CO?'731':'73';
    const body={sales_plan_id:sales.id,batch_no:'RMM-'+(product===CO?'CO':'CU')+'-'+year+'-'+suffix,shipment_month:'2026-11'};
    const created=await request(admin,product,api,'POST',body);
    assert(created.actions.edit&&created.actions.submit);
    const edited=await request(admin,product,api+'/'+created.id,'PATCH',{...body,shipment_month:'2026-12',version:created.version});
    const pending=await request(admin,product,api+'/'+created.id+'/submit','POST',{version:edited.version});
    assert.equal(pending.state,'PENDING');assert.equal(pending.actions.review,false);
    await request(admin,product,api+'/'+created.id+'/approve','POST',{version:pending.version},409);
    const rejected=await request(manager,product,api+'/'+created.id+'/reject','POST',{version:pending.version,reason:'Synthetic TEST return'});
    assert.equal(rejected.state,'REJECTED');
    const again=await request(admin,product,api+'/'+created.id+'/submit','POST',{version:rejected.version});
    const approved=await request(manager,product,api+'/'+created.id+'/approve','POST',{version:again.version});
    assert.equal(approved.state,'APPROVED');
    const adminView=await request(admin,product,api+'/'+created.id);
    assert.equal(adminView.actions.start,true);
    await request(viewer,product,api,'POST',body,403);
    await go(product,'/preparation/work-plans/'+created.id);
    const start=page.getByRole('link',{name:'创建备货单',exact:true});await start.waitFor();await shot(page,product+'-approved-plan');
    const startHref=await start.getAttribute('href');
    await start.click();
    await page.waitForURL('**/*?preparation_plan='+created.id);
    const work=page.locator(product===CU?'#v261-create':'#co-create');
    try{await work.waitFor({timeout:5000});}
    catch{await go(product,startHref);await work.waitFor();}
    const staffPlan=await request(supervisor,product,api,'POST',{...body,batch_no:body.batch_no.slice(0,-1)+'4'});
    const staffPending=await request(supervisor,product,api+'/'+staffPlan.id+'/submit','POST',{version:staffPlan.version});
    await go(product,'/preparation/work-plans/'+staffPlan.id);
    await page.getByRole('button',{name:/通过/}).first().waitFor();
    const adminApproved=await request(admin,product,api+'/'+staffPlan.id+'/approve','POST',{version:staffPending.version});
    assert.equal(adminApproved.state,'APPROVED');
   }
  });
  await check('isolated persistent draft, version and product authorization',async()=>{
   const sales=await one("SELECT id FROM sales_plans WHERE status='OPEN' ORDER BY created_at DESC LIMIT 1");
   const id=randomUUID(),api='/document-drafts/'+id;
   const before=await one('SELECT count(*)::int count FROM preparation_plans');
   const body={form_key:'preparation-plan-form',route:'/preparation/work-plans',version:0,fields:[
    ['sales_plan_id',0,'select-one',sales.id],['shipment_month',0,'month',''],['batch_no',0,'text','']
   ]};
   const first=await request(admin,CU,api,'PUT',body);
   assert.equal(first.version,1);
   assert.equal((await request(admin,CU,api,'PUT',body)).version,1);
   await request(viewer,CU,api,'GET',null,404);
   await request(admin,CO,'/cobalt'+api,'GET',null,404);
   await request(admin,CU,api,'PUT',{...body,version:1,fields:[['sales_plan_id',0,'select-one',randomUUID()]]},404);
   const latest=await request(admin,CU,api,'PUT',{...body,version:1,fields:[...body.fields,['extra',0,'text','resume']]});
   assert.equal(latest.version,2);
   await request(admin,CU,api,'PUT',{...body,version:1,fields:[['batch_no',0,'text','stale']]},409);
   assert.deepEqual(await one('SELECT count(*)::int count FROM preparation_plans'),before);
   await request(admin,CU,api,'DELETE',{version:2});
   await request(admin,CU,api,'GET',null,404);
  });
  await check('preparation draft saved and reopened in browser',async()=>{
   await go(CU,'/preparation/work-plans');
   await page.locator('#preparation-plan-create').click();
   const form=page.locator('#preparation-plan-form');
   await form.locator('[name=batch_no]').fill('RMM-CU-2097-84');
   await form.getByRole('button',{name:'保存草稿',exact:true}).click();
   await form.getByText('草稿已保存',{exact:true}).waitFor();
   await shot(page,'preparation-draft-saved');
   await page.reload();await ready();
   assert.equal(await page.locator('#module-document-drafts').count(),0);
   const row=page.locator('#preparation-plans-table [data-document-draft-row]').filter({hasText:'RMM-CU-2097-84'});
   await row.getByText('草稿',{exact:true}).waitFor();
   await row.locator('[data-draft-open]').click();
   await form.getByText('已载入草稿',{exact:true}).waitFor();
   assert.equal(await form.locator('[name=batch_no]').inputValue(),'RMM-CU-2097-84');
   const select=form.locator('[name=sales_plan_id]');
   await select.locator('option').nth(1).waitFor({state:'attached'});
   await select.selectOption({index:1});
   await form.locator('[name=shipment_month]').fill('2026-11');
   await form.locator('[name=batch_no]').fill('invalid-batch');
   await form.getByRole('button',{name:'保存计划',exact:true}).click();
   await form.getByText(/批次号格式无效/).waitFor();
   const batch='RMM-CU-'+(2700+Math.floor(Math.random()*900))+'-94';
   await form.locator('[name=batch_no]').fill(batch);
   await form.getByRole('button',{name:'保存草稿',exact:true}).click();
   await form.getByRole('button',{name:'保存草稿',exact:true}).waitFor({state:'visible'});
   await page.waitForFunction(()=>!document.querySelector('#preparation-plan-form [data-draft-feedback]')?.previousElementSibling.disabled);
   await form.getByRole('button',{name:'保存计划',exact:true}).click();
   await page.waitForURL(/\/preparation\/work-plans\/[0-9a-f-]{36}$/);
   assert.equal((await one('SELECT count(*)::int count FROM preparation_plans WHERE batch_no=$1',[batch])).count,1);
  });
  await check('account dialog backdrop, Escape and failed validation',async()=>{
   await go(CU,'/workbench/accounts');await page.locator('#account-create').click();
   const form=page.locator('#account-edit');
   await form.locator('[name=display_name]').fill('Synthetic modal TEST');
   await page.mouse.click(5,5);
   assert.equal(await form.locator('[name=display_name]').inputValue(),'Synthetic modal TEST');
   await page.keyboard.press('Escape');
   await page.locator('#operation-confirm').waitFor();
   await page.locator('#operation-confirm-cancel').click();
   await form.getByRole('button',{name:'保存',exact:true}).click();
   assert.equal(await form.locator('[name=display_name]').inputValue(),'Synthetic modal TEST');
   await shot(page,'account-create-retained');
   await form.locator('#account-cancel').click();await page.locator('#operation-confirm-accept').click();
   await page.locator('#dialog:not([open])').waitFor({state:'attached'});
   await page.locator('#account-create').click();
   const name='v476_'+randomUUID().slice(0,12).replace('-','');
   await form.locator('[name=username]').fill(name);
   await form.locator('[name=display_name]').fill('Synthetic '+name);
   await form.locator('[name=password]').fill('WmsTest@'+randomUUID());
   await form.getByRole('button',{name:'保存',exact:true}).click();
   await page.locator('#dialog:not([open])').waitFor({state:'attached'});
   await page.waitForFunction(username=>Accounts.users?.some(user=>user.username===username),name);
   assert.equal((await one('SELECT count(*)::int count FROM users WHERE username=$1',[name])).count,1);
  });
  await check('copper archive in-stock and outbound, real document links',async()=>{
   for(const state of ['IN_STOCK','OUTBOUND']){
    const b=await one('SELECT bundle_no FROM bundles WHERE physical_status=$1 AND receipt_id IS NOT NULL ORDER BY inbound_at DESC LIMIT 1',[state]);
    await go(CU,'/inventory/'+encodeURIComponent(b.bundle_no));
    await title('捆包详情档案');
    await page.locator('.archive-identity').getByText('捆包片数',{exact:true}).waitFor();
    assert.equal(await page.getByText('全部档案字段与历史依据',{exact:true}).count(),0);
    const link=page.locator('.inventory-archive table a').first();
    await link.waitFor();const route=await link.getAttribute('href');
    await shot(page,'copper-archive-'+state);
    await link.click();await page.waitForURL(url=>url.pathname===route.split('?')[0]);
   }
  });
  await check('cobalt archive list return, precision and real document links',async()=>{
   for(const stock of ['IN_STOCK','OUTBOUND']){
    const filter='?stock_state='+stock+'&batch_page=1';
    await go(CO,'/inventory'+filter);
    await page.locator('a[href*="/archive"]').first().click();
    await page.locator('.inventory-archive').waitFor();
    await title('批次详情档案');
    assert.equal(await page.getByText('完整批次档案',{exact:true}).count(),0);
    const visible=await page.locator('.archive-identity').innerText();
    assert(/\d+\.\d{4}(?!\d)/.test(visible));assert(/\d+\.\d{5}(?!\d)/.test(visible));
    const route=page.url(),link=page.locator('.inventory-archive table a').first();
    await link.waitFor();
    await shot(page,'cobalt-archive-'+stock);
    const target=await link.getAttribute('href');await link.click();
    await page.waitForURL(url=>url.pathname===target.split('?')[0]);
    await page.goto(route);await ready();
    await page.getByRole('link',{name:'返回批次列表',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/inventory'&&url.searchParams.get('stock_state')===stock&&url.searchParams.get('batch_page')==='1');
   }
  });
  await check('browser gate paper, copper and cobalt',async()=>{
   const testPrint=async(product,id,revision)=>{
    await go(product,'/overview');
    const prefix=product===CO?'/cobalt':'',paper=await admin.ctx.newPage();
    await paper.addInitScript(()=>{window.print=()=>{window.printRequested=true;};});
    const data=await paper.goto(origin+'/api/v1'+prefix+'/gate-permits/'+id+'/revisions/'+revision+'/view');
    assert.equal(data.status(),200);
    await paper.locator('.sheet[data-fit-ready="1"]').waitFor();
    assert.match(await paper.locator('style').textContent(),/@page\{size:9\.5in 5\.5in/);
    await paper.locator('#gate-print').click();
    assert(await paper.evaluate(()=>window.printRequested));
    await paper.emulateMedia({media:'print'});
    await paper.pdf({path:path.join(output,product+'-gate-permit.pdf'),preferCSSPageSize:true,printBackground:true});
    await paper.screenshot({path:path.join(output,product+'-gate-print-render.png')});
    await paper.close();
   };
   const copper=await one("SELECT id,current_revision FROM gate_permits WHERE product_code='CU_CATHODE' LIMIT 1");
   await testPrint(CU,copper.id,copper.current_revision);
   const co=await one('SELECT order_id FROM co_packing_documents LIMIT 1');
   const issued=await request(admin,CO,'/cobalt/gate-permits/from/'+co.order_id,'POST',{});
   await testPrint(CO,issued.permit_id,issued.revision);
  });
  await check('packing and invoice action panels at 1440, 1280 and 390',async()=>{
   const cu=await one('SELECT loading_id FROM packing_list_documents LIMIT 1'),co=await one('SELECT order_id FROM co_packing_documents LIMIT 1');
   for(const [product,route,form] of [[CU,'/export-shipments/'+cu.loading_id,'#shipping-generate'],[CO,'/outbounds/'+co.order_id+'/packing-list','#co-packing-generate']]){
    for(const width of [1440,1280,390]){
     await page.setViewportSize({width,height:900});await go(product,route);await page.locator(form).waitFor();
     const dimensions=await page.locator(form).evaluate(f=>{
      const grid=f.closest('.p46-grid'),main=f.closest('.p46-main'),documentGrid=f.querySelector('.wms-field-grid');
      return {grid:grid.getBoundingClientRect().width,main:main.getBoundingClientRect().width,form:f.getBoundingClientRect().width,fields:documentGrid.getBoundingClientRect().width};
     });
     assert(Math.abs(dimensions.grid-dimensions.main)<2&&Math.abs(dimensions.form-dimensions.fields)<2,JSON.stringify(dimensions));
     if(width!==1280)await shot(page,product+'-packing-'+width);
    }
    const table=product===CU?'packing_list_documents':'co_packing_documents',fk=product===CU?'loading_id':'order_id',
     id=product===CU?cu.loading_id:co.order_id;
    const prior=(await one('SELECT revision FROM '+table+' WHERE '+fk+'=$1',[id])).revision;
    const field=page.locator(form+' '+(product===CU?'input[name=unit_price_usd]':'textarea[name=reason]'));
    await field.fill('');
    await page.locator(form+' button.primary').click();
    assert.equal((await one('SELECT revision FROM '+table+' WHERE '+fk+'=$1',[id])).revision,prior);
    await field.fill(product===CU?'9500.42':'Synthetic V4.7.6 packing layout test');
    await page.locator(form+' button.primary').click();
    if(product===CO)await page.locator('#operation-confirm-accept').click();
    for(let i=0;i<35;i++){
     if((await one('SELECT revision FROM '+table+' WHERE '+fk+'=$1',[id])).revision===prior+1)break;
     await new Promise(resolve=>setTimeout(resolve,150));
    }
    assert.equal((await one('SELECT revision FROM '+table+' WHERE '+fk+'=$1',[id])).revision,prior+1,
     JSON.stringify({product,errors:await page.locator('#shipping-generate-error,#co-packing-error').allTextContents()}));
   }
  });
  await check('separate approval prototypes, desktop and mobile',async()=>{
   const mock=await admin.ctx.newPage();
   await mock.goto(pathToFileURL(path.join(E.root,'docs/v4.7.6/loading-detail-proposal.html')).href);
   for(const [product,button] of [['copper','阴极铜'],['cobalt','氢氧化钴']]){
    await mock.getByRole('button',{name:button,exact:true}).click();
    await mock.getByText('装载明细（1 条）',{exact:true}).click();
    assert.equal(await mock.locator('details[open] tbody tr').count(),1);
    await mock.locator('#review-state').selectOption('pending');
    await mock.getByRole('button',{name:'审核通过',exact:true}).waitFor();
    await shot(mock,product+'-loading-proposal');
   }
   await mock.goto(pathToFileURL(path.join(E.root,'docs/v4.7.6/content-width-proposal.html')).href);
   for(const state of ['empty','open','closed','narrow']){
    await mock.locator('[data-layout='+state+']').click();
    const grid=await mock.locator('.proposal-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(grid,state==='open'?2:1);
    await shot(mock,'width-proposal-'+state);
   }
   await mock.close();
  });
  await check('draft buttons and persistence in business entry forms',async()=>{
   await page.setViewportSize({width:1440,height:900});
   const cuPlan=await one("SELECT id FROM preparation_plans WHERE product_code=$1 AND state='APPROVED' AND allocation_id IS NULL LIMIT 1",[CU]);
   const coPlan=await one("SELECT id FROM preparation_plans WHERE product_code=$1 AND state='APPROVED' AND co_preparation_id IS NULL LIMIT 1",[CO]);
   const visits=[
    [CU,'/receipts/new','#v26-receipt'],[CU,'/preparation/new?preparation_plan='+cuPlan.id,'#v261-create'],
    [CO,'/receipts/new?preparation_plan='+coPlan.id,'#co-create'],
    [CU,'/loading-plans/new','#single-plan-form'],[CO,'/loading-plans/new','#co-loading-form'],
    [CU,'/outbounds/loads/new','#lp-load-form'],[CU,'/stocktaking/new','#v33-count-create'],
    [CO,'/stocktaking/new','#co-count-create'],[CU,'/export-licenses/new','#export-license-application'],
    [CO,'/export-licenses/new','#export-license-application']
   ];
   const failures=[];
   for(const [product,route,selector] of visits){
    try{
     await go(product,route);
     const form=page.locator(selector);await form.waitFor({timeout:4500});
     await form.getByRole('button',{name:'保存草稿',exact:true}).click();
     const result=form.locator('[data-draft-feedback]');await result.waitFor();
     await page.waitForFunction(id=>!!document.querySelector(id+' [data-draft-feedback]')?.textContent,selector,{timeout:4500});
     assert.equal(await result.textContent(),'草稿已保存');
    }catch(error){failures.push({product,route,selector,reason:error.message.split('\n')[0]});}
   }
   assert.deepEqual(failures,[]);
  });
  await check('stocktake drafts reopen the copper dialog and restore the cobalt bag row',async()=>{
   const draftOpen=async id=>{
    await page.locator('[data-draft-open="'+id+'"]').click();
   };
   const save=async(form,key)=>{
    const written=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().includes('/document-drafts/'));
    await form.getByRole('button',{name:'保存草稿',exact:true}).click();
    const response=await written;
    assert.equal(response.status(),200,await response.text());
    const row=await response.json();assert(row.fields.some(([name])=>name===key));return row.id;
   };
   const common={project_id:fixture.project,warehouse_id:fixture.warehouse};
   const copper=await request(admin,CU,'/v27/stocktakes','POST',{
    ...common,assigned_to:admin.user.id,task_type:'SPECIAL',cutoff_at:new Date(Date.now()+60000).toISOString(),remark:'Synthetic draft resume'
   });
   await request(admin,CU,'/v27/stocktakes/'+copper.id+'/start','POST',{version:copper.version,note:'Synthetic draft resume'});
   await go(CU,'/stocktaking/'+copper.id);
   await page.locator('#v27-record').evaluate(button=>button.click());
   const observation=page.locator('#v27-observation'),remark=observation.locator('[name="remark"]');
   await remark.fill('Synthetic copper observation draft');
   const cuId=await save(observation,'remark');
   await go(CU,'/stocktaking');await draftOpen(cuId);await remark.waitFor();
   await page.waitForFunction(()=>document.querySelector('#v27-observation [name="remark"]')?.value==='Synthetic copper observation draft');
   const cobalt=await request(admin,CO,'/cobalt/stocktaking','POST',{...common,title:'Synthetic bag draft resume'});
   await go(CO,'/stocktaking/'+cobalt.id+'?page=1');
   const count=page.locator('#co-count-record'),row=count.locator('[data-count-bag]').first();
   await row.locator('[data-note]').fill('Synthetic cobalt bag draft');
   const bag=await row.getAttribute('data-count-bag');
   const coId=await save(count,'count-note:'+bag);
   await go(CO,'/stocktaking');await draftOpen(coId);
   const note=count.locator('[data-count-bag="'+bag+'"] [data-note]');await note.waitFor();
   await page.waitForFunction(selector=>document.querySelector(selector)?.value==='Synthetic cobalt bag draft','[data-count-bag="'+bag+'"] [data-note]');
   await shot(page,'cobalt-stocktake-draft-resumed');
  });
  await check('vehicle arrival drafts return to the same dispatch record for both products',async()=>{
   const plate='V476-'+randomUUID().slice(0,8),cuPlan=await one("SELECT id,preparation_month FROM sales_plans WHERE remark='Synthetic rc2 copper' ORDER BY created_at DESC LIMIT 1");
   const coPlan=await one("SELECT id,version,shipment_month FROM co_sales_plans WHERE status='OPEN' AND shipment_month IS NOT NULL ORDER BY created_at LIMIT 1");
   assert(cuPlan&&coPlan);
   const workbook=new(require('exceljs').Workbook)(),sheet=workbook.addWorksheet('Dispatch');
   sheet.addRows([['Horse','Trailer','Capacity'],[plate+'-CU',plate+'-TR-CU',30]]);
   const path='/plans/'+cuPlan.id+'/dispatch',body={file_name:'v476-synthetic-dispatch.xlsx',file_base64:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')};
   const preview=await request(admin,CU,path+'/import-preview','POST',body);
   await request(admin,CU,path,'POST',{...body,preview_sha256:preview.file_sha256});
   const {vehicles}=await request(admin,CU,path+'?shipment_month='+cuPlan.preparation_month);
   const cuVehicle=vehicles.find(row=>row.truck_no===plate+'-CU');
   const coVehicle=await request(manager,CO,'/cobalt/sales/plans/'+coPlan.id+'/dispatch/vehicles','POST',{
    plan_version:coPlan.version,truck_no:plate+'-CO',capacity_tonnes:'30',trailer_no:plate+'-TR-CO',
    driver_name:'Synthetic dispatch driver',passport_no:plate+'-P',transporter:'Synthetic TEST carrier'
   });
   for(const [product,selector,id,month] of [
    [CU,'#yard-arrival-form',cuVehicle?.id,cuPlan.preparation_month],[CO,'#co-arrival-form',coVehicle.id,coPlan.shipment_month]
   ]){
    assert(id,'Synthetic dispatch record must be available');
    const route='/loading-plans?'+new URLSearchParams({tab:'arrivals',vehicle_id:id,shipment_month:month});
    await go(product,route);
    const form=page.locator(selector),driver=form.locator('[name="driver_name"]');
    await driver.fill('Synthetic driver draft');
    const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().includes('/document-drafts/'));
    await form.getByRole('button',{name:'保存草稿',exact:true}).click();
    const response=await saved;assert.equal(response.status(),200,await response.text());
    const draft=await response.json();
    await go(product,'/loading-plans?tab=arrivals');
    await page.locator('[data-draft-open="'+draft.id+'"]').click();
    await driver.waitFor();
    await page.waitForFunction(formId=>document.querySelector(formId+' [name="driver_name"]')?.value==='Synthetic driver draft',selector);
    assert.equal(new URL(page.url()).searchParams.get('vehicle_id'),id);
   }
  });
  assert.deepEqual(errors,[]);
 }finally{
  fs.writeFileSync(path.join(output,'targeted-results.json'),JSON.stringify(results,null,2));
  await browser.close();await db.end();
 }
 if(results.some(result=>result.status!=='PASS'))process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
