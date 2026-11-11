'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const E=require('./environment.cjs'),{build}=require('../../server/app.cjs');

test('single active session, shared tab CSRF, restart and registration field errors',async()=>{
 const {name,client:owner}=await E.database();
 let app;
 try{
  await require('../../scripts/production-db.cjs').migrate(owner,{environment:'test',apply:true,backupVerified:true,appPassword:process.env.WMS_TEST_APP_PASSWORD});
  const f=await E.seed(owner,name),origin=f.appCfg.origin,admin=f.accounts.find(a=>a.role==='admin'),other=f.accounts.find(a=>a.role==='sales_operator');
  app=await build({config:f.appCfg});
  const login=async(a,ip)=>{
   const r=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.82.3.'+ip,headers:{origin},payload:{username:a.username,password:a.password}});
   assert.equal(r.statusCode,200,r.body);
   assert.equal(r.json().user.id,a.id);
   return {cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken,origin};
  };
  const get=headers=>app.inject({url:'/api/v1/me',headers});
  const independent=await login(other,1),first=await login(admin,2),second=await login(admin,3);
  const rejected=await get(first);
  assert.equal(rejected.statusCode,401);assert.equal(rejected.json().code,'SESSION_REPLACED');
  const attempted=await app.inject({method:'PATCH',url:'/api/v1/stock-map/locations/'+randomUUID(),headers:first,payload:{version:1}});
  assert.equal(attempted.statusCode,401);
  assert.equal((await get(independent)).statusCode,200);
  const sameTabs=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/api/v1/auth/csrf',headers:second,payload:{}})));
  for(const result of sameTabs){assert.equal(result.statusCode,200);assert.equal(result.json().csrfToken,second['x-csrf-token']);}
  const raced=await Promise.all([4,5].map(ip=>login(admin,ip)));
  const probes=await Promise.all(raced.map(get));
  assert.deepEqual(probes.map(r=>r.statusCode).sort(),[200,401]);
  const current=raced[probes.findIndex(r=>r.statusCode===200)];
  assert.equal((await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND replaced_at IS NULL AND expires_at>now()',[admin.id])).rows[0].n,1);
  const audit=(await owner.query("SELECT after_data FROM audit_logs WHERE actor_id=$1 AND action='login_session_replaced' ORDER BY id DESC LIMIT 1",[admin.id])).rows[0].after_data;
  assert.equal(audit.username,admin.username);assert.match(audit.ip,/^127\.82\.3\./);assert(audit.sessions[0].replaced_at);
  assert(!/token|hash|password/.test(JSON.stringify(audit)));
  await app.close();app=await build({config:f.appCfg});
  assert.equal((await get(first)).statusCode,401);assert.equal((await get(current)).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:current,payload:{}})).statusCode,200);
  assert.equal((await get(current)).statusCode,401);

  const prefix='/api/v1/auth/',remoteAddress='127.82.4.1';
  const token=await app.inject({url:prefix+'registration-token',remoteAddress});
  const headers={origin,cookie:token.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':token.json().csrfToken};
  const register=payload=>app.inject({method:'POST',url:prefix+'registration-requests',remoteAddress,headers,payload});
  const invalid=await register({username:'!',display_name:' ',password:'short',confirm:'different',contact_email:'a@b@x.invalid'});
  assert.equal(invalid.statusCode,400);
  assert.deepEqual(invalid.json().fields.map(f=>f.field).sort(),['confirm','contact_email','display_name','password','username']);
  const username='v473_'+randomUUID().replaceAll('-','').slice(0,16),password='Synthetic!'+randomUUID();
  const registration={username,display_name:'Synthetic v473 applicant',password,confirm:password,contact_email:'v473@example.invalid'};
  const duplicates=await Promise.all([register(registration),register(registration)]);
  assert.deepEqual(duplicates.map(r=>r.statusCode).sort(),[201,409]);
  assert.equal(duplicates.find(r=>r.statusCode===409).json().fields[0].field,'username');
  assert.equal((await owner.query('SELECT count(*)::int n FROM registration_requests WHERE username=$1',[username])).rows[0].n,1);
 }finally{await app?.close();await owner.end();}
});
