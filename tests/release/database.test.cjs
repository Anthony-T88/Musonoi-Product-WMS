'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs'),Chain=require('../../scripts/migration-chain.cjs'),{migrate}=require('../../scripts/production-db.cjs'),{initialize}=require('../../scripts/production-bootstrap.cjs');
test('isolated migration, initialization, business permission and concurrency acceptance',async t=>{
 const open=[];let app,failed=false;const check=async(name,fn)=>t.test(name,async()=>{try{await fn();}catch(e){failed=true;throw e;}});const connect=async()=>{const d=await E.database();open.push(d.client);return d;},chain=Chain.load(),appPassword=process.env.WMS_TEST_APP_PASSWORD;
 try{
 const production=await connect();
 await check('empty schema dry-run rolls back every table; release apply, repeat and backup precondition',async()=>{
  let r=await migrate(production.client,{environment:'production',appPassword});assert.equal(r.added,chain.length);assert.equal((await production.client.query("SELECT to_regclass('public.schema_migrations') value")).rows[0].value,null);
  r=await migrate(production.client,{environment:'production',apply:true,appPassword});assert.equal(r.added,chain.length);await assert.rejects(()=>migrate(production.client,{environment:'production',apply:true}),{code:'MIGRATION_VERIFIED_BACKUP_REQUIRED'});assert.equal((await migrate(production.client,{environment:'production',apply:true,backupVerified:true})).added,0);
 });
 await check('new document serials start at 01 and continue beyond 99 without truncating',async()=>{
  const c=production.client;
  const {rows}=await c.query('SELECT short_document_serial(n) code FROM unnest(ARRAY[1,2,9,10,99,100]::bigint[]) n');
  assert.deepEqual(rows.map(r=>r.code),['01','02','09','10','99','100']);
  const {rows:[loading]}=await c.query("SELECT next_loading_document_code('CU_CATHODE') cu, next_loading_document_code('CO_HYDROXIDE') co");
  assert.match(loading.cu,/^LOAD-\d{8}-01$/);assert.equal(loading.co,loading.cu);
  const {rows:[plan]}=await c.query("SELECT 'SP-'||short_document_serial(nextval('sales_plan_numbers')) code");
  assert.equal(plan.code,'SP-01');
 });
 await check('suffix migration keeps old claim evidence and quarantines conflicting aliases',async()=>{
  const c=production.client,owner=crypto.randomUUID(),other=crypto.randomUUID();
  const claims=[
   ['MUS-2026-370-28',owner],
   ['MUS-2026-370-28A',owner],['MUS-2026-370-028A',owner],
   ['MUS-2026-370-28B',owner],['MUS-2026-370-028B',other]
  ];
  await c.query('BEGIN');
  try{
   for(const [label,account] of claims)await c.query('INSERT INTO bundle_number_registry VALUES($1,$2,false,$3)',[label,account,JSON.stringify([{bundle_no:label}])]);
   const suffix=chain.find(entry=>entry.version==='213_v490_bundle_number_suffix.sql');
   assert(suffix);
   await c.query(suffix.sql);
   const {rows}=await c.query("SELECT * FROM bundle_number_registry WHERE number_key LIKE 'MUS-2026-370-%' ORDER BY number_key");
   assert.deepEqual(rows.map(row=>[row.number_key,row.owner_id,row.conflicted,row.sources.map(source=>source.bundle_no).sort()]),[
    ['MUS-2026-370-28',owner,false,['MUS-2026-370-28']],
    ['MUS-2026-370-28A',owner,false,['MUS-2026-370-028A','MUS-2026-370-28A']],
    ['MUS-2026-370-28B',null,true,['MUS-2026-370-028B','MUS-2026-370-28B']]
   ]);
   assert.equal((await c.query("SELECT v265_bundle_key('  mus-2026-37-001a  ') key")).rows[0].key,'MUS-2026-037-1A');
  }finally{await c.query('ROLLBACK');}
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
 await check('arrival upgrade backfills blank trailer 2 fields in confirmed copper and cobalt arrivals once',async()=>{
  const {client:c,name}=await connect();
  await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const beforeRepair=chain.findIndex(entry=>entry.version.startsWith('211_'));
  for(const entry of chain.slice(0,beforeRepair))await Chain.execute(c,entry);
  await c.query("INSERT INTO system_info VALUES(true,'test')");
  const fixture=await E.seed(c,name),actor=fixture.accounts[0].id,month='2088-10';
  const cases=[
   {phase:'CONFIRMED',trailer:'',repair:true},
   {phase:'CONFIRMED',trailer:' \t\u00a0\u3000',repair:true},
   {phase:'CONFIRMED',trailer:'TRAILER-04'},
   {phase:'CONFIRMED',trailer:'N/A'},
   {phase:'DRAFT',trailer:''},
   {phase:'CLEARED',trailer:''},
   {phase:'CONFIRMED',trailer:'',legacy:true}
  ];
  const rows=[];
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   const co=product==='CO_HYDROXIDE',customer=fixture.customers[product],table=co?'co_vehicle_arrivals':'vehicle_arrivals';
   const plan=(await (co?
    c.query("INSERT INTO co_sales_plans(project_id,warehouse_id,customer_id,contract_id,shipment_month,target_weight,planned_vehicle_count,destination,created_by,updated_by) VALUES($1,$2,$3,$4,$5,1,1,'Depot',$6,$6) RETURNING id",
     [fixture.project,fixture.warehouse,customer.id,customer.contract,month,actor]):
    c.query('INSERT INTO sales_plans(project_id,customer_id,contract_id,preparation_month,target_weight,quantity_tolerance,planned_lot_count,created_by) VALUES($1,$2,$3,$4,1,0,1,$5) RETURNING id',
     [fixture.project,customer.id,customer.contract,month,actor]))).rows[0].id;
   for(const role of ['sales_manager','commerce_manager']){
    const reviewer=fixture.accounts.find(account=>account.role===role).id;
    await c.query("SELECT ux10_review_sales_plan($1,$2,$3,(SELECT version FROM sales_plan_approvals WHERE plan_id=$2),'APPROVED','')",
     [product,plan,reviewer]);
   }
   const batch=co?null:(await c.query("INSERT INTO sales_dispatch_imports(sales_plan_id,shipment_month,file_name,file_sha256,row_count,created_by) VALUES($1,$2,'synthetic.xlsx',$3,$4,$5) RETURNING id",
    [plan,month,'a'.repeat(64),cases.length,actor])).rows[0].id;
   for(const [index,{phase,trailer,repair,legacy}] of cases.entries()){
    const dispatch=(await (co?
     c.query('INSERT INTO co_dispatch_vehicles(sales_plan_id,shipment_month,truck_no,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING id',
      [plan,month,'CO-211-'+index,actor]):
     c.query("INSERT INTO sales_dispatch_vehicles(import_id,source_sheet,source_row,truck_no,trailer_no) VALUES($1,'Dispatch',$2,$3,'') RETURNING id",
      [batch,index+2,'CU-211-'+index]))).rows[0].id;
    const row=(await (co?
     c.query("INSERT INTO co_vehicle_arrivals(sales_plan_id,dispatch_vehicle_id,registration_phase,trailer_one,trailer_two,driver_name,passport_no,transporter,arrived_at,registered_by,updated_by) VALUES($1,$2,$3,'TR-01',$4,'Test Driver','TEST','Test Carrier',now(),$5,$5) RETURNING *",
      [plan,dispatch,phase,trailer,actor]):
     c.query("INSERT INTO vehicle_arrivals(sales_plan_id,dispatch_vehicle_id,registration_phase,trailer_one,trailer_two,driver_name,passport_no,shipment_month,registered_by) VALUES($1,$2,$3,'TR-01',$4,'Test Driver','TEST',$5,$6) RETURNING *",
      [plan,dispatch,phase,trailer,month,actor]))).rows[0];
    if(legacy)await c.query("INSERT INTO document_drafts(id,actor_id,product_code,form_key,route,fields,updated_at) VALUES($1,$2,$3,$4,$5,'[]',$6::timestamptz+interval '1 second')",
     [crypto.randomUUID(),actor,product,co?'co-arrival-form':'yard-arrival-form','/arrivals?vehicle_id='+dispatch,row.updated_at]);
    rows.push({table,row,repair});
   }
  }
  await c.query("DELETE FROM role_permissions WHERE role_code='admin' AND permission_code='vehicle-arrival:write'");
  const verify=async repairApplied=>{
   for(const {table,row,repair} of rows){
    const actual=(await c.query('SELECT * FROM '+table+' WHERE id=$1',[row.id])).rows[0];
    assert.deepEqual(actual,repairApplied&&repair?{...row,trailer_two:'N/A',version:row.version+1}:row);
   }
  };
  assert.equal((await migrate(c,{environment:'test'})).added,chain.length-beforeRepair);
  await verify(false);
  assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,chain.length-beforeRepair);
  await verify(true);
  assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,0);
  await verify(true);
  const audits=(await c.query("SELECT entity_type,entity_id,actor_id,before_data,after_data FROM audit_logs WHERE action='arrival_trailer_two_backfilled'")).rows;
  assert.equal(audits.length,rows.filter(item=>item.repair).length);
  for(const {table,row} of rows.filter(item=>item.repair)){
   const audit=audits.find(item=>item.entity_id===row.id);
   assert.equal(audit.entity_type,table);
   assert.equal(audit.actor_id,null);
   assert.equal(audit.before_data.trailer_two,row.trailer_two);
   assert.equal(audit.after_data.trailer_two,'N/A');
  }
  const co=rows.find(item=>item.table==='co_vehicle_arrivals').row;
  await assert.rejects(()=>c.query("UPDATE co_vehicle_arrivals SET trailer_two='ALTERED',version=version+1 WHERE id=$1",[co.id]),/CO_SALES_SCOPE_PERMISSION/);
 });
 const upgradeEvidence=[];
 for(const from of [172,173,174,175,176,177,178,179,180,181,182,184,185,186,190,193,194,195,198,199,200,201,203,204,205,207,209]){
  await check(`direct ${from} → ${chain.length} preserves every existing synthetic business table and refuses wrong environment`,async()=>{
   const {client:c,name}=await connect();
   await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
   for(const entry of chain.slice(0,from))await Chain.execute(c,entry);
   await c.query("INSERT INTO system_info VALUES(true,'test')");
   const fixture=await E.seed(c,name);
   await c.query("UPDATE users SET language_code='en' WHERE id=$1",[fixture.accounts[0].id]);
   // The legacy all-permissions synthetic admin must match a migrated V4.8.7 role.
   if(from>=199)await c.query("DELETE FROM role_permissions WHERE role_code='admin' AND permission_code IN('printer:manage','inventory:correct-request','inventory:correct-review')");
   if(from>=200)await c.query("DELETE FROM role_permissions WHERE role_code='admin' AND permission_code IN('lot:reverse-request','lot:reverse-review')");
   if(from===209)await c.query("DELETE FROM role_permissions WHERE role_code='admin' AND permission_code='outbound:logistics-review'");
   const metalEntryRoles=(await c.query(`SELECT role_code FROM role_permissions WHERE permission_code='outbound:logistics-review'
    UNION SELECT 'logistics_office_operator' ORDER BY 1`)).rows.map(row=>row.role_code);
   const insertPlan=()=>c.query("INSERT INTO sales_plans(project_id,customer_id,target_weight,created_by,contract_id,quantity_tolerance,preparation_month,planned_lot_count) VALUES($1,$2,1,$3,$4,0,to_char(current_date,'YYYY-MM'),1) RETURNING id,code",
    [fixture.project,fixture.customers.CU_CATHODE.id,fixture.accounts[0].id,fixture.customers.CU_CATHODE.contract]);
   if(from===179)assert.equal((await insertPlan()).rows[0].code,'SP-00000001');
   if(from===190){
    await insertPlan();
    await c.query("UPDATE customer_contracts SET active=false,deleted_at=now(),deleted_by=$2,deletion_reason='Synthetic archived contract',version=version+1 WHERE id=$1",[fixture.customers.CU_CATHODE.contract,fixture.accounts[0].id]);
    await assert.rejects(()=>c.query(`INSERT INTO customer_contracts(project_id,customer_id,contract_no,effective_date,end_date,created_by)
      SELECT project_id,customer_id,contract_no,effective_date,end_date,created_by FROM customer_contracts WHERE id=$1`,[fixture.customers.CU_CATHODE.contract]),{code:'23505',constraint:'customer_contracts_contract_no_key'});
   }
   if(from>=182)await c.query(`INSERT INTO export_licenses(product_code,project_id,customer_id,cu_contract_id,applied_on,proforma_no,quantity,unit_basis,unit,currency,issuing_bank,created_by)
    VALUES('CU_CATHODE',$1,$2,$3,current_date,'SYNTHETIC-LEGACY-BOOK',1,'PHYSICAL_MT','MT','USD','Synthetic legacy bank',$4)`,
    [fixture.project,fixture.customers.CU_CATHODE.id,fixture.customers.CU_CATHODE.contract,fixture.accounts[0].id]);
   if(from>=185)await c.query("INSERT INTO export_license_record_books(product_code,project_id,customer_id,kind,value,created_by) VALUES('CU_CATHODE',$1,$2,'issuing_bank','Synthetic legacy bank',$3)",
    [fixture.project,fixture.customers.CU_CATHODE.id,fixture.accounts[0].id]);
   let archivedCobalt;
   if(from===207){
    const source=crypto.randomUUID(),actor=fixture.accounts[0].id;
    await c.query(`INSERT INTO historical_movement_documents(id,product_code,movement_type,document_no,document_key,business_date,
     date_evidence,source_name,source_sha256,source_data,source_facts,imported_by)
     VALUES($1,'CO_HYDROXIDE','OUTBOUND','LEGACY-CO-PL','LEGACY-CO-PL','2020-03-05','Synthetic source date',
      'synthetic.xlsx',$2,$3,'{"batch_no":"LEGACY-CO-LOT"}',$4)`,[source,'a'.repeat(64),Buffer.from('synthetic'),actor]);
    await c.query(`INSERT INTO historical_movement_lines(document_id,source_row,unit_id,unit_key,net_kg,gross_kg)
     VALUES($1,1,'LEGACY-CO-BAG','LEGACY-CO-BAG',30000,30075)`,[source]);
    await c.query(`INSERT INTO historical_backfills(source_id,import_batch_id,project_id,warehouse_id,customer_id,backfilled_by)
     VALUES($1,$2,$3,$4,$5,$6)`,[source,crypto.randomUUID(),fixture.project,fixture.warehouse,fixture.customers.CO_HYDROXIDE.id,actor]);
    await c.query(`INSERT INTO historical_stock_units(source_id,source_row,product_code,unit_key) VALUES($1,1,'CO_HYDROXIDE','LEGACY-CO-BAG')`,[source]);
    archivedCobalt=(await c.query(`INSERT INTO historical_business_documents(source_id,kind,document_no,business_date)
     VALUES($1,'OUTBOUND','HIST-OUT-LEGACY-CO-PL','2020-03-05') RETURNING id`,[source])).rows[0].id;
   }
   await c.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,outcome) VALUES($1,'synthetic_upgrade','customers',$2,'COMMITTED')",[fixture.accounts[0].id,fixture.customers.CU_CATHODE.id]);
   const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
   const snapshot=async()=>{
    const result={};
    for(const table of tables){
     const qualified='public."'+table.replaceAll('"','""')+'"';
     const projected=['vehicle_arrivals','co_vehicle_arrivals'].includes(table)?"(to_jsonb(t)-'registration_phase')":table==='stocktakes'?"(to_jsonb(t)-'period_month')":table==='co_stocktakes'?"(to_jsonb(t)-'task_type'-'period_month')":table==='sales_dispatch_vehicles'?"(to_jsonb(t)-'transporter'-'destination'-'transport_version')":table==='co_dispatch_vehicles'?"(to_jsonb(t)-'destination')":table==='co_loading_plans'?"(to_jsonb(t)-'transporter'-'cancelled_at'-'cancelled_by'-'cancel_reason')":table==='historical_sales_dispatch_links'?"(to_jsonb(t)-'automatic')":table==='co_preparations'?"(to_jsonb(t)-'planned_location_id')":table==='preparation_plans'?"(to_jsonb(t)-'reversal_id')":table==='preparation_plan_events'?"(to_jsonb(t)-'allocation_id'-'co_preparation_id')":table==='audit_logs'&&from===172?"(to_jsonb(t)-'scope_context')":['users','registration_requests'].includes(table)?"(to_jsonb(t)-'contact_phone'-'contact_email')":table==='sessions'?"(to_jsonb(t)-'replaced_at')":table==='stock_map_regions'?"(to_jsonb(t)-'slot_count')":table==='export_license_record_books'?"(to_jsonb(t)-'archived_at'-'version'-'account_name'-'swift_code')":table==='export_license_actions'?"(to_jsonb(t)-'processing_snapshot')":table==='export_licenses'?"(to_jsonb(t)-'issuing_bank_account'-'offshore_bank'-'offshore_bank_account'-'processing_records'-'issuing_bank_account_name'-'offshore_bank_account_name'-'standard_amount'-'issuing_bank_swift'-'offshore_bank_swift')":"to_jsonb(t)";
     const projection=table==='roles'?"(to_jsonb(t)||jsonb_build_object('version',t.version-(EXISTS(SELECT 1 FROM role_permissions p WHERE p.role_code=t.code AND p.permission_code='co:metal-submit'))::int))":projected;
     const metalPermissionFilter={
      permissions:"WHERE value::jsonb->>'code' NOT IN('co:metal-read','co:metal-submit')",
      role_permissions:"WHERE value::jsonb->>'permission_code' NOT IN('co:metal-read','co:metal-submit')",
      role_permission_caps:"WHERE value::jsonb->>'permission_code' NOT IN('co:metal-read','co:metal-submit')",
      audit_logs:"WHERE value::jsonb#>>'{after_data,migration}' IS DISTINCT FROM '220_v490_cobalt_metal_permissions'"
     }[table]||'';
     const rows=(await c.query(`SELECT value FROM (SELECT ${projection}::text AS value FROM ${qualified} t ${table==='role_permission_caps'?"WHERE permission_code<>'access-change:approve' AND NOT(role_code='sales_manager' AND permission_code='plan:write') AND permission_code NOT LIKE 'export-license:%' AND permission_code NOT IN('printer:manage','inventory:correct-request','inventory:correct-review','lot:reverse-request','lot:reverse-review','customs:bp','customs:bp-template') AND NOT(role_code IN('sales_operator','sales_manager') AND permission_code IN('dispatch:read','dispatch:month'))":table==='roles'?"WHERE code<>'general_manager'":table==='role_permissions'?"WHERE permission_code<>'access-change:approve' AND permission_code NOT LIKE 'export-license:%' AND permission_code NOT IN('printer:manage','inventory:correct-request','inventory:correct-review','lot:reverse-request','lot:reverse-review','customs:bp','customs:bp-template') AND NOT(role_code IN('sales_operator','sales_manager','admin') AND permission_code IN('dispatch:read','dispatch:month'))":table==='permissions'?"WHERE code<>'access-change:approve' AND code NOT LIKE 'export-license:%' AND code<>'dispatch:month' AND code NOT IN('inventory:correct-request','inventory:correct-review','lot:reverse-request','lot:reverse-review','customs:bp','customs:bp-template')":table==='stock_map_cells'?"WHERE code<>'P3'":''}) snapshot ${metalPermissionFilter} ORDER BY value COLLATE "C"`)).rows;
     result[table]={rows:rows.length,digest:crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>r.value))).digest('hex')};
    }
    return result;
   };
   const catalog=async()=>{
    const {rows}=await c.query(`
     SELECT 'constraint' AS kind, conrelid::regclass::text AS relation, conname AS name, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid<>0 AND NOT (conrelid=to_regclass('export_license_record_books') AND confrelid=conrelid AND cardinality(conkey)=5) AND NOT (conrelid=to_regclass('co_dispatch_vehicles') AND confrelid=to_regclass('co_dispatch_imports') AND cardinality(conkey)=3) AND conname NOT IN('sales_dispatch_vehicles_transporter_check','sales_dispatch_vehicles_destination_check','sales_dispatch_vehicles_transport_version_check','co_dispatch_vehicles_destination_check','co_loading_plans_transporter_check','co_sales_plans_destination_check','locations_map_usage_check','customer_contracts_contract_no_key','sales_plan_approvals_check1','sales_plan_approvals_check3','sales_plan_close_requests_check1','sales_plan_close_requests_check2','export_license_actions_check1','co_preparations_check1','co_preparations_check2','stock_adjustments_check','co_vehicle_arrivals_trailer_one_check','co_vehicle_arrivals_driver_name_check','co_vehicle_arrivals_passport_no_check','co_vehicle_arrivals_transporter_check','allocations_lot_no_key','co_preparations_preparation_batch_no_key','preparation_plans_product_code_batch_no_key','preparation_plans_state_check','preparation_plans_check1','preparation_plan_events_action_check','preparation_plans_work_state_check','co_work_batches_status_check','co_inventory_status_check','export_license_record_books_swift_check','export_licenses_issuing_bank_swift_check','export_licenses_offshore_bank_swift_check')
     UNION ALL
     SELECT 'trigger', tgrelid::regclass::text, tgname, pg_get_triggerdef(oid)
     FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
     ORDER BY 1,2,3`);
    return rows.filter(row=>!row.name.startsWith('v490_manager_'));
   };
   const before=await snapshot(),beforeCatalog=(await catalog()).filter(row=>row.name!=='co_dispatch_vehicle_import_plan_fk');
   await assert.rejects(()=>migrate(c,{environment:'production',apply:true,backupVerified:true}),{code:'MIGRATION_TEST_CONVERSION_FORBIDDEN'});
   assert.equal((await c.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,from);
   assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,chain.length-from);
   assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,0);
   const {rows:applied}=await c.query('SELECT version,checksum FROM schema_migrations');
   const checksums=new Map(applied.map(({version,checksum})=>[version,checksum]));
   assert.equal(checksums.size,chain.length);
   for(const {version,checksum} of chain)assert.equal(checksums.get(version),checksum,version);
   await Chain.guard172(c,'after');
   assert.deepEqual(await snapshot(),before);
   const metalGrants=(await c.query(`SELECT role_code,array_agg(permission_code ORDER BY permission_code) AS permissions
    FROM role_permissions WHERE permission_code IN('co:metal-read','co:metal-submit') GROUP BY role_code ORDER BY role_code`)).rows;
   assert.deepEqual(metalGrants,metalEntryRoles.map(role_code=>({role_code,permissions:['co:metal-read','co:metal-submit']})));
   if(archivedCobalt)assert.deepEqual((await c.query(`SELECT net_kg::text,round(estimated_metal_mt,5)::text estimated_mt,version,
     confirmed_metal_mt,shipment_status FROM co_historical_metal_outbound WHERE order_id=$1`,[archivedCobalt])).rows[0],
    {net_kg:'30000',estimated_mt:'10.80000',version:0,confirmed_metal_mt:null,shipment_status:'PENDING_ARECOMS'});
   const correctionPermissions=(await c.query(
    "SELECT role_code,permission_code FROM role_permissions WHERE permission_code IN('inventory:correct-request','inventory:correct-review','printer:manage') ORDER BY role_code"
   )).rows.map(row=>[row.role_code,row.permission_code]);
   const reversalGrants=(await c.query("SELECT role_code,permission_code FROM role_permissions WHERE permission_code IN('lot:reverse-request','lot:reverse-review') ORDER BY role_code")).rows;
   assert.deepEqual(reversalGrants,[{role_code:'logistics_manager',permission_code:'lot:reverse-review'},{role_code:'site_supervisor',permission_code:'lot:reverse-request'}]);
   assert.deepEqual((await c.query("SELECT role_code FROM role_permissions WHERE permission_code='customs:bp' ORDER BY role_code")).rows.map(row=>row.role_code),['admin','logistics_office_operator']);
   assert.deepEqual(correctionPermissions,[['logistics_field_operator','inventory:correct-request'],['production_manager','inventory:correct-review'],['production_operator','inventory:correct-request']]);
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_indexes WHERE indexname IN('allocations_reserved_lot_no','co_preparations_reserved_batch_no','preparation_plans_reserved_batch_no') AND indexdef LIKE '% WHERE %'")).rows[0].n,3);
   if(from>=182){
    const result=await c.query("SELECT kind,value FROM export_license_record_books WHERE product_code='CU_CATHODE' AND customer_id=$1",[fixture.customers.CU_CATHODE.id]);
    assert.deepEqual(result.rows,[{kind:'issuing_bank',value:'Synthetic legacy bank'}]);
   }
   const p3=(await c.query("SELECT r.slot_count,count(c.*)::int cells FROM stock_map_regions r JOIN stock_map_cells c ON c.region_code=r.code WHERE r.code='P3' GROUP BY r.slot_count")).rows[0];
   assert.deepEqual(p3,{slot_count:1,cells:35});
   if(from===179)assert.equal((await insertPlan()).rows[0].code,'SP-02');
   assert.equal((await c.query("SELECT count(*)::int n FROM role_permission_caps WHERE role_code='sales_manager' AND permission_code='plan:write'")).rows[0].n,1);
   for(const table of ['users','registration_requests'])assert.equal((await c.query('SELECT count(*)::int n FROM '+table+' WHERE contact_phone IS NOT NULL OR contact_email IS NOT NULL')).rows[0].n,0);
   const afterCatalog=await catalog(),priorKeys=new Set(beforeCatalog.map(({kind,relation,name})=>[kind,relation,name].join('/')));
   const normalizeType=row=>{
    let definition=row.definition;
    if(row.name==='co_loading_plans_status_check')definition=definition.replace(", 'CANCELLED'::text",'');
    if(row.name==='users_language_code_check')definition=definition.replace(", 'fr'::text",'');
    if(row.name==='co_loading_plans_check')
     definition=definition.replace("status = ANY (ARRAY['DRAFT'::text, 'CANCELLED'::text])","status = 'DRAFT'::text");
    if(from<187&&row.name==='stocktakes_task_type_check')definition=definition.replace("'SEMIANNUAL'::text, ",'');
    if(from<193&&['allocations','preparation_plans'].includes(row.relation)&&definition.includes('^RMM-CU-'))
     definition=definition.replace('[1-9][0-9]{1,35}','[1-9][0-9]');
    return {...row,definition};
   };
   assert.deepEqual(afterCatalog.filter(({kind,relation,name})=>priorKeys.has([kind,relation,name].join('/'))).map(normalizeType),beforeCatalog);
   assert(afterCatalog.some(row=>row.relation==='co_dispatch_vehicles'&&row.definition.includes('FOREIGN KEY (import_id) REFERENCES co_dispatch_imports(id)')));
   assert(!afterCatalog.some(row=>row.name==='co_dispatch_vehicle_import_plan_fk'));
   assert(afterCatalog.some(row=>row.name==='stocktakes_task_type_check'&&row.definition.includes("'SEMIANNUAL'")));
   assert(afterCatalog.some(row=>row.name==='co_loading_plans_status_check'&&row.definition.includes("'CANCELLED'")));
   assert(afterCatalog.some(row=>row.name==='co_loading_plans_check'&&row.definition.includes("'DRAFT'::text, 'CANCELLED'::text])")&&row.definition.includes('current_load_id IS NULL')));
   assert(afterCatalog.some(row=>row.name==='co_loading_cancel_details'&&row.definition.includes('cancel_reason IS NOT NULL')));
   assert(afterCatalog.some(row=>row.name==='users_language_code_check'&&row.definition.includes("'fr'::text")));
   assert.equal((await c.query('SELECT count(*)::int n FROM co_loading_plans WHERE cancelled_at IS NOT NULL OR cancelled_by IS NOT NULL OR cancel_reason IS NOT NULL')).rows[0].n,0);
   assert(afterCatalog.some(t=>t.relation==='audit_logs'&&t.name==='aa_security_r3_audit_scope'));
   const rights=(await c.query("SELECT has_table_privilege('musonoi_app','security_schema_status','SELECT') can_read, has_function_privilege('musonoi_app','security_r3_entity_scopes(text,text)','EXECUTE') can_forge")).rows[0];
   assert.deepEqual(rights,{can_read:true,can_forge:false});
   upgradeEvidence.push({from,to:chain.length,tablesChecked:tables.length,existingConstraintsAndTriggersChecked:beforeCatalog.length,unchangedSyntheticRows:Object.values(before).reduce((n,t)=>n+t.rows,0),accounts:before.users.rows,wrongEnvironmentRefused:true});
  });
 }
 const guard=await connect();
 await check('172 refuses a drifted prerequisite function, rolls back, then applies once with exact snapshots',async()=>{
  const c=guard.client;await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');for(const e of chain.slice(0,chain.findIndex(e=>e.version.startsWith('172_'))))await Chain.execute(c,e);await c.query("INSERT INTO system_info VALUES(true,'test')");const prior=require('./fixtures/172-functions.json').before.find(f=>f.name==='ux10_plan_submission');await c.query(prior.definition.replace('BEGIN','BEGIN\n-- synthetic drift'));
  await assert.rejects(()=>migrate(c,{environment:'test',apply:true,backupVerified:true}),{code:'MIGRATION_172_FUNCTION_BASELINE_MISMATCH'});assert.equal((await c.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,171);await c.query(prior.definition);assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true}  )).added,chain.length-171);await Chain.guard172(c,'after');
 });
 const business=await connect();
 await check('concurrent migrations serialize: exactly one applies, the other is an idempotent retry',async()=>{
  const second=new Client(E.options(business.name));open.push(second);await second.connect();const results=await Promise.all([migrate(business.client,{environment:'test',apply:true,backupVerified:true}),migrate(second,{environment:'test',apply:true,backupVerified:true})]);assert.deepEqual(results.map(r=>r.added).sort((a,b)=>a-b),[0,chain.length]);
 });
 const f=await E.seed(business.client,business.name);app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};
 const login=async role=>{const a=f.accounts.find(a=>a.role===role),r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.20.0.'+(f.accounts.indexOf(a)+1),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200,'login '+role);return sessions[role]={id:a.id,origin:f.appCfg.origin,cookie:r.cookies.map(c=>c.name+'='+c.value).join('; '),'x-csrf-token':r.json().csrfToken};};for(const a of f.accounts)await login(a.role);
 const request=(role,product,url,body,method,key=crypto.randomUUID())=>app.inject({method:method||(body?'POST':'GET'),url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':product,'idempotency-key':key},...(body?{payload:body}:{})});
 const api=async(role,product,url,body,expected=200,method)=>{const r=await request(role,product,url,body,method);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,300));return r.json();};
 await check('known copper warehouses gain formal slots while shared locations and existing IDs are preserved',async()=>{
  const db=await connect(),c=db.client;
  await c.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const beforeSlots=chain.findIndex(e=>e.version.startsWith('193_'));
  for(const entry of chain.slice(0,beforeSlots))await Chain.execute(c,entry);
  await c.query("INSERT INTO system_info VALUES(true,'test')");
  const {rows:[{id:project}]}=await c.query("INSERT INTO projects(code,name) VALUES('WMS-TEST','Fixture') RETURNING id");
  const {rows:[{id:warehouse}]}=await c.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'MUS','Fixture') RETURNING id",[project]);
  const {rows:areas}=await c.query("INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_usage) VALUES($1,$2,'SHARED-PRODUCTION','P5','TEMPORARY'),($1,$2,'SHARED-LEFTOVERS','P3','LEFTOVER') RETURNING id",[project,warehouse]);
  const {rows:[local]}=await c.query("INSERT INTO projects(code,name) VALUES('AUDIT','Fixture') RETURNING id");
  const {rows:[localWarehouse]}=await c.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'MUSONOI','Fixture') RETURNING id",[local.id]);
  const {rows:[oldWarehouse]}=await c.query("INSERT INTO warehouses(project_id,code,name,active) VALUES($1,'AUDIT-WH','Fixture',false) RETURNING id",[local.id]);
  const {rows:[oldSlot]}=await c.query("INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_usage) VALUES($1,$2,'P1-01','P1-01','FORMAL') RETURNING id",[local.id,oldWarehouse.id]);
  assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,chain.length-beforeSlots);
  assert.equal((await migrate(c,{environment:'test',apply:true,backupVerified:true})).added,0);
  const {rows}=await c.query("SELECT cell.region_code,count(*)::int n FROM locations l JOIN stock_map_cells cell ON cell.code=l.map_cell_code WHERE l.warehouse_id=$1 AND l.map_usage='FORMAL' GROUP BY 1 ORDER BY 1",[warehouse]);
  assert.deepEqual(rows,[{region_code:'P1',n:46},{region_code:'P2',n:29},{region_code:'P4',n:22}]);
  assert.equal((await c.query("SELECT count(*)::int n FROM locations WHERE id=ANY($1::uuid[])",[areas.map(a=>a.id)])).rows[0].n,2);
  const {rows:[{n}]}=await c.query("SELECT count(*)::int n FROM locations WHERE warehouse_id=$1 AND map_usage='FORMAL'",[localWarehouse.id]);
  assert.equal(n,97);
  assert.equal((await c.query("SELECT warehouse_id FROM locations WHERE id=$1",[oldSlot.id])).rows[0].warehouse_id,oldWarehouse.id);
  assert.equal((await c.query("SELECT code FROM locations WHERE warehouse_id=$1 AND map_cell_code='P1-01'",[localWarehouse.id])).rows[0].code,'MUSONOI-P1-01');
 });
 await check('dispatch transfer across sales plans, transport backfill and arrival Excel for copper and cobalt',async()=>{
  const XLSX=require('xlsx'),Excel=require('exceljs');
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   const co=product==='CO_HYDROXIDE',{salesPlan}=require('./preparation-fixture.cjs');
   const plan=await salesPlan(api,f,product),target=await salesPlan(api,f,product,'2088-10'),sameMonth=await salesPlan(api,f,product);
   const basePath=(co?'/cobalt/sales':'')+'/plans/',operator=co?'sales_operator':'sales_manager';
   const path=basePath+plan+'/dispatch',targetPath=basePath+target+'/dispatch';
   const alias='TRANSFER-AUDIT-'+product,actor=f.accounts[0].id;
   const {rows:[other]}=await business.client.query('INSERT INTO customers(project_id,code,name,product_code) VALUES($1,$2,$2,$3) RETURNING id',
    [f.project,alias,product]);
   if(co)await business.client.query('INSERT INTO co_customer_profiles(id,project_id,code,name,created_by,updated_by) VALUES($1,$2,$3,$3,$4,$4)',
    [other.id,f.project,alias,actor]);
   const {rows:[contract]}=await business.client.query('INSERT INTO '+(co?'co_sales_contracts':'customer_contracts')+
    '(project_id,customer_id,contract_no,effective_date,end_date,created_by'+(co?',updated_by':'')+
    ') VALUES($1,$2,$3,current_date-1,current_date+365,$4'+(co?',$4':'')+') RETURNING id',
    [f.project,other.id,alias,actor]);
   const otherCustomer=await salesPlan(api,{...f,customers:{...f.customers,[product]:{id:other.id,contract:contract.id}}},product,'2088-10');
   const original=await api(operator,product,path);
   assert(original.dispatch_month.can_change);
   assert.deepEqual(original.dispatch_month.targets.map(r=>r.id),[target]);
   assert.deepEqual((await api('logistics_manager',product,path)).dispatch_month.targets,[]);
   (f.dispatchMonthPlans??={})[product]={id:plan,month:original.dispatch_month.month,target};
   const sales=(co?'/cobalt':'')+'/sales-workflow/plans';
   const salesFilters={plan_no:original.plan.code,contract_no:co?original.plan.contract_no:
    (await api(operator,product,sales+'/'+plan)).contract_no,customer_id:f.customers[product].id,
    shipment_month:original.dispatch_month.month,status:'OPEN'};
   const matching=await api(operator,product,sales+'?'+new URLSearchParams(salesFilters));
   assert(matching.items.some(row=>row.id===plan));
   assert(matching.customer_options.some(row=>row.id===salesFilters.customer_id));
   assert.equal((await api(operator,product,sales+'?'+new URLSearchParams({...salesFilters,contract_no:'NO-TEST-MATCH'}))).total,0);
   const workbook=XLSX.utils.book_new();
   const truck=co?'CO':'CU';
   XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['HORSE','TON','TRANSPORTER'],[truck+'1234',12.3456,'Saved Carrier'],[truck+'1235',23.4567]
   ]),'Dispatch');
   const file={file_name:'dispatch.xlsx',mapping:{sheet:'Dispatch',header_row:1,truck_column:1,capacity_column:2,capacity_kg:false},file_base64:XLSX.write(workbook,{type:'base64',bookType:'xlsx'}),...(co?{plan_version:original.plan.version}:{})};
   const preview=await api('admin',product,path+'/import-preview',file);
   await api('admin',product,path+(co?'/import':''),{...file,shipment_month:preview.shipment_month,preview_sha256:preview.file_sha256});
   const saved=await api(operator,product,path),plate=co?'CO1234':'CU1234',vehicle=saved.vehicles.find(v=>v.truck_no===plate);
   const monthPath=path+'/vehicles/'+vehicle.id+'/month',shift={shipment_month:'2088-10',
    previous_month:original.dispatch_month.month,target_plan_id:target};
   await api('production_operator',product,monthPath,shift,403);
   const {target_plan_id,...noTarget}=shift;
   await api(operator,product,monthPath,noTarget,400);
   await api(operator,product,monthPath,{...shift,target_plan_id:plan},409);
   await api(operator,product,monthPath,{...shift,target_plan_id:sameMonth,shipment_month:shift.previous_month},409);
   await api(operator,product,monthPath,{...shift,target_plan_id:otherCustomer},409);
   await api(operator,product,monthPath,{...shift,previous_month:'2088-11'},409);
   await api(operator,product,monthPath,{...shift,shipment_month:'2088-11'},409);
   const key=crypto.randomUUID(),changed=await request(operator,product,monthPath,shift,'POST',key);
   assert.equal(changed.statusCode,200,changed.body);
   assert.equal(changed.json().id,vehicle.id);assert.equal(changed.json().shipment_month,'2088-10');
   assert.equal(changed.json().sales_plan_id,target);
   const replay=await request(operator,product,monthPath,shift,'POST',key);
   assert.deepEqual(replay.json(),changed.json());assert.equal(replay.statusCode,200);
   const auditSql="SELECT before_data,after_data FROM audit_logs WHERE entity_id=$1 AND action='dispatch_vehicle_month_changed'";
   const audit=(await business.client.query(auditSql,[vehicle.id])).rows;
   assert.equal(audit.length,1);assert.equal(audit[0].before_data.shipment_month,shift.previous_month);
   assert.equal(audit[0].after_data.shipment_month,shift.shipment_month);
   assert.equal(audit[0].before_data.sales_plan_id,plan);
   assert.equal(audit[0].after_data.sales_plan_id,target);
   assert.equal(audit[0].after_data.import_id,vehicle.import_id);
   await api(operator,product,monthPath,shift,404);
   const after=await api(operator,product,path);
   const received=await api(operator,product,targetPath);
   assert.equal(after.dispatch_month.month,original.dispatch_month.month);
   assert.equal(after.vehicles.length,1);
   assert.equal(after.vehicles[0].shipment_month,original.dispatch_month.month);
   assert.equal((await api(operator,product,path+'?shipment_month=2088-10')).vehicles.length,0);
   assert.equal(received.vehicles.length,1);
   assert.equal(received.vehicles[0].id,vehicle.id);
   assert.equal(received.vehicles[0].shipment_month,'2088-10');
   assert.equal(received.vehicles[0].import_id,vehicle.import_id);
   assert.equal(received.vehicles[0].capacity_tonnes,vehicle.capacity_tonnes);
   assert.equal(received.imports[0].file_name,file.file_name);
   if(!co){
    assert.equal(after.summary.vehicle_count,1);
    assert.equal(received.summary.vehicle_count,1);
   }
   const later=await api('admin',product,path+'/import-preview',file);
   assert.equal(later.shipment_month,original.dispatch_month.month);
   await api('admin',product,path+(co?'/import':''),{...file,shipment_month:later.shipment_month,preview_sha256:later.file_sha256});
   const fresh=(await api(operator,product,path)).vehicles.find(v=>v.truck_no===plate&&v.id!==vehicle.id);
   await api(operator,product,path+'/vehicles/'+fresh.id+'/month',shift,409);
   const endpoint=(co?'/cobalt/sales':'/loading-plans')+'/arrivals',filters={sales_plan_id:target,shipment_month:'2088-10'};
   const listing=await api('admin',product,endpoint+'?'+new URLSearchParams(filters));assert.equal(listing.items.length,1);
   const book=new Excel.Workbook(),exported=await request('admin',product,endpoint+'/export',filters);
   assert.equal(exported.statusCode,200,exported.body.slice(0,250));assert.equal(Number(exported.headers['x-export-count']),1);
   await book.xlsx.load(exported.rawPayload);const sheet=book.worksheets[0];
   assert.equal(sheet.getCell('E7').value,co?'CO1234':'CU1234');assert.equal(sheet.getCell('F7').value,12.3456);
   assert.equal(sheet.getCell('F7').numFmt,'#,##0.0000');
   await api('production_operator',product,endpoint+'/export',filters,403);
   const arrival={trailer_one:co?'COTRLR42':'CUTRLR42',driver_name:co?'TEST Co Driver':'TEST Cu Driver',passport_no:co?'COFICT42':'CUFICT42',transporter:'TEST Carrier',
    arrived_at:new Date(Date.now()-120000).toISOString(),...(co?{dispatch_version:received.vehicles[0].version}:{})};
   await api('admin',product,endpoint+'/'+vehicle.id,arrival);
   await api(operator,product,targetPath+'/vehicles/'+vehicle.id+'/month',{
    previous_month:'2088-10',shipment_month:shift.previous_month,target_plan_id:sameMonth},409);
   const previewPath=targetPath+'/import-preview',savePath=targetPath+(co?'/import':''),routeBook=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(routeBook,XLSX.utils.aoa_to_sheet([
    ['Horse Reg. No.','TON','Transport Company Name','Placeoffloaded','STATUS'],
    [truck.toLowerCase()+'-12 34',99,'Other Carrier',''],
    [plate,99,'Other Carrier','Depot North'],
    [truck+'5555',88,'Other Carrier','Depot South'],
    [truck+'1235',23.4567,'','','Cancelled']
   ]),'Dispatch');
   const base=(workbook,shipment_month,version=original.plan.version)=>({file_name:'dispatch-route.xlsx',
    file_base64:XLSX.write(workbook,{type:'base64',bookType:'xlsx'}),shipment_month,
    ...(co?{plan_version:version}:{})});
   const transport={...base(routeBook,'2088-10',received.plan.version),transport_only:true};
   const importer='logistics_manager';
   const get=()=>api(operator,product,targetPath),getSource=()=>api(operator,product,path);
   const before=await get();
   const sourceBefore=await getSource();
   await api('production_operator',product,previewPath,transport,403);
   await api(importer,product,previewPath,{...transport,shipment_month:''},400);
   const routePreview=await api(importer,product,previewPath,transport);
   assert.deepEqual(routePreview.items.map(v=>v.action),['FILL_TRANSPORT','DUPLICATE','UNMATCHED']);
   assert.deepEqual(routePreview.items.slice(0,1).map(v=>[v.transporter,v.destination]),[['Saved Carrier','Depot North']]);
   assert.equal(routePreview.cancelled_count,1);
   assert.deepEqual((await get()).vehicles,before.vehicles);
   const save={...transport,mapping:routePreview.mapping,preview_sha256:routePreview.file_sha256};
   await api('production_operator',product,savePath,save,403);
   const result=await api(importer,product,savePath,save);
   assert.deepEqual([result.added_count,result.transport_filled_count,result.unmatched_count,result.cancelled_count],[0,1,1,0]);
   const completed=await get(),updated=completed.vehicles.find(v=>v.id===vehicle.id);
   assert.equal(updated.shipment_month,'2088-10');
   assert.equal(updated.capacity_tonnes,vehicle.capacity_tonnes);
   assert.equal(updated.import_id,vehicle.import_id);
   assert.deepEqual([updated.transporter,updated.destination],['Saved Carrier','Depot North']);
   assert.deepEqual((await getSource()).vehicles,sourceBefore.vehicles);
   assert.equal(completed.vehicles.length,before.vehicles.length);
   assert.equal(completed.imports.length,before.imports.length);
   assert.equal((await api(importer,product,savePath,save)).transport_filled_count,0);
   const {rows:[record]}=await business.client.query(
    "SELECT after_data FROM audit_logs WHERE entity_id=$1 AND action='dispatch_vehicle_transport_updated'",[vehicle.id]);
   assert.equal(record.after_data.source,'DISPATCH_FILE');
   assert.equal(record.after_data.file_sha256,routePreview.file_sha256);
   assert.deepEqual(record.after_data.source_rows,{destination:3});
   const conflicts=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(conflicts,XLSX.utils.aoa_to_sheet([
    ['HORSE','TRANSPORTER','DESTINATION'],[plate,'Other Carrier','Depot North'],
    [truck+'1235','New Carrier','Depot South'],[truck+'1235','New Carrier','Depot East']
   ]),'Dispatch');
   const normal=base(conflicts,original.dispatch_month.month),normalPreview=await api(importer,product,path+'/import-preview',normal);
   assert.equal(normalPreview.transport_filled_count,1);
   assert.equal(normalPreview.transport_conflict_count,1);
   assert.equal((await api(importer,product,path+(co?'/import':''),{...normal,preview_sha256:normalPreview.file_sha256})).transport_filled_count,1);
   const normalResult=await getSource();
   assert.equal(normalResult.vehicles.find(v=>v.id===fresh.id).destination,'Depot North');
   assert.deepEqual(normalResult.vehicles.find(v=>v.truck_no===truck+'1235'),sourceBefore.vehicles.find(v=>v.truck_no===truck+'1235'));
   const concurrentPath=path+'/vehicles/'+normalResult.vehicles.find(v=>v.truck_no===truck+'1235').id+'/month';
   const concurrent=await Promise.all([request(operator,product,concurrentPath,shift,'POST'),request(operator,product,concurrentPath,shift,'POST')]);
   assert.deepEqual(concurrent.map(result=>result.statusCode).sort(),[200,404]);
  }
 });
 await check('BP Excel downloads use the exact archived revision and document permissions',async()=>{
  const Excel=require('exceljs');
  const BPPrint=require('../../server/customs-bp-print.cjs');
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   const co=product==='CO_HYDROXIDE',number='EXCEL-AUDIT/2026/'+(co?'CO':'CU'),customer=f.customers[product].id;
   const order=crypto.randomUUID(),rows=[{order_id:order,batch:'AUDIT-BATCH',truck:'AUDIT1234',trailer_two:'N/A',transporter:'Example International Logistics',
    driver:'Audit Driver',passport:'001234',quantity:'15',net_mt:'31.4539',gross_mt:'32.7828',loading_date:'2026-11-23'}];
   const snapshot={number,header:{issuer:'Audit Company',address:'Audit Address',rccm:'AUDIT-RCCM',id_nat:'AUDIT-IDNAT',
    nif:'AUDIT-NIF',contact:'Audit Contact',customer:'Audit Customer',product:co?'COBALT HYDROXIDE':'COPPER CATHODES',
    mode:'ROAD',border:'Sakania',agency:'Audit Agency',license:'AUDIT-LICENSE',loading_point:'Audit Mine',
    loading_date:'2026-11-23',destination:'Audit Depot',signature_date:'2026-11-24'},rows,
    total:{quantity:'15',net_mt:'31.4539',gross_mt:'32.7828'},template_revision:1,template_title:'BULLETIN DE PESAGE / WEIGHTING SHEET'};
   const {rows:[doc]}=await business.client.query(`INSERT INTO customs_bp_documents(product_code,document_no,source_ids,source_context,snapshot,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[product,number,[order],
    JSON.stringify([{project_id:f.project,customer_id:customer,warehouse_id:f.warehouse}]),snapshot,f.accounts[0].id]);
   await business.client.query('INSERT INTO customs_bp_revisions(document_id,revision,snapshot,created_by) VALUES($1,2,$2,$3)',
    [doc.id,{...snapshot,header:{...snapshot.header,mode:'RAILWAY'}},f.accounts[0].id]);
   const path=(co?'/cobalt':'')+'/customs/bp/'+doc.id+'/excel';
   (f.bpExcelDocuments??={})[product]={id:doc.id,number};
   const checkRevision=async(suffix,rev,mode)=>{
    const response=await request('admin',product,path+suffix);
    assert.equal(response.statusCode,200,response.body.slice(0,220));
    assert.match(response.headers['content-type'],/spreadsheetml\.sheet/);
    assert.match(response.headers['content-disposition'],new RegExp('attachment; filename="BP_EXCEL-AUDIT-2026-'+(co?'CO':'CU')+'_r'+rev+'\\.xlsx"'));
    const book=new Excel.Workbook();await book.xlsx.load(response.rawPayload);
    assert.equal(book.worksheets.length,1);
    const sheet=book.worksheets[0];
    const cells=row=>{
     const result=[];
     sheet.getRow(row).eachCell(cell=>{if(cell.type!==Excel.ValueType.Merge)result.push(cell);});
     return result;
    };
    const headings=cells(15);
    assert.deepEqual(headings.map(cell=>cell.text),BPPrint.columns.map(([label])=>label));
    const vehicle=(row,label)=>sheet.getCell(row,headings.find(cell=>cell.text===label).col);
    assert.match(sheet.getCell('A1').text,/EXCEL-AUDIT/);
    assert.deepEqual(['A4','A5','A6','A7'].map(cell=>sheet.getCell(cell).text),
     ['RCCM: AUDIT-RCCM','ID-NAT: AUDIT-IDNAT','NIF: AUDIT-NIF','Contact: Audit Contact']);
    assert.deepEqual(cells(11).slice(0,2).map(cell=>cell.text),['Transport mode:',mode]);
    assert.equal(vehicle(16,'TRAILER 2').value,'N/A');
    const transporter=vehicle(16,'TRANSPORTER');
    assert.equal(transporter.value,'Example International Logistics');
    assert.equal(transporter.alignment.shrinkToFit,true);
    assert.notEqual(transporter.alignment.wrapText,true);
    assert.equal(transporter.alignment.horizontal,'center');
    assert.equal(transporter.font.name,'Times New Roman');
    assert.equal(vehicle(16,'PASSPORT NO.').value,'001234');
    assert.equal(vehicle(16,'PACKAGE N°').value,15);
    assert.equal(vehicle(16,'Net Weight (MT)').value,31.4539);
    assert.equal(vehicle(17,'Gross Weight (MT)').value,32.7828);
    assert.equal(vehicle(16,'Net Weight (MT)').numFmt,'#,##0.000');
    const loadingDate=cells(12).at(-1);
    assert.equal(loadingDate.value.toISOString(),'2026-11-23T00:00:00.000Z');
    assert.equal(loadingDate.numFmt,'[$-809]d mmmm yyyy');
    assert.deepEqual(cells(19).map(cell=>cell.text),['SIGNATURE','KOLWEZI, le 24 November 2026']);
    assert.deepEqual(cells(19).map(cell=>cell.alignment.horizontal),['left','right']);
    assert.equal(sheet.getImages().length,1);
    assert.equal(sheet.rowCount,19);
    assert.equal(sheet.pageSetup.paperSize,9);
    assert.equal(sheet.pageSetup.orientation,'landscape');
    assert.equal(sheet.pageSetup.horizontalCentered,true);
    assert.equal(sheet.pageSetup.fitToHeight,1);
   };
   await checkRevision('',2,'RAILWAY');
   await checkRevision('?revision=1',1,'ROAD');
   await api('admin',product,path+'?revision=99',undefined,404);
   await api('production_operator',product,path,undefined,403);
   if(co)await api('customer_admin',product,path,undefined,404);
  }
 });
 await check('license records, pricing, pending reviews and late historical quota match for both products',async()=>{
  const XLSX=require('xlsx');
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   const co=product==='CO_HYDROXIDE',base=(co?'/cobalt':'')+'/export-permits',books=base+'/record-books';
   const buyer=f.customers[product],tag='LICENSE-AUDIT-'+product,license=tag+'-NUMBER';
   const actor=f.accounts[0].id;
   const {rows:[second]}=await business.client.query('INSERT INTO customers(project_id,code,name,product_code) VALUES($1,$2,$2,$3) RETURNING id',[f.project,tag,product]);
   if(co)await business.client.query('INSERT INTO co_customer_profiles(id,project_id,code,name,created_by,updated_by) VALUES($1,$2,$3,$3,$4,$4)',[second.id,f.project,tag,actor]);
   const {rows:[otherContract]}=await business.client.query('INSERT INTO '+(co?'co_sales_contracts':'customer_contracts')+
    '(project_id,customer_id,contract_no,effective_date,end_date,created_by'+(co?',updated_by':'')+") VALUES($1,$2,$3,'2019-01-01','2099-01-01',$4"+(co?',$4':'')+') RETURNING id',[f.project,second.id,tag,actor]);
   const create=body=>api('sales_operator',product,books,{project_id:f.project,...body});
   const bank=await create({kind:'issuing_bank',value:tag+' bank'});
   const another=await create({kind:'issuing_bank',value:tag+' other bank'});
   const account=await create({kind:'issuing_bank_account',value:'1001',account_name:'Account holder',bank_id:bank.id,swift_code:'tst1cd01'});
   const offshore=await create({kind:'offshore_bank',value:tag+' offshore'});
   const offAccount=await create({kind:'offshore_bank_account',value:'2001',account_name:'Offshore holder',bank_id:offshore.id,swift_code:'TST2GB2L123'});
   await api('sales_operator',product,books,{project_id:f.project,kind:'offshore_bank_account',value:'BAD-CODE',bank_id:offshore.id,swift_code:'INVALID'},400);
   assert((await api('sales_operator',product,books+'?contract_id='+otherContract.id)).items.some(row=>row.id===account.id));
   const common={contract_id:buyer.contract,applied_on:'2019-12-01',proforma_no:tag,quantity:'12.345',unit_price:'10.005',amount:'1000',currency:'EUR',unit_basis:'CUSTOM',unit:'kg'};
   const selected={issuing_bank:bank.id,issuing_bank_account:account.id,offshore_bank:offshore.id,offshore_bank_account:offAccount.id};
   await api('sales_operator',product,base,{...common,processing_records:{...selected,issuing_bank:another.id}},400);
   const draft=await api('sales_operator',product,base,{...common,processing_records:selected});
   assert.deepEqual([draft.unit,draft.currency,draft.amount,draft.issuing_bank_account_name,draft.offshore_bank_account_name],['MT','USD','123.51','Account holder','Offshore holder']);
   assert.deepEqual([draft.issuing_bank_swift,draft.offshore_bank_swift],['TST1CD01','TST2GB2L123']);
   const modified=await api('sales_operator',product,books+'/'+account.id,{project_id:f.project,version:account.version,value:'1002',account_name:'New holder'},200,'PATCH');
   assert.equal(modified.swift_code,account.swift_code);
   await api('sales_operator',product,books+'/'+bank.id,{project_id:f.project,version:bank.version},409,'DELETE');
   await api('commerce_manager',product,books+'/'+account.id,{project_id:f.project,version:modified.version},403,'DELETE');
   await api('sales_operator',product,books+'/'+account.id,{project_id:f.project,version:modified.version},200,'DELETE');
   assert(!(await api('sales_operator',product,books+'?contract_id='+buyer.contract)).items.some(row=>row.id===account.id));
   const preserved=await api('sales_operator',product,base+'/'+draft.id);
   assert.equal(preserved.issuing_bank_account,'1001');
   assert.equal(preserved.issuing_bank_swift,'TST1CD01');
   const rows=Array.from({length:29},()=>[]);
   rows[0]=['PACKING LIST'];rows[2]=['','','','Packing List No:',tag+'-PL'];rows[3]=['','','','Lot No:',tag+'-LOT'];
   rows[5]=['','','','EB License No:',license];rows[6]=['','','','Shipping Date:','2020-03-05'];
   rows[21]=['Synthetic '+(co?'CO-AUDIT':'CU-AUDIT'),'','','',co?'TEST-HIST-CO':'TEST-HIST-CU'];
   rows[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
   rows.push([1,'Synthetic',tag+'-UNIT',co?null:48,tag+'-SEAL',647.123456,650.123456],['Total',null,null,null,null,647.123456,650.123456]);
   const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'PL');
   const file={file_name:tag+'.xlsx',file_base64:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}).toString('base64'),warehouse_id:f.warehouse};
   const queue='/historical-movements/batch';
   const preview=(await api('admin',product,queue+'/preview',{files:[file]})).results[0];
   assert(preview.importable,JSON.stringify(preview.issues));
   const imported=(await api('admin',product,queue+'/confirm',{files:[{...file,preview_token:preview.preview_token}]})).results[0];
   assert.equal(imported.status,'IMPORTED');
   if(co)f.historicalMetalSource={id:imported.id,search:tag+'-PL'};
   const outbound=(co?'/cobalt':'')+'/outbound-workspace',statusFilter={[co?'state':'status']:'OUTBOUND'};
   const archived=(await api('admin',product,outbound+'?'+new URLSearchParams({...statusFilter,search:tag+'-PL'}))).items
    .find(row=>row.historical_import);
   assert(archived);
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(archived.created_at));
   const outboundFilters={...statusFilter,customer_id:f.customers[product].id,created_date:day};
   for(const search of [tag+'-LOT',tag+'-PL',co?'TEST-HIST-CO':'TEST-HIST-CU']){
    const result=await api('admin',product,outbound+'?'+new URLSearchParams({...outboundFilters,search}));
    assert(result.items.some(row=>(row.order_id||row.id)===(archived.order_id||archived.id)));
   }
   assert.equal((await api('admin',product,outbound+'?'+new URLSearchParams({...outboundFilters,created_date:'2000-01-01',search:tag+'-PL'}))).total,0);
   assert.equal(Number((await api('sales_operator',product,base+'/'+draft.id)).used),0);
   const issue=await api('sales_operator',product,base+'/'+draft.id+'/actions',{action:'ISSUE',reason:'Synthetic license',version:draft.version,payload:{license_no:license,valid_from:'2020-01-01',valid_until:'2099-01-01'}});
   assert.equal((await api('sales_operator',product,base+'/'+draft.id)).status,'PENDING');
   assert((await api('commerce_manager',product,base+'?status=PENDING&proforma_no='+tag)).items.some(l=>l.id===draft.id));
   const todos=co?'/cobalt/ui461/tasks':'/v34/todos';
   const readTasks=async role=>{const r=await api(role,product,todos);return r.pending||r.items;};
   assert((await readTasks('commerce_manager')).some(t=>t.id===issue.id&&t.kind==='EXPORT_LICENSE_REVIEW'));
   assert(!(await readTasks('sales_operator')).some(t=>t.id===issue.id));
   const reviewUrl=base+'/'+draft.id+'/actions/'+issue.id;
   await api('sales_operator',product,reviewUrl,{decision:'APPROVED',note:'Not allowed'},403);
   const issued=await api('commerce_manager',product,reviewUrl,{decision:'APPROVED',note:'Verified'});
   assert.equal(issued.status,'ACTIVE');
   assert.equal(Number(issued.used),0.647123456);
   assert.equal(issued.historical_usage[0].source_id,imported.id);
   assert(!(await readTasks('commerce_manager')).some(t=>t.id===issue.id));
   const again=(await api('admin',product,queue+'/confirm',{files:[{...file,preview_token:preview.preview_token}]})).results[0];
   assert.equal(again.status,'ALREADY_IMPORTED');
   assert.equal((await api('sales_operator',product,base+'/'+draft.id)).historical_usage.length,1);
  }
 });
 await check('historical cobalt outbounds enter the ARECOMS queue and preserve independent confirmation and source history',async()=>{
  const product='CO_HYDROXIDE',c=business.client,{id:source,search}=f.historicalMetalSource;
  const {rows:[{id}]}=await c.query("SELECT id FROM historical_business_documents WHERE source_id=$1 AND kind='OUTBOUND'",[source]);
  const suffix=new URLSearchParams({view:'outbound',status:'PENDING_ARECOMS',search,from:'2020-03-05',to:'2020-03-05'});
  const queue='/cobalt/metal?'+suffix,detail='/cobalt/metal/outbounds/'+id,
   archive='/cobalt/historical-backfill/documents/'+id+'?kind=OUTBOUND';
  const loginRole='logistics_manager',entryRole='logistics_office_operator',approveRole='production_manager';
  const pending=await api(entryRole,product,queue);
  assert.equal(pending.total,1);
  const [line]=pending.items;
  assert.deepEqual([line.order_id,line.historical_source_id,line.historical_import,line.posted_day,line.net_mt,line.estimated_mt,line.confirmed_mt],
   [id,source,true,'2020-03-05','0.6471','0.23296',null]);
  assert.equal(pending.summary.period.pending,1);
  const before=await api(loginRole,product,archive);
  assert.equal(before.metal.can_submit,true);
  assert.equal(before.metal.can_decide,false);
  assert.equal((await api(entryRole,product,archive)).metal,undefined);
  const entry=await api(entryRole,product,detail);
  assert.equal(entry.can_submit,true);
  assert.equal(entry.can_decide,false);
  assert.equal((await api('customer_admin',product,queue)).total,0);
  await api('customer_admin',product,detail,undefined,404);
  await api('customer_admin',product,archive,undefined,404);
  const proposal={version:0,amount_mt:'0.24123',reason:'Synthetic verified laboratory document'};
  await api('production_operator',product,detail+'/submit',proposal,403);
  await api('customer_admin',product,detail+'/submit',proposal,404);
  const key=crypto.randomUUID();
  const requested=await api(entryRole,product,detail+'/submit',proposal);
  assert.equal(requested.version,1);
  const submitted=await api(approveRole,product,archive);
  assert.equal(submitted.metal.can_decide,true);
  assert.equal(submitted.metal.pending_metal_mt,'0.24123');
  assert.equal(submitted.metal.confirmed_mt,null);
  assert.equal((await api(approveRole,product,queue)).total,1);
  const decision={version:1,reason:'Synthetic independent ARECOMS verification'};
  await api(entryRole,product,detail+'/confirm',decision,403);
  await api(entryRole,product,detail+'/reject',decision,403);
  const replies=await Promise.all([request(approveRole,product,detail+'/confirm',decision,'POST',key),
   request(approveRole,product,detail+'/confirm',decision,'POST',key)]);
  assert(replies.every(r=>r.statusCode===200));
  assert.deepEqual(replies[0].json(),replies[1].json());
  const confirmed=await api(loginRole,product,archive);
  assert.equal(confirmed.metal.shipment_status,'COMPLETED');
  assert.equal(confirmed.metal.confirmed_mt,'0.24123');
  assert.deepEqual(confirmed.metal.history.map(e=>e.action),['CONFIRMED','SUBMITTED']);
  assert.deepEqual(confirmed.rows,before.rows);
  assert.deepEqual(confirmed.source_facts,before.source_facts);
  assert.equal((await api(loginRole,product,queue)).total,0);
  const report=await api('admin',product,'/cobalt/reports?from=2020-03-05&to=2020-03-05');
  assert.equal(report.outbound.find(row=>row.document_no===search).arecoms_mt,'0.24123');
  const revision={version:2,amount_mt:'0.25000',reason:'Synthetic correction to verify revision'};
  await api('admin',product,detail+'/submit',revision);
  const rejection={version:3,reason:'Original synthetic confirmation is correct'};
  await api('admin',product,detail+'/confirm',rejection,403);
  await api(approveRole,product,detail+'/reject',rejection);
  assert.equal((await api(approveRole,product,detail)).confirmed_mt,'0.24123');
  await assert.rejects(()=>c.query("UPDATE co_historical_metal_events SET reason='tamper' WHERE outbound_id=$1",[id]),/CO_RECORD_IMMUTABLE/);
  f.historicalMetalSource.outboundId=id;
 });
 await check('archived copper contract number can be reused with the correct customer while current duplicates conflict',async()=>{
  const product='CU_CATHODE',route='/contracts',contractNo='AUDIT-ARCHIVE-REUSE';
  const {rows:[{id:correctCustomer}]}=await business.client.query(
   "INSERT INTO customers(project_id,code,name,product_code) VALUES($1,'CU-AUDIT-CORRECT','Synthetic correct customer',$2) RETURNING id",[f.project,product]);
  const body={project_id:f.project,customer_id:f.customers[product].id,contract_no:contractNo,effective_date:'2026-01-01',end_date:'2099-01-01',active:false};
  const original=await api('admin',product,route,body);
  const corrected={...body,customer_id:correctCustomer,active:true};
  await api('admin',product,route,corrected,409);
  await api('admin',product,`${route}/${original.id}`,{version:original.version,reason:'Wrong customer'},200,'DELETE');
  const responses=await Promise.all([request('admin',product,route,corrected),request('admin',product,route,corrected)]);
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
  const replacement=responses.find(r=>r.statusCode===200).json();
  assert.notEqual(replacement.id,original.id);
  assert.equal(replacement.customer_id,correctCustomer);
  const archived=await api('admin',product,`${route}/${original.id}`);
  assert.equal(archived.customer_id,original.customer_id);
  assert.equal(archived.deletion_reason,'Wrong customer');
  assert(archived.deleted_at);
  const current=await api('admin',product,`${route}?search=${contractNo}`);
  assert.deepEqual(current.items.map(r=>r.id),[replacement.id]);
 });
 await check('retired layout APIs return 404 and prior layout records are retained',async()=>{
  for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
   await api('admin',product,'/page-layout',undefined,404);
   await api('admin',product,'/page-layout',{scope:'global',version:0,settings:{}},404,'PATCH');
  }
 });
 await check('both products: configurable admin review, revocation, two authorized sales and closure stages',async()=>{
  const role=async()=>(await api('admin','CU_CATHODE','/security/roles')).items.find(r=>r.code==='admin'),original=await role();
   const workflow=(await api('admin','CU_CATHODE','/security/roles')).catalog.workflow;
   for(const permission of ['roles:manage','plan:approve','inventory:correct-request','inventory:correct-review']) assert.ok(workflow[permission],permission);
   assert.equal(workflow['printer:manage'],undefined);
   const set=async permissions=>{const r=await role();await api('admin','CU_CATHODE','/security/roles/admin',{version:r.version,permissions},200,'PUT');await login('admin');};
  await api('admin','CU_CATHODE','/security/roles/admin',{version:original.version,permissions:original.permissions.filter(p=>p!=='roles:manage')},400,'PUT');
  const today=(await business.client.query("SELECT (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date::text d")).rows[0].d;
  for(const co of [false,true]){const product=co?'CO_HYDROXIDE':'CU_CATHODE',customer=f.customers[product],base=(co?'/cobalt':'')+'/sales-workflow',save=co?'/cobalt/sales/plans':'/plans',body={project_id:f.project,customer_id:customer.id,contract_id:customer.contract,target_weight:'100',remark:'Synthetic audit plan',...(co?{warehouse_id:f.warehouse,shipment_month:today.slice(0,7),planned_vehicle_count:1,destination:'Synthetic audit destination',status:'OPEN'}:{quantity_tolerance:'5',preparation_month:today.slice(0,7)})};
   const p=await api('sales_operator',product,save,body),url=base+'/plans/'+p.id;let d=await api('sales_operator',product,url);await login('customer_admin');await api('customer_admin',product,url,undefined,co?404:200);await set(original.permissions.filter(p=>p!=='plan:approve'));await api('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},403);await set(original.permissions);const reviewKey=crypto.randomUUID(),reviews=await Promise.all([request('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},undefined,reviewKey),request('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},undefined,reviewKey)]);assert.equal(reviews[0].statusCode,200,reviews[0].body);assert.deepEqual(reviews[0].json(),reviews[1].json());d=await api('sales_operator',product,url);await api('sales_manager',product,url+'/review',{version:d.approval_version,decision:'APPROVED'},403);await api('admin',product,url+'/review',{version:d.approval_version,decision:'APPROVED'});d=await api('sales_operator',product,url);assert.equal(d.approval_state,'APPROVED');assert.equal(d.close_eligibility,'AVAILABLE');
   assert.equal((await api('admin',product,url)).close_eligibility,'OTHER_SUBMITTER');
   await api('sales_operator',product,url+'/close',{version:d.version,reason:'Synthetic unused plan closure'});d=await api('sales_operator',product,url);await api('admin',product,url+'/close-review',{request_id:d.close_request_id,version:d.close_version,decision:'APPROVED'});d=await api('sales_operator',product,url);await api('sales_manager',product,url+'/close-review',{request_id:d.close_request_id,version:d.close_version,decision:'APPROVED'},403);await api('admin',product,url+'/close-review',{request_id:d.close_request_id,version:d.close_version,decision:'APPROVED'});const closed=await api('sales_operator',product,url);assert.equal(closed.status,'CLOSED');assert.equal(closed.close_eligibility,'CLOSED');
  }await set(original.permissions);
 });
 const P=require('./preparation-fixture.cjs'),coCode='CO_HYDROXIDE',cuCode='CU_CATHODE';
 let nativeCobaltPlan,initialWorkPlan;
 await check('preparation plan approval uses existing roles, records return and rejects bypass',async()=>{
  nativeCobaltPlan=await P.salesPlan(api,f,coCode);
  const base='/cobalt/preparation-plans',draft=await P.draft(api,coCode,nativeCobaltPlan,P.batch(coCode,201)),url=base+'/'+draft.id;
  await api('logistics_field_operator',coCode,'/cobalt/preparations',{preparation_plan_id:draft.id,total_bags:3},409);
  await api('logistics_field_operator',coCode,base,{sales_plan_id:nativeCobaltPlan,batch_no:P.batch(coCode,299),shipment_month:draft.shipment_month},403);
  await api('export_supervisor',coCode,base,{sales_plan_id:nativeCobaltPlan,customer_id:f.customers.CU_CATHODE.id,batch_no:P.batch(coCode,299),shipment_month:draft.shipment_month},400);
  const sent=await api('export_supervisor',coCode,url+'/submit',{version:draft.version});
  await api('site_supervisor',coCode,url+'/approve',{version:sent.version},403);
  const rejected=await api('logistics_manager',coCode,url+'/reject',{version:sent.version,reason:'Synthetic revision requested'});
  assert.equal(rejected.state,'REJECTED');
  const saved=await api('export_supervisor',coCode,url,{sales_plan_id:nativeCobaltPlan,batch_no:draft.batch_no,shipment_month:draft.shipment_month,version:rejected.version},200,'PATCH');
  const sentAgain=await api('export_supervisor',coCode,url+'/submit',{version:saved.version});
  initialWorkPlan=await api('logistics_manager',coCode,url+'/approve',{version:sentAgain.version});
  assert.equal(initialWorkPlan.state,'APPROVED');
  assert(initialWorkPlan.events.some(e=>e.action==='REJECT'&&e.reason==='Synthetic revision requested'));
  await api('logistics_field_operator',coCode,'/cobalt/preparations',{total_bags:1},409);
  await api('logistics_field_operator',cuCode,'/preparation-plans/'+draft.id,undefined,404);
 });
 await check('native cobalt intake: exact weights/seals, unauthorized review rejected, final receipt and bounded stock history',async()=>{
  const co='CO_HYDROXIDE',key=crypto.randomUUID(),body={preparation_plan_id:initialWorkPlan.id,project_id:f.project,warehouse_id:f.warehouse,total_bags:3,planned_location_id:f.location},responses=await Promise.all([request('logistics_field_operator',co,'/cobalt/preparations',body,undefined,key),request('logistics_field_operator',co,'/cobalt/preparations',body,undefined,key)]);assert.equal(responses[0].statusCode,200,responses[0].body);assert.deepEqual(responses[0].json(),responses[1].json());const p=responses[0].json(),url='/cobalt/preparations/'+p.id;f.preparation=p.id;
  assert.equal((await api('admin',co,url)).planned_location_id,f.location);
  await api('logistics_field_operator',co,'/cobalt/preparations',body,409);
  assert.equal((await api('admin',co,'/cobalt/preparation-plans/'+initialWorkPlan.id)).co_preparation_id,p.id);
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
  const withoutScope=(await business.client.query("INSERT INTO projects(code,name) VALUES('OUTSIDE','Synthetic unscoped project') RETURNING id")).rows[0].id,wh=(await business.client.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'OUTSIDE','Synthetic unscoped warehouse') RETURNING id",[withoutScope])).rows[0].id;await api('admin',co,'/cobalt/preparations',{project_id:withoutScope,warehouse_id:wh,total_bags:1},409);
 });
 await check('historical intake estimates wet weight until a bag is measured without counting either bag twice',async()=>{
  const co='CO_HYDROXIDE',operator='logistics_field_operator';
  let p;
  await business.client.query('ALTER TABLE co_preparations ALTER COLUMN intake_flow_version SET DEFAULT 1');
  try{
   const plan=await P.approved(api,co,nativeCobaltPlan,P.batch(co,202));
   p=await api(operator,co,'/cobalt/preparations',{preparation_plan_id:plan.id,project_id:f.project,warehouse_id:f.warehouse,total_bags:2});
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
 f.coUiWorkPlan=(await P.approved(api,coCode,nativeCobaltPlan,P.batch(coCode,209))).id;
 E.save('fixture.json',f);E.save('database-results.json',{status:'PASS',database:business.name,migrations:chain.length,upgradeEvidence,productionDatabaseWrites:0,workingDatabaseWrites:0,fastify:require('fastify/package.json').version});
 }finally{await app?.close();for(const c of open)await c.end();}
});
