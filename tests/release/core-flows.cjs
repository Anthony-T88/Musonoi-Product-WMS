'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs');
test('native cobalt match independence, cancellation, rematch, formal outbound and reports',async t=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;const checks=[];
 const check=(name,fn)=>t.test(name,async()=>{try{await fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL'});throw e;}});
 try{
 await c.query("INSERT INTO role_permissions SELECT 'logistics_field_operator',unnest(ARRAY['loading-plan:match','load:write','load:execute']) ON CONFLICT DO NOTHING");app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};let ip=1;
 for(const a of f.accounts){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.93.0.'+(ip++),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200);sessions[a.role]={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};}
 const request=(url,role='admin',body)=>app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':'CO_HYDROXIDE','idempotency-key':crypto.randomUUID()},...(body?{payload:body}:{})});
 const api=async(url,role,body,expected=200)=>{const r=await request(url,role,body);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,250));return r.json();};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),salt=crypto.randomBytes(4).toString('hex'),customer=f.customers.CO_HYDROXIDE;
 let sales,prep,plan,matched,review,preview;
 await check('two independent sales approvals and a dispatch arrival feed the loading plan',async()=>{
  sales=await api('/cobalt/sales/plans','sales_operator',{project_id:f.project,warehouse_id:f.warehouse,customer_id:customer.id,contract_id:customer.contract,target_weight:'100',shipment_month:today.slice(0,7),planned_vehicle_count:2,destination:'Synthetic destination',status:'OPEN',remark:'Synthetic rc2 flow'});
  for(const role of ['sales_manager','commerce_manager']){const d=await api('/cobalt/sales-workflow/plans/'+sales.id,role);await api('/cobalt/sales-workflow/plans/'+sales.id+'/review',role,{version:d.approval_version,decision:'APPROVED'});}sales=await api('/cobalt/sales-workflow/plans/'+sales.id);
  const vehicle=await api('/cobalt/sales/plans/'+sales.id+'/dispatch/vehicles','logistics_manager',{plan_version:sales.version,shipment_month:today.slice(0,7),truck_no:'RC2-'+salt,capacity_tonnes:'30',trailer_no:'RC2-TRAILER',driver_name:'Synthetic Driver',passport_no:'Synthetic Passport',transporter:'Synthetic Transport'});
  f.rc2arrival=await api('/cobalt/sales/arrivals/'+vehicle.id,'logistics_field_operator',{dispatch_version:vehicle.version,arrived_at:new Date(Date.now()-1000).toISOString(),trailer_one:'RC2-TRAILER',trailer_two:'',driver_name:'Synthetic Driver',passport_no:'Synthetic Passport',transporter:'Synthetic Transport',container_no:'',exception_remark:'Synthetic arrival'});
 });
 await check('native preparation preserves exact ARECOMS precision and final receipt independence',async()=>{
  prep=await api('/cobalt/preparations','logistics_field_operator',{project_id:f.project,warehouse_id:f.warehouse,total_bags:1});const base='/cobalt/preparations/'+prep.id;
  await api(base+'/submit','logistics_field_operator',{version:prep.version});let w=await api(base+'/work','logistics_field_operator');
  await api(base+'/work/save','logistics_field_operator',{batch_version:w.work.version,arecoms_quantity_mt:'1.23456789',bags:w.bags.map(b=>({bag_id:b.bag_id,version:b.version,actual_gross_kg:'650.123',seal_no:'RC2-SEAL-'+salt,sampled:true}))});w=await api(base+'/work');
  const zone=(await c.query('SELECT zone_id FROM co_locations WHERE id=$1',[f.location])).rows[0].zone_id;await c.query("SELECT set_config('musonoi.co_location_reason','Synthetic rc2 location',false)");const loc=(await c.query('INSERT INTO co_locations(zone_id,project_id,warehouse_id,code,x,y,width,height,updated_by) VALUES($1,$2,$3,$4,300,100,100,100,$5) RETURNING *',[zone,f.project,f.warehouse,'RC2-'+salt,f.accounts.find(a=>a.role==='admin').id])).rows[0];
  const place={preparation_id:prep.id,batch_version:w.work.version,selection:'ALL',target_location_id:loc.id,target_version:loc.version,source:'PREPARATION'},pv=await api('/cobalt/stock/place-preview','site_supervisor',place);await api('/cobalt/stock/place','site_supervisor',{...place,preview_hash:pv.preview_hash});await api(base+'/work/submit','logistics_field_operator',{batch_version:w.work.version});w=await api(base+'/work');await api(base+'/work/approve','site_supervisor',{batch_version:w.work.version});let p=await api(base);await api(base+'/production-approve','production_manager',{version:p.version});
  const raw=(await c.query('SELECT arecoms_quantity_mt::text v FROM co_work_batches WHERE preparation_id=$1',[prep.id])).rows[0].v;assert.equal(raw,'1.23456789');assert.equal((await api('/cobalt/stock/batches/'+prep.id)).batch.arecoms_display_mt,'1.2346');
  const s=await api('/cobalt/stock/summary');assert.equal(s.completed_arecoms_mt,'1.23456789');assert.equal(s.confirmed_arecoms_batches,1);assert(s.unconfirmed_arecoms_batches>=1);
  const report=await api('/cobalt/reports');assert.equal(report.inventorySummary.confirmed_arecoms_mt,'1.23456789');assert(report.inventorySummary.arecoms_unconfirmed_batches>=1);
  const exported=await request('/cobalt/stock/export');assert.equal(exported.statusCode,200);const book=new(require('exceljs').Workbook)();await book.xlsx.load(exported.rawPayload);const text=JSON.stringify(book.worksheets[0].getSheetValues());assert(text.includes('1.2346'));assert(text.includes('1.23456789'));
 });
 await check('matching requires current versions and a complete independent preparation',async()=>{
  const options=await api('/cobalt/loading/options?sales_plan_id='+sales.id),a=options.arrivals.find(a=>a.id===f.rc2arrival.id);assert(a);
  preview=await api('/cobalt/loading/preview?sales_plan_id='+sales.id+'&preparation_id='+prep.id+'&arrival_id='+a.id);
  plan=await api('/cobalt/loading/plans','logistics_manager',{sales_plan_id:sales.id,preparation_id:prep.id,arrival_id:a.id,planned_load_date:today,destination:'Synthetic destination',invoice_no:'RC2-INV-'+salt,export_license_no:'RC2-LICENSE',remark:'Synthetic rc2 matching',...preview.versions});
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
  await act('start','logistics_field_operator');await act('confirm','logistics_field_operator',{confirmation:'ALL_BAGS'});await act('approve','site_supervisor');await act('depart','logistics_field_operator',{actual_departure:true,departed_at:new Date().toISOString()});await act('submit-outbound','logistics_field_operator');await act('logistics-approve','logistics_manager');
  assert.equal((await c.query("SELECT count(*)::int n FROM co_inventory WHERE preparation_id=$1 AND status<>'OUTBOUND'",[prep.id])).rows[0].n,1);await act('production-approve','production_manager');assert.equal((await api(base)).execution.state,'OUTBOUND');assert.equal((await c.query("SELECT count(*)::int n FROM co_inventory WHERE preparation_id=$1 AND status<>'OUTBOUND'",[prep.id])).rows[0].n,0);
  await assert.rejects(()=>c.query("UPDATE co_loading_reviews SET reason='tamper' WHERE id=$1",[review.id]));
 });
 }finally{await app?.close();await c.end();E.save('rc2-core-results.json',{checks,status:checks.every(x=>x.status==='PASS')?'PASS':'FAIL',syntheticOnly:true});}
});
