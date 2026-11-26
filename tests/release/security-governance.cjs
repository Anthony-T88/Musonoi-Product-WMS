'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto'),{Client}=require('pg');
const E=require('./environment.cjs'),{migrate}=require('../../scripts/production-db.cjs');
const {configure}=require('../../scripts/general-manager.cjs');

test('General Manager approval gates effective account access and leaves reviewable evidence',async t=>{
 const db=await E.database(),c=db.client;
 let app,appClient;
 try{
  await migrate(c,{environment:'test',apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD});
  const fixture=await E.seed(c,db.name),reports=[];
  const manager={username:'audit_general_manager',displayName:'Synthetic General Manager',password:randomBytes(24).toString('hex')};
  assert.equal((await configure(c,manager,{environment:'test'})).status,'DRY_RUN_ROLLED_BACK');
  assert.equal((await c.query('SELECT 1 FROM users WHERE username=$1',[manager.username])).rowCount,0);
  await assert.rejects(()=>configure(c,manager,{environment:'test',apply:true}),{code:'MIGRATION_VERIFIED_BACKUP_REQUIRED'});
  assert.equal((await configure(c,manager,{environment:'test',apply:true,backupVerified:true})).status,'PROVISIONED');
  await assert.rejects(()=>configure(c,{...manager,username:'other_gm'},{environment:'test'}),{code:'GENERAL_MANAGER_ACTIVE_ACCOUNT_CONFLICT'});
  const cfg={...fixture.appCfg,port:4492,origin:'http://127.0.0.1:4492'};
  app=await require('../../server/app.cjs').build({config:cfg,requestAuditReporter:record=>reports.push(record)});
  const login=async(account,remoteAddress)=>{
   const response=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress,
    headers:{origin:cfg.origin},payload:{username:account.username,password:account.password}});
   assert.equal(response.statusCode,200,response.body);
   return {user:response.json().user,origin:cfg.origin,cookie:response.cookies.map(x=>x.name+'='+x.value).join('; '),
    'x-csrf-token':response.json().csrfToken};
  };
  const adminAccount=fixture.accounts.find(a=>a.role==='admin'),operatorAccount=fixture.accounts.find(a=>a.role==='production_operator');
  const admin=await login(adminAccount,'192.0.2.11'),gm=await login(manager,'198.51.100.12'),operator=await login(operatorAccount,'203.0.113.13');
  const api=(session,method,url,payload,product='CU_CATHODE')=>app.inject({method,url:'/api/v1'+url,headers:{
   origin:session.origin,cookie:session.cookie,'x-csrf-token':session['x-csrf-token'],'x-product-code':product
  },...(payload?{payload}:{})});
  const expect=async(session,method,url,body,status=200)=>{
   const response=await api(session,method,url,body);
   assert.equal(response.statusCode,status,response.body);
   return response.json();
  };
  const review=(id,decision='APPROVED',extra={})=>expect(gm,'POST','/security/access-requests/'+id+'/decision',{decision,password:manager.password,...extra});
  const users=()=>expect(admin,'GET','/users?status=all');
  const readRole=async()=> (await c.query('SELECT role_code FROM users WHERE id=$1',[operatorAccount.id])).rows[0].role_code;

  await t.test('only the independent approver sees the queue and the warehouse is outside this role',async()=>{
   assert.deepEqual(gm.user.permissions,['access-change:approve']);
   await expect(gm,'GET','/inventory',null,403);
   await expect(operator,'GET','/security/access-requests',null,403);
   await expect(admin,'PATCH','/users/'+gm.user.id,{active:false},403);
   await expect(admin,'POST','/users/'+gm.user.id+'/reset-password',{password:manager.password},403);
   appClient=new Client({connectionString:cfg.databaseUrl});await appClient.connect();
   await assert.rejects(()=>appClient.query("UPDATE users SET active=false WHERE id=$1",[gm.user.id]),{code:'42501'});
   await assert.rejects(()=>appClient.query("INSERT INTO role_permissions VALUES('admin','access-change:approve')"),{code:'42501'});
  });
  await t.test('proposal, independent decision and session revocation apply exactly once',async()=>{
   const path='/users/'+operatorAccount.id,body={role_code:'logistics_field_operator',scopes:[{project_id:fixture.project,warehouse_id:fixture.warehouse}]};
   const staged=await expect(admin,'PATCH',path,body);
   assert.equal(staged.approval_pending,true);
   assert.equal(await readRole(),'production_operator');
   await expect(admin,'PATCH',path,body,409);
   await expect(admin,'POST','/security/access-requests/'+staged.id+'/decision',{decision:'APPROVED',password:manager.password},403);
   await expect(gm,'POST','/security/access-requests/'+staged.id+'/decision',{decision:'APPROVED',password:'wrong secret'},403);
   const inbox=await expect(gm,'GET','/security/access-requests');
   assert.equal(inbox.items.find(r=>r.id===staged.id).after_data.scopes[0].warehouse_id,fixture.warehouse);
   assert(!JSON.stringify(inbox).includes('fingerprint'));
   const cobaltInbox=await api(gm,'GET','/security/access-requests',null,'CO_HYDROXIDE');
   assert.equal(cobaltInbox.statusCode,200,cobaltInbox.body);
   assert.deepEqual(cobaltInbox.json(),inbox);
   const results=await Promise.all(['CU_CATHODE','CO_HYDROXIDE'].map(product=>api(gm,'POST','/security/access-requests/'+staged.id+'/decision',
    {decision:'APPROVED',password:manager.password},product)));
   assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
   assert.equal(await readRole(),'logistics_field_operator');
   await expect(operator,'GET','/me',null,401);
   const audit=(await c.query("SELECT action,actor_id,request_id FROM audit_logs WHERE (action='access_change_decided' AND entity_id=$1) OR (action='user_updated' AND entity_id=$2)",[staged.id,operatorAccount.id])).rows;
   assert.equal(audit.length,2);
   assert.equal(audit[0].request_id,audit[1].request_id);
   assert.deepEqual(new Set(audit.map(r=>r.actor_id)),new Set([admin.user.id,gm.user.id]));
  });
  await t.test('role rights, account creation, rejection, withdrawal and stale proposals',async()=>{
   const role=await expect(admin,'POST','/security/roles',{name:'Synthetic Approved Role',permissions:['inventory:read']});
   const matrix=await expect(admin,'PUT','/security/roles/'+role.code,{version:role.version,permissions:['inventory:read','inventory:export']});
   assert.equal((await c.query("SELECT 1 FROM role_permissions WHERE role_code=$1 AND permission_code='inventory:export'",[role.code])).rowCount,0);
   assert.equal((await review(matrix.id)).state,'APPROVED');
   const password=randomBytes(20).toString('hex'),name='audit_new_governed';
   const body={username:name,display_name:'Synthetic gated account',role_code:role.code,scopes:[{project_id:fixture.project}],password};
   const staged=await expect(admin,'POST','/users',body);
   assert(!(await users()).items.some(u=>u.username===name));
   assert.equal((await review(staged.id,'REJECTED',{note:'Synthetic rejected request'})).state,'REJECTED');
   const next=await expect(admin,'POST','/users',body);
   assert.equal((await expect(admin,'POST','/security/access-requests/'+next.id+'/decision',{decision:'WITHDRAWN'})).state,'WITHDRAWN');
   const stale=await expect(admin,'POST','/users',body);
   await c.query('UPDATE roles SET version=version+1 WHERE code=$1',[role.code]);
   assert.equal((await review(stale.id)).state,'STALE');
   const fresh=await expect(admin,'POST','/users',body);
   assert.equal((await review(fresh.id)).state,'APPROVED');
   assert((await users()).items.some(u=>u.username===name));
   assert.equal((await c.query('SELECT count(*)::int n FROM access_change_requests WHERE pending_password_hash IS NOT NULL')).rows[0].n,0);
  });
  await t.test('audit filters, redaction, export fingerprint and request logging without client allowlists',async()=>{
   const marker='synthetic-audit-request',hidden='SYNTHETIC-REMOVED';
   const {rows:[row]}=await c.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data,request_id) VALUES($1::uuid,'user_updated','users',$1::uuid::text,$2,$3) RETURNING id",
    [admin.user.id,{passport_no:hidden,nested:{csrfToken:hidden},display_name:'Visible name'},marker]);
   const list=await expect(admin,'GET','/v27/audit?request_id='+marker+'&category=ACCESS');
   assert.equal(list.total,1);
   const detail=await expect(admin,'GET','/v27/audit/'+row.id);
   assert(!JSON.stringify(detail).includes(hidden));
   const evidence=await api(admin,'POST','/v27/audit/export',{request_id:marker});
   assert.equal(evidence.statusCode,200,evidence.body);
   assert.equal(evidence.json().records.length,1);
   assert.equal(evidence.headers['x-content-sha256'],createHash('sha256').update(evidence.rawPayload).digest('hex'));
   assert(!evidence.body.includes(hidden));
   const remoteAddress='192.0.2.13';
   const health=await app.inject({url:'/api/v1/health?private='+hidden,remoteAddress,
    headers:{'x-forwarded-for':'198.51.100.13'}});
   const anonymous=await app.inject({url:'/api/v1/me?private='+hidden,remoteAddress});
   assert.equal(health.statusCode,200);
   assert.equal(anonymous.statusCode,401);
   for(const [response,route] of [[health,'/api/v1/health'],[anonymous,'/api/v1/me']]){
    const requestId=response.headers['x-wms-request-id'];
    assert(requestId);
    assert(reports.some(record=>record.request_id===requestId&&record.status===response.statusCode&&
     record.route===route&&record.source_ip===remoteAddress));
   }
   assert(!JSON.stringify(reports).includes(hidden));
  });
  if(process.env.CHROME_EXECUTABLE){
   await t.test('real browser opens the General Manager inbox and approves the submitted account change',async()=>{
    const {chromium}=require('playwright');
    const staged=await expect(admin,'PATCH','/users/'+operatorAccount.id,{role_code:'production_operator'});
    assert.equal(staged.approval_pending,true);
    await app.listen({port:cfg.port,host:'127.0.0.1'});
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
    try{
     const page=await browser.newPage({viewport:{width:390,height:844}});
     await page.goto(cfg.origin);
     await page.locator('#login-username').fill(manager.username);
     await page.locator('#login-password').fill(manager.password);
     await page.locator('#login-form button[type="submit"]').click();
     await page.waitForURL('**/workbench/access-approvals');
     await page.locator('#access-approval-filter').waitFor();
     const form=page.locator('form[data-request-id="'+staged.id+'"]');
     await form.locator('xpath=ancestor::details').locator('summary').click();
     await form.locator('[name="password"]').fill(manager.password);
     await form.locator('[value="APPROVED"]').click();
     await form.waitFor({state:'detached'});
     assert.equal(await readRole(),'production_operator');
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }finally{await browser.close();}
   });
  }
 }finally{
  await app?.close();
  await appClient?.end();
  await c.end();
 }
});
