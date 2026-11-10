'use strict';

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{randomBytes}=require('node:crypto');
const E=require('./environment.cjs'),{migrate}=require('../../scripts/production-db.cjs');
const products=['CU_CATHODE','CO_HYDROXIDE'],readers=12,iterations=8,recordsPerProduct=2500;
const result={syntheticOnly:true,status:'FAIL',readers,iterations,recordsPerProduct};
const report=path.resolve(process.argv[2]||path.join(E.runtime,'export-license-load.json'));

const usage=async c=>{
 await c.query('SELECT pg_stat_clear_snapshot()');
 return (await c.query(`SELECT blks_read,blks_hit,temp_files,temp_bytes,deadlocks,tup_returned,tup_fetched
 FROM pg_stat_database WHERE datname=current_database()`)).rows[0];
};
const percentile=(xs,p)=>+xs[Math.min(xs.length-1,Math.ceil(p*xs.length)-1)].toFixed(2);
async function run(){
 const d=await E.database();
 let app;
 try{
  await migrate(d.client,{environment:'test',apply:true,backupVerified:true,appPassword:process.env.WMS_TEST_APP_PASSWORD});
  const fixture=await E.seed(d.client,d.name);
  const permissions=require('../../server/security.cjs'),actor=fixture.accounts.find(a=>a.role==='admin');
  const accounts=[];
  for(let i=0;i<readers;i++){
   const username='perf_export_'+i,password=randomBytes(20).toString('base64url');
   const {rows:[u]}=await d.client.query("INSERT INTO users(username,display_name,password_hash,role_code) VALUES($1,'Synthetic load reader',$2,'logistics_manager') RETURNING id",[username,permissions.hashPassword(password)]);
   await d.client.query('INSERT INTO user_scopes(user_id,project_id) VALUES($1,$2)',[u.id,fixture.project]);
   accounts.push({username,password});
  }
  for(const product of products){
   const {id,contract}=fixture.customers[product],cu=product===products[0];
   const target=cu?'cu_contract_id':'co_contract_id';
   await d.client.query(`INSERT INTO export_licenses
    (product_code,project_id,customer_id,${target},applied_on,proforma_no,license_no,quantity,unit_basis,unit,currency,valid_from,valid_until,state,created_by)
    SELECT $1,$2,$3,$4,current_date-90,'PERF-'||$1||'-'||i,'SYNTH-'||i,25.012345,'PHYSICAL_MT','MT','USD',current_date-60,
    CASE WHEN i%2=0 THEN current_date+10 ELSE current_date+365 END,'ISSUED',$5
    FROM generate_series(1,$6::int) i`,[product,fixture.project,id,contract,actor.id,recordsPerProduct]);
  }
  await d.client.query('ANALYZE export_licenses');
  result.tableBytes=Number((await d.client.query("SELECT pg_total_relation_size('export_licenses') n")).rows[0].n);
  app=await require('../../server/app.cjs').build({config:fixture.appCfg});
  const sessions=await Promise.all(accounts.map(async(a,i)=>{
   const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.92.7.'+(i+1),headers:{origin:fixture.appCfg.origin},payload:a});
   assert.equal(login.statusCode,200);
   return login.cookies.map(x=>x.name+'='+x.value).join('; ');
  }));
  const before=await usage(d.client),start=performance.now(),times=[];
  await Promise.all(sessions.map(async(cookie,i)=>{
   const product=products[i%2],prefix=product===products[0]?'':'/cobalt';
   for(let n=0;n<iterations;n++){
    const suffix=n%2===0?'?page=3&status=ACTIVE':'?search=PERF-'+product+'-1',begin=performance.now();
    const response=await app.inject({url:'/api/v1'+prefix+'/export-permits'+suffix,headers:{cookie,'x-product-code':product}});
    times.push({ms:performance.now()-begin,status:response.statusCode});
    if(response.statusCode===200){
     const body=response.json();assert.equal(body.indicators.active,recordsPerProduct);
     assert.equal(body.indicators.expiring,recordsPerProduct/2);assert(body.items.length>0&&body.items.length<=50);
    }
   }
  }));
  const elapsed=performance.now()-start,samples=times.map(t=>t.ms).sort((a,b)=>a-b);
  const errors=times.filter(t=>t.status!==200).length;
  result.http={count:times.length,errors,errorRate:errors/times.length,requestsPerSecond:+(times.length*1000/elapsed).toFixed(2),p50Ms:percentile(samples,.5),p95Ms:percentile(samples,.95),maxMs:percentile(samples,1)};
  await app.close();app=null;
  const after=await usage(d.client);
  result.postgres=Object.fromEntries(Object.keys(after).map(k=>[k,Number(after[k])-Number(before[k])]));
  assert.equal(errors,0);
  assert.equal(result.postgres.deadlocks,0);
  result.status='PASS';
 }finally{await app?.close();await d.client.end();}
}
run().catch(e=>{result.reason=e.message;process.exitCode=1;}).finally(()=>{
 fs.mkdirSync(path.dirname(report),{recursive:true});
 fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
});
