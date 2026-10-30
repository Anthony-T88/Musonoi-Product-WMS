'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{randomUUID}=require('crypto'),{Client}=require('pg');
const {ownerConfig,migrate}=require('../scripts/db.cjs'),{config}=require('../server/config.cjs');
const source='musonoi_v26_development_test',database=process.argv[3],checks=[],logs=[];
if(!/^musonoi_receipt_repair_\d+_test$/.test(database||''))throw Error('Supply restored isolated receipt repair database');
const backup=process.argv[2];if(!backup||!fs.existsSync(backup))throw Error('Supply existing project-local backup');
const cfg=config(),credentials=JSON.parse(fs.readFileSync(JSON.parse(fs.readFileSync('test-output/fixed-account-reset.json')).credentialFile)).accounts;
let c,app;const sessions={};
async function req(url,who,body,key=randomUUID()){const s=sessions[who];return app.inject({method:body===undefined?'GET':'POST',url:'/api/v1'+url,headers:{origin:'http://127.0.0.1:4176',...(s?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),'idempotency-key':key},...(body===undefined?{}:{payload:body})});}
async function pass(url,who,body,key){const r=await req(url,who,body,key);assert.equal(r.statusCode,200,url+' '+r.body);return r.json();}
const ok=(v,label)=>{assert(v,label);checks.push(label);};
(async()=>{
 c=new Client(ownerConfig(database));await c.connect();const url=new URL(cfg.databaseUrl);url.pathname='/'+database;
 app=await require('../server/app.cjs').build({config:{...cfg,databaseUrl:url.href,origin:'http://127.0.0.1:4176'},errorReporter:r=>logs.push(r)});
 for(const u of credentials){const r=await pass('/auth/login',null,{username:u.username,password:u.password});const login=await req('/auth/login',null,{username:u.username,password:u.password});assert.equal(login.statusCode,200);sessions[u.username]={cookie:login.headers['set-cookie'].split(';')[0],csrf:login.json().csrfToken};ok(!!r.csrfToken,'login '+u.username);}
 const original=(await c.query("select * from receipts where status='PENDING' and submitted_by is null order by created_at limit 1")).rows[0];assert(original,'snapshot must contain reported historical receipt');
 const before=await c.query('select count(*) from bundles');const key=randomUUID();let response=await req('/receipts/'+original.id+'/confirm','production_dept',{version:original.version},key);
 ok(response.statusCode===500&&logs.at(-1).code==='23502','reproduces actual receipt NULL violation as internal error');
 ok(response.json().errorId===logs.at(-1).errorId&&!JSON.stringify(logs).includes(credentials[0].password),'correlated sanitized error report');
 ok((await c.query('select count(*) from bundles')).rows[0].count===before.rows[0].count,'failed confirmation fully rolls back stock');
 await migrate(database);
 const r=await pass('/receipts/'+original.id+'/confirm','production_dept',{version:original.version},key);
 ok(r.status==='CONFIRMED'&&r.self_review_exception===false&&r.submitted_by===null,'actual legacy receipt approves without inventing submitter');
 await pass('/receipts/'+original.id+'/confirm','production_dept',{version:original.version},key);
 ok((await c.query('select count(*) from bundles where receipt_id=$1',[r.id])).rows[0].count===(await c.query('select count(*) from receipt_lines where receipt_id=$1',[r.id])).rows[0].count,'retry posts exactly once');
 const audit=(await c.query("select after_data from audit_logs where entity_id=$1 and action='receipt_confirmed' order by id desc limit 1",[r.id])).rows[0];ok(audit?.after_data.self_review_exception===false,'confirmation audit records boolean false');
 for(const who of ['logistics_manager','site_supervisor','logistics_operator'])for(const action of ['submit','confirm','reject']){const denied=await req('/receipts/'+r.id+'/'+action,who,{version:r.version,reason:'denied'});ok(denied.statusCode===403,who+' denied '+action);}
 const now=new Date();let draft=await pass('/receipts','production_dept',{project_id:original.project_id,lines:[{bundle_no:'MUS-2026-999-987654321',production_date:now.toISOString().slice(0,10),inbound_at:now.toISOString()}]});
 // Model a pre-051 submission via its legal DRAFT -> PENDING transition.
 draft=(await c.query("update receipts set status='PENDING',submitted_at=now(),version=version+1 where id=$1 returning *",[draft.id])).rows[0];
 draft=await pass('/receipts/'+draft.id+'/reject','admin',{version:draft.version,reason:'legacy submitter regression'});ok(draft.status==='REJECTED'&&draft.self_review_exception===false&&draft.submitted_by===null,'independent legacy rejection records false without NULL violation');
 const errors=require('../server/service-errors.cjs');ok(errors.status({code:'ECONNREFUSED'})===503&&errors.status({code:'23502'})===500,'connection outage distinct from SQL defect');
 const report={status:'PASS',database,source,backup:path.basename(backup),checks:checks.length,details:checks};fs.writeFileSync('test-output/receipt-null-submitter.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(app)await app.close();if(c)await c.end();});
