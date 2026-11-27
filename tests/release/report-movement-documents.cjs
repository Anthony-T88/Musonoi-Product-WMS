'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Client}=require('pg'),E=require('./environment.cjs');
const Data=require('../../server/report-center-data.cjs'),Reports=require('../../server/report-center.cjs');

const period={from:'2025-02-01',to:'2025-02-07'};
const at=(d)=>'2025-02-'+String(d).padStart(2,'0')+'T10:00:00Z';
const copperTables=['inventory_history','inventory_events','inventory_origins','inventory_revisions','inventory_reporting_epoch',
 'bundles','receipts','outbound_orders','loading_orders','packing_list_documents','loading_plan_matches',
 'loading_plan_documents','export_transport','allocations','sales_plans'];
const cobaltTables=['co_report_movements','co_bags','co_preparations','co_outbound_bags','co_outbounds','co_packing_documents',
 'co_location_events','co_locations'];
const historicalTables=['historical_outbound_units','historical_backfills','historical_movement_documents'];

async function copper(c,project,warehouse){
 const ids=Array.from({length:12},randomUUID);
 const [receipt,bundle,preparation,otherMove,packed,legacy,order,exportOrder,plan,allocation,matched,originWarehouse]=ids;
 const before='2025-01-31T10:00:00Z',after=at(2);
 await c.query("INSERT INTO inventory_reporting_epoch(revision_id,started_at) VALUES(1,'2025-01-01T10:00:00Z')");
 await c.query('INSERT INTO inventory_revisions(id,posted_at) VALUES (10,$1),(20,$2)',[before,after]);
 await c.query("INSERT INTO receipts(id,code) VALUES($1,'SYN-RECEIPT')",[receipt]);
 await c.query('INSERT INTO bundles(id,receipt_id) VALUES($1,$2)',[bundle,receipt]);
 await c.query('INSERT INTO loading_orders(id) VALUES($1),($2)',[order,exportOrder]);
 await c.query("INSERT INTO packing_list_documents(loading_id,document_no) VALUES($1,'SYN-ARCHIVED-PL')",[order]);
 await c.query("INSERT INTO loading_plan_documents(id,packing_list_no) VALUES($1,'SYN-PL-PLAN')",[matched]);
 await c.query('INSERT INTO loading_plan_matches(loading_id,document_id) VALUES($1,$2)',[order,matched]);
 await c.query('INSERT INTO export_transport(loading_id,fields) VALUES($1,$2)',[exportOrder,{packing_list_no:'SYN-PL-EXPORT'}]);
 await c.query('INSERT INTO sales_plans(id,project_id) VALUES($1,$2)',[plan,project]);
 await c.query("INSERT INTO allocations(id,plan_id,code,lot_no) VALUES($1,$2,'SYN-PREPARATION','SYN-PREP-LOT')",[allocation,plan]);

 const state=(piece,warehouse_id,status='IN_STOCK')=>({bundle_no:piece,warehouse_id,project_id:project,physical_status:status,
  weight:'2.1',location:'SYN-ROW-BAY',lot_no:'SYN-LOT'});
 async function add(id,piece,previous,current,event,details,delta){
  if(previous)await c.query('INSERT INTO inventory_history(bundle_id,revision_id,state) VALUES($1,10,$2)',[id,state(piece,previous)]);
  await c.query('INSERT INTO inventory_history(bundle_id,revision_id,state) VALUES($1,20,$2)',[id,state(piece,warehouse,current)]);
  await c.query('INSERT INTO inventory_events(id,bundle_id,revision_id,event_type,physical_delta,after_data) VALUES($1,$2,20,$3,$4,$5)',
   [ids.indexOf(id)+1,id,event,delta,details]);
 }
 await add(bundle,'SYN-IN',null,'IN_STOCK','INBOUND',{code:'SYN-NONRECEIPT'},'2.1');
 await add(preparation,'SYN-PREP',originWarehouse,'IN_STOCK','MOVE',{allocation_id:allocation},0);
 await add(otherMove,'SYN-OTHER-MOVE',originWarehouse,'IN_STOCK','MOVE',{},0);
 await add(packed,'SYN-PACKED',warehouse,'OUTBOUND','OUTBOUND',{loading_id:order,code:'SYN-OUTBOUND'},'-2.1');
 const outbound=randomUUID();
 await c.query('INSERT INTO outbound_orders(id,loading_id) VALUES($1,$2)',[outbound,exportOrder]);
 await add(legacy,'SYN-LEGACY',warehouse,'OUTBOUND','OUTBOUND',{outbound_id:outbound,code:'SYN-OLD-OUT'},'-2.1');
}

async function cobalt(c,project,warehouse){
 const [preparation,outbound,location]=Array.from({length:3},randomUUID);
 await c.query("INSERT INTO co_preparations(id,document_no,preparation_batch_no) VALUES($1,'SYN-CO-RECEIPT','SYN-CO-LOT')",[preparation]);
 await c.query('INSERT INTO co_outbounds(id,snapshot) VALUES($1,$2)',[outbound,{plan:{packing_list_no:'SYN-CO-FROZEN-PL'}}]);
 await c.query("INSERT INTO co_locations(id,project_id,warehouse_id,code) VALUES($1,$2,$3,'SYN-CO-BAY')",[location,project,warehouse]);
 for(const [index,kind] of ['RECEIPT','OUTBOUND','TRANSFER'].entries()){
  const bag=randomUUID(),number='SYN-CO-'+kind;
  await c.query('INSERT INTO co_bags(id,bag_no,preparation_id) VALUES($1,$2,$3)',[bag,number,preparation]);
  await c.query('INSERT INTO co_report_movements(id,bag_id,project_id,warehouse_id,occurred_at,kind,bags_delta,known_net_delta_kg,unknown_bags_delta) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,0)',[index+1,bag,project,warehouse,at(3),kind,kind==='OUTBOUND'?-1:1,kind==='OUTBOUND'?-647:647]);
  if(kind==='OUTBOUND')await c.query('INSERT INTO co_outbound_bags(outbound_id,bag_id,position_snapshot) VALUES($1,$2,$3)',
   [outbound,bag,{location_id:location}]);
 }
}

async function historical(c,project,warehouse){
 const product='CU_CATHODE';
 const [receipt,ignored,matchSource,missingSource]=Array.from({length:4},randomUUID);
 await c.query("INSERT INTO historical_movement_documents(id,product_code,movement_type,document_no,business_date,voided_at) "+
  "VALUES($1,$2,'INBOUND','SYN-HISTORY-RECEIPT','2025-02-02',NULL),($3,$2,'INBOUND','SYN-VOIDED','2025-02-02','2025-02-05T00:00:00Z')",
  [receipt,product,ignored]);
 for(const [id,name,source] of [[matchSource,'LINKED',receipt],[missingSource,'MISSING',ignored]]){
  await c.query('INSERT INTO historical_backfills(source_id,receipt_source_id) VALUES($1,$2)',[id,source]);
  await c.query("INSERT INTO historical_outbound_units(source_id,project_id,warehouse_id,product_code,packing_list_no,unit_id,source_row,"+
   "net_kg,source_facts,shipping_date,original_receipt_date) VALUES($1,$2,$3,$4,$5,$6,1,2100,$7,'2025-02-04','2025-02-02')",
  [id,project,warehouse,product,'SYN-HISTORY-PL-'+name,'SYN-HISTORY-'+name,{batch_no:'SYN-HISTORY-LOT'}]);
 }
}

test('inventory movements use their linked business numbers and retain independent scope changes',async()=>{
 const f=E.fixture(),c=new Client(E.options(f.database));
 await c.connect();
 try{
  assert.equal((await c.query('SELECT environment FROM system_info WHERE singleton')).rows[0].environment,'test');
  // Session-local projections preserve existing checkout data, including warehouses and authorization.
  for(const table of [...copperTables,...cobaltTables,...historicalTables])
   await c.query('CREATE TEMP TABLE '+table+' AS SELECT * FROM public.'+table+' WITH NO DATA');
  await copper(c,f.project,f.warehouse);
  await cobalt(c,f.project,f.warehouse);
  await historical(c,f.project,f.warehouse);
  const req={user:{id:f.accounts.find(a=>a.role==='admin').id,language_code:'zh-CN',
   permissions:['report:read','inventory:export']},productCode:'CU_CATHODE'};
  const cu=await Data.movements(c,req,period,f.warehouse);
  const co=await Data.movements(c,{...req,productCode:'CO_HYDROXIDE'},period,f.warehouse);
  const one=(rows,piece,kind)=>{const result=rows.filter(r=>r.piece===piece&&(!kind||r.kind===kind));assert.equal(result.length,1);return result[0];};
  assert.equal(one(cu,'SYN-IN','INBOUND').document,'SYN-RECEIPT');
  assert.equal(one(cu,'SYN-PREP','PREPARATION_TRANSFER').document,'SYN-PREPARATION');
  assert.equal(one(cu,'SYN-OTHER-MOVE','TRANSFER').document,null);
  assert.equal(one(cu,'SYN-PACKED','OUTBOUND').document,'SYN-ARCHIVED-PL');
  assert.equal(one(cu,'SYN-LEGACY','OUTBOUND').document,'SYN-PL-EXPORT');
  assert.equal(one(cu,'SYN-HISTORY-LINKED','INBOUND').document,'SYN-HISTORY-RECEIPT');
  assert.equal(one(cu,'SYN-HISTORY-LINKED','OUTBOUND').document,'SYN-HISTORY-PL-LINKED');
  const missing=one(cu,'SYN-HISTORY-MISSING','INBOUND');
  assert.equal(missing.document,null);
  assert.equal(missing.pending_fields.document,'HISTORICAL_NOT_LINKED');
  assert.equal(one(co,'SYN-CO-RECEIPT','INBOUND').document,'SYN-CO-RECEIPT');
  assert.equal(one(co,'SYN-CO-TRANSFER','TRANSFER').document,null);
  const shipped=one(co,'SYN-CO-OUTBOUND','OUTBOUND');
  assert.equal(shipped.document,'SYN-CO-FROZEN-PL');
  assert.equal(shipped.position,'SYN-CO-BAY');

  const data=await Reports.report(c,req,{...period,kind:'movement',kind_filter:'INBOUND',source:'HISTORICAL'});
  assert.equal(data.labels.PREPARATION_TRANSFER,'备货流转');
  assert.equal(data.labels.TRANSFER,'范围流转');
  const book=new (require('exceljs').Workbook)();
  await book.xlsx.load(await Reports.workbook(data,req));
  const sheet=book.getWorksheet('明细'),column=sheet.getRow(6).values.indexOf('单据号');
  assert.ok(column>=2);
  const values=data.detail.rows.map((_,i)=>sheet.getCell(i+7,column).value);
  assert.ok(values.includes('SYN-HISTORY-RECEIPT'));
  assert.ok(values.some(v=>typeof v==='string'&&/^因.+待确认补充$/.test(v)));
 }finally{await c.end();}
});
