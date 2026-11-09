'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs'),Chain=require('../../scripts/migration-chain.cjs'),{migrate}=require('../../scripts/production-db.cjs'),{initialize}=require('../../scripts/production-bootstrap.cjs');
test('isolated migration, initialization, business permission and concurrency acceptance',async t=>{
 const open=[];let app,failed=false;const check=async(name,fn)=>t.test(name,async()=>{try{await fn();}catch(e){failed=true;throw e;}});const connect=async()=>{const d=await E.database();open.push(d.client);return d;},chain=Chain.load(),appPassword=process.env.WMS_TEST_APP_PASSWORD;
 try{
 const production=await connect();
 await check('empty schema dry-run rolls back every table; release apply, repeat and backup precondition',async()=>{
  let r=await migrate(production.client,{environment:'production',appPassword});assert.equal(r.added,179);assert.equal((await production.client.query("SELECT to_regclass('public.schema_migrations') value")).rows[0].value,null);
  r=await migrate(production.client,{environment:'production',apply:true,appPassword});assert.equal(r.added,179);await assert.rejects(()=>migrate(production.client,{environment:'production',apply:true}),{code:'MIGRATION_VERIFIED_BACKUP_REQUIRED'});assert.equal((await migrate(production.client,{environment:'production',apply:true,backupVerified:true})).added,0);
 });
 await check('bootstrap requires reviewed map, verified backup; dry-run/apply/retry preserve identities',async()=>{
  const c=production.client,sourceHash=crypto.createHash('sha256').update('SYNTHETIC TEST GEOMETRY ONLY').digest('hex'),plan={admin:{username:'audit_bootstrap',displayName:'Synthetic bootstrap admin',language:'zh-CN'},project:{code:'AUDIT',name:'Synthetic audit project'},warehouse:{code:'AUDIT',name:'Synthetic audit warehouse'},formalCells:['P1-01'],mapSourceSha256:sourceHash},password=crypto.randomBytes(24).toString('base64url');
  await assert.rejects(()=>initialize(c,plan,password,{apply:true}),{code:'BOOTSTRAP_VERIFIED_BACKUP_REQUIRED'});await assert.rejects(()=>initialize(c,plan,password),{code:'BOOTSTRAP_MAP_SOURCE_MISMATCH'});
  await c.query("UPDATE stock_map_source SET status='VERIFIED',source_sha256=$1,source_name='SYNTHETIC TEST FIXTURE',notes='Synthetic geometry for initialization testing only'",[sourceHash]);await c.query("UPDATE stock_map_cells SET x=0,y=0,width=100,height=100 WHERE code IN('P1-01','P5')");
  assert.equal((await initialize(c,plan,password)).status,'DRY_RUN_ROLLED_BACK');assert.equal((await c.query('SELECT count(*)::int n FROM users')).rows[0].n,0);const r=await initialize(c,plan,password,{apply:true,backupVerified:true});assert.equal(r.status,'INITIALIZED');assert.equal((await initialize(c,plan,password,{apply:true})).status,'ALREADY_INITIALIZED');assert.equal((await c.query('SELECT count(*)::int n FROM users')).rows[0].n,1);await assert.rejects(()=>initialize(c,{...plan,project:{...plan.project,name:'changed'}},password),{code:'BOOTSTRAP_ALREADY_INITIALIZED'});
  const first=chain[0];await c.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',['0'.repeat(64),first.version]);await assert.rejects(()=>initialize(c,plan,password),{code:'MIGRATION_CHECKSUM_CHANGED'});await c.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',[first.checksum,first.version]);const last=chain.at(-1);await c.query('DELETE FROM schema_migrations WHERE version=$1',[last.version]);await assert.rejects(()=>initialize(c,plan,password),{code:'MIGRATION_DATABASE_INCOMPLETE'});await c.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[last.version,last.checksum]);
 });
 const old=await connect();
 await check('138-entry old schema upgrades incrementally; database holes and checksum changes are rejected',async()=>{
  const c=old.client;await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');for(const e of chain.slice(0,138))await Chain.execute(c,e);await c.query("INSERT INTO system_info VALUES(true,'test')");assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true} )).added,chain.length-138);const first=chain[0];await c.query('DELETE FROM schema_migrations WHERE version=$1',[first.version]);await assert.rejects(()=>migrate(c,{environment:'test'}),{code:'MIGRATION_DATABASE_HISTORY_GAP'});await c.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[first.version,first.checksum]);await c.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',['0'.repeat(64),first.version]);await assert.rejects(()=>migrate(c,{environment:'test'}),{code:'MIGRATION_CHECKSUM_CHANGED'});await c.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',[first.checksum,first.version]);
 });
 await check('preproduction CLI dry-run and confirmed apply use the same verified migration chain',async()=>{
  const {execFileSync}=require('node:child_process'),url=E.options(old.name).connectionString,env={...process.env,APP_ENV:'test',DEPLOYMENT_TIER:'preproduction',DATABASE_OWNER_URL:url,DB_ALLOWED_HOSTS:'127.0.0.1',DB_EXPECTED_NAME:old.name,TEST_BACKUP_VERIFIED:'yes'};const run=args=>JSON.parse(execFileSync(process.execPath,['scripts/preproduction-db.cjs',...args],{cwd:E.root,env,windowsHide:true,encoding:'utf8'}));assert.equal(run([]).status,'DRY_RUN_ROLLED_BACK');assert.equal(run(['--apply','--confirm-database',old.name]).added,0);
 });
 const upgradeEvidence=[];
 for(const from of [172,173,174,175,176,177,178]){
  await check(`direct ${from} → 179 preserves every existing synthetic business table and refuses wrong environment`,async()=>{
   const {client:c,name}=await connect();
   await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
   for(const entry of chain.slice(0,from))await Chain.execute(c,entry);
   await c.query("INSERT INTO system_info VALUES(true,'test')");
   const fixture=await E.seed(c,name);
   await c.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,outcome) VALUES($1,'synthetic_upgrade','customers',$2,'COMMITTED')",[fixture.accounts[0].id,fixture.customers.CU_CATHODE.id]);
   const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
   const snapshot=async()=>{
    const result={};
    for(const table of tables){
     const qualified='public."'+table.replaceAll('"','""')+'"';
     const projected=table==='co_preparations'?"(to_jsonb(t)-'planned_location_id')":table==='audit_logs'&&from===172?"(to_jsonb(t)-'scope_context')":['users','registration_requests'].includes(table)?"(to_jsonb(t)-'contact_phone'-'contact_email')":"to_jsonb(t)";
     const rows=(await c.query(`SELECT value FROM (SELECT ${projected}::text AS value FROM ${qualified} t ${table==='role_permission_caps'?"WHERE NOT(role_code='sales_manager' AND permission_code='plan:write')":''}) snapshot ORDER BY value COLLATE "C"`)).rows;
     result[table]={rows:rows.length,digest:crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>r.value))).digest('hex')};
    }
    return result;
   };
   const catalog=async()=>{
    const {rows}=await c.query(`
     SELECT 'constraint' AS kind, conrelid::regclass::text AS relation, conname AS name, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid<>0 AND conname<>'co_sales_plans_destination_check'
     UNION ALL
     SELECT 'trigger', tgrelid::regclass::text, tgname, pg_get_triggerdef(oid)
     FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
     ORDER BY 1,2,3`);
    return rows;
   };
   const before=await snapshot(),beforeCatalog=await catalog();
   await assert.rejects(()=>migrate(c,{environment:'production',apply:true,backupVerified:true}),{code:'MIGRATION_TEST_CONVERSION_FORBIDDEN'});
   assert.equal((await c.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,from);
   assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,179-from);
   assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,0);
   const {rows:applied}=await c.query('SELECT version,checksum FROM schema_migrations');
   const checksums=new Map(applied.map(({version,checksum})=>[version,checksum]));
   assert.equal(checksums.size,chain.length);
   for(const {version,checksum} of chain)assert.equal(checksums.get(version),checksum,version);
   await Chain.guard172(c,'after');
   assert.deepEqual(await snapshot(),before);
   assert.equal((await c.query("SELECT count(*)::int n FROM role_permission_caps WHERE role_code='sales_manager' AND permission_code='plan:write'")).rows[0].n,1);
   for(const table of ['users','registration_requests'])assert.equal((await c.query('SELECT count(*)::int n FROM '+table+' WHERE contact_phone IS NOT NULL OR contact_email IS NOT NULL')).rows[0].n,0);
   const afterCatalog=await catalog(),priorKeys=new Set(beforeCatalog.map(({kind,relation,name})=>[kind,relation,name].join('/')));
   assert.deepEqual(afterCatalog.filter(({kind,relation,name})=>priorKeys.has([kind,relation,name].join('/'))),beforeCatalog);
   assert(afterCatalog.some(t=>t.relation==='audit_logs'&&t.name==='aa_security_r3_audit_scope'));
   const rights=(await c.query("SELECT has_table_privilege('musonoi_app','security_schema_status','SELECT') can_read, has_function_privilege('musonoi_app','security_r3_entity_scopes(text,text)','EXECUTE') can_forge")).rows[0];
   assert.deepEqual(rights,{can_read:true,can_forge:false});
   upgradeEvidence.push({from,to:179,tablesChecked:tables.length,existingConstraintsAndTriggersChecked:beforeCatalog.length,unchangedSyntheticRows:Object.values(before).reduce((n,t)=>n+t.rows,0),accounts:before.users.rows,wrongEnvironmentRefused:true});
  });
 }
 const guard=await connect();
 await check('172 refuses a drifted prerequisite function, rolls back, then applies once with exact snapshots',async()=>{
  const c=guard.client;await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');for(const e of chain.slice(0,chain.findIndex(e=>e.version.startsWith('172_'))))await Chain.execute(c,e);await c.query("INSERT INTO system_info VALUES(true,'test')");const prior=require('./fixtures/172-functions.json').before.find(f=>f.name==='ux10_plan_submission');await c.query(prior.definition.replace('BEGIN','BEGIN\n-- synthetic drift'));
  await assert.rejects(()=>migrate(c,{environment:'test',apply:true,backupVerified:true}),{code:'MIGRATION_172_FUNCTION_BASELINE_MISMATCH'});assert.equal((await c.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,171);await c.query(prior.definition);assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true}  )).added,chain.length-171);await Chain.guard172(c,'after');
 });
 const business=await connect();
 await check('concurrent migrations serialize: exactly one applies, the other is an idempotent retry',async()=>{
  const second=new Client(E.options(business.name));open.push(second);await second.connect();const results=await Promise.all([migrate(business.client,{environment:'test',apply:true,backupVerified:true}),migrate(second,{environment:'test',apply:true,backupVerified:true})]);assert.deepEqual(results.map(r=>r.added).sort((a,b)=>a-b),[0,179]);
 });
 const f=await E.seed(business.client,business.name);app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};
 const login=async role=>{const a=f.accounts.find(a=>a.role===role),r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.20.0.'+(f.accounts.indexOf(a)+1),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200,'login '+role);return sessions[role]={id:a.id,origin:f.appCfg.origin,cookie:r.cookies.map(c=>c.name+'='+c.value).join('; '),'x-csrf-token':r.json().csrfToken};};for(const a of f.accounts)await login(a.role);
 const request=(role,product,url,body,method,key=crypto.randomUUID())=>app.inject({method:method||(body?'POST':'GET'),url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':product,'idempotency-key':key},...(body?{payload:body}:{})});
 const api=async(role,product,url,body,expected=200,method)=>{const r=await request(role,product,url,body,method);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,300));return r.json();};
 await check('retired layout APIs return 404 and prior layout records are retained',async()=>{
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   await api('admin',product,'/page-layout',undefined,404);
   await api('admin',product,'/page-layout',{scope:'global',version:0,settings:{}},404,'PATCH');
  }
 });
 await check('both products: configurable admin review, revocation, two independent sales and closure stages',async()=>{
  const role=async()=>(await api('admin','CU_CATHODE','/security/roles')).items.find(r=>r.code==='admin'),original=await role();
  assert.equal(Object.keys((await api('admin','CU_CATHODE','/security/roles')).catalog.workflow).length,67);const set=async permissions=>{const r=await role();await api('admin','CU_CATHODE','/security/roles/admin',{version:r.version,permissions},200,'PUT');await login('admin');};
  await api('admin','CU_CATHODE','/security/roles/admin',{version:original.version,permissions:original.permissions.filter(p=>p!=='roles:manage')},400,'PUT');
  const today=(await business.client.query("SELECT (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date::text d")).rows[0].d;
  for(const co of [false,true]){const product=co?'CO_HYDROXIDE':'CU_CATHODE',customer=f.customers[product],base=(co?'/cobalt':'')+'/sales-workflow',save=co?'/cobalt/sales/plans':'/plans',body={project_id:f.project,customer_id:customer.id,contract_id:customer.contract,target_weight:'100',remark:'Synthetic audit plan',...(co?{warehouse_id:f.warehouse,shipment_month:today.slice(0,7),planned_vehicle_count:1,destination:'Synthetic audit destination',status:'OPEN'}:{quantity_tolerance:'5',preparation_month:today.slice(0,7)})};
   const p=await api('sales_operator',product,save,body),url=base+'/plans/'+p.id;let d=await api('sales_operator',product,url);await login('customer_admin');await api('customer_admin',product,url,undefined,co?404:200);await set(original.permissions.filter(p=>p!=='plan:approve'));await api('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},403);await set(original.permissions);const reviewKey=crypto.randomUUID(),reviews=await Promise.all([request('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},undefined,reviewKey),request('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},undefined,reviewKey)]);assert.equal(reviews[0].statusCode,200,reviews[0].body);assert.deepEqual(reviews[0].json(),reviews[1].json());d=await api('sales_operator',product,url);await api('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},409);await api('commerce_manager',product,url+'/review',{version:d.approval_version,decision:'APPROVED'});d=await api('sales_operator',product,url);assert.equal(d.approval_state,'APPROVED');
   await api('sales_operator',product,url+'/close',{version:d.version,reason:'Synthetic unused plan closure'});d=await api('sales_operator',product,url);await api('admin',product,url+'/close-review',{request_id:d.close_request_id,version:d.close_version,decision:'APPROVED'});d=await api('sales_operator',product,url);await api('admin',product,url+'/close-review',{request_id:d.close_request_id,version:d.close_version,decision:'APPROVED'},409);await api('commerce_manager',product,url+'/close-review',{request_id:d.close_request_id,version:d.close_version,decision:'APPROVED'});assert.equal((await api('sales_operator',product,url)).status,'CLOSED');
  }await set(original.permissions);
 });
 await check('native cobalt intake: exact weights/seals, no self-review, final receipt and bounded stock history',async()=>{
  const co='CO_HYDROXIDE',key=crypto.randomUUID(),body={project_id:f.project,warehouse_id:f.warehouse,total_bags:3,planned_location_id:f.location},responses=await Promise.all([request('logistics_field_operator',co,'/cobalt/preparations',body,undefined,key),request('logistics_field_operator',co,'/cobalt/preparations',body,undefined,key)]);assert.equal(responses[0].statusCode,200,responses[0].body);assert.deepEqual(responses[0].json(),responses[1].json());const p=responses[0].json(),url='/cobalt/preparations/'+p.id;f.preparation=p.id;
  assert.equal((await api('admin',co,url)).planned_location_id,f.location);
  await api('logistics_field_operator',co,url+'/submit',{version:p.version});let work=await api('logistics_field_operator',co,url+'/work');
  const duplicates=work.bags.slice(0,2).map(b=>({bag_id:b.bag_id,version:b.version,actual_gross_kg:'650',seal_no:'DUPLICATE-'+p.id,sampled:true}));
  const proposals=duplicates.map(({bag_id,seal_no})=>({bag_id,seal_no}));
  const check=await api('logistics_field_operator',co,url+'/work/seal-check',{bags:proposals});
  assert.deepEqual(new Set(check.conflicts.map(r=>r.conflicting_bag_no)),new Set(work.bags.slice(0,2).map(b=>b.bag_no)));
  const failedSave=await api('logistics_field_operator',co,url+'/work/save',{batch_version:work.work.version,bags:duplicates},409);
  assert.equal(failedSave.details.conflicts.length,2);
  assert.equal((await api('logistics_field_operator',co,url+'/work')).work.version,work.work.version);
  await api('logistics_field_operator',co,url+'/work/save',{batch_version:work.work.version,bags:work.bags.map((b,i)=>({bag_id:b.bag_id,version:b.version,actual_gross_kg:i?'651.25':'650',seal_no:'AUDIT-'+p.id+'-'+i,sampled:true}))});work=await api('logistics_field_operator',co,url+'/work');const layout=await api('admin',co,'/cobalt/stock/layout'),loc=layout.locations.find(l=>l.id===f.location),place={preparation_id:p.id,batch_version:work.work.version,selection:'ALL',target_location_id:loc.id,target_version:loc.version,source:'PREPARATION'},pv=await api('site_supervisor',co,'/cobalt/stock/place-preview',place);await api('site_supervisor',co,'/cobalt/stock/place',{...place,preview_hash:pv.preview_hash});await api('logistics_field_operator',co,url+'/work/submit',{batch_version:work.work.version});
  work=await api('site_supervisor',co,url+'/work');await api('logistics_field_operator',co,url+'/work/approve',{batch_version:work.work.version},403);await api('site_supervisor',co,url+'/work/approve',{batch_version:work.work.version});let d=await api('production_manager',co,url);assert.equal(d.inventory.physical_bags,0);await api('production_manager',co,url+'/production-approve',{version:d.version});d=await api('admin',co,url);assert.equal(d.inventory.physical_bags,3);
  const stock=await api('admin',co,'/cobalt/stock/batches/'+p.id+'?page_size=20');assert.equal(stock.items.length,3);assert.equal(stock.items[0].seal_no.startsWith('AUDIT-'),true);assert.equal(stock.items[0].actual_gross_kg,'650');await api('admin',co,'/cobalt/stock?page_size=6',undefined,400);await api('admin',co,'/cobalt/stock/history?page=0',undefined,400);const history=await api('admin',co,'/cobalt/stock/history?preparation_id='+p.id);assert(history.items.some(e=>e.bag_no&&e.actor_role_name_snapshot));await api('production_operator',co,'/cobalt/stock/place-preview',{...place,reason:'Unauthorized'},403);
  const withoutScope=(await business.client.query("INSERT INTO projects(code,name) VALUES('OUTSIDE','Synthetic unscoped project') RETURNING id")).rows[0].id,wh=(await business.client.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'OUTSIDE','Synthetic unscoped warehouse') RETURNING id",[withoutScope])).rows[0].id;await api('admin',co,'/cobalt/preparations',{project_id:withoutScope,warehouse_id:wh,total_bags:1},403);
 });
 await check('historical intake estimates wet weight until a bag is measured without counting either bag twice',async()=>{
  const co='CO_HYDROXIDE',operator='logistics_field_operator';
  let p;
  await business.client.query('ALTER TABLE co_preparations ALTER COLUMN intake_flow_version SET DEFAULT 1');
  try{
   p=await api(operator,co,'/cobalt/preparations',{project_id:f.project,warehouse_id:f.warehouse,total_bags:2});
  }finally{await business.client.query('ALTER TABLE co_preparations ALTER COLUMN intake_flow_version SET DEFAULT 2');}
  f.estimatedPreparation=p.id;
  const path='/cobalt/preparations/'+p.id,filtered='/cobalt/metal?preparation_id='+p.id;
  assert.equal((await api('admin',co,filtered)).total,0);
  const pending=await api(operator,co,path+'/submit',{version:p.version});
  const site=await api('site_supervisor',co,path+'/site-approve',{version:pending.version});
  await api('production_manager',co,path+'/production-approve',{version:site.version});
  const read=async()=>(await api('admin',co,filtered)).items[0];
  const estimated=await read();
  assert.equal(estimated.bags,2);assert.equal(estimated.estimated_bags,2);
  assert.equal(estimated.net_mt,'1.2940');assert.equal(estimated.estimated_mt,'0.46584');
  const w=await api(operator,co,path+'/work'),bag=w.bags[0];
  await api(operator,co,path+'/work/save',{batch_version:w.work.version,bags:[{bag_id:bag.bag_id,version:bag.version,actual_gross_kg:'660.125'}]});
  const checked=await api(operator,co,path+'/work/seal-check',{bags:[{bag_id:bag.bag_id,seal_no:('AUDIT-'+f.preparation+'-0').toLowerCase()}]});
  const existing=(await business.client.query('SELECT bag_no FROM co_bags WHERE preparation_id=$1 ORDER BY daily_number LIMIT 1',[f.preparation])).rows[0].bag_no;
  assert.deepEqual(checked.conflicts,[{bag_id:bag.bag_id,conflicting_bag_no:existing}]);f.sealConflict={bag:existing,seal:'AUDIT-'+f.preparation+'-0'};
  const batch=(await api('admin',co,'/cobalt/stock?preparation_id='+f.preparation)).items[0];
  assert(batch.received_at);assert.equal(batch.sampled_bags,3);assert.equal(batch.effective_net_mt,'1.9435');
  const mixed=await read();
  assert.equal(mixed.bags,2);assert.equal(mixed.estimated_bags,1);
  assert.equal(mixed.net_mt,'1.3041');assert.equal(mixed.estimated_mt,'0.46949');
 });
 if(failed)throw Error('Acceptance subtests failed; no successful fixture published');
 E.save('fixture.json',f);E.save('database-results.json',{status:'PASS',database:business.name,migrations:179,upgradeEvidence,productionDatabaseWrites:0,workingDatabaseWrites:0,fastify:require('fastify/package.json').version});
 }finally{await app?.close();for(const c of open)await c.end();}
});
