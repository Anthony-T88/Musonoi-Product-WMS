'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client,Pool}=require('pg'),E=require('./environment.cjs');
test('second batch isolated reliability acceptance',async t=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;
 const checks=[],check=(name,fn)=>t.test(name,async()=>{try{await fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL'});throw e;}});
 try{
 app=await require('../../server/app.cjs').build({config:{...f.appCfg,trustedProxyIps:'127.90.0.1'}});
 const admin=f.accounts.find(x=>x.role==='admin');
 const login=(remoteAddress,forwarded,password=admin.password)=>app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress,headers:{origin:f.appCfg.origin,...(forwarded?{'x-forwarded-for':forwarded}:{})},payload:{username:admin.username,password}});
 const r=await login('127.90.1.1');assert.equal(r.statusCode,200);const session={origin:f.appCfg.origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken,'x-product-code':'CO_HYDROXIDE'};
 const api=(url,body)=>app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...session,'idempotency-key':crypto.randomUUID()},...(body?{payload:body}:{})});
 await check('unknown ARECOMS remains NULL on stock and map summary',async()=>{
  for(const path of ['/cobalt/stock/summary','/cobalt/stock/map']){const r=await api(path);assert.equal(r.statusCode,200);const s=r.json().summary||r.json();assert.equal(s.completed_arecoms_mt,null);assert(s.unconfirmed_arecoms_batches>=1);assert.equal(s.confirmed_arecoms_batches,0);}
 });
 await check('legacy confirmed zero and empty ARECOMS projections remain distinct without changing stored business values',async()=>{
  await c.query('BEGIN');try{
   await c.query('CREATE TEMP TABLE co_work_batches AS SELECT * FROM public.co_work_batches');
   await c.query("UPDATE co_work_batches SET arecoms_quantity_mt=0,reviewed_at=now(),amendment_status='NONE' WHERE preparation_id=$1",[f.preparation]);
   const S=require('../../server/cobalt-stock.cjs'),req={query:{preparation_id:f.preparation},user:{id:admin.id},url:'/api/v1/cobalt/stock/summary'},filter=await S.filter(c,req);let s=await S.summary(c,filter);assert.equal(Number(s.completed_arecoms_mt),0);assert.equal(s.completed_arecoms_display_mt,'0.00000');assert.equal(s.confirmed_arecoms_batches,1);assert.equal(s.unconfirmed_arecoms_batches,0);
   await c.query('UPDATE co_work_batches SET arecoms_quantity_mt=NULL WHERE preparation_id=$1',[f.preparation]);s=await S.summary(c,filter);assert.equal(s.completed_arecoms_mt,null);assert.equal(s.unconfirmed_arecoms_batches,1);
   await c.query('CREATE TEMP TABLE co_inventory AS SELECT * FROM public.co_inventory');await c.query("UPDATE co_inventory SET status='OUTBOUND'");s=await S.summary(c,filter);assert.equal(s.completed_arecoms_mt,null);assert.equal(s.confirmed_arecoms_batches,0);assert.equal(s.unconfirmed_arecoms_batches,0);
  }finally{await c.query('ROLLBACK');}
 });
 await check('real cobalt stocktake audit resolves authoritative project and warehouse',async()=>{
  const r=await api('/cobalt/stocktaking',{project_id:f.project,warehouse_id:f.warehouse,title:'Synthetic rc2 scope proof'});assert.equal(r.statusCode,200,r.body);
  const row=(await c.query("SELECT scope_context FROM audit_logs WHERE entity_type='co_stocktakes' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[r.json().id])).rows[0];assert(row?.scope_context);assert(row.scope_context.scopes.some(x=>x.project_id===f.project&&x.warehouse_id===f.warehouse));
  const auditId=(await c.query("SELECT id FROM audit_logs WHERE entity_type='co_stocktakes' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[r.json().id])).rows[0].id;
  const other=(await c.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,$2,'Synthetic audit denial warehouse') RETURNING id",[f.project,'AUD-'+crypto.randomBytes(4).toString('hex').toUpperCase()])).rows[0].id;
  const role='custom_'+crypto.randomBytes(8).toString('hex');await c.query('INSERT INTO roles(code,name,name_en,built_in,created_by) VALUES($1,$1,$1,false,$2)',[role,admin.id]);await c.query("INSERT INTO role_permissions VALUES($1,'audit:read')",[role]);
  for(const [warehouse,customer,want]of [[f.warehouse,null,200],[other,null,404],[f.warehouse,f.customers.CO_HYDROXIDE.id,404]]){
   const password=crypto.randomBytes(20).toString('base64url'),username='audit_scope_'+crypto.randomBytes(4).toString('hex'),id=(await c.query('INSERT INTO users(username,display_name,password_hash,role_code) VALUES($1,$1,$2,$3) RETURNING id',[username,require('../../server/security.cjs').hashPassword(password),role])).rows[0].id;await c.query('INSERT INTO user_scopes(user_id,project_id,warehouse_id,customer_id) VALUES($1,$2,$3,$4)',[id,f.project,warehouse,customer]);
   const l=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.96.'+Math.floor(Math.random()*200)+'.1',headers:{origin:f.appCfg.origin},payload:{username,password}});assert.equal(l.statusCode,200);const h={cookie:l.cookies.map(x=>x.name+'='+x.value).join('; ')};assert.equal((await app.inject({method:'GET',url:'/api/v1/v27/audit/'+auditId,headers:h})).statusCode,want);const legacy=await app.inject({method:'GET',url:'/api/v1/audit',headers:h});assert.equal(legacy.json().items.some(x=>x.id===auditId),want===200);
  }
 });
 await check('trusted nginx separates twenty concurrent staff client addresses',async()=>{
  const responses=await Promise.all(Array.from({length:20},(_,i)=>login('127.90.0.1','192.0.2.'+(i+1))));assert.deepEqual(responses.map(r=>r.statusCode),Array(20).fill(200));
 });
 await check('untrusted forwarding spoof cannot bypass login limit',async()=>{
  const statuses=[];for(let i=0;i<11;i++)statuses.push((await login('127.91.0.1','198.51.100.'+(i+1),'incorrect synthetic password')).statusCode);assert.deepEqual(statuses,[...Array(10).fill(401),429]);
 });
 await check('trusted proxy rejects chains rather than accepting forged forwarding hops',async()=>{assert.equal((await login('127.90.0.1','192.0.2.1, 198.51.100.2')).statusCode,400);});
 }finally{await app?.close();await c.end();E.save('rc2-reliability-results.json',{checks,status:checks.every(x=>x.status==='PASS')?'PASS':'FAIL',checkedAt:new Date().toISOString(),syntheticOnly:true});}
});
