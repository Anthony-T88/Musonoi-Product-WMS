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
  const lines=[1,2].map(n=>({bundle_no:'MUS-'+day.slice(0,4)+'-043-0'+n,sheets_per_bundle:48,production_date:day,inbound_at:new Date().toISOString()}));
  const receipt=await api(requester,'/receipts',{project_id:f.project,lines});
  const submitted=await api(requester,'/receipts/'+receipt.id+'/submit',{version:receipt.version});
  await api(reviewer,'/receipts/'+receipt.id+'/confirm',{version:submitted.version});
  const {rows:[main,second]}=await c.query('SELECT * FROM bundles WHERE receipt_id=$1 ORDER BY bundle_no',[receipt.id]);
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
   await api('admin',base(main),proposed(main),403);
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
  await t.test('request and independent approval from the bundle detail and manager tasks',async()=>{
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
    await task.getByRole('link',{name:'Open to Process →'}).click();
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
  await t.test('grant and revoke show the affected permissions and honor cancellation',async()=>{
   const {context,page}=await open('admin');
   try{
    await page.goto(origin+'/workbench/permissions');
    await page.locator('button[data-role="sales_operator"]').click();
    const gate=page.locator('tr[data-permission-module=gate]'),read=gate.locator('input[value="gate:read"]'),print=gate.locator('input[value="gate:print"]');
    assert.equal(await page.locator('input[value="printer:manage"]').count(),0);
    await read.click();
    await page.getByRole('heading',{name:'Disable Dependent Permissions'}).waitFor();
    assert.match(await page.locator('#operation-confirm').innerText(),/Sales Confirmation of Physical Gate Exit/);
    await page.locator('#operation-confirm-cancel').click();assert(await read.isChecked());
    await read.click();await page.locator('#operation-confirm-accept').click();assert(!(await read.isChecked()));
    if(!await print.isVisible())await gate.locator('details').filter({has:page.locator('input[value="gate:print"]')}).locator('summary').click();
    await print.click();
    await page.getByRole('heading',{name:'Enable Required Permissions'}).waitFor();
    assert.match(await page.locator('#operation-confirm').innerText(),/View Vehicle Gate Exit and Permit History/);
    await page.locator('#operation-confirm-accept').click();assert(await read.isChecked()&&await print.isChecked());
   }finally{await context.close();}
  });
 }finally{await browser?.close();await app?.close();await c.end();}
});
