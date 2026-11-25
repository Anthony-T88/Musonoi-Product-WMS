'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),DB=require('../../server/database-connection.cjs');
const root=path.resolve(__dirname,'../..');
test('Docker uses explicit sources, default deny context and final sensitive-file exclusions',()=>{
 const docker=fs.readFileSync(path.join(root,'deploy/Dockerfile'),'utf8'),ignore=fs.readFileSync(path.join(root,'.dockerignore'),'utf8').split(/\r?\n/).filter(s=>s&&!s.startsWith('#'));
 assert.equal(ignore[0],'**');assert(!/^COPY(?:\s+--[^ ]+)*\s+\.\s+\./m.test(docker));assert(docker.includes('RUN node scripts/verify-release.cjs'));
 for(const pattern of ['**/.git/**','**/.runtime/**','**/private/**','**/backups/**','**/uploads/**','**/.env','**/*.pem','**/*.key','**/*.enc','**/*.dump','**/*.zip'])assert(ignore.includes(pattern),pattern);
 const copies=docker.split(/\r?\n/).filter(s=>s.startsWith('COPY ')).flatMap(line=>line.replace(/^COPY(?:\s+--[^ ]+)*/,'').trim().split(/\s+/).slice(0,-1));
 for(const unsafe of ['.env','.runtime','private','backups','uploads','.git','Musonoi-Database-V4.6.9-R2.dump.enc','RELEASE_MANIFEST.json'])assert(!copies.includes(unsafe),unsafe);
 assert(!copies.includes('.'));assert(!copies.includes('scripts'));assert(!copies.includes('tests'));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'SOURCE_MANIFEST.json')));for(const f of manifest.files)assert(copies.some(source=>f.path===source||f.path.startsWith(source+'/')),'Missing from explicit Docker copy list: '+f.path);
});
test('database target boundaries, owner separation and TLS bypass remain enforced',()=>{
 const cfg={environment:'production',databaseUrl:'postgresql://musonoi_app:synthetic@127.0.0.1:55432/wrong',db:{tier:'production',hosts:'127.0.0.1',name:'expected'}};assert.throws(()=>DB.connection(cfg),{code:'DB_TARGET_NOT_ALLOWED'});
 cfg.databaseUrl='postgresql://musonoi_app:synthetic@127.0.0.1:55432/expected';assert.throws(()=>DB.connection(cfg,'owner'),{code:'DB_ACCOUNT_SEPARATION_REQUIRED'});
 assert.throws(()=>DB.connection({environment:'test',databaseUrl:'postgresql://musonoi_app:synthetic@127.0.0.1:55432/production'}),{code:'DB_TEST_PRODUCTION_TARGET_FORBIDDEN'});
});
test('database startup retries temporary connection errors and closes every attempt',async t=>{
 const {Client}=require('pg'),errors=['57P03','ECONNREFUSED'],events=[],inFlight=new Set();
 const connect=t.mock.method(Client.prototype,'connect',async function(){
  assert.equal(inFlight.size,0);
  inFlight.add(this);
  const code=errors.shift();
  if(code)throw Object.assign(Error('synthetic startup failure'),{code});
 });
 const close=t.mock.method(Client.prototype,'end',async function(){assert(inFlight.delete(this));});
 const query=t.mock.method(Client.prototype,'query',async ({text,query_timeout})=>{
  assert.equal(text,'SELECT 1');
  assert(query_timeout>0&&query_timeout<=1000);
  return {rows:[{ready:1}]};
 });
 await DB.verifyStartup({connectionTimeoutMillis:5000},async db=>{
  assert.deepEqual((await db.query('SELECT 1')).rows,[{ready:1}]);
 },{timeoutMs:1000,intervalMs:5,report:event=>events.push(event)});
 assert.equal(connect.mock.callCount(),3);
 assert.equal(close.mock.callCount(),3);
 assert.equal(query.mock.callCount(),1);
 assert.deepEqual(events[0],{status:'DB_WAITING',code:'57P03',timeoutMs:1000});
 assert.equal(events[1]?.status,'DB_READY');
});
test('database startup reports a deadline and fails fast on security or schema errors',async t=>{
 const {Client}=require('pg');
 const connect=t.mock.method(Client.prototype,'connect',async()=>{
  throw Object.assign(Error('synthetic unavailable database'),{code:'57P03'});
 });
 const close=t.mock.method(Client.prototype,'end',async()=>{});
 const options={connectionTimeoutMillis:5000},quiet={timeoutMs:60,intervalMs:1000,report:()=>{}};
 await assert.rejects(()=>DB.verifyStartup(options,async()=>assert.fail('connection was unavailable'),quiet),error=>{
  assert.deepEqual(DB.safeError(error),{status:'FAILED',code:'DB_STARTUP_TIMEOUT',lastCode:'57P03'});
  return true;
 });
 assert.equal(close.mock.callCount(),connect.mock.callCount());
 for(const code of ['28P01','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DB_SECURITY_SCHEMA_REQUIRED']){
  const failure=Object.assign(Error('synthetic permanent startup failure'),{code}),attempts=connect.mock.callCount();
  connect.mock.mockImplementation(async()=>{if(code!=='DB_SECURITY_SCHEMA_REQUIRED')throw failure;});
  await assert.rejects(()=>DB.verifyStartup(options,async()=>{throw failure;},{...quiet,timeoutMs:1000}),error=>error===failure);
  assert.equal(connect.mock.callCount(),attempts+1);
  assert.equal(close.mock.callCount(),attempts+1);
 }
});
test('maintenance apply requires an explicit database confirmation',()=>{const M=require('../../scripts/maintenance-connection.cjs'),cfg={db:{name:'explicit'}};assert.equal(M.authorize([],cfg),false);assert.throws(()=>M.authorize(['--apply'],cfg),{code:'MAINTENANCE_CONFIRMATION_REQUIRED'});assert.throws(()=>M.authorize(['--apply','--confirm-database','other'],cfg),{code:'MAINTENANCE_CONFIRMATION_REQUIRED'});assert.equal(M.authorize(['--apply','--confirm-database','explicit'],cfg),true);});
test('Fastify fix is installed and accepts streaming responses',async()=>{assert.equal(require('fastify/package.json').version,'5.12.8');const app=require('fastify')({handlerTimeout:15});try{const {PassThrough}=require('node:stream');app.get('/stream',async()=>{const stream=new PassThrough();stream.write('start');setTimeout(()=>stream.end('done'),40);return stream;});app.get('/alive',async()=>({ok:true}));await assert.rejects(app.inject('/stream'),{code:'FST_ERR_HANDLER_TIMEOUT'});assert.equal((await app.inject('/alive')).statusCode,200);}finally{await app.close();}});
