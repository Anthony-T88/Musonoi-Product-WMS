'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs');
test('native copper and cobalt stocktake submissions, independent review and retained histories',async()=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;const states=[];
 try{
 app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};let ip=1;
 for(const a of f.accounts){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.97.0.'+(ip++),headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});assert.equal(r.statusCode,200);sessions[a.role]={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};}
 const api=async(url,role,body,co=false)=>{const r=await app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':co?'CO_HYDROXIDE':'CU_CATHODE','idempotency-key':crypto.randomUUID()},...(body?{payload:body}:{})});assert.equal(r.statusCode,200,url+' '+r.body.slice(0,300));return r.json();};
 const wh=(await c.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,$2,'Synthetic empty count warehouse') RETURNING id",[f.project,'CNT-'+crypto.randomBytes(4).toString('hex').toUpperCase()])).rows[0].id;
 const count=await api('/v27/stocktakes','admin',{project_id:f.project,warehouse_id:wh,assigned_to:f.accounts.find(a=>a.role==='admin').id,task_type:'SPECIAL',cutoff_at:new Date(Date.now()+60000).toISOString(),remark:'Synthetic isolated empty count'});
 for(const[action,role]of [['start','admin'],['submit-review','admin'],['review','logistics_manager'],['approve','logistics_manager'],['complete','logistics_manager']]){const d=await api('/v27/stocktakes/'+count.id,'admin'),task=d.task||d.document||d;if(action==='complete'&&task.phase==='COMPLETED')continue;await api('/v27/stocktakes/'+count.id+'/'+action,role,{version:task.version,note:'Synthetic '+action});states.push('Cu '+action);}
 for(const decision of ['reject','approve']){
  const p=await api('/cobalt/stocktaking','logistics_field_operator',{project_id:f.project,warehouse_id:f.warehouse,title:'Synthetic rc2 '+decision},true),base='/cobalt/stocktaking/'+p.id;
  const rows=(await c.query('SELECT snapshot FROM co_stocktake_rounds WHERE task_id=$1 ORDER BY round DESC LIMIT 1',[p.id])).rows[0].snapshot;
  for(let i=0;i<rows.length;i+=200){const d=await api(base,'admin',null,true);await api(base+'/observe','logistics_field_operator',{version:(d.task||d).version,items:rows.slice(i,i+200).map(r=>({bag_id:r.bag_id||r.id,present:true,actual_location_id:r.location_id||r.expected_location_id||null,actual_gross_kg:null,note:'Synthetic observed'}))},true);}
  let d=await api(base,'admin',null,true);await api(base+'/submit','logistics_field_operator',{version:(d.task||d).version,note:'Synthetic submit'},true);d=await api(base,'admin',null,true);await api(base+'/'+decision,'logistics_manager',{version:(d.task||d).version,note:'Synthetic independent '+decision},true);d=await api(base,'admin',null,true);assert.equal(d._approval.workflows[0].state,decision==='approve'?'APPROVED':'REJECTED');assert(d._approval.history.items.every(x=>x.role_basis!=='CURRENT_ACCOUNT'));states.push('Co '+decision);
 }
 E.save('rc2-stocktake-results.json',{status:'PASS',states,syntheticOnly:true});
 }finally{await app?.close();await c.end();}
});
