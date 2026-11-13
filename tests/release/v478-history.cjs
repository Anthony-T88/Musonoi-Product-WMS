'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const XLSX=require('xlsx');
const E=require('./environment.cjs');
const f=require(require('node:path').join(E.root,process.env.WMS_480_HISTORY_FIXTURE||'.runtime/v478-test-config.json'));
const CU='CU_CATHODE',CO='CO_HYDROXIDE',origin=f.appCfg.origin;
const path='/historical-movements/batch';
const preview=(user,files)=>request(user,path+'/preview',{files});
const submit=(user,files)=>request(user,path+'/confirm',{files});

async function login(role){
 const account=f.accounts.find(row=>row.role===role);
 const response=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({username:account.username,password:account.password})});
 assert.equal(response.status,200);
 return {cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),'x-csrf-token':(await response.json()).csrfToken};
}
async function request(user,route,body,product=CU,status=200){
 const response=await fetch(origin+'/api/v1'+route,{
  headers:{...user,origin,'x-product-code':product,'content-type':'application/json','idempotency-key':randomUUID()},
  method:body?'POST':'GET',body:body&&JSON.stringify(body)
 });
 const data=await response.json();
 assert.equal(response.status,status,route+' '+data.error);
 return data;
}
function workbook(product,{name,unit,date='2020-03-05',receipt,duplicateDate}){
 const rows=Array.from({length:29},()=>[]),co=product===CO;
 rows[0]=['PACKING LIST'];rows[2]=['','','','Packing List No:',name];rows[3]=['','','','Lot No:',name+'-LOT'];
 rows[4]=['','','','Contract No:','TEST-CONTRACT'];rows[6]=['','','','Shipping Date:',date];
 if(receipt)rows[7]=['','','','Actual Receipt Date:',receipt];
 if(duplicateDate)rows[8]=['','','','Shipment Date:',duplicateDate];
 rows[21]=['Synthetic Buyer','','','','TEST-TRUCK'];
 rows[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
 rows.push([1,'Synthetic',unit,co?null:48,'TEST-SEAL',647.123456,650.123456],['Total',null,null,null,null,647.123456,650.123456]);
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'PL');
 const bookType=co?'xlsx':'xls';
 return {file_name:name+'.'+bookType,file_base64:XLSX.write(book,{bookType,type:'buffer'}).toString('base64'),warehouse_id:f.warehouse};
}
async function main(){
 assert.match(origin,/^http:\/\/127\.0\.0\.1:419[12]$/);
 assert.equal(f.appCfg.environment,'test');assert.match(f.database,/^musonoi_audit_[0-9a-f]{10}_test$/);
 const db=new Client(E.options(f.database));await db.connect();
 try{
  const status=(await db.query('SELECT environment FROM system_info WHERE singleton')).rows[0];
  assert.equal(status.environment,'test');
  const admin=await login('admin'),viewer=await login('limited_viewer'),scoped=await login('customer_admin'),tag=randomUUID().slice(0,8);
  const actual=[process.env.WMS_PL_CU,process.env.WMS_PL_CO].map((name,i)=>({file_name:i?'field-cobalt.xlsx':'field-copper.xls',file_base64:fs.readFileSync(name).toString('base64'),warehouse_id:f.warehouse}));
  const field=(await preview(admin,actual)).results;
  assert.deepEqual(field.map(row=>[row.product_code,row.totals.quantity]),[[CU,19],[CO,52]]);
  assert(field.every(row=>row.importable||row.already_imported||row.issues.includes('DOCUMENT_CONFLICT')||row.rows.some(line=>line.flags.includes('UNIT_CONFLICT'))));
  assert(field.every(row=>row.shipping_cell==='PL!E7'));
  const cu=workbook(CU,{name:'TEST-CU-'+tag,unit:'TEST-CU-UNIT-'+tag}),co=workbook(CO,{name:'TEST-CO-'+tag,unit:'TEST-CO-UNIT-'+tag,receipt:'2020-03-02'});
  const missing=workbook(CU,{name:'TEST-MISSING-'+tag,unit:'TEST-BAD-'+tag,date:null});
  const invalid=workbook(CO,{name:'TEST-INVALID-'+tag,unit:'TEST-INVALID-'+tag,date:'05/03/2020'});
  const ambiguous=workbook(CU,{name:'TEST-AMBIGUOUS-'+tag,unit:'TEST-AMBIGUOUS-'+tag,duplicateDate:'2020-03-07'});
  const queue=[cu,missing,co,invalid,ambiguous],reviews=(await preview(admin,queue)).results;
  assert.deepEqual(reviews.map(row=>row.importable),[true,false,true,false,false]);
  assert.deepEqual([reviews[1],reviews[3],reviews[4]].map(row=>row.issues[0]),['SHIPPING_DATE_MISSING','SHIPPING_DATE_INVALID','SHIPPING_DATE_AMBIGUOUS']);
  await request(viewer,path+'/preview',{files:[cu]},CU,403);
  await request(viewer,path+'/confirm',{files:[cu]},CU,403);
  await request(viewer,'/historical-movements',undefined,CU,403);
  await request(admin,'/historical-movements/preview',{...cu,movement_type:'INBOUND',business_date:'2020-01-01'},CU,410);
  const response=await fetch(origin+'/workbench/historical-movements',{headers:viewer,redirect:'manual'});
  assert.equal(response.status,403);
  const withTokens=queue.map((file,i)=>({...file,preview_token:reviews[i].preview_token}));
  const counts=async()=> (await db.query(`SELECT (SELECT count(*) FROM bundles) copper,(SELECT count(*) FROM co_inventory) cobalt,
   (SELECT count(*) FROM loading_plan_documents) plans,(SELECT count(*) FROM export_license_allocations) licences,
   (SELECT count(*) FROM inventory_revisions) revisions`)).rows[0];
  const before=await counts();
  const overview=(product,user=admin,day='2020-03-05')=>request(user,(product===CU?'/v34/overview':'/cobalt/overview')+'?'+new URLSearchParams({from:day,to:day}),undefined,product);
  const tally=(data,direction)=>data.historical_imports?.rows.filter(row=>row.direction===direction).reduce((n,row)=>n+row.units,0)||0;
  const prior=await Promise.all([overview(CU),overview(CO),overview(CO,admin,'2020-03-02')]);
  const imported=await submit(admin,withTokens);
  assert.deepEqual(imported.results.map(row=>row.status),['IMPORTED','FAILED','IMPORTED','FAILED','FAILED']);
  const cuId=imported.results[0].id,coId=imported.results[2].id;
  assert.equal(imported.results[0].import_batch_id,imported.results[2].import_batch_id);
  for(const [product,id,unit] of [[CU,cuId,'TEST-CU-UNIT-'+tag],[CO,coId,'TEST-CO-UNIT-'+tag]]){
   const co=product===CO,base=co?'/cobalt':'';
   const entry=await request(admin,base+'/historical-movements/'+id,undefined,product);
   assert.equal(entry.rows[0].source_row,30);assert.equal(entry.rows[0].unit_id,unit);
   assert.deepEqual(entry.documents.map(row=>row.event_order),[1,2,3,4]);
   const archived=await request(admin,co?'/cobalt/stock?stock_state=OUTBOUND&bag='+unit:'/inventory?status=OUTBOUND&search='+unit,undefined,product);
   assert.equal(archived.total,1);assert(archived.items[0].historical_import);
   if(!co)assert.equal(archived.items[0].date,null);
   const active=await request(admin,co?'/cobalt/stock?stock_state=IN_STOCK&bag='+unit:'/inventory?status=CURRENT&search='+unit,undefined,product);
   assert.equal(active.total,0);
   const key=co?archived.items[0].preparation_id:archived.items[0].uuid;
   const record=await request(admin,base+'/historical-backfill/stock/batch/'+key,undefined,product);
   assert.equal(record.rows[0].net_kg,'647.123456');assert.equal(record.rows[0].gross_kg,'650.123456');
   assert.equal(record.original_receipt_date,co?'2020-03-02':null);
   assert.equal(record.documents[0].business_date,co?'2020-03-02':'2020-03-05');
   const load=record.documents.find(row=>row.kind==='LOADING_ORDER');
   const loaded=await request(admin,base+'/historical-backfill/documents/'+load.id+'?kind=LOADING_ORDER',undefined,product);
   assert.equal(loaded.rows[0].unit_id,unit);assert.equal(loaded.net_kg,record.net_kg);
   await request(scoped,base+'/historical-backfill/stock/batch/'+key,undefined,product,404);
  }
  const updated=await Promise.all([overview(CU),overview(CO),overview(CO,admin,'2020-03-02')]);
  assert.equal(tally(updated[0],'OUTBOUND')-tally(prior[0],'OUTBOUND'),1);
  assert.equal(tally(updated[1],'OUTBOUND')-tally(prior[1],'OUTBOUND'),1);
  assert.equal(tally(updated[0],'INBOUND')-tally(prior[0],'INBOUND'),0);
  assert.equal(tally(updated[2],'INBOUND')-tally(prior[2],'INBOUND'),1);
  assert.deepEqual(updated[0].outbound,prior[0].outbound);
  assert.deepEqual(updated[1].shipping,prior[1].shipping);
  assert.deepEqual(updated[0].metrics,prior[0].metrics);
  assert.deepEqual(updated[1].inventory,prior[1].inventory);
  for(let i=0;i<2;i++){
   const beforeNet=prior[i].chart_trend.rows[0].net_weight,afterNet=updated[i].chart_trend.rows[0].net_weight;
   assert.equal(Number((Number(afterNet)-Number(beforeNet)).toFixed(9)),0.647123456);
  }
  assert.equal(updated[2].chart_trend.rows[0].inbound_units-prior[2].chart_trend.rows[0].inbound_units,1);
  for(const [product,needle,receiptPath,planPath,outboundPath] of [
   [CU,'TEST-CU-'+tag,'/v34/lists/receipts?status=CONFIRMED','/v34/lists/loading?status=COMPLETED','/outbound-workspace?status=OUTBOUND'],
   [CO,'TEST-CO-'+tag,'/cobalt/sales-workflow/preparations?status=RECEIVED','/cobalt/loading/plans?status=OUTBOUND','/cobalt/outbound-workspace?state=OUTBOUND']
  ]){
   for(const path of [receiptPath,planPath,outboundPath]){
    const list=await request(admin,path+'&search='+needle,undefined,product);
    assert(list.items.some(row=>row.historical_import&&row.code.includes(needle)),path);
   }
   const pending=await request(admin,receiptPath.replace(/status=\w+$/,'status=DRAFT'),undefined,product);
   assert(pending.items.every(row=>!row.historical_import));
  }
  const dateQuery='from=2020-03-05&to=2020-03-05';
  const cuReport=await request(admin,'/v34/reports?type=outbound&group_by=lot_no&'+dateQuery,undefined,CU);
  const cuLot=cuReport.items.find(row=>row.lot_no==='TEST-CU-'+tag+'-LOT');
  assert.equal(cuLot?.bundles,1);
  assert.equal(Number(cuLot.net_weight),0.647123);
  const coReport=await request(admin,'/cobalt/reports?'+dateQuery,undefined,CO);
  const coLot=coReport.outbound.find(row=>row.preparation_batch_no==='TEST-CO-'+tag+'-LOT');
  assert.equal(coLot?.historical_import,true);assert.equal(coLot.arecoms_mt,null);
  const flows=await request(admin,'/reports?type=flows&'+dateQuery,undefined,CU);
  assert(flows.rows.some(row=>row.bundle_no==='TEST-CU-UNIT-'+tag&&row.type==='历史导入出库'));
  for(const [product,url,body,lot] of [
   [CU,'/v34/reports/export',{type:'outbound',group_by:'lot_no',from:'2020-03-05',to:'2020-03-05'},cuLot.lot_no],
   [CO,'/cobalt/reports/export',{filters:coReport.filters,signature:coReport.signature},coLot.preparation_batch_no],
   [CU,'/v34/reports/export',{comprehensive:true,from:'2020-03-05',to:'2020-03-05'},cuLot.lot_no]
  ]){
   const response=await fetch(origin+'/api/v1'+url,{method:'POST',headers:{...admin,origin,'x-product-code':product,
    'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify(body)});
   assert.equal(response.status,200);
   const exportBook=XLSX.read(Buffer.from(await response.arrayBuffer()));
   assert(Object.values(exportBook.Sheets).some(sheet=>Object.values(sheet).some(cell=>cell.v===lot)),lot);
  }
  const hidden=await overview(CU,scoped);
  assert.equal(hidden.historical_imports,null);
  const bag='TEST-CO-UNIT-'+tag;
  const exportStock=await fetch(origin+'/api/v1/cobalt/stock/export?'+new URLSearchParams({stock_state:'ALL',bag,language:'zh-CN'}),{
   headers:{...admin,origin,'x-product-code':CO}
  });
  assert.equal(exportStock.status,200);
  const excel=XLSX.read(Buffer.from(await exportStock.arrayBuffer()));
  const exported=XLSX.utils.sheet_to_json(excel.Sheets['袋级明细']);
  assert.equal(exported.length,1);
  assert.equal(exported[0]['袋号'],bag);
  assert.equal(exported[0]['来源']??exported[0].Source,'历史导入数据');
  assert.equal(exported[0]['发运日期'],'2020-03-05');
  const repeated=await submit(admin,withTokens.filter((_,i)=>i===0||i===2));
  assert.deepEqual(repeated.results.map(row=>row.status),['ALREADY_IMPORTED','ALREADY_IMPORTED']);
  const fail=workbook(CU,{name:'TEST-ROLLBACK-'+tag,unit:'TEST-ROLLBACK-UNIT-'+tag});
  const failure=(await preview(admin,[fail])).results[0];assert(failure.importable);fail.preview_token=failure.preview_token;
  await db.query(`CREATE FUNCTION v478_failure_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.kind='LOADING_ORDER' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER v478_failure_fixture BEFORE INSERT ON historical_business_documents FOR EACH ROW EXECUTE FUNCTION v478_failure_fixture()`);
  try{
   assert.equal((await submit(admin,[fail])).results[0].code,'IMPORT_WRITE_FAILED');
   assert((await preview(admin,[fail])).results[0].importable);
   assert.equal((await db.query('SELECT count(*)::int n FROM historical_movement_documents WHERE document_no=$1',['TEST-ROLLBACK-'+tag])).rows[0].n,0);
  }finally{await db.query('DROP TRIGGER v478_failure_fixture ON historical_business_documents; DROP FUNCTION v478_failure_fixture()');}
  const competing=await Promise.all([submit(admin,[fail]),submit(admin,[fail])]);
  assert.deepEqual(competing.map(row=>row.results[0].status).sort(),['ALREADY_IMPORTED','IMPORTED']);
  assert.equal(competing[0].results[0].id,competing[1].results[0].id);
  const live='MUS-2020-87-00026';
  await db.query('INSERT INTO bundle_number_registry(number_key,conflicted,sources) VALUES(v265_bundle_key($1),false,$2) ON CONFLICT DO NOTHING',[live,'[]']);
  const conflict=(await preview(admin,[workbook(CU,{name:'TEST-CONFLICT-'+tag,unit:live})])).results[0];
  assert(!conflict.importable&&conflict.rows[0].flags.includes('UNIT_CONFLICT')&&conflict.rows[0].conflicts.length);
  const legacyFile=workbook(CU,{name:'TEST-LEGACY-'+tag,unit:'TEST-LEGACY-UNIT-'+tag});
  const legacyPreview=(await preview(admin,[legacyFile])).results[0];
  const ledger=await db.query(`INSERT INTO historical_movement_documents(product_code,movement_type,document_no,document_key,business_date,date_evidence,
   source_name,source_sha256,source_data,source_facts,imported_by) VALUES($1,'OUTBOUND',$2,$3,$4,'Synthetic old ledger',$5,$6,$7,$8,$9) RETURNING id`,
  [CU,legacyPreview.document_no,legacyPreview.document_key,legacyPreview.business_date,legacyFile.file_name,
   require('../../server/historical-packing.cjs').digest(Buffer.from(legacyFile.file_base64,'base64')),
   Buffer.from(legacyFile.file_base64,'base64'),{batch_no:legacyPreview.batch_no,shipping_date:legacyPreview.shipping_date},
   f.accounts.find(row=>row.role==='admin').id]);
  const oldId=ledger.rows[0].id,unit=legacyPreview.rows[0];
  await db.query(`INSERT INTO historical_movement_lines(document_id,source_row,unit_id,unit_key,seal_no,sheets_count,net_kg,gross_kg)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[oldId,unit.source_row,unit.unit_id,unit.unit_key,unit.seal_no,unit.sheets_count,unit.net_kg,unit.gross_kg]);
  const migrationPreview=(await preview(admin,[legacyFile])).results[0];
  assert(migrationPreview.importable);
  const migrated=(await submit(admin,[{...legacyFile,preview_token:migrationPreview.preview_token}])).results[0];
  assert.equal(migrated.id,oldId);
  assert.equal(migrated.status,'IMPORTED');
  assert.deepEqual(await counts(),before);
  const testApp=await require('../../server/app.cjs').build({config:f.appCfg});
  try{
   const now=new Date(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
   const bundleNo='MUS-'+day.slice(0,4)+'-078-'+String(now.getTime());
   const {rows:[site]}=await db.query("INSERT INTO projects(code,name) VALUES($1,'Synthetic history conflict project') RETURNING id",['TEST-HIST-'+tag]);
   await db.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'TEST-HIST','Synthetic history conflict warehouse')",[site.id]);
   for(const account of f.accounts.filter(item=>['production_operator','production_manager'].includes(item.role))){
    await db.query('INSERT INTO user_scopes(user_id,project_id) VALUES($1,$2)',[account.id,site.id]);
   }
   const requestAs=async(role,address)=>{
    const account=f.accounts.find(item=>item.role===role);
    const login=await testApp.inject({url:'/api/v1/auth/login',method:'POST',remoteAddress:address,headers:{origin},payload:{username:account.username,password:account.password}});
    assert.equal(login.statusCode,200,role);
    return async(route,payload)=>{
     const response=await testApp.inject({url:'/api/v1'+route,method:'POST',remoteAddress:address,headers:{origin,
      cookie:login.cookies.map(item=>item.name+'='+item.value).join('; '),'x-csrf-token':login.json().csrfToken,'idempotency-key':randomUUID()},payload});
     assert.equal(response.statusCode,200,route+' '+response.body.slice(0,160));
     return response.json();
    };
   };
   const produce=await requestAs('production_operator','127.73.0.21'),confirm=await requestAs('production_manager','127.73.0.22');
   const receipt=await produce('/receipts',{project_id:site.id,lines:[{bundle_no:bundleNo,sheets_per_bundle:48,production_date:day,inbound_at:now.toISOString()}]});
   const pending=await produce('/receipts/'+receipt.id+'/submit',{version:receipt.version});
   await confirm('/receipts/'+receipt.id+'/confirm',{version:pending.version});
   const {rows:[live]}=await db.query('SELECT physical_status FROM bundles WHERE receipt_id=$1',[receipt.id]);
   assert.equal(live.physical_status,'IN_STOCK');
   const blocked=(await preview(admin,[workbook(CU,{name:'TEST-LIVE-CONFLICT-'+tag,unit:bundleNo})])).results[0];
   assert(!blocked.importable&&blocked.rows[0].flags.includes('UNIT_CONFLICT')&&blocked.rows[0].conflicts.length);
  }finally{await testApp.close();}
  const proof={field:field.map(({product_code,totals,shipping_date})=>({product_code,units:totals.quantity,shipping_date})),
   mixedBatch:true,missingInvalidAmbiguousDates:true,inventoryAndDocumentTrace:true,legacyIdentifierConflict:true,liveStockConflict:true,historicalOverviewScopeAndDates:true,cobaltHistoricalExport:true,historicalReportAndExcel:true,
   permissionDenial:true,customerScopeDenial:true,repeatAndConcurrent:true,transactionRollbackAndRetry:true,legacyLedgerReused:true,liveLedgersUnchanged:true};
  fs.mkdirSync('.runtime/v478-evidence',{recursive:true});
  fs.writeFileSync('.runtime/v478-evidence/history.json',JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
 }finally{await db.end();}
}
main().catch(error=>{console.error(error.stack,error.cause||'');process.exitCode=1;});
