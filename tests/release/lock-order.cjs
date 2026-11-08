'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client,Pool}=require('pg'),E=require('./environment.cjs'),Lease=require('../../server/authorization-lease.cjs');
test('queued management cannot strand cobalt and gate work behind its own authorization lease',async t=>{
 const f=E.fixture(),owner=new Client(E.options(f.database));await owner.connect();const config=require('../../server/database-connection.cjs').connection(f.appCfg),auth=new Pool({...config,max:1}),work=new Pool({...config,max:1,options:config.options+' -c lock_timeout=500ms'}),results=[];
 try{
 for(const [name,module]of [['intake','cobalt.cjs'],['sales','cobalt-sales.cjs'],['stock','cobalt-stock.cjs'],['gate','gate-permits.cjs']])await t.test(name,async()=>{
  const req={method:'POST',url:'/api/v1/cobalt/rc2-lock-'+name,headers:{'idempotency-key':crypto.randomUUID()},body:{},productCode:'CO_HYDROXIDE',raw:{},user:{id:f.accounts.find(a=>a.role==='admin').id}};let exclusive;
  await Lease.acquire(req,auth);await owner.query('BEGIN');exclusive=owner.query('SELECT pg_advisory_xact_lock(21002)');
  try{await new Promise(r=>setTimeout(r,60));const fn=require('../../server/'+module)[name==='intake'||name==='sales'?'mutation':'mutate'],result=await (name==='intake'?fn(work,req,'co:read',null,async()=>({id:f.preparation})):fn(work,req,'co:read',async()=>({id:f.preparation})));assert.equal(result.id,f.preparation);results.push({name,status:'PASS'});}
  finally{await Lease.release(req);await exclusive;await owner.query('ROLLBACK');}
 });
 }finally{await owner.query('ROLLBACK').catch(()=>{});await auth.end();await work.end();await owner.end();E.save('rc2-lock-order-results.json',{status:results.length===4?'PASS':'FAIL',checks:results,syntheticOnly:true});}
});
