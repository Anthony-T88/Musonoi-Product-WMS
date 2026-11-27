'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),
 {chromium}=require('playwright'),E=require('./environment.cjs'),P=require('./preparation-fixture.cjs');
const cu='CU_CATHODE',requester='production_operator',reviewer='production_manager',operator='logistics_field_operator';
test('bundle corrections and permission dependencies with a fresh TEST database',async t=>{
 const {client:c,name}=await E.database();let app,browser;
 try{
  await require('../../scripts/production-db.cjs').migrate(c,{apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD,environment:'test'});
assert.equal((await c.query("SELECT count(*)::int n FROM role_permissions WHERE permission_code='printer:manage'")).rows[0].n,0);
  const f=await E.seed(c,name),port=4397,origin='http://127.0.0.1:'+port,logins=new Map();
  app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin,trustedProxyIps:'127.0.0.1'}});
  async function signIn(role){
   const a=f.accounts.find(x=>x.role===role),r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.87.0.'+(f.accounts.indexOf(a)+1),
    headers:{origin},payload:{username:a.username,password:a.password}});
   assert.equal(r.statusCode,200,role);
   const state={cookie:r.cookies.map(item=>item.name+'='+item.value).join('; '),'x-csrf-token':r.json().csrfToken};
   logins.set(role,state);return state;
  }
  async function api(role,url,body,expected=200,method=body?'POST':'GET'){
   const headers=logins.get(role)||await signIn(role);
   const r=await app.inject({url:'/api/v1'+url,method,payload:body,headers:{...headers,origin,'x-product-code':cu,'idempotency-key':crypto.randomUUID()}});
   assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,300));return r.json();
  }
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const lines=[1,2,3].map(n=>({...E.receiptBundle(day,n),sheets_per_bundle:48,inbound_at:new Date().toISOString()}));
  const receipt=await api(requester,'/receipts',{project_id:f.project,lines});
  const submitted=await api(requester,'/receipts/'+receipt.id+'/submit',{version:receipt.version});
  await api(reviewer,'/receipts/'+receipt.id+'/confirm',{version:submitted.version});
  const {rows:[main,second,delegated]}=await c.query('SELECT * FROM bundles WHERE receipt_id=$1 ORDER BY bundle_no',[receipt.id]);
  const base=row=>'/bundles/'+row.id+'/corrections';
  const proposed=row=>({version:row.version,changes:{sheets_per_bundle:49},reason:'Synthetic label verified'});
  const current=async id=>(await c.query('SELECT * FROM bundles WHERE id=$1',[id])).rows[0];

  await t.test('retired printing permission and independent gate confirmation',async()=>{
   const roles=await api('admin','/security/roles');
   assert(roles.catalog.legacy.includes('printer:manage'));
   assert(!roles.catalog.workflow['printer:manage']);
   assert.deepEqual(roles.catalog.dependencies['gate:exit'],['gate:read']);
   const sales=roles.items.find(row=>row.code==='sales_operator');
   await api('admin','/security/roles/'+sales.code,{version:sales.version,permissions:['gate:exit','printer:manage']},400,'PUT');
   const saved=await api('admin','/security/roles/'+sales.code,{version:sales.version,permissions:[...new Set([...sales.permissions.filter(p=>p!=='gate:print'),'gate:exit','gate:read'])]},200,'PUT');
   assert(saved.permissions.includes('gate:exit')&&saved.permissions.includes('gate:read')&&!saved.permissions.includes('gate:print'));

  });
  await t.test('locked stock, approval roles and the old direct edit boundary',async()=>{
   await api('logistics_office_operator',base(main),proposed(main),403);
   await api('admin','/v262/bundles/'+main.id+'/sheets',{version:main.version,sheets_per_bundle:51,reason:'Should require approval'},409,'PATCH');
   const draft=await api(operator,base(second),proposed(second));
   await api(requester,base(second),proposed(second),409);
   await api(operator,base(second)+'/'+draft.id+'/review',{decision:'APPROVED'},403);
   assert.equal((await current(second.id)).sheets_per_bundle,48);
   const planApi=(role,product,url,body)=>api(role,url,body),sales=await P.salesPlan(planApi,f,cu),plan=await P.approved(planApi,cu,sales,P.batch(cu,819));
   await c.query("UPDATE stock_map_source SET status='VERIFIED',source_sha256=$1,source_name='Synthetic CI geometry',notes='Synthetic test only'",[crypto.createHash('sha256').update('CORRECTION GEOMETRY').digest('hex')]);
   await c.query("UPDATE stock_map_cells SET x=0,y=0,width=100,height=100 WHERE code='P1-01'");
   const slot=await api('admin','/masters/locations',{project_id:f.project,warehouse_id:f.warehouse,code:'P1-01',active:true});
   await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code='P1-01' WHERE id=$1",[slot.id]);
   const work=await api(operator,'/v261/lots',{preparation_plan_id:plan.id,planned_location_id:slot.id,items:[{bundle_id:second.id,sample_required:false}]});
   await api(reviewer,base(second)+'/'+draft.id+'/review',{decision:'APPROVED'},409);
   assert(!(await api(operator,base(second))).can_request);
   await api(operator,'/v262/lots/'+work.id+'/revoke',{version:work.version,reason:'Synthetic unlocked',work_stopped:true,physical_state_verified:true});
   await api(reviewer,base(second)+'/'+draft.id+'/review',{decision:'APPROVED'},409);
   await api(reviewer,base(second)+'/'+draft.id+'/review',{decision:'REJECTED',note:'Preparation locking happened during review'});
   assert.equal((await current(second.id)).sheets_per_bundle,48);
  });
  await app.listen({host:'127.0.0.1',port});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  let browserLogin=0;
  async function open(role,language='en',width=1440){
   const a=f.accounts.find(row=>row.role===role),context=await browser.newContext({extraHTTPHeaders:{'X-Forwarded-For':'127.87.1.'+(++browserLogin)},viewport:{width,height:900}});
   const r=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:a.username,password:a.password}});
   assert.equal(r.status(),200);
   const page=await context.newPage();page.setDefaultTimeout(12000);
   await page.goto(origin+'/overview');
   await page.waitForFunction(()=>window.AppSignedIn&&typeof Router!=='undefined'&&!Router.rendering&&typeof I18n!=='undefined');
   if(language!==await page.evaluate(()=>I18n.language))await page.evaluate(value=>I18n.change(value),language);
   await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
   return {context,page};
  }
   await t.test('request and manager approval from the bundle detail and tasks',async()=>{
   const url='/inventory/'+main.bundle_no;
   let login=await open(requester,'zh-CN',390);
   try{
    const p=login.page;await p.goto(origin+url);
    await p.getByRole('button',{name:'申请捆包信息更正'}).click();
    const form=p.locator('#bundle-correction-form');
    await form.locator('[name=sheets_per_bundle]').fill('51');
    await form.locator('[name=seal_no]').fill('SYNTH-APPROVED-TEST-SEAL');
    const date=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
    await form.locator('[name=production_date]').fill(date);
    await form.locator('[name=reason]').fill('Synthetic proof of corrected label');
    await form.getByRole('button',{name:'提交审核'}).click();
    await p.getByText('Synthetic proof of corrected label',{exact:true}).waitFor().catch(async e=>{throw Error((await form.locator('[role=alert]').allTextContents()).join(' / '),{cause:e});});
    assert.equal((await current(main.id)).sheets_per_bundle,48);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
   }finally{await login.context.close();}
   login=await open(reviewer,'en');
   try{
    const p=login.page;await p.goto(origin+'/overview?management=todos');
    const task=p.locator('tr').filter({has:p.locator('a[href="'+url+'"]')});
    await task.getByText('Bundle Correction Awaiting Production Manager Review',{exact:true}).waitFor();
    await task.getByRole('link',{name:'Document Details'}).click();
    await p.getByRole('button',{name:'Approve',exact:true}).click();
    await p.locator('#operation-confirm-accept').click();
    await p.locator('#bundle-correction-records').getByText('Approved',{exact:true}).waitFor();
    const after=await current(main.id);
    assert.equal(after.sheets_per_bundle,51);
    assert.equal(after.seal_no,'SYNTH-APPROVED-TEST-SEAL');
    assert.notDeepEqual(after.production_date,main.production_date);
    assert.equal(after.net_weight,main.net_weight);
    assert.equal(after.location_id,main.location_id);
    assert.equal((await c.query("SELECT count(*)::int n FROM bundle_metadata_history WHERE bundle_id=$1 AND kind='BUNDLE_CORRECTION'",[main.id])).rows[0].n,1);
   }finally{await login.context.close();}
  });
   await t.test('administrator grants both correction permissions and sales submits and approves its own request',async()=>{
   const permission='inventory:correct-request',review='inventory:correct-review',role='sales_operator';
   const management=await open('admin');
   try{
    const p=management.page;await p.goto(origin+'/workbench/permissions');
    await p.locator('[data-role=admin]').click();
    const choice=p.locator('.s46-r2-matrix input[value="'+permission+'"]');
    await choice.waitFor();
    assert(await choice.isEnabled());
    await p.locator('[data-role='+role+']').click();
    await choice.waitFor();
    assert(await choice.isEnabled());
    assert.equal(await choice.isChecked(),false);
    assert.match(await choice.locator('xpath=..').innerText(),/Suggested roles:.*Production Operator.*Logistics Field Operator/);
    await choice.check();
    await p.locator('.s46-r2-matrix input[value="'+review+'"]').check();
    const [saved]=await Promise.all([
     p.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/v1/security/roles/'+role),
     p.locator('#role-save').click()
    ]);
    assert.equal(saved.status(),200,await saved.text());
    const grants=(await saved.json()).permissions;
    assert(grants.includes(permission)&&grants.includes(review));
   }finally{await management.context.close();}

   const sales=await open(role,'zh-CN');
   try{
    const url='/inventory/'+delegated.bundle_no,p=sales.page;
    await p.goto(origin+url);
    await p.getByRole('button',{name:'申请捆包信息更正'}).click();
    const form=p.locator('#bundle-correction-form');
    await form.locator('[name=sheets_per_bundle]').fill('52');
    await form.locator('[name=reason]').fill('Synthetic delegated correction proof');
    const [submitted]=await Promise.all([
     p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1'+base(delegated)),
     form.getByRole('button',{name:'提交审核'}).click()
    ]);
    assert.equal(submitted.status(),200,await submitted.text());
     const correction=await submitted.json();
     assert.equal(correction.state,'PENDING');
    await p.getByText('Synthetic delegated correction proof',{exact:true}).waitFor();
    assert.equal((await current(delegated.id)).sheets_per_bundle,48);
     const approve=p.locator('#bundle-correction-records [data-bundle-correction="'+correction.id+'"][data-decision=APPROVED]');
     await approve.click();
     const [approved]=await Promise.all([
      p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1'+base(delegated)+'/'+correction.id+'/review'),
      p.locator('#operation-confirm-accept').click()
     ]);
     assert.equal(approved.status(),200,await approved.text());
     await p.locator('#bundle-correction-records').getByText('已通过',{exact:true}).waitFor();
     const after=await current(delegated.id);
     assert.equal(after.sheets_per_bundle,52);
     assert.equal(after.net_weight,delegated.net_weight);
     const roleActor=f.accounts.find(account=>account.role===role).id;
     const {rows:[record]}=await c.query('SELECT requester_id,reviewer_id FROM bundle_corrections WHERE id=$1',[correction.id]);
     assert.deepEqual(record,{requester_id:roleActor,reviewer_id:roleActor});
   }finally{await sales.context.close();}
  });
  await t.test('grant and revoke show the affected permissions and honor cancellation',async()=>{
   const {context,page}=await open('admin');
   try{
    await page.goto(origin+'/workbench/permissions');
    await page.locator('button[data-role="sales_operator"]').click();
    const gate=page.locator('tr[data-permission-module=gate]'),read=gate.locator('input[value="gate:read"]'),print=gate.locator('input[value="gate:print"]');
    assert.equal(await page.locator('input[value="printer:manage"]').count(),0);
    await read.click();
    await page.getByRole('heading',{name:'Disable Dependent Permissions'}).waitFor();
    assert.match(await page.locator('#operation-confirm').innerText(),/Confirm Physical Gate Exit/);
    await page.locator('#operation-confirm-cancel').click();assert(await read.isChecked());
    await read.click();await page.locator('#operation-confirm-accept').click();assert(!(await read.isChecked()));
    if(!await print.isVisible())await gate.locator('details').filter({has:page.locator('input[value="gate:print"]')}).locator('summary').click();
    await print.click();
    await page.getByRole('heading',{name:'Enable Required Permissions'}).waitFor();
    assert.match(await page.locator('#operation-confirm').innerText(),/View Vehicle Gate Exit and Permit History/);
    await page.locator('#operation-confirm-accept').click();assert(await read.isChecked()&&await print.isChecked());
   }finally{await context.close();}
  });
  await t.test('stock issue browser sends the selected date and displays each correction approval stage',async()=>{
   const {context,page}=await open('admin','zh-CN',390);
   try{
    const id=crypto.randomUUID(),correction=crypto.randomUUID(),url='/outbounds/loads/'+id;
    const path='/api/v1/v26/loads/'+id,base=path+'/outbound-date-corrections',review=base+'/'+correction+'/review';
    const declared='2001-02-03',corrected='2040-12-31',reason='Synthetic stock issue date evidence',requests=[];
    let posted=false,stage=null;
    const states=['PENDING_LOGISTICS','PENDING_PRODUCTION','APPROVED'];
    const fulfill=(route,data)=>route.fulfill({json:data});
    await page.route('**/api/v1/loads/'+id,route=>fulfill(route,{id,code:'DATE-UI-TEST',
     customer_name:'Synthetic date customer',vehicle_no:'DATE-UI',items:[],version:1,
     status:posted?'DEPARTED':'LOADED',workflow_state:posted?'OUTBOUND':'READY'}));
    await page.route('**/api/v1/v26/reviews/loads/'+id,route=>fulfill(route,{items:[]}));
    await page.route('**/api/v1/outbound-workspace/orders/'+id+'/corrections',route=>fulfill(route,{items:[]}));
    await page.route('**'+path+'/depart',route=>{
     requests.push(route.request().postDataJSON());
     posted=true;
     return fulfill(route,{id});
    });
    await page.route('**'+base,route=>{
     if(route.request().method()==='POST'){
      requests.push(route.request().postDataJSON());
      stage=0;
      return fulfill(route,{id:correction});
     }
     return fulfill(route,{outbound_date:stage===2?corrected:declared,can_request:stage===null,
      items:stage===null?[]:[{id:correction,version:stage+1,state:states[stage],can_review:stage<2,
       original_date:declared,corrected_date:corrected,requester_name:'Synthetic operator',reason}]});
    });
    await page.route('**'+review,route=>{
     requests.push(route.request().postDataJSON());
     stage++;
     return fulfill(route,{id:correction});
    });
    await page.goto(origin+url+'?date_correction=1#outbound-date-correction-panel');
    const date=page.locator('#v26-departure-date');
    await date.fill(declared);
    assert.equal(await date.getAttribute('min'),null);
    assert.equal(await date.getAttribute('max'),null);
    await page.locator('[data-v26-action=depart]').click();
    const confirmation=page.locator('#operation-confirm');
    await confirmation.getByText(declared,{exact:true}).waitFor();
    const [departure]=await Promise.all([
     page.waitForResponse(r=>new URL(r.url()).pathname===path+'/depart'),
     confirmation.locator('#operation-confirm-accept').click()
    ]);
    assert.equal(departure.status(),200,await departure.text());
    await page.goto(origin+url+'?date_correction=1#outbound-date-correction-panel');
    const request=page.locator('#outbound-date-correction-request');
    await request.click().catch(async error=>{
     throw Error((await page.locator('#page-content').innerText()).slice(0,1400),{cause:error});
    });
    const form=page.locator('#outbound-date-correction-form');
    await form.locator('[name=outbound_date]').fill(corrected);
    await form.locator('[name=reason]').fill(reason);
    await form.locator('button[type=submit]').click();
    const panel=page.locator('#outbound-date-correction-panel');
    for(const title of ['待物流经理审批','待生产管理部经理审批']){
     await panel.getByText(title,{exact:true}).waitFor();
     await panel.locator('[data-decision=APPROVED]').click();
     await page.locator('#operation-confirm-accept').click();
    }
    await panel.getByText('已生效',{exact:true}).waitFor();
    assert.equal(await panel.locator('.business-toolbar span[data-no-i18n]').textContent(),corrected);
    assert.deepEqual(requests,[
     {version:1,note:'',actual_departure:true,outbound_date:declared},
     {expected_date:declared,outbound_date:corrected,reason},
     {version:1,decision:'APPROVED',note:''},{version:2,decision:'APPROVED',note:''}
    ]);
   }finally{await context.close();}
  });
 }finally{await browser?.close();await app?.close();await c.end();}
});
