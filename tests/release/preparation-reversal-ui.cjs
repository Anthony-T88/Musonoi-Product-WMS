'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright'),E=require('./environment.cjs'),P=require('./preparation-fixture.cjs');
const {migrate}=require('../../scripts/production-db.cjs');
const copper='CU_CATHODE',cobalt='CO_HYDROXIDE';
const operator='logistics_field_operator',supervisor='site_supervisor',manager='logistics_manager';
const requestBody=version=>({version,reason:'Synthetic preparation error',observation:'Count and locations verified',verified:true});
const approval={decision:'APPROVED',note:'Verified complete batch in stock',verified:true};
const rejection={decision:'REJECTED',note:'Synthetic return for a fresh stock check'};
const planBase=product=>product===cobalt?'/cobalt/preparation-plans':'/preparation-plans';
const base=product=>product===cobalt?'/cobalt/preparations':'/v261/lots';

test('preparation plan reopening and whole-batch reversal',async t=>{
 const {client:c,name}=await E.database();let app,browser;
 try{
  await migrate(c,{apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD,environment:'test'});
  const f=await E.seed(c,name),port=4399,origin='http://127.0.0.1:'+port,sessions=new Map();
  app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin,trustedProxyIps:'127.0.0.1'}});
  async function request(role,product,url,body,key=crypto.randomUUID()){
   const account=f.accounts.find(a=>a.role===role);
   if(!sessions.has(role)){
    const r=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},remoteAddress:'127.87.0.'+(f.accounts.indexOf(account)+1),
     payload:{username:account.username,password:account.password}});
    assert.equal(r.statusCode,200);
    sessions.set(role,{origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken});
   }
   return app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions.get(role),'x-product-code':product,'idempotency-key':key},payload:body});
  }
  async function api(role,product,url,body,expected=200){
   const r=await request(role,product,url,body);
   assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,500));
   return r.json();
  }
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const receipt=await api('production_operator',copper,'/receipts',{project_id:f.project,lines:[1,2,3,4].map(n=>({
   ...E.receiptBundle(day,'00'+n),sheets_per_bundle:48,inbound_at:new Date().toISOString()
  }))});
  const submit=await api('production_operator',copper,'/receipts/'+receipt.id+'/submit',{version:receipt.version});
  await api('production_manager',copper,'/receipts/'+receipt.id+'/confirm',{version:submit.version});
  const {rows:bundles}=await c.query('SELECT * FROM bundles WHERE receipt_id=$1 ORDER BY bundle_no',[receipt.id]);
  await c.query("UPDATE stock_map_source SET status='VERIFIED',source_sha256=$1,source_name='Synthetic geometry',notes='Synthetic test'",[crypto.createHash('sha256').update('REVERSAL GEOMETRY').digest('hex')]);
  await c.query("UPDATE stock_map_cells SET x=0,y=0,width=100,height=100 WHERE code='P1-01'");
  const slot=await api('admin',copper,'/masters/locations',{project_id:f.project,warehouse_id:f.warehouse,code:'P1-01',active:true});
  await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code='P1-01' WHERE id=$1",[slot.id]);
  const fixtures={};
  for(const product of [copper,cobalt]){
   const co=product===cobalt,sale=await P.salesPlan(api,f,product),plan=await P.approved(api,product,sale,P.batch(product,921));
   const payload=co?{total_bags:2}:{planned_location_id:slot.id,items:bundles.slice(0,2).map(b=>({bundle_id:b.id,sample_required:false}))};
   fixtures[product]={sale,plan,payload};
   await t.test(product+' cancels only work; same approved plan is directly executable with original batch',async()=>{
    const first=await api(operator,product,base(product),{...payload,preparation_plan_id:plan.id,preparation_plan_version:plan.version});
    let cancelled;
    if(co){
     const started=await api(operator,product,base(product)+'/'+first.id+'/submit',{version:first.version});
     cancelled=await api(operator,product,base(product)+'/'+first.id+'/withdraw',{version:started.version,reason:'Synthetic cancellation before receipt'});
    }else cancelled=await api(operator,product,'/v262/lots/'+first.id+'/revoke',{
     version:first.version,reason:'Synthetic cancellation before final approval',work_stopped:true,physical_state_verified:true
    });
    assert.equal(co?cancelled.status:cancelled.workflow_state,co?'WITHDRAWN':'CANCELLED');
    const r=await api(operator,product,planBase(product)+'?executable=1&search='+plan.batch_no);
    assert.deepEqual(r.items.map(x=>x.id),[plan.id]);
    const reopened=r.items[0];
    const detail=await api(operator,product,planBase(product)+'/'+reopened.id);
    assert.equal(detail.state,'APPROVED');
    assert(detail.events.some(e=>e.action==='WORK_CANCEL'&&(e.allocation_id||e.co_preparation_id)===first.id));
    assert.equal(detail.events.filter(e=>e.action==='APPROVE').length,1);
    await api(operator,product,base(product),{...payload,preparation_plan_id:plan.id,preparation_plan_version:plan.version},409);
    const candidates=await Promise.all([1,2].map(()=>request(operator,product,base(product),{...payload,preparation_plan_id:plan.id,preparation_plan_version:reopened.version})));
    assert.deepEqual(candidates.map(r=>r.statusCode).sort(),[200,409],candidates.map(r=>r.body).join(' '));
    const second=candidates.find(r=>r.statusCode===200).json();
    assert.notEqual(first.id,second.id);
    assert.equal(co?second.preparation_batch_no:second.lot_no,plan.batch_no);
    fixtures[product].work=second;
   });
  }

  for(const product of [copper,cobalt])await t.test(product+' final reversal enforces authors, verifies stock and preserves physical inventory',async()=>{
   const co=product===cobalt,{plan,work}=fixtures[product],url=base(product)+'/'+work.id,path=url+'/reversal';
   assert(work?.id,'Reopened work is required');
   if(co){
    await api(operator,product,url+'/submit',{version:work.version});
    let current=await api(operator,product,url+'/work');
    await api(operator,product,url+'/work/save',{batch_version:current.work.version,bags:current.bags.map((b,i)=>({
     bag_id:b.bag_id,version:b.version,actual_gross_kg:'650',seal_no:'REVERSAL-CO-'+i,sampled:true
    }))});
    current=await api(operator,product,url+'/work');
    const layout=await api(supervisor,product,'/cobalt/stock/layout'),location=layout.locations.find(x=>x.id===f.location);
    const placement={preparation_id:work.id,batch_version:current.work.version,selection:'ALL',target_location_id:location.id,target_version:location.version,source:'PREPARATION'};
    const preview=await api(supervisor,product,'/cobalt/stock/place-preview',placement);
    await api(supervisor,product,'/cobalt/stock/place',{...placement,preview_hash:preview.preview_hash});
    await api(operator,product,url+'/work/submit',{batch_version:current.work.version});
    current=await api(supervisor,product,url+'/work');
    await api(supervisor,product,url+'/work/approve',{batch_version:current.work.version});
    const detail=await api('production_manager',product,url);
    await api('production_manager',product,url+'/production-approve',{version:detail.version});
   }else{
    const detail=await api(operator,product,url),weighed=(await api(operator,product,'/v262/lots/'+work.id+'/weigh',{version:work.version,
     items:detail.items.map((b,i)=>({bundle_id:b.id,item_version:b.item_version,gross_weight:'2.1000',seal_no:'REVERSAL-CU-'+i}))})).lot;
    const submitted=await api(operator,product,url+'/submit',{version:weighed.version});
    await api(supervisor,product,url+'/approve',{version:submitted.version,all_weighed_and_stored:true});
   }
   const snapshot=async()=>co?(await c.query(`SELECT i.bag_id,i.received_by,i.received_at,x.actual_gross_kg,x.seal_no,p.location_id
      FROM co_inventory i JOIN co_bag_work x USING(bag_id) JOIN co_positions p USING(bag_id)
      WHERE i.preparation_id=$1 ORDER BY i.bag_id`,[work.id])).rows:(await c.query(`SELECT b.* FROM bundles b JOIN allocation_items i ON i.bundle_id=b.id
      WHERE i.allocation_id=$1 ORDER BY b.id`,[work.id])).rows;
   const original=await snapshot();
   assert.equal(original.length,2);
   const facts=await api(supervisor,product,path);
   assert(facts.can_request,JSON.stringify(facts));
   await api(operator,product,path,requestBody(facts.version),403);
   await api('export_supervisor',product,path,requestBody(facts.version),403);
   await api(supervisor,product,path,{...requestBody(facts.version),verified:false},400);
   const replay=crypto.randomUUID(),first=(await request(supervisor,product,path,requestBody(facts.version),replay));
   assert.equal(first.statusCode,200,first.body);
   const result=first.json(),review=path+'/'+result.reversal_id+'/review';
   assert.deepEqual((await request(supervisor,product,path,requestBody(facts.version),replay)).json(),result);
   await api(supervisor,product,path,requestBody(facts.version),409);
   await api(supervisor,product,review,approval,403);
   await api(manager,product,review,rejection);
   assert.deepEqual(await snapshot(),original);
   const ready=await api(supervisor,product,path);
   const submitted=await api(supervisor,product,path,requestBody(ready.version));
   fixtures[product].reversal={id:submitted.reversal_id,workId:work.id,url,planId:plan.id,original,snapshot};
  });

  await app.listen({host:'127.0.0.1',port});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  await t.test('a previously approved copper lot can reselect after authorized correction and rejection',async()=>{
   const planned=await api('admin',copper,'/masters/locations',{project_id:f.project,warehouse_id:f.warehouse,code:'P1-02',active:true});
   await c.query("UPDATE stock_map_cells SET x=100,y=0,width=100,height=100 WHERE code='P1-02'");
   await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code='P1-02' WHERE id=$1",[planned.id]);
   const {rows:[vacantCell]}=await c.query("SELECT code FROM stock_map_cells WHERE region_code='P1' AND code NOT IN('P1-01','P1-02') ORDER BY code LIMIT 1");
   assert(vacantCell,'A separate formal location is required for reselection');
   const vacant=await api('admin',copper,'/masters/locations',{project_id:f.project,warehouse_id:f.warehouse,code:vacantCell.code,active:true});
   await c.query('UPDATE stock_map_cells SET x=200,y=0,width=100,height=100 WHERE code=$1',[vacantCell.code]);
   await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code=$1 WHERE id=$2",[vacantCell.code,vacant.id]);
   const plan=await P.approved(api,copper,fixtures[copper].sale,P.batch(copper,923));
   const create={preparation_plan_id:plan.id,preparation_plan_version:plan.version,planned_location_id:planned.id};
   const [wrong,right]=bundles.slice(2);
   const work=await api(operator,copper,base(copper),{...create,items:[{bundle_id:wrong.id,sample_required:false}]});
   const lotPath=id=>base(copper)+'/'+id;
   const weighAndSubmit=async(id,seal)=>{
    const d=await api(operator,copper,lotPath(id));
    const saved=await api(operator,copper,'/v262/lots/'+id+'/weigh',{version:d.version,
     items:d.items.map(b=>({bundle_id:b.id,item_version:b.item_version,gross_weight:'2.1000',seal_no:seal}))});
    return api(operator,copper,lotPath(id)+'/submit',{version:saved.lot.version});
   };
   const queued=await weighAndSubmit(work.id,'RESELECT-OLD-SEAL');
   const approved=await api(supervisor,copper,lotPath(work.id)+'/approve',{version:queued.version,all_weighed_and_stored:true});
   assert.equal(approved.workflow_state,'PREPARED');
   const revokeBody=version=>({version,reason:'Synthetic wrong bundle correction',work_stopped:true,
    physical_state_verified:true,observation:'Checked original bundle at its actual location'});
   const revokePath='/v262/lots/'+work.id+'/revoke';
   await api(operator,copper,revokePath,revokeBody(approved.version),409);
   const reversalPath=lotPath(work.id)+'/reversal';
   assert.equal((await api(supervisor,copper,reversalPath)).can_request,true);
   const pendingReversal=await api(supervisor,copper,reversalPath,requestBody(approved.version));
   const reopened=await api(supervisor,copper,lotPath(work.id)+'/reopen',{version:approved.version,note:'Correct the selected bundle'});
   assert.equal(reopened.workflow_state,'RECTIFY');
   const resubmitted=await api(operator,copper,lotPath(work.id)+'/submit',{version:reopened.version});
   const rejected=await api(supervisor,copper,lotPath(work.id)+'/reject',{version:resubmitted.version,note:'Wrong bundle selected'});
   assert.equal(rejected.workflow_state,'RECTIFY');
   assert.equal((await api(operator,copper,lotPath(work.id))).preapproval.blocked_code,'REVERSAL');
   await api(operator,copper,revokePath,revokeBody(rejected.version),409);
   await api(manager,copper,reversalPath+'/'+pendingReversal.reversal_id+'/review',rejection);
   const returnedFacts=(await api(operator,copper,lotPath(work.id))).preapproval;
   assert.equal(returnedFacts.was_approved,true);
   assert.equal(returnedFacts.has_active_approval,false);
   assert.equal(returnedFacts.can_reselect,true,JSON.stringify(returnedFacts));
   const reviewer=(await api(supervisor,copper,lotPath(work.id))).preapproval;
   assert.equal(reviewer.can_revoke,true);
   assert.equal(reviewer.can_reselect,false);
   const positions=async()=> (await c.query('SELECT id,location_id,physical_status FROM bundles WHERE id=ANY($1::uuid[]) ORDER BY id',[[wrong.id,right.id]])).rows;
   const before=await positions();
   assert.equal(before.find(bundle=>bundle.id===wrong.id).location_id,planned.id);
   const auth=f.accounts.find(a=>a.role===operator),context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
   let replacement;
   try{
    const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:auth.username,password:auth.password,language:'zh-CN'}});
    assert(login.ok());
    const page=await context.newPage();
    await page.addLocatorHandler(page.locator('#task-notice[open] [data-task-dismiss]'),button=>button.click());
    await page.goto(origin+'/preparation/'+work.id);
    await page.locator('#lot-revoke').waitFor();
    const language=page.locator('.top-actions select[data-language]');
    assert.equal(await language.getAttribute('aria-label'),'语言/Language');
    assert.deepEqual(await language.locator('option').allTextContents(),['中文','English','Français']);
    await language.selectOption('en');
    const englishReselect=page.getByRole('button',{name:'Reselect Bundles',exact:true});
    await englishReselect.waitFor();
    await page.getByRole('button',{name:'Cancel Preparation',exact:true}).waitFor();
    await englishReselect.click();
    const dialog=page.locator('#lot-preapproval-dialog');
    await dialog.getByRole('heading',{name:'Cancel Preparation and Reselect Bundles',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Cancel and Reselect',exact:true}).waitFor();
    assert.doesNotMatch(await dialog.innerText(),/\p{Script=Han}/u);
    await dialog.locator('#lot-preapproval-back').click();
    await language.selectOption('zh-CN');
    assert.deepEqual(await language.locator('option').allTextContents(),['中文','English','Français']);
    const reselect=page.getByRole('button',{name:'重选捆包',exact:true});
    await reselect.waitFor();
    for(const width of [1280,390,1440]){
     await page.setViewportSize({width,height:900});
     assert(await reselect.isVisible());
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    }
    await reselect.click();
    await dialog.getByRole('button',{name:'返回',exact:true}).click();
    assert.equal((await c.query('SELECT workflow_state FROM allocations WHERE id=$1',[work.id])).rows[0].workflow_state,'RECTIFY');
    await reselect.click();
    await dialog.locator('[name=reason]').fill('Synthetic wrong bundle correction');
    await dialog.locator('[name=work_stopped]').check();
    await dialog.locator('[name=physical_state_verified]').check();
    assert(await dialog.locator('[name=observation]').evaluate(input=>input.required));
    await dialog.locator('[name=observation]').fill('Checked original bundle at its actual location');
    const cancelled=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/v262/lots/'+work.id+'/revoke'));
    await dialog.getByRole('button',{name:'确认撤销并重选',exact:true}).click();
    const changed=await cancelled;
    assert.equal(changed.status(),200,await changed.text());
    assert.equal((await changed.json()).reopened_preparation_plan_id,plan.id);
    await page.waitForURL(url=>url.pathname==='/preparation/new'&&url.searchParams.get('preparation_plan')===plan.id);
    assert.equal(await page.locator('#v261-lot-no').inputValue(),plan.batch_no);
    await page.locator('[data-v261-pick="'+right.id+'"]').check();
    assert.equal(await page.locator('[data-v261-pick="'+wrong.id+'"]').isChecked(),false);
    const location=page.locator('#v261-planned');
    assert(await location.locator('option[value="'+planned.id+'"]').evaluate(option=>option.disabled));
    await location.selectOption(vacant.id);
    const created=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/v261/lots'));
    await page.locator('#v261-create-submit').click();
    const response=await created;
    assert.equal(response.status(),200,await response.text());
    replacement=await response.json();
    assert.notEqual(replacement.id,work.id);
    assert.equal(replacement.lot_no,work.lot_no);
   }finally{await context.close();sessions.delete(operator);}
   assert.deepEqual(await positions(),before);
   const archived=await api(operator,copper,lotPath(work.id));
   assert.equal(archived.workflow_state,'CANCELLED');
   assert(archived.history.some(item=>item.action==='APPROVE'));
   assert(archived.history.some(item=>item.action==='REOPEN'&&item.note==='Correct the selected bundle'));
   assert(archived.history.some(item=>item.action==='REJECT'&&item.note==='Wrong bundle selected'));
   assert(archived.history.some(item=>item.action==='REVOKE'));
   assert(archived.items.every(item=>item.released_at));
   assert.deepEqual((await api(operator,copper,lotPath(replacement.id))).items.map(item=>item.id),[right.id]);
   const retry=await weighAndSubmit(replacement.id,'RESELECT-NEW-SEAL');
   assert.equal(retry.workflow_state,'PENDING');
   const returned=await api(supervisor,copper,lotPath(replacement.id)+'/reject',{version:retry.version,note:'Synthetic cancellation path'});
   await api(supervisor,copper,'/v262/lots/'+replacement.id+'/revoke',{version:returned.version,reason:'Verified stop',
    observation:'Stock and locations checked',work_stopped:true,physical_state_verified:true});
   assert.equal((await api(operator,copper,lotPath(replacement.id))).preapproval.reopened_preparation_plan_id,plan.id);
  });
  await t.test('manager sees pending reversal in the actual work detail and approves in both products',async()=>{
   const a=f.accounts.find(x=>x.role===manager),context=await browser.newContext({viewport:{width:1280,height:900}});
   assert.equal((await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:a.username,password:a.password}})).status(),200);
   const page=await context.newPage();
   await page.addLocatorHandler(page.locator('#task-notice[open] [data-task-dismiss]'),button=>button.click());
   await page.goto(origin+'/overview');
   await page.waitForFunction(()=>window.AppSignedIn&&typeof Router!=='undefined'&&!Router.rendering);
   for(const [i,product] of [copper,cobalt].entries()){
    const fx=fixtures[product].reversal;
    assert(fx,'Reversal fixture was prepared for '+product);
    if(i){
     await page.goto(origin+'/overview?management=todos');
     await page.locator('#c461-task-product').selectOption(product);
     await page.waitForFunction(()=>window.ProductContext?.ready&&ProductContext.code==='CO_HYDROXIDE'&&!Router.rendering);
    }
    const path=(i?'/receipts/':'/preparation/')+fx.workId+'?reversal='+fx.id+'#preparation-reversal';
    await page.goto(origin+'/overview?management=todos');
    const todo=page.locator('#page-content a[href='+JSON.stringify(path)+']').first();
    await todo.click();
    const section=page.locator('#preparation-reversal');
    await section.locator('[data-reversal-action=approve]').waitFor();
    if(i)await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await section.locator('[data-reversal-action=approve]').click();
    const form=page.locator('#preparation-reversal-review');
    await form.locator('[name=note]').fill('Verified physical stock and location');
    await form.locator('[name=verified]').check();
    const approved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/'+fx.id+'/review'));
    await form.locator('button[type=submit]').click();
    const response=await approved;
    assert.equal(response.status(),200,await response.text());
    await section.getByText(/已撤销|Reversed/).first().waitFor();
    assert.deepEqual(await fx.snapshot(),fx.original);
    const {rows:[state]}=await c.query('SELECT state FROM preparation_plans WHERE id=$1',[fx.planId]);
    assert.equal(state.state,'CANCELLED');
    const saved=(await c.query('SELECT * FROM preparation_reversals WHERE id=$1',[fx.id])).rows[0];
    assert.equal(saved.state,'APPROVED');
    assert.equal(saved.stock_snapshot.length,2);
    assert.notEqual(saved.requested_by,saved.reviewed_by);
    if(i){
     const inventory=await api(operator,product,'/cobalt/stock/batches/'+fx.workId);
     assert(inventory.items.every(row=>row.status==='REVERSED'));
    }else{
     const active=(await c.query('SELECT count(*)::int n FROM reservations WHERE allocation_id=$1 AND released_at IS NULL',[fx.workId])).rows[0].n;
     assert.equal(active,0);
    }
   }
   await context.close();
   sessions.delete(manager);
  });

  await t.test('replacement cobalt plan uses the same bags, location and receipt, while retaining the old batch',async()=>{
   const {sale,plan,reversal:fx}=fixtures[cobalt];
   const values={sales_plan_id:sale,shipment_month:P.localMonth(),reversal_id:fx.id};
   const path=planBase(cobalt);
   await api('export_supervisor',cobalt,path,{...values,batch_no:plan.batch_no},409);
   const draft=await api('export_supervisor',cobalt,path,{...values,batch_no:P.batch(cobalt,922)});
   const pending=await api('export_supervisor',cobalt,path+'/'+draft.id+'/submit',{version:draft.version});
   const next=await api(manager,cobalt,path+'/'+draft.id+'/approve',{version:pending.version});
   const start=await api(operator,cobalt,base(cobalt),{preparation_plan_id:next.id,preparation_plan_version:next.version});
   assert.equal(start.id,fx.workId);
   assert.equal(start.preparation_batch_no,next.batch_no);
   assert.deepEqual(await fx.snapshot(),fx.original);
   const detail=await api(operator,cobalt,fx.url+'/work');
   assert.equal(detail.work.status,'PREPARING');
   const {rows:[old]}=await c.query('SELECT * FROM preparation_plans WHERE id=$1',[plan.id]);
   assert.equal(old.state,'CANCELLED');
   assert.equal(old.co_preparation_id,null);
   const archive=await api(operator,cobalt,fx.url+'/reversal?record='+fx.id);
   assert(archive.items.some(x=>x.batch_no===plan.batch_no&&x.replacement_plan_id===next.id&&x.stock.length===2));
   await api('export_supervisor',cobalt,path,{sales_plan_id:sale,shipment_month:P.localMonth(),batch_no:plan.batch_no},409);
  });
 }finally{if(browser)await browser.close();if(app)await app.close();await c.end();}
});
