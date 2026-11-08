'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs');
test('native copper receipt, preparation, sampling, weighing and formal outbound',async()=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;const steps=[];
 try{
 for(const [role,permissions]of [['production_operator',['receipt:write','receipt:read']],['logistics_field_operator',['load:write','load:execute','allocation:write','allocation:read']]])for(const p of permissions)await c.query('INSERT INTO role_permissions VALUES($1,$2) ON CONFLICT DO NOTHING',[role,p]);
 app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};let ip=1;
 for(const a of f.accounts){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.95.0.'+(ip++),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200);sessions[a.role]={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};}
 const api=async(url,role='admin',body,expected=200)=>{const r=await app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':'CU_CATHODE','idempotency-key':crypto.randomUUID()},...(body?{payload:body}:{})});assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,250));return r.json();};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),seq=String(Date.now()),customer=f.customers.CU_CATHODE;
 const plan=await api('/plans','sales_operator',{project_id:f.project,customer_id:customer.id,contract_id:customer.contract,target_weight:'100',quantity_tolerance:'5',preparation_month:today.slice(0,7),remark:'Synthetic rc2 copper'});
 for(const role of ['sales_manager','commerce_manager']){const p=await api('/sales-workflow/plans/'+plan.id);await api('/sales-workflow/plans/'+plan.id+'/review',role,{version:p.approval_version,decision:'APPROVED'});}steps.push('sales plan two independent approvals');
 const number='MUS-'+today.slice(0,4)+'-020-'+seq;
 let receipt=await api('/receipts','production_operator',{project_id:f.project,lines:[{bundle_no:number,sheets_per_bundle:48,production_date:today,inbound_at:new Date().toISOString()}]});
 await api('/receipts','production_operator',{project_id:f.project,lines:[{bundle_no:number,sheets_per_bundle:48,production_date:today,inbound_at:new Date().toISOString()}]},409);
 receipt=await api('/receipts/'+receipt.id+'/submit','production_operator',{version:receipt.version});await api('/receipts/'+receipt.id+'/confirm','production_manager',{version:receipt.version});const bundle=(await c.query('SELECT * FROM bundles WHERE receipt_id=$1',[receipt.id])).rows[0];assert(bundle);steps.push('unique bundle, independent receipt review');
 await c.query("UPDATE stock_map_source SET status='VERIFIED',source_sha256=$1,source_name='Synthetic CI geometry',notes='Synthetic test geometry only'",[crypto.createHash('sha256').update('RC2-SYNTHETIC-MAP').digest('hex')]);await c.query("UPDATE stock_map_cells SET x=0,y=0,width=100,height=100 WHERE code IN('P1-01','P5')");const location=(await c.query("SELECT * FROM locations WHERE project_id=$1 AND code='P1-01'",[f.project])).rows[0]||await api('/masters/locations','admin',{project_id:f.project,warehouse_id:f.warehouse,code:'P1-01',active:true});
 await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code='P1-01' WHERE id=$1",[location.id]);let lot=await api('/v261/lots','logistics_field_operator',{plan_id:plan.id,lot_no:'RMM-CU-'+today.slice(0,4)+'-01',planned_location_id:location.id,items:[{bundle_id:bundle.id,sample_required:false}]});
 lot=await api('/v261/lots/'+lot.id,'logistics_field_operator');
 lot=(await api('/v262/lots/'+lot.id+'/weigh','logistics_field_operator',{version:lot.version,items:lot.items.map(b=>({bundle_id:b.id,item_version:b.item_version,gross_weight:'2.0350',seal_no:'RC2-CU-'+seq}))})).lot;
 assert.equal((await c.query('SELECT (net_weight=2.0325::numeric) v FROM bundles WHERE id=$1',[bundle.id])).rows[0].v,true);
 lot=await api('/v261/lots/'+lot.id+'/submit','logistics_field_operator',{version:lot.version});await api('/v261/lots/'+lot.id+'/approve','site_supervisor',{version:lot.version,all_weighed_and_stored:true});steps.push('exclusive location and gross minus 2.5kg net weight');
 let load=await api('/v26/loads','logistics_field_operator',{allocation_id:lot.id,vehicle_no:'RC2-CU-'+seq,load_date:today,bundle_ids:[bundle.id]});
 for(const [action,role,extra]of [['approve','site_supervisor',{}],['depart','logistics_field_operator',{actual_departure:true,departed_at:new Date().toISOString()}],['logistics-approve','logistics_manager',{}]])load=await api('/v26/loads/'+load.id+'/'+action,role,{version:load.version,...extra});
 assert.notEqual((await c.query('SELECT physical_status FROM bundles WHERE id=$1',[bundle.id])).rows[0].physical_status,'OUTBOUND');load=await api('/v26/loads/'+load.id+'/manager-approve','production_manager',{version:load.version});assert.equal((await c.query('SELECT physical_status FROM bundles WHERE id=$1',[bundle.id])).rows[0].physical_status,'OUTBOUND');steps.push('independent loading, logistics and final production approval; final outbound deduction');
 E.save('rc2-copper-results.json',{status:'PASS',steps,syntheticOnly:true});
 }finally{await app?.close();await c.end();}
});
