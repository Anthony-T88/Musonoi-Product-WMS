'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Client}=require('pg');
const E=require('./environment.cjs');
const out=path.resolve(process.argv[2]),pgBin=process.argv[3],start=Date.now(),result={status:'FAIL',stages:[],syntheticOnly:true};
const digest=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function pg(name,args){
 const u=E.configuration();
 const run=spawnSync(pgBin?path.join(pgBin,name+(process.platform==='win32'?'.exe':'')):name,args,{windowsHide:true,encoding:'utf8',env:{...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password)}});
 result.stages.push({name,status:run.status??1,milliseconds:Date.now()-start});
 if(run.status!==0)throw Error(name+' failed: '+(run.stderr||run.error?.message||''));
 return run.stdout;
}
async function counts(client){
 const query=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
 const report={};
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  for(const {tablename:name} of query.rows){
   if(!/^[a-z_0-9]+$/.test(name))throw Error('Invalid identifier');
   const {rows:[s]}=await client.query(`SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) fingerprint FROM public."${name}" t`);
   report[name]=s;
  }
  return report;
 }finally{await client.query('ROLLBACK');}
}
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const f=E.fixture(),source=new Client(E.options(f.database));await source.connect();
 assert.equal((await source.query('SELECT environment FROM system_info WHERE singleton')).rows[0]?.environment,'test');
 const target=await E.database();
 const dump=path.resolve('.runtime','v472-synthetic-rehearsal.dump');
 try{
  const before=await counts(source);
  assert(before.export_licenses.n>=2,'requires completed copper and cobalt synthetic samples');
  assert(before.export_license_allocations.n>=3,'requires allocation history');
  result.pgServer=(await source.query('SHOW server_version')).rows[0].server_version;
  result.pgClient=pg('pg_dump',['--version']).trim();
  pg('pg_dump',['--format=custom','--file',dump,'--dbname',f.database,'--no-password']);
  const bytes=fs.readFileSync(dump);result.backup={size:bytes.length,sha256:digest(bytes)};
  const catalog=pg('pg_restore',['--list',dump]);assert(catalog.includes('export_license_allocations'));
  pg('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--dbname',target.name,'--no-password',dump]);
  assert.deepEqual(await counts(target.client),before);
  result.verifiedTables=Object.keys(before).length;
  result.criticalCounts=Object.fromEntries(['schema_migrations','users','loading_plan_documents','co_loading_plans','co_metal_outbound','sales_invoice_confirmations','audit_logs','export_licenses','export_license_allocations','export_license_actions','export_license_attachments'].filter(k=>before[k]).map(k=>[k,before[k].n]));
  const config={...E.appConfig(target.name),port:4398,origin:'http://127.0.0.1:4398'};
  const app=await require('../../server/app.cjs').build({config});
  try{
   await app.listen({host:'127.0.0.1',port:config.port});
   const health=await fetch(config.origin+'/api/v1/health');assert.equal(health.status,200);
   const a=f.accounts.find(a=>a.role==='admin'),login=await fetch(config.origin+'/api/v1/auth/login',{method:'POST',headers:{origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})});
   assert.equal(login.status,200);
   const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
   for(const [product,p] of [['CU_CATHODE',''],['CO_HYDROXIDE','/cobalt']]){
    const licences=await fetch(config.origin+'/api/v1'+p+'/export-permits',{headers:{cookie,'X-Product-Code':product}});
    assert.equal(licences.status,200);
    assert((await licences.json()).items.length>=1);
   }
   result.stages.push({name:'health-login-and-both-products',status:0,milliseconds:Date.now()-start});
  }finally{await app.close();}
  result.status='PASS';
 }finally{await Promise.allSettled([source.end(),target.client.end()]);}
}
main().catch(e=>{result.error=e.message;console.error(e.message);process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(out,'local-backup-rehearsal.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));});
