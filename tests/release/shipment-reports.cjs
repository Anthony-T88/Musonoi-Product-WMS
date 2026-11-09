'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{Client}=require('pg'),E=require('./environment.cjs');
test('cobalt shipment reconciliation through report API, workbook and page presentation',async t=>{
 const f=E.fixture(),c=new Client(E.options(f.database)),app=require('fastify')(),checks=[];
 await c.connect();
 const check=(name,fn)=>t.test(name,async()=>{try{await fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL'});throw e;}});
 try{
 // Session-local synthetic report projections: no changes to tables, accounts or grants.
 for(const table of ['co_sales_plans','co_customer_profiles','co_sales_contracts','co_inventory','co_preparations','co_loading_orders','co_load_executions','co_outbounds','co_dispatch_vehicles','co_metal_outbound'])await c.query('CREATE TEMP TABLE '+table+' AS SELECT * FROM public.'+table+' WITH NO DATA');
 for(const [table,key] of [['co_preparations','id'],['co_loading_orders','id'],['co_load_executions','order_id']])await c.query('ALTER TABLE '+table+' ADD PRIMARY KEY('+key+')');
 const [a,b,ac,ac2,bc,p1,p2,p3,p4]=Array.from({length:9},()=>crypto.randomUUID());
 for(const [id,name] of [[a,'Customer A'],[b,'Customer B']])await c.query('INSERT INTO co_customer_profiles(id,name) VALUES($1,$2)',[id,name]);
 for(const [id,customer,code] of [[ac,a,'A1'],[ac2,a,'A2'],[bc,b,'B1']])await c.query('INSERT INTO co_sales_contracts(id,project_id,customer_id,contract_no) VALUES($1,$2,$3,$4)',[id,f.project,customer,code]);
 for(const [id,customer,contract,code] of [[p1,a,ac,'PLAN-1'],[p2,a,ac2,'PLAN-2'],[p3,b,bc,'PLAN-3'],[p4,a,ac,'PLAN-4']])await c.query("INSERT INTO co_sales_plans(id,project_id,warehouse_id,customer_id,contract_id,code,shipment_month,target_weight,planned_vehicle_count,status) VALUES($1,$2,$3,$4,$5,$6,'2025-01',100,4,'OPEN')",[id,f.project,f.warehouse,customer,contract,code]);
 let unknownBatch;
 for(const [i,plan,customer,contract,month,metal] of [[1,p1,'Customer A','A1','01','0.123456789123456789'],[2,p1,'Customer A','A1','01','0.200000000000000002'],[3,p2,'Customer A','A2','01',null],[4,p2,'Customer A','A2','01',''],[5,p3,'Customer B','B1','01','0.000000000'],[6,p1,'Customer A','A1','02','1.000000000000000001'],[7,p1,'Customer A','A1','02',null]]){
  const [order,prep,ob]=Array.from({length:3},()=>crypto.randomUUID());
  if(i===3)unknownBatch=prep;
  await c.query('INSERT INTO co_preparations(id,preparation_batch_no,project_id,warehouse_id) VALUES($1,$2,$3,$4)',[prep,'SYN-BATCH-'+i,f.project,f.warehouse]);
  await c.query("INSERT INTO co_loading_orders(id,preparation_id,sales_plan_id,product_code,status,code,actual_gross_kg,actual_net_kg,bag_count) VALUES($1,$2,$3,'CO_HYDROXIDE','OUTBOUND',$4,650,647,1)",[order,prep,plan,'SYN-LOAD-'+i]);
  await c.query("INSERT INTO co_load_executions(order_id,state) VALUES($1,'OUTBOUND')",[order]);
  const snapshot=JSON.stringify({customer:{name:customer},contract:{contract_no:contract},order:{transport_snapshot:{truck_no:'SYN-TRUCK-'+i},bag_count:1,actual_gross_kg:'650',actual_net_kg:'647',arecoms_input:metal},plan:{packing_list_no:'SYN-PACK-'+i}});
  await c.query('INSERT INTO co_outbounds(id,order_id,code,posted_at,snapshot) VALUES($1,$2,$3,$4,$5)',[ob,order,'SYN-OUT-'+i,'2025-'+month+'-15T10:00:00Z',i===2?snapshot.replace(JSON.stringify(metal),metal):snapshot]);
  const confirmed={1:'0.12346',2:'0.20000',6:'1.00000'}[i]||null;
  await c.query("INSERT INTO co_metal_outbound(outbound_id,order_id,preparation_id,posted_at,net_kg,estimated_metal_mt,confirmed_metal_mt,confirmed_at,shipment_status,legacy_metal_mt) VALUES($1,$2,$3,$4,647,0.23292,$5::numeric,CASE WHEN $5::numeric IS NOT NULL THEN '2025-03-05T10:00:00Z'::timestamptz END,$6,$7)",[ob,order,prep,'2025-'+month+'-15T10:00:00Z',confirmed,confirmed?'COMPLETED':'PENDING_ARECOMS',metal]);
 }
 await require('../../server/cobalt-reports.cjs').register({app,pool:{connect:async()=>({query:c.query.bind(c),release(){}})},permitted:()=>async req=>{req.user={id:f.accounts.find(a=>a.role==='admin').id,language_code:'en',permissions:['report:read','inventory:export']};},csrf:async()=>{}});
 const base='/api/v1/cobalt/reports',jan='0.32346',cumulative='1.32346';
 const get=async filters=>{const r=await app.inject(base+'?'+new URLSearchParams(filters));assert.equal(r.statusCode,200,r.body);return r.json();};
 const stats=(row,value,unknown,known)=>{assert.equal(row.arecoms_mt,value);assert.equal(row.arecoms_unconfirmed_vehicles,unknown);assert.equal(row.arecoms_confirmed_vehicles,known);};
 await check('two confirmed vehicles sum exactly, while prior raw values remain unchanged',async()=>{
  const d=await get({month:'2025-01',contract_id:ac});assert.equal(d.outbound.length,2);stats(d.shippingSummary,jan,0,2);
  assert.deepEqual(d.outbound.map(r=>r.arecoms_mt),['0.12346','0.20000']);
  assert.deepEqual((await c.query("SELECT legacy_metal_mt FROM co_metal_outbound WHERE confirmed_metal_mt IS NOT NULL ORDER BY legacy_metal_mt")).rows.map(r=>r.legacy_metal_mt),['0.123456789123456789','0.200000000000000002','1.000000000000000001']);
 });
 await check('all unknown (including blank) stays NULL in shipping and execution',async()=>{
  assert.equal((await get({month:'2025-01',preparation_id:unknownBatch})).execution[0].arecoms_mt,null);
  const d=await get({month:'2025-01',contract_id:ac2});stats(d.shippingSummary,null,2,0);stats(d.execution[0],null,2,0);assert.deepEqual(d.outbound.map(r=>r.arecoms_mt),[null,null]);
 });
 await check('mixed customer, contract and month groups reconcile without filling unknowns',async()=>{
  const d=await get({month:'2025-01',customer_id:a});assert.equal(d.outbound.length,4);stats(d.shippingSummary,jan,2,2);stats(d.customers[0],jan,2,2);stats(d.trend[0],jan,2,2);
  stats(d.contracts.find(r=>r.contract_no==='A1'),jan,0,2);stats(d.contracts.find(r=>r.contract_no==='A2'),null,2,0);
 });
 await check('a historical zero is pending and an empty plan has no pending vehicle',async()=>{
  const d=await get({month:'2025-01',customer_id:b});stats(d.shippingSummary,null,1,0);stats(d.execution[0],null,1,0);
  const e=await get({month:'2025-01',sales_plan_id:p4});stats(e.shippingSummary,null,0,0);stats(e.execution[0],null,0,0);
 });
 await check('sales plan filters compose with customer, contract and date; execution stays cumulative',async()=>{
  const d=await get({month:'2025-01',sales_plan_id:p1,customer_id:a,contract_id:ac});stats(d.shippingSummary,jan,0,2);assert.equal(d.execution.length,1);stats(d.execution[0],cumulative,1,3);assert.equal(d.execution[0].outbound_vehicles,4);
  const e=await get({month:'2025-02',sales_plan_id:p1});stats(e.shippingSummary,'1.00000',1,1);assert.deepEqual(e.execution,[]);
  assert.equal((await app.inject(base+'?sales_plan_id='+crypto.randomUUID())).statusCode,403);
 });
 await check('confirmation entered in March is attributed to the formal outbound month',async()=>{
  const d=await require('../../server/cobalt-metal.cjs').summary(c,{user:{id:f.accounts.find(a=>a.role==='admin').id}}, {},{from:'2025-01-15',to:'2025-03-05'});
  assert.deepEqual(d.months.map(r=>[r.period,r.confirmed_mt,r.pending]),[['2025-01','0.32346',3],['2025-02','1.00000',1]]);
 });
 await check('signed Excel export agrees with confirmed and pending API totals',async()=>{
  const sheetRow=(sheet,row)=>sheet.getRow(row).values.slice(2),cell=(ws,r,header)=>{const col=sheetRow(ws,6).indexOf(header);assert(col>=0,header);return ws.getCell(r,col+2);};
  for(const [filters,exact,unknown,known] of [[{month:'2025-01',customer_id:a},jan,2,2],[{month:'2025-01',contract_id:ac2},null,2,0],[{month:'2025-01',customer_id:b},null,1,0]]){
   const d=await get(filters);const r=await app.inject({method:'POST',url:base+'/export',payload:{filters:d.filters,signature:d.signature}});assert.equal(r.statusCode,200);assert.equal(r.headers['x-report-signature'],d.signature);
   const book=new(require('exceljs').Workbook)();await book.xlsx.load(r.rawPayload);const summary=book.getWorksheet('Shipping Summary'),metrics=new Map();for(let i=7;i<=summary.rowCount;i++){const [name,display,raw]=sheetRow(summary,i);metrics.set(name,{display:display??null,raw:raw??null});}
   const label='Confirmed ARECOMS Subtotal (MT)',display=exact==null?null:Number(exact);assert.deepEqual(metrics.get(label),{display,raw:exact});assert.equal(metrics.get('Unconfirmed Metal Vehicles').display,unknown);assert.equal(metrics.get('Confirmed Metal Vehicles').display,known);
   const execution=book.getWorksheet('Sales Execution'),detail=book.getWorksheet('Shipping Details');
   d.execution.forEach((row,i)=>{assert.equal(cell(execution,i+7,'Exact source: '+label).value,row.arecoms_mt);assert.equal(cell(execution,i+7,'Unconfirmed Metal Vehicles').value,row.arecoms_unconfirmed_vehicles);});
   d.outbound.forEach((row,i)=>assert.equal(cell(detail,i+7,'Exact source: Confirmed ARECOMS Metal MT').value,row.arecoms_mt));
  }
 });
 await check('active report page distinguishes subtotal, unknown and confirmed zero',async()=>{
  const context={window:{},I18n:{language:'en',translate:x=>x},ManagementLabels:{columns:{}},CobaltReportsUI:{labels:{}},esc:String,Tonnes:require('../../dist/tonnes.js')};
  vm.runInNewContext(fs.readFileSync(path.join(E.root,'dist/reports463.js'),'utf8'),context);const ui=context.window.Reports463,d=await get({month:'2025-01',customer_id:a});ui.current={kind:'co',view:'shipping',data:d};assert.match(ui.metrics(),/Confirmed ARECOMS Subtotal/);assert.match(ui.metrics(),/0\.32346/);assert.match(ui.metrics(),/Unconfirmed Metal Vehicles/);
  ui.current.view='execution';assert(ui.dataset().columns.includes('arecoms_unconfirmed_vehicles'));assert.match(ui.cell({arecoms_mt:'0'},'arecoms_mt'),/0\.00000/);assert.equal(ui.cell({arecoms_mt:null},'arecoms_mt'),'Unknown');
 });
 }finally{await app.close();await c.end();E.save('rc2-shipment-results.json',{syntheticOnly:true,status:checks.length===8&&checks.every(x=>x.status==='PASS')?'PASS':'FAIL',checks});}
});
