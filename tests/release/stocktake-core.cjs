'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs');
async function authorizedApi(app,f){
 const sessions={};let ip=1;
 for(const a of f.accounts){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.97.0.'+(ip++),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200);sessions[a.role]={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};}
 return async(url,role,body,co=false,expected=200)=>{const r=await app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':co?'CO_HYDROXIDE':'CU_CATHODE','idempotency-key':crypto.randomUUID()},...(body?{payload:body}:{})});assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,300));return r.json();};
}
test('native copper and cobalt stocktake submissions, authorized self review and retained histories',async()=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;const states=[];
 try{
 app=await require('../../server/app.cjs').build({config:f.appCfg});
 const api=await authorizedApi(app,f);
 const wh=(await c.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,$2,'Synthetic empty count warehouse') RETURNING id",[f.project,'CNT-'+crypto.randomBytes(4).toString('hex').toUpperCase()])).rows[0].id;
 const created=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const [co,kind,period] of [[false,'SEMIANNUAL','2026-07'],[true,'ANNUAL','2026-01']]){
  const role=co?'logistics_field_operator':'admin',list=co?'/cobalt/stocktaking':'/v27/stocktakes';
  const body={project_id:f.project,warehouse_id:wh,task_type:kind,period_month:period,...(co?{title:'Synthetic period verification'}:{cutoff_at:new Date().toISOString(),remark:'Synthetic period verification'})};
  const task=await api(co?list:'/v33/stocktakes',role,body,co);
  const matched=await api(list+'?'+new URLSearchParams({task_type:kind,period,created_date:created}),role,null,co);
  const row=matched.items.find(item=>item.id===task.id);
  assert.equal(row?.period_month,period);assert(row.baseline_at);
  assert(matched.periods.some(value=>value.task_type===kind&&value.period_month===period));
  const miss=await api(list+'?'+new URLSearchParams({task_type:kind,period,created_date:'2000-01-01'}),role,null,co);
  assert(!miss.items.some(item=>item.id===task.id));
 }
 const count=await api('/v27/stocktakes','admin',{project_id:f.project,warehouse_id:wh,assigned_to:f.accounts.find(a=>a.role==='admin').id,task_type:'SPECIAL',cutoff_at:new Date(Date.now()+60000).toISOString(),remark:'Synthetic isolated empty count'});
 for(const[action,role]of [['start','admin'],['submit-review','admin'],['review','admin'],['approve','admin'],['complete','admin']]){const d=await api('/v27/stocktakes/'+count.id,'admin'),task=d.task||d.document||d;if(action==='complete'&&task.phase==='COMPLETED')continue;await api('/v27/stocktakes/'+count.id+'/'+action,role,{version:task.version,note:'Synthetic '+action});states.push('Cu '+action);}
 for(const decision of ['reject','approve']){
  const p=await api('/cobalt/stocktaking','admin',{project_id:f.project,warehouse_id:f.warehouse,title:'Synthetic rc2 '+decision},true),base='/cobalt/stocktaking/'+p.id;
  const rows=(await c.query('SELECT snapshot FROM co_stocktake_rounds WHERE task_id=$1 ORDER BY round DESC LIMIT 1',[p.id])).rows[0].snapshot;
  for(let i=0;i<rows.length;i+=200){const d=await api(base,'admin',null,true);await api(base+'/observe','admin',{version:(d.task||d).version,items:rows.slice(i,i+200).map(r=>({bag_id:r.bag_id||r.id,present:true,actual_location_id:r.location_id||r.expected_location_id||null,actual_gross_kg:null,note:'Synthetic observed'}))},true);}
  let d=await api(base,'admin',null,true);await api(base+'/submit','admin',{version:(d.task||d).version,note:'Synthetic submit'},true);d=await api(base,'admin',null,true);await api(base+'/'+decision,'admin',{version:(d.task||d).version,note:'Synthetic self review '+decision},true);d=await api(base,'admin',null,true);assert.equal(d._approval.workflows[0].state,decision==='approve'?'APPROVED':'REJECTED');assert(d._approval.history.items.every(x=>x.role_basis!=='CURRENT_ACCOUNT'));states.push('Co '+decision);
 }
 E.save('rc2-stocktake-results.json',{status:'PASS',states,syntheticOnly:true});
 }finally{await app?.close();await c.end();}
});

test('administrator records the required copper recount, approves it and archives the resolved difference',async()=>{
 const {client:c,name}=await E.database();let app;
 try{
  await require('../../scripts/production-db.cjs').migrate(c,{apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD,environment:'test'});
  const f=await E.seed(c,name),created=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  app=await require('../../server/app.cjs').build({config:f.appCfg});
  const api=await authorizedApi(app,f);
  const bundle=E.receiptBundle(created,'99303');
  const receipt=await api('/receipts','production_operator',{project_id:f.project,lines:[{...bundle,sheets_per_bundle:48,inbound_at:new Date().toISOString()}]});
  const pending=await api('/receipts/'+receipt.id+'/submit','production_operator',{version:receipt.version});
  await api('/receipts/'+receipt.id+'/confirm','production_manager',{version:pending.version});
  const {rows:[location]}=await c.query('SELECT b.location_id,l.warehouse_id FROM bundles b JOIN locations l ON l.id=b.location_id WHERE b.receipt_id=$1',[receipt.id]);
  const scoped=await api('/v33/stocktakes','admin',{project_id:f.project,warehouse_id:location.warehouse_id,
   location_id:location.location_id,task_type:'SPECIAL',cutoff_at:new Date().toISOString(),remark:'Synthetic admin recount'});
  const fresh='/v33/stocktakes/'+scoped.id,doc='/v27/stocktakes/'+scoped.id;
  const action=async(path,note,expected=200)=>api(path,'admin',{version:(await api(doc,'admin')).version,note},false,expected);
  const snapshot=(await api(fresh+'/snapshot','admin')).items;
  assert(snapshot.some(row=>row.state.bundle_no===bundle.bundle_no));
  const observations=snapshot.map(({state})=>({bundle_no:state.bundle_no,present:true,actual_location_id:state.location_id,
   actual_state:state.bundle_no===bundle.bundle_no?'RESERVED':'UNKNOWN',remark:'Synthetic physical observation'}));
  await action(doc+'/start','Start the count');
  await api(doc+'/observations','admin',{version:(await api(doc,'admin')).version,entries:observations});
  await action(doc+'/submit-review','Submit the first pass');
  await action(doc+'/review','A required second pass cannot be skipped',409);
  const recounted=await action(fresh+'/recount','Start the required second pass');
  assert.equal(recounted.current_pass,2);
  await api(doc+'/observations','admin',{version:recounted.version,entries:observations.filter(row=>row.bundle_no===bundle.bundle_no)});
  await action(doc+'/submit-review','Submit completed recount');
  await action(doc+'/review','Review completed recount');
  const approved=await action(doc+'/approve','Approve completed recount');
  assert.equal(approved.phase,'ADJUSTMENTS');
  const report=await api(doc,'admin');
  assert.equal(report.independent_reviewer,false);
  assert.equal(report.can_resolve_as_reviewer,true);
  assert.equal(report.report.rows.find(row=>row.bundle_no===bundle.bundle_no).finding,'STATUS');
  await api(doc+'/resolve','admin',{version:report.version,bundle_no:bundle.bundle_no,method:'VERIFIED',
   reason:'Rechecked the related workflow and physical state'});
  assert.equal((await action(doc+'/complete','Archive verified count')).phase,'COMPLETED');
 }finally{await app?.close();await c.end();}
});
