'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs');
test('native cobalt match independence, cancellation, rematch, formal outbound and reports',async t=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;const checks=[];
 const check=(name,fn)=>t.test(name,async()=>{try{await fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL'});throw e;}});
 try{
 await c.query("INSERT INTO role_permissions SELECT 'logistics_field_operator',unnest(ARRAY['loading-plan:match','load:write','load:execute']) ON CONFLICT DO NOTHING");app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};let ip=1;
 for(const a of f.accounts){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.93.0.'+(ip++),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200);sessions[a.role]={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};}
 const request=(url,role='admin',body,key=crypto.randomUUID())=>app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':'CO_HYDROXIDE','idempotency-key':key},...(body?{payload:body}:{})});
 const api=async(url,role,body,expected=200)=>{const r=await request(url,role,body);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,250));return r.json();};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),salt=crypto.randomBytes(4).toString('hex'),customer=f.customers.CO_HYDROXIDE;
 let sales,prep,plan,matched,review,preview,licensePath;
 await check('two independent sales approvals and a dispatch arrival feed the loading plan',async()=>{
  sales=await api('/cobalt/sales/plans','sales_operator',{project_id:f.project,customer_id:customer.id,contract_id:customer.contract,target_weight:'100',shipment_month:today.slice(0,7),planned_vehicle_count:2,status:'OPEN',remark:'Synthetic rc2 flow'});
  assert.equal(sales.warehouse_id,f.warehouse);
  assert.equal(sales.destination,'');
  for(const role of ['sales_manager','commerce_manager']){const d=await api('/cobalt/sales-workflow/plans/'+sales.id,role);await api('/cobalt/sales-workflow/plans/'+sales.id+'/review',role,{version:d.approval_version,decision:'APPROVED'});}sales=await api('/cobalt/sales-workflow/plans/'+sales.id);
  const vehiclePath='/cobalt/sales/plans/'+sales.id+'/dispatch/vehicles';
  await api(vehiclePath,'logistics_manager',{plan_version:sales.version,shipment_month:'2000-01',truck_no:'MISMATCH-'+salt},409);
  const vehicle=await api(vehiclePath,'logistics_manager',{plan_version:sales.version,truck_no:'RC2-'+salt,capacity_tonnes:'30',trailer_no:'RC2-TRAILER',driver_name:'Synthetic Driver',passport_no:'Synthetic Passport',transporter:'Synthetic Transport'});
  assert.equal(vehicle.shipment_month,sales.shipment_month);
  f.rc2arrival=await api('/cobalt/sales/arrivals/'+vehicle.id,'logistics_field_operator',{dispatch_version:vehicle.version,arrived_at:new Date(Date.now()-1000).toISOString(),trailer_one:'RC2-TRAILER',trailer_two:'',driver_name:'Synthetic Driver',passport_no:'Synthetic Passport',transporter:'Synthetic Transport',container_no:'',exception_remark:'Synthetic arrival'});
 });
 await check('native preparation preserves exact ARECOMS precision and final receipt independence',async()=>{
  prep=await api('/cobalt/preparations','logistics_field_operator',{project_id:f.project,warehouse_id:f.warehouse,total_bags:1});const base='/cobalt/preparations/'+prep.id;
  await api(base+'/submit','logistics_field_operator',{version:prep.version});let w=await api(base+'/work','logistics_field_operator');
  await api(base+'/work/save','logistics_field_operator',{batch_version:w.work.version,arecoms_quantity_mt:'1.23456789',bags:w.bags.map(b=>({bag_id:b.bag_id,version:b.version,actual_gross_kg:'650.123',seal_no:'RC2-SEAL-'+salt,sampled:true}))});w=await api(base+'/work');
  const zone=(await c.query('SELECT zone_id FROM co_locations WHERE id=$1',[f.location])).rows[0].zone_id;await c.query("SELECT set_config('musonoi.co_location_reason','Synthetic rc2 location',false)");const loc=(await c.query('INSERT INTO co_locations(zone_id,project_id,warehouse_id,code,x,y,width,height,updated_by) VALUES($1,$2,$3,$4,300,100,100,100,$5) RETURNING *',[zone,f.project,f.warehouse,'RC2-'+salt,f.accounts.find(a=>a.role==='admin').id])).rows[0];
  const place={preparation_id:prep.id,batch_version:w.work.version,selection:'ALL',target_location_id:loc.id,target_version:loc.version,source:'PREPARATION'},pv=await api('/cobalt/stock/place-preview','site_supervisor',place);await api('/cobalt/stock/place','site_supervisor',{...place,preview_hash:pv.preview_hash});await api(base+'/work/submit','logistics_field_operator',{batch_version:w.work.version});w=await api(base+'/work');await api(base+'/work/approve','site_supervisor',{batch_version:w.work.version});let p=await api(base);await api(base+'/production-approve','production_manager',{version:p.version});
  const raw=(await c.query('SELECT arecoms_quantity_mt::text v FROM co_work_batches WHERE preparation_id=$1',[prep.id])).rows[0].v;assert.equal(raw,'1.23456789');assert.equal((await api('/cobalt/stock/batches/'+prep.id)).batch.arecoms_display_mt,'1.23457');
  const s=await api('/cobalt/stock/summary');assert.equal(s.completed_arecoms_mt,'1.23456789');assert.equal(s.confirmed_arecoms_batches,1);assert(s.unconfirmed_arecoms_batches>=1);
  const report=await api('/cobalt/reports');assert.equal(report.inventorySummary.confirmed_arecoms_mt,'1.23456789');assert(report.inventorySummary.arecoms_unconfirmed_batches>=1);
  const exported=await request('/cobalt/stock/export');assert.equal(exported.statusCode,200);const book=new(require('exceljs').Workbook)();await book.xlsx.load(exported.rawPayload);const text=JSON.stringify(book.worksheets[0].getSheetValues());assert(text.includes('1.23457'));assert(text.includes('1.23456789'));
 });
 await check('matching requires current versions and a complete independent preparation',async()=>{
  const options=await api('/cobalt/loading/options?sales_plan_id='+sales.id),a=options.arrivals.find(a=>a.id===f.rc2arrival.id);assert(a);
  preview=await api('/cobalt/loading/preview?sales_plan_id='+sales.id+'&preparation_id='+prep.id+'&arrival_id='+a.id);
  const permit=await api('/cobalt/export-permits','sales_operator',{contract_id:customer.contract,applied_on:today,proforma_no:'RMM-CO-'+salt,quantity:'30',unit_basis:'COBALT_MT',unit:'Co MT',currency:'USD'});
  const path=licensePath='/cobalt/export-permits/'+permit.id,issue=await api(path+'/actions','sales_operator',{action:'ISSUE',payload:{license_no:'RC2-LICENSE',valid_from:today,valid_until:'2099-12-31'},version:permit.version,reason:'Synthetic cobalt licence'});
  await api(path+'/actions/'+issue.id,'sales_manager',{decision:'APPROVED',note:'Synthetic independent cobalt review'});
  plan=await api('/cobalt/loading/plans','logistics_manager',{sales_plan_id:sales.id,preparation_id:prep.id,arrival_id:a.id,planned_load_date:today,destination:'Synthetic destination',license_id:permit.id,remark:'Synthetic rc2 matching',...preview.versions});
  assert.equal(plan.invoice_no,permit.proforma_no+'-01');
  assert.equal(plan.packing_list_no,plan.invoice_no+'-PL');
  assert.equal(Number((await api(path)).reserved),0.23296428);
  assert.equal(Number((await api(path)).used),0);
  const registered=await api('/cobalt/sales/arrivals?sales_plan_id='+sales.id+'&arrival_state=PLANNED');
  assert.equal(registered.items[0].loading_plan_id,plan.id);assert.equal(registered.state_counts.PLANNED,1);
  await api('/cobalt/sales/arrivals/'+a.dispatch_vehicle_id,'logistics_field_operator',{
   dispatch_version:a.dispatch_version||a.vehicle_version||1,version:a.version,arrived_at:new Date().toISOString(),
   trailer_one:'RC2-TRAILER',driver_name:'Synthetic Driver',passport_no:'Synthetic Passport',transporter:'Synthetic Transport'
  },409);
  await api('/cobalt/loading/plans','logistics_manager',{sales_plan_id:sales.id,preparation_id:prep.id,arrival_id:a.id,
   planned_load_date:today,destination:'Synthetic destination',invoice_no:'DUPLICATE-'+salt,export_license_no:'RC2-LICENSE',remark:'',...preview.versions},409);
  const match=async()=>{const d=await api('/cobalt/loading/plans/'+plan.id),p=await api('/cobalt/loading/preview?plan_id='+plan.id+'&sales_plan_id='+sales.id+'&preparation_id='+prep.id+'&arrival_id='+a.id);await api('/cobalt/loading/plans/'+plan.id+'/match','logistics_field_operator',{version:d.plan.version,preview_hash:p.preview_hash});return api('/cobalt/loading/plans/'+plan.id);};
  f.rc2match=match;matched=await match();review=await api('/cobalt/loading/orders/'+matched.order.id+'/requests','logistics_field_operator',{version:matched.order.version,kind:'CANCEL_MATCH',reason:'Synthetic cancellation proof'});
 });
 await check('administrator with raw historical grant is denied; supervisor needs permission and correct version',async()=>{
  const body={version:review.version,order_version:matched.order.version,note:'Synthetic review'};
  await api('/cobalt/loading/reviews/'+review.id+'/approve','admin',body,403);
  await api('/cobalt/loading/reviews/'+review.id+'/approve','site_supervisor',{...body,version:review.version+1},409);
  const id=f.accounts.find(a=>a.role==='site_supervisor').id;await c.query("DELETE FROM role_permissions WHERE role_code='site_supervisor' AND permission_code='co:loading-review'");
  assert.equal((await request('/cobalt/loading/reviews/'+review.id+'/approve','site_supervisor',body)).statusCode,401);
  await c.query("INSERT INTO role_permissions VALUES('site_supervisor','co:loading-review')");const a=f.accounts.find(a=>a.id===id),r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.94.0.1',headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});sessions.site_supervisor={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};
  await api('/cobalt/loading/reviews/'+review.id+'/approve','site_supervisor',body);assert.equal((await api('/cobalt/loading/plans/'+plan.id)).plan.status,'DRAFT');matched=await f.rc2match();
  await c.query('BEGIN');try{
   await c.query("INSERT INTO role_permissions VALUES('site_supervisor','loading-plan:match') ON CONFLICT DO NOTHING");
   const self=(await c.query("INSERT INTO co_loading_reviews(order_id,kind,expected_order_version,reason,requested_by) VALUES($1,'CANCEL_MATCH',$2,'Synthetic self review denial',$3) RETURNING id",[matched.order.id,matched.order.version,id])).rows[0];
   await assert.rejects(()=>c.query("UPDATE co_loading_reviews SET status='APPROVED',version=version+1,reviewed_by=$2,reviewed_at=now(),review_note='Synthetic self review' WHERE id=$1",[self.id,id]),e=>e.code==='23514'&&e.message.includes('CO_LOADING_INDEPENDENT_SUPERVISOR_REQUIRED'));
  }finally{await c.query('ROLLBACK');}
 });
 await check('formal outbound alone deducts inventory after independent load, logistics and production approvals',async()=>{
  const base='/cobalt/execution/orders/'+matched.order.id,act=async(action,role,extra={})=>{const d=await api(base);await api(base+'/'+action,role,{...(action==='start'?{order_version:d.order.version}:{version:d.execution.version}),note:'Synthetic rc2 '+action,...extra});};
  await api('/cobalt/packing/orders/'+matched.order.id,'admin',undefined,409);
  await act('start','logistics_field_operator');await act('confirm','logistics_field_operator',{confirmation:'ALL_BAGS'});await act('approve','site_supervisor');await act('depart','logistics_field_operator',{actual_departure:true,departed_at:new Date().toISOString()});await act('submit-outbound','logistics_field_operator');await act('logistics-approve','logistics_manager');
  assert.equal((await c.query("SELECT count(*)::int n FROM co_inventory WHERE preparation_id=$1 AND status<>'OUTBOUND'",[prep.id])).rows[0].n,1);const d=await api(base),key=crypto.randomUUID(),body={version:d.execution.version,note:'Synthetic rc3 final approval'};
  const approvals=await Promise.all([request(base+'/production-approve','production_manager',body,key),request(base+'/production-approve','production_manager',body,key)]);
  assert.equal(approvals[0].statusCode,200,approvals[0].body);
  assert.equal(approvals[1].statusCode,200,approvals[1].body);
  assert.deepEqual(approvals[0].json(),approvals[1].json());
  assert.equal((await c.query('SELECT count(*)::int n FROM co_outbounds WHERE order_id=$1',[matched.order.id])).rows[0].n,1);
  assert.equal((await api(base)).execution.state,'OUTBOUND');assert.equal((await c.query("SELECT count(*)::int n FROM co_inventory WHERE preparation_id=$1 AND status<>'OUTBOUND'",[prep.id])).rows[0].n,0);
  await assert.rejects(()=>c.query("UPDATE co_loading_reviews SET reason='tamper' WHERE id=$1",[review.id]));
 });
 await check('sales confirmation alone adds posted cobalt net weight to fulfilment',async()=>{
  const path='/cobalt/sales-workflow/plans/'+sales.id,detail=await api(path);
  const batch=detail.posted_batches.find(row=>row.loading_id===matched.order.id);
  assert.equal(batch.batch_id,prep.id);assert.equal(batch.confirmed_at,null);
  assert.equal(Number(detail.control.invoiced_net_weight),0);
  assert((await api('/cobalt/stock?stock_state=OUTBOUND&phase=OUTBOUND')).items.some(row=>row.preparation_id===prep.id));
  assert((await api('/cobalt/export-licenses?search=RC2-LICENSE')).items.some(row=>row.id===plan.id));
  const body={loading_id:matched.order.id,batch_id:prep.id,invoice_no:batch.source_invoice_no||'SYNTHETIC-CO-INVOICE'};
  await api(path+'/confirm-invoice','logistics_field_operator',body,403);
  await api(path+'/confirm-invoice','sales_operator',{...body,batch_id:crypto.randomUUID()},404);
  await api(path+'/confirm-invoice','sales_operator',body);
  await api(path+'/confirm-invoice','sales_operator',body);
  const updated=await api(path);
  assert.equal(Number(updated.control.invoiced_net_weight),0.647123);
  assert.equal(updated.posted_batches[0].invoice_no,body.invoice_no);
  const report=await api('/cobalt/reports?sales_plan_id='+sales.id);
  assert.equal(Number(report.execution[0].invoiced_net_kg),647.123);
  assert.equal((await api('/cobalt/metal/outbounds/'+matched.order.id)).shipment_status,'PENDING_ARECOMS');
 });
 await check('estimated cobalt and independent ARECOMS confirmation remain separate from physical posting',async()=>{
  const base='/cobalt/metal/outbounds/'+matched.order.id,initial=await api(base);
  assert.equal(initial.shipment_status,'PENDING_ARECOMS');assert.equal(initial.legacy_metal_mt,'1.23456789');
  assert.equal(initial.estimated_metal_mt,'0.23296428');assert.equal(initial.estimated_mt,'0.23296');
  assert.equal(initial.net_mt,'0.6471');assert.equal(initial.confirmed_mt,null);assert.equal(initial.difference_mt,null);
  const precision=(await c.query(`SELECT round(co_estimated_metal_mt(30000),5)::text thirty,
   round(co_estimated_metal_mt(647),5)::text one,round(co_estimated_metal_mt(647.011*2),5)::text combined,
   (round(co_estimated_metal_mt(647.011),5)*2)::text rounded_per_bag,
   round(10.92345-co_estimated_metal_mt(30000),5)::text difference`)).rows[0];
  assert.deepEqual(precision,{thirty:'10.80000',one:'0.23292',combined:'0.46585',rounded_per_bag:'0.46584',difference:'0.12345'});
  const pending='/cobalt/metal?view=outbound&status=PENDING_ARECOMS';
  assert((await api(pending)).items.some(r=>r.order_id===matched.order.id));
  await api(base,'customer_admin',undefined,404);
  assert.equal((await app.inject({url:'/api/v1'+base,headers:{...sessions.admin,'x-product-code':'CU_CATHODE'}})).statusCode,409);
  const proposal={version:0,amount_mt:'0.35641',reason:'Independent synthetic assay'};
  await api(base+'/submit','site_supervisor',proposal,403);
  await api(base+'/submit','logistics_manager',{...proposal,amount_mt:'0.00000'},400);
  await api(base+'/submit','logistics_manager',{...proposal,amount_mt:'0.123456'},400);
  const key=crypto.randomUUID(),submissions=await Promise.all([request(base+'/submit','logistics_manager',proposal,key),request(base+'/submit','logistics_manager',proposal,key)]);
  assert(submissions.every(r=>r.statusCode===200),submissions.map(r=>r.body).join(' '));
  assert.deepEqual(submissions[0].json(),submissions[1].json());
  assert.equal((await api(base)).shipment_status,'PENDING_ARECOMS');
  const decision={version:1,reason:'Verified ARECOMS against original'};
  const decisions=await Promise.all([request(base+'/confirm','production_manager',decision),request(base+'/confirm','production_manager',decision)]);
  assert.deepEqual(decisions.map(r=>r.statusCode).sort(),[200,409]);
  const complete=await api(base);assert.equal(complete.shipment_status,'COMPLETED');assert.equal(complete.confirmed_mt,'0.35641');
  const quota=await api(licensePath);
  assert.equal(Number(quota.pending),0.35641);
  assert.equal(Number(quota.used),0);
  const allocation=quota.allocations.find(x=>x.plan_id===plan.id);
  const reconcile=await api(licensePath+'/actions','sales_operator',{action:'SETTLE',version:quota.version,reason:'Synthetic verified customs declaration',payload:{allocation_id:allocation.id,quantity:'0.34019',reference:'Synthetic customs reference'}});
  const decisionBody={decision:'APPROVED',note:'Independent verification of synthetic declaration'};
  const receipts=await Promise.all([request(licensePath+'/actions/'+reconcile.id,'sales_manager',decisionBody),request(licensePath+'/actions/'+reconcile.id,'sales_manager',decisionBody)]);
  assert.deepEqual(receipts.map(x=>x.statusCode).sort(),[200,409]);
  const settled=await api(licensePath);
  assert.equal(Number(settled.used),0.34019);
  assert.equal(Number(settled.pending),0);
  assert.equal((await api(base)).confirmed_mt,'0.35641');
  assert.equal(complete.difference_mt,'0.12345');assert.equal(complete.history.length,2);assert(complete.confirmed_by&&complete.confirmed_at);
  assert(!(await api(pending)).items.some(r=>r.order_id===matched.order.id));
  const period=await api('/cobalt/overview?from='+today+'&to='+today);
  assert.equal(period.metal.months.at(-1).confirmed_mt,'0.35641');
  assert.equal(period.metal.months.at(-1).pending,0);
  await api(base+'/submit','admin',{version:2,amount_mt:'0.40000',reason:'Synthetic revision'});
  await api(base+'/confirm','admin',{version:3,reason:'Self review is prohibited'},403);
  assert.equal((await api(base)).confirmed_mt,'0.35641');
  await api(base+'/reject','production_manager',{version:3,reason:'Original confirmation is correct'});
  assert.equal((await api(base)).confirmed_mt,'0.35641');
  const workbook=new(require('exceljs').Workbook)(),exported=await request('/cobalt/metal/export?view=outbound&search='+matched.order.code);
  assert.equal(exported.statusCode,200,exported.body.slice(0,250));await workbook.xlsx.load(exported.rawPayload);
  const sheet=workbook.worksheets[0];assert.equal(sheet.getCell('H2').numFmt,'0.0000');
  assert.equal(sheet.getCell('J2').numFmt,'0.00000');assert.equal(sheet.getCell('J2').value,0.35641);
  assert.equal(sheet.getCell('K2').value,0.12345);assert.equal(sheet.getCell('N2').value,'0.35641');
  assert.equal((await c.query("SELECT count(*)::int n FROM co_inventory WHERE preparation_id=$1 AND status<>'OUTBOUND'",[prep.id])).rows[0].n,0);
  await assert.rejects(()=>c.query("UPDATE co_metal_events SET reason='tamper' WHERE outbound_id=$1",[initial.outbound_id]),/CO_RECORD_IMMUTABLE/);
 });
 await check('archived Packing List reconciles bag, seal and physical weight with the final outbound report',async()=>{
  const base='/cobalt/packing/orders/'+matched.order.id;
  const details=await api(base);
  const generated=await api(base+'/generate','admin',{expected_revision:0,source_signature:details.source_signature,reason:'Synthetic rc3 integration evidence'});
  const downloaded=await request(base+'/file');assert.equal(downloaded.statusCode,200);
  assert.equal(crypto.createHash('sha256').update(downloaded.rawPayload).digest('hex'),generated.file_sha256);
  assert.equal(downloaded.headers['x-content-sha256'],generated.file_sha256);
  const book=new(require('exceljs').Workbook)();await book.xlsx.load(downloaded.rawPayload);
  const sheet=book.worksheets[0],bag=(await api('/cobalt/stock/batches/'+prep.id)).items[0];
  assert.equal(sheet.getCell('C30').value,bag.bag_no);
  assert.equal(sheet.getCell('E30').value,'RC2-SEAL-'+salt);
  assert.equal(sheet.getCell('F30').value,647.123);
  assert.equal(sheet.getCell('G30').value,650.123);
  const report=await api('/cobalt/reports');
  assert.equal(report.shippingSummary.arecoms_mt,'0.35641');
  const outbound=report.outbound.find(item=>item.document_no===generated.document_no);
  assert(outbound);assert.equal(Number(outbound.actual_net_kg),647.123);
  const exported=await request('/cobalt/reports/export','admin',{filters:report.filters,signature:report.signature});
  assert.equal(exported.statusCode,200,exported.body.slice(0,200));
  const reportsBook=new(require('exceljs').Workbook)();await reportsBook.xlsx.load(exported.rawPayload);
  assert(JSON.stringify(reportsBook.worksheets.map(ws=>ws.getSheetValues())).includes('0.35641'));
 });
 await check('formal outbound with no prior ARECOMS value still posts once and remains in the confirmation queue',async()=>{
  const role='logistics_field_operator',manager='logistics_manager';
  const p=await api('/cobalt/preparations',role,{project_id:f.project,warehouse_id:f.warehouse,total_bags:1});
  const receipt='/cobalt/preparations/'+p.id,work=receipt+'/work';
  await api(receipt+'/submit',role,{version:p.version});
  let w=await api(work,role),bag=w.bags[0];
  await api(work+'/save',role,{batch_version:w.work.version,bags:[{bag_id:bag.bag_id,version:bag.version,actual_gross_kg:'650',seal_no:'NO-ASSAY-'+salt,sampled:true}]});
  w=await api(work,role);
  assert.equal(w.metal.measured_estimated_mt,'0.23292');
  const loc=(await c.query('SELECT id,version FROM co_locations WHERE code=$1',['RC2-'+salt])).rows[0];
  const place={preparation_id:p.id,batch_version:w.work.version,selection:'ALL',target_location_id:loc.id,target_version:loc.version,source:'PREPARATION'};
  const position=await api('/cobalt/stock/place-preview','site_supervisor',place);
  await api('/cobalt/stock/place','site_supervisor',{...place,preview_hash:position.preview_hash});
  await api(work+'/submit',role,{batch_version:w.work.version});w=await api(work,role);
  await api(work+'/approve','site_supervisor',{batch_version:w.work.version});
  await api(receipt+'/production-approve','production_manager',{version:(await api(receipt)).version});
  const inStock=await api('/cobalt/metal?preparation_id='+p.id);
  assert.equal(inStock.items[0].bags,1);assert.equal(inStock.items[0].net_mt,'0.6470');assert.equal(inStock.items[0].estimated_mt,'0.23292');
  assert.equal((await api(receipt)).metal.inventory.estimated_mt,'0.23292');
  const vehicle=await api('/cobalt/sales/plans/'+sales.id+'/dispatch/vehicles',manager,{
   plan_version:(await api('/cobalt/sales-workflow/plans/'+sales.id)).version,shipment_month:today.slice(0,7),truck_no:'NO-ASSAY-'+salt,
   capacity_tonnes:'30',trailer_no:'NEW-TRAILER',driver_name:'Second Driver',passport_no:'Second Passport',transporter:'Second Carrier'});
  const arrival=await api('/cobalt/sales/arrivals/'+vehicle.id,role,{
   dispatch_version:vehicle.version,arrived_at:new Date(Date.now()-1000).toISOString(),trailer_one:'NEW-TRAILER',trailer_two:'',
   driver_name:'Second Driver',passport_no:'Second Passport',transporter:'Second Carrier',container_no:'',exception_remark:''});
  const args=new URLSearchParams({sales_plan_id:sales.id,preparation_id:p.id,arrival_id:arrival.id}),pv=await api('/cobalt/loading/preview?'+args);
  const lp=await api('/cobalt/loading/plans',manager,{...Object.fromEntries(args),planned_load_date:today,destination:'Synthetic destination',
   invoice_no:'NO-ASSAY-'+salt,export_license_no:'RC2-LICENSE',remark:'',...pv.versions});
  const match=await api('/cobalt/loading/preview?'+new URLSearchParams({...Object.fromEntries(args),plan_id:lp.id}));
  await api('/cobalt/loading/plans/'+lp.id+'/match',role,{version:lp.version,preview_hash:match.preview_hash});
  const order=(await api('/cobalt/loading/plans/'+lp.id)).order,execution='/cobalt/execution/orders/'+order.id;
  const advance=async(action,actor,extra={})=>{
   const data=await api(execution);
   return api(execution+'/'+action,actor,{...(action==='start'?{order_version:data.order.version}:{version:data.execution.version}),note:'No assay fixture',...extra});
  };
  assert.equal((await api(execution)).shipment_status,'PENDING_OUTBOUND');
  assert.equal((await api('/cobalt/metal?preparation_id='+p.id)).items[0].bags,1);
  await advance('start',role);await advance('confirm',role,{confirmation:'ALL_BAGS'});await advance('approve','site_supervisor');
  await advance('depart',role,{actual_departure:true,departed_at:new Date().toISOString()});
  await advance('submit-outbound',role);await advance('logistics-approve',manager);await advance('production-approve','production_manager');
  const metal=await api('/cobalt/metal/outbounds/'+order.id);
  assert.equal(metal.legacy_metal_mt,null);assert.equal(metal.confirmed_mt,null);assert.equal(metal.shipment_status,'PENDING_ARECOMS');
  assert.equal((await api('/cobalt/metal?preparation_id='+p.id)).items.length,0);
  assert((await api('/cobalt/metal?view=outbound&status=PENDING_ARECOMS')).items.some(r=>r.order_id===order.id));
 });
 }finally{await app?.close();await c.end();E.save('rc2-core-results.json',{checks,status:checks.every(x=>x.status==='PASS')?'PASS':'FAIL',syntheticOnly:true});}
});
