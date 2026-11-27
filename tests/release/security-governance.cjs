'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto'),{Client}=require('pg');
const E=require('./environment.cjs'),{migrate}=require('../../scripts/production-db.cjs');
const Chain=require('../../scripts/migration-chain.cjs');
const {configure}=require('../../scripts/general-manager.cjs');

test('access approval retirement preserves evidence and secured account administration',async t=>{
 const db=await E.database(),c=db.client;
 let app,appClient;
 try{
  const chain=Chain.load(),target=chain.findIndex(entry=>entry.version.startsWith('219_'));
  assert(target>0);
  await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const entry of chain.slice(0,target))await Chain.execute(c,entry);
  await c.query("INSERT INTO system_info(singleton,environment) VALUES(true,'test')");
  const fixture=await E.seed(c,db.name),reports=[];
  const adminAccount=fixture.accounts.find(a=>a.role==='admin'),operatorAccount=fixture.accounts.find(a=>a.role==='production_operator');
  const manager={username:'audit_general_manager',displayName:'Synthetic General Manager',password:randomBytes(24).toString('hex')};
  assert.equal((await configure(c,manager,{environment:'test'})).status,'DRY_RUN_ROLLED_BACK');
  assert.equal((await c.query('SELECT 1 FROM users WHERE username=$1',[manager.username])).rowCount,0);
  await assert.rejects(()=>configure(c,manager,{environment:'test',apply:true}),{code:'MIGRATION_VERIFIED_BACKUP_REQUIRED'});
  assert.equal((await configure(c,manager,{environment:'test',apply:true,backupVerified:true})).status,'PROVISIONED');
  await assert.rejects(()=>configure(c,{...manager,username:'other_gm'},{environment:'test'}),{code:'GENERAL_MANAGER_ACTIVE_ACCOUNT_CONFLICT'});
  const managerId=(await c.query('SELECT id FROM users WHERE username=$1',[manager.username])).rows[0].id;
  const queue=async(kind,key,after,passwordHash=null)=>(await c.query(`INSERT INTO access_change_requests
   (kind,target_key,target_label,requested_by,requester_role,after_data,payload,pending_password_hash,fingerprint)
   VALUES($1,$2,'Synthetic historical request',$3,'admin',$4,$4,$5,$6) RETURNING id`,
   [kind,key,adminAccount.id,after,passwordHash,'0'.repeat(64)])).rows[0];
  const queued=await queue('USER_UPDATE',operatorAccount.id,{role_code:'admin'},require('../../server/security.cjs').hashPassword('Synthetic queue fixture only'));
  const decided=await queue('USER_UPDATE',adminAccount.id,{display_name:'Historical decision'});
  const past=(await c.query("UPDATE access_change_requests SET state='APPROVED',reviewed_by=$2,reviewed_at=now(),decision_note='Historical decision' WHERE id=$1 RETURNING *",[decided.id,managerId])).rows[0];
  assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true,appPassword:process.env.WMS_TEST_APP_PASSWORD})).added,chain.length-target);
  const cfg={...fixture.appCfg,port:4492,origin:'http://127.0.0.1:4492'};
  app=await require('../../server/app.cjs').build({config:cfg,requestAuditReporter:record=>reports.push(record)});
  const login=async(account,remoteAddress)=>{
   const response=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress,
    headers:{origin:cfg.origin},payload:{username:account.username,password:account.password}});
   assert.equal(response.statusCode,200,response.body);
   return {user:response.json().user,origin:cfg.origin,cookie:response.cookies.map(x=>x.name+'='+x.value).join('; '),
    'x-csrf-token':response.json().csrfToken};
  };
  const admin=await login(adminAccount,'192.0.2.11'),gm=await login(manager,'198.51.100.12'),operator=await login(operatorAccount,'203.0.113.13');
  const api=(session,method,url,payload,product='CU_CATHODE')=>app.inject({method,url:'/api/v1'+url,headers:{
   origin:session.origin,cookie:session.cookie,'x-csrf-token':session['x-csrf-token'],'x-product-code':product
  },...(payload?{payload}:{})});
  const expect=async(session,method,url,body,status=200)=>{
   const response=await api(session,method,url,body);
   assert.equal(response.statusCode,status,response.body);
   return response.json();
  };
  const readRole=async()=> (await c.query('SELECT role_code FROM users WHERE id=$1',[operatorAccount.id])).rows[0].role_code;

  await t.test('pending access requests are archived without applying them and prior decisions remain unchanged',async()=>{
   const saved=(await c.query('SELECT state,reviewed_by,reviewed_at,pending_password_hash,decision_note FROM access_change_requests WHERE id=$1',[queued.id])).rows[0];
   assert.equal(saved.state,'RETIRED');
   assert.equal(saved.reviewed_by,null);
   assert(saved.reviewed_at);
   assert.equal(saved.pending_password_hash,null);
   assert.match(saved.decision_note,/未执行/);
   assert.equal(await readRole(),'production_operator');
   assert.deepEqual((await c.query('SELECT * FROM access_change_requests WHERE id=$1',[past.id])).rows[0],past);
   const retirement=(await c.query("SELECT * FROM audit_logs WHERE action='access_change_retired' AND entity_id=$1",[queued.id])).rows[0];
   assert.equal(retirement.after_data.state,'RETIRED');
   assert.equal(retirement.after_data.requested_by,adminAccount.id);
   assert((await expect(admin,'GET','/v27/audit?entity='+queued.id+'&category=ACCESS')).items.length);
   assert.doesNotMatch(JSON.stringify(retirement),/pending_password_hash|password_hash/);
   await assert.rejects(()=>c.query('DELETE FROM access_change_requests WHERE id=$1',[queued.id]),{code:'55000'});
  });
  await t.test('obsolete approval routes are gone and the retained General Manager account gains no authority',async()=>{
   assert.equal(gm.user.role_code,'general_manager');
   assert.deepEqual(gm.user.permissions,[]);
   await expect(gm,'GET','/me');
   await expect(gm,'GET','/inventory',null,403);
   await expect(gm,'GET','/users',null,403);
   await expect(admin,'GET','/security/access-requests',null,404);
   await expect(gm,'POST','/security/access-requests/'+queued.id+'/decision',{decision:'APPROVED'},404);
   await expect(admin,'PATCH','/users/'+gm.user.id,{active:false},403);
   await expect(admin,'POST','/users/'+gm.user.id+'/reset-password',{password:manager.password},403);
   appClient=new Client({connectionString:cfg.databaseUrl});await appClient.connect();
   await assert.rejects(()=>appClient.query("UPDATE users SET active=false WHERE id=$1",[gm.user.id]),{code:'42501'});
   await assert.rejects(()=>appClient.query("UPDATE access_change_requests SET decision_note='synthetic edit' WHERE id=$1",[queued.id]),{code:'42501'});
  });
  await t.test('authorized user and role updates take effect immediately with matching audit and session revocation',async()=>{
   const path='/users/'+operatorAccount.id;
   const change={role_code:'logistics_field_operator',scopes:[{project_id:fixture.project,warehouse_id:fixture.warehouse}]};
   await expect(operator,'PATCH',path,change,403);
   await expect(gm,'PATCH',path,change,403);
   assert.deepEqual(await expect(admin,'PATCH',path,change),{ok:true});
   assert.equal(await readRole(),'logistics_field_operator');
   await expect(operator,'GET','/me',null,401);
   const audit=(await c.query("SELECT action,actor_id,request_id FROM audit_logs WHERE action='user_updated' AND entity_id=$1",[operatorAccount.id])).rows;
   assert.equal(audit.length,1);
   assert.equal(audit[0].actor_id,admin.user.id);
   assert(audit[0].request_id);
   const role=await expect(admin,'POST','/security/roles',{name:'Synthetic Managed Role',permissions:['inventory:read']});
   const matrix=await expect(admin,'PUT','/security/roles/'+role.code,{version:role.version,permissions:['inventory:read','inventory:export']});
   assert.equal(matrix.version,role.version+1);
   assert(matrix.permissions.includes('inventory:export'));
   await expect(admin,'PUT','/security/roles/'+role.code,{version:role.version,permissions:['inventory:read']},409);
   const account=await expect(admin,'POST','/users',{username:'audit_new_managed',display_name:'Synthetic Managed Account',
    role_code:role.code,scopes:[{project_id:fixture.project}],password:randomBytes(20).toString('hex')});
   assert.equal(account.role_code,role.code);
   assert.equal((await c.query("SELECT count(*)::int n FROM access_change_requests WHERE state='PENDING'")).rows[0].n,0);
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
   await t.test('browser persists French through sign-in, refresh and language changes',async()=>{
    const {chromium}=require('playwright');
    await app.listen({port:cfg.port,host:'127.0.0.1'});
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
    try{
     const page=await browser.newPage({viewport:{width:390,height:844}});
     const consoleErrors=[];
     page.on('pageerror',error=>consoleErrors.push(error.message));
     await page.goto(cfg.origin);
     await page.locator('[data-login-language="fr"]').click();
     assert.deepEqual(await page.locator('[data-login-language]').allTextContents(),['中文','English','Français']);
     assert.equal(await page.locator('#login-form button[type="submit"]').innerText(),'Se connecter');
     await page.locator('#login-username').fill(adminAccount.username);
     await page.locator('#login-password').fill(adminAccount.password);
     await page.locator('#login-form button[type="submit"]').click();
     const selector=page.locator('.top-actions select[data-language]');
     await selector.waitFor();
     assert.equal(await selector.inputValue(),'fr');
     assert.deepEqual(await selector.locator('option').allTextContents(),['中文','English','Français']);
     assert.equal((await c.query('SELECT language_code FROM users WHERE id=$1',[adminAccount.id])).rows[0].language_code,'fr');
     await page.reload();
     await selector.waitFor();
     assert.equal(await selector.inputValue(),'fr');
     await selector.selectOption('en');
     await page.waitForFunction(()=>document.documentElement.lang==='en');
     await selector.selectOption('fr');
     await page.waitForFunction(()=>document.documentElement.lang==='fr');
     await page.goto(cfg.origin+'/workbench');
     await selector.waitFor();
     assert.equal(await page.locator('a[href="/workbench/access-approvals"]').count(),0);
     await page.goto(cfg.origin+'/workbench/access-approvals');
     assert.equal(await page.locator('#access-approval-filter').count(),0);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     assert.deepEqual(consoleErrors,[]);
    }finally{await browser.close();}
   });
  }
 }finally{
  await app?.close();
  await appClient?.end();
  await c.end();
 }
});
