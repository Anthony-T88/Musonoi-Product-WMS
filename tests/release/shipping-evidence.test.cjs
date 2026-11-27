'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const XLSX=require('xlsx');
const Packing=require('../../server/historical-packing.cjs');
const Evidence=require('../../server/report-shipping-evidence.cjs');
const Report=require('../../server/report-center.cjs');
const Management=require('../../server/management.cjs');
const Cobalt=require('../../server/cobalt-reports.cjs');
const History=require('../../server/historical-backfill.cjs');

function workbook(fields,invoiceFields=[]){
 const header=Array.from({length:29},()=>[]);
 header[0][0]='Packing List';
 header[28][2]='BAG NO';
 fields.forEach(([name,value],i)=>{header[i+2][3]=name;header[i+2][4]=value;});
 const inv=Array.from({length:29},()=>[]);
 invoiceFields.forEach(([name,value],i)=>{inv[i+2][3]=name;inv[i+2][4]=value;});
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(header),'PL');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(inv),'INV');
 return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
}

test('historical archive uses labeled transport, commercial and load fields without substituting the shipping date',()=>{
 const data=workbook([
  ['EB License No:','LIC-01'],['Driver’s name:','Driver Evidence'],['Passport No:','00123'],
  ['Horse No:','TRK-01'],['Tailer 1 No:','TL-01'],['Tailer 2 No:','N/A'],
  ['Forwarder:','Forwarder Evidence'],['Placeoffloaded:','Depot A'],['Sales Plan No:','PLAN-X'],
  ['Shipment Month:','2026-10'],['Shipping Date:','2026-11-04']
 ],[['Invoice No:','INV-01']]);
 const metadata=Packing.archivedShippingMetadata('CO_HYDROXIDE',{data});
 const row=Evidence.historicalFields({},{metadata});
 assert.deepEqual(metadata.ambiguous,[]);
 assert.equal(row.invoice,'INV-01');
 assert.equal(row.license,'LIC-01');
 assert.equal(row.driver,'Driver Evidence');
 assert.equal(row.passport,'00123');
 assert.equal(row.vehicle,'TRK-01');
 assert.equal(row.trailerOne,'TL-01');
 assert.equal(row.trailerTwo,'N/A');
 assert.equal(row.transporter,'Forwarder Evidence');
 assert.equal(row.destination,'Depot A');
 assert.equal(row.plan,'PLAN-X');
 assert.equal(row.month,'2026-10');
 assert.equal(row.loadDate,null);
 assert.equal(row.pending_fields.loadDate,'HISTORICAL_SOURCE_MISSING');
});

test('ambiguous workbook evidence stays pending and an actual sales link or confirmation takes precedence',()=>{
 const metadata=Packing.archivedShippingMetadata('CO_HYDROXIDE',{data:workbook([
  ['Destination:','Unverified A'],['Sales Plan Number:','PLAN-RAW'],
  ['Shipment Month:','2026-10'],['Actual Loading Date:','2026-10-30']
 ],[['Destination:','Unverified B'],['Invoice No:','INV-RAW']])});
 const row=Evidence.historicalFields({},{
  metadata,plan_id:'plan-reference',plan:'VERIFIED-PLAN',shipment_month:'2026-11',confirmed_invoice:'INV-CONFIRMED'
 });
 assert.equal(row.planId,'plan-reference');
 assert.equal(row.plan,'VERIFIED-PLAN');
 assert.equal(row.month,'2026-11');
 assert.equal(row.invoice,'INV-CONFIRMED');
 assert.equal(row.destination,null);
 assert.equal(row.pending_fields.destination,'HISTORICAL_AMBIGUOUS');
 assert.equal(row.loadDate,'2026-10-30');
 const unlinked=Evidence.historicalFields({date:'2026-11-01'});
 assert.equal(unlinked.month,null);
 assert.equal(unlinked.pending_fields.month,'HISTORICAL_NOT_LINKED');
});

test('archived-source enrichment is read-only, reads only selected ids and rejects a checksum mismatch',async()=>{
 const archived=workbook([['Driver’s name:','Driver Evidence']]);
 const selected='19bebfa2-5488-4f2f-b0c2-d83288b2d2ad';
 let digest=require('node:crypto').createHash('sha256').update(archived).digest('hex');
 let archiveReads=0;
 const req={
  async query(sql,params){
   assert.match(sql,/^\s*SELECT\s/i);
   assert.deepEqual(params,['CO_HYDROXIDE',[selected]]);
   if(sql.includes('source_facts facts'))return {rows:[{id:selected,source_sha256:digest,facts:{}}]};
   archiveReads++;
   const content={source_name:'archive.xlsx',source_data:archived,id:selected};
   return {rows:[{...content,source_sha256:digest}]};
  }
 };
 const evidence=await Evidence.historical(req,'CO_HYDROXIDE',[selected]);
 assert.equal(Evidence.historicalFields({},evidence.get(selected)).driver,'Driver Evidence');
 const cached=await Evidence.historical(req,'CO_HYDROXIDE',[selected]);
 assert.equal(Evidence.historicalFields({},cached.get(selected)).driver,'Driver Evidence');
 assert.equal(archiveReads,1);
 digest='invalid';
 const rejected=await Evidence.historical(req,'CO_HYDROXIDE',[selected]);
 const row=Evidence.historicalFields({},rejected.get(selected));
 assert.equal(row.driver,null);
 assert.equal(row.pending_fields.driver,'HISTORICAL_SOURCE_MISSING');
 assert.equal(archiveReads,2);
});

test('copper uses the sales plan for each actual lot and exports the complete shipment evidence',async t=>{
 const id='acfe2ae4-3663-44c4-865c-c430a9452945';
 t.mock.method(Management,'context',async()=>({w:{}}));
 t.mock.method(Management,'outbound',async()=>[{
  id,date:'2026-11-06',code:'CU-LOAD',customer_name:'Warehouse Customer',contract_no:'CONTRACT',
  corrected_vehicle_no:'CORRECTED-PLATE',loaded_at:'2026-11-04T23:10:00Z',packing_revision:1
 }]);
 t.mock.method(History,'reportShipments',async()=>[]);
 const client={async query(sql,params){
  if(sql.includes('clock_timestamp'))return {rows:[{d:'2026-11-27'}]};
  assert.deepEqual(params,[[id]]);
  if(sql.includes('archive.snapshot'))return {rows:[{id,archived_packing_no:'CU-PL',shipment_month:'2026-10',
   trailer_two:'N/A',archived:{transport:{vehicle_no:'ORIGINAL-PLATE',trailer_one:'TR-1',driver_name:'Driver',
    passport_no:'00123',destination:'Depot',forwarder:'Carrier',eb_license:'LIC-01'}}}]};
  assert.match(sql,/sales_plans p ON p.id=a.plan_id/);
  return {rows:[
   {loading_id:id,lot:'LOT-1',plan:'PLAN-1',invoice:'INV-1',qty:2,gross:'2',net:'1.9',confirmed_at:'2026-11-15'},
   {loading_id:id,lot:'LOT-2',plan:'PLAN-2',invoice:'INV-2',qty:1,gross:'1',net:'0.95'}
  ]};
 }};
 const req={productCode:'CU_CATHODE',user:{language_code:'zh-CN',permissions:['report:read','inventory:export']}};
 const report=await Report.report(client,req,{kind:'shipping',from:'2026-11-01',to:'2026-11-26'});
 assert.deepEqual(report.detail.rows.map(row=>[row.plan,row.invoice]),[['PLAN-1','INV-1'],['PLAN-2','INV-2']]);
 assert.deepEqual(report.detail.rows.map(row=>row.pending_fields),[{},{}]);
 const workbook=new (require('exceljs').Workbook)();
 await workbook.xlsx.load(await Report.workbook(report,req));
 const detail=workbook.getWorksheet('明细');
 const field=(row,label)=>{
  const col=detail.getRow(6).values.indexOf(label);
  assert(col>0,label);
  return detail.getCell(row,col).value;
 };
 for(const [label,val] of [['商业发票号','INV-1'],['许可证号','LIC-01'],['司机姓名','Driver'],['护照号','00123'],
  ['车牌号','CORRECTED-PLATE'],['挂车1号','TR-1'],['挂车2号','N/A'],['运输商','Carrier'],['目的地','Depot'],
  ['销售计划号','PLAN-1'],['销售发运月','2026-10'],['装箱单号','CU-PL']])assert.equal(field(7,label),val);
 assert.equal(field(7,'装车日期').toISOString().slice(0,10),'2026-11-05');
});

test('cobalt uses recorded outbound transport and actual confirmation dates, without substituting a planned date',async t=>{
 const ids=['b6162dff-22ec-4691-8f07-efc8ca8ba3ac','5a763c03-1baa-4b87-b07e-be03f0bf5539'];
 t.mock.method(Cobalt,'build',async()=>({outbound:ids.map((id,i)=>({order_id:id,order_no:'CO-'+i,posted_at:'2026-11-05',
  document_no:'CO-PL-'+i,actual_gross_kg:'1500',actual_net_kg:'1400',bags:2,arecoms_mt:'0.13'}))}));
 t.mock.method(History,'reportShipments',async()=>[]);
 const client={async query(sql,params){
  if(sql.includes('clock_timestamp'))return {rows:[{d:'2026-11-27'}]};
  assert.deepEqual(params,[ids]);
  assert.match(sql,/WHERE l.id=ANY/);
  return {rows:ids.map((id,i)=>({id,confirmed_invoice:'INV-'+i,snapshot:{
   order:{transport_snapshot:{truck_no:'ARRIVAL',driver_name:'Arrival Driver',passport_no:'09876',trailer_two:'N/A'}},
   departure:{transport_snapshot:{truck_no:'DEPARTURE'}},
   execution:{confirmed_at:i===0?'2026-11-02T23:45:00Z':null},
   plan:{planned_load_date:'2026-10-19',export_license_no:'LIC',destination:'Depot',transporter:'Transport'},
   sales_plan:{code:'CO-SALES',shipment_month:'2026-10'}
  }}))};
 }};
 const req={productCode:'CO_HYDROXIDE',user:{language_code:'en',permissions:['report:read']}};
 const report=await Report.report(client,req,{kind:'shipping',from:'2026-11-01',to:'2026-11-26'});
 const [first,second]=report.detail.rows;
 assert.equal(first.vehicle,'DEPARTURE');
 assert.equal(first.trailerTwo,'N/A');
 assert.equal(first.passport,'09876');
 assert.equal(first.month,'2026-10');
 assert.equal(first.loadDate,'2026-11-03');
 assert.equal(second.loadDate,null);
 assert.equal(second.pending_fields.loadDate,'ONLINE_SOURCE_MISSING');
 assert.equal(second.metal,'0.13');
});
