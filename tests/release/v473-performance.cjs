'use strict';

const path=require('node:path'),assert=require('node:assert/strict');
const {Pool}=require('pg'),{chromium}=require('playwright');
const E=require('./environment.cjs');
const runRoot=path.resolve(__dirname,'../..');

async function fixture(root,port){
 const env=require(path.join(root,'tests/release/environment.cjs')),db=await env.database();
 try{
  await require(path.join(root,'scripts/production-db.cjs')).migrate(db.client,{environment:'test',apply:true,backupVerified:true,appPassword:process.env.WMS_TEST_APP_PASSWORD});
  const f=await env.seed(db.client,db.name),admin=f.accounts.find(x=>x.role==='admin'),cu=f.customers.CU_CATHODE;
  await db.client.query(`INSERT INTO export_licenses(product_code,project_id,customer_id,cu_contract_id,applied_on,proforma_no,license_no,quantity,unit_basis,unit,currency,state,valid_from,valid_until,created_by)
   SELECT 'CU_CATHODE',$1,$2,$3,current_date-30,'PERF-'||lpad(i::text,4,'0'),'LIC-'||i,150.12345,'PHYSICAL_MT','MT','USD',
   CASE WHEN i%4=0 THEN 'APPLYING' ELSE 'ISSUED' END,current_date-30,CASE WHEN i%5=0 THEN current_date-1 ELSE current_date+25 END,$4 FROM generate_series(1,600) i`,[f.project,cu.id,cu.contract,admin.id]);
  await db.client.query('ANALYZE export_licenses');
  f.appCfg={...f.appCfg,port,origin:'http://127.0.0.1:'+port};
  return {f,admin,db};
 }catch(e){await db.client.end();throw e;}
}

async function measure(root,port,browser){
 const {f,admin,db}=await fixture(root,port);
 const queries=[],pool=new Pool({connectionString:f.appCfg.databaseUrl});
 pool.on('connect',client=>{
  const original=client.query.bind(client);
  client.query=(sql,...args)=>{
   const pending=original(sql,...args);
   if(typeof sql==='string'&&/export_license/.test(sql)&&pending?.then)queries.push({sql,parameters:Array.isArray(args[0])?args[0]:[]});
   return pending;
  };
 });
 const app=await require(path.join(root,'server/app.cjs')).build({config:f.appCfg,pool});
 try{
  await app.listen({host:'127.0.0.1',port});
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:f.appCfg.origin},payload:{username:admin.username,password:admin.password}});
  assert.equal(login.statusCode,200);
  const headers={cookie:login.cookies.map(c=>c.name+'='+c.value).join('; '),'x-product-code':'CU_CATHODE'};
  const api='/api/v1/export-permits';
  const first=await app.inject({url:api,headers});assert.equal(first.statusCode,200,first.body.slice(0,300));
  const sample=[];queries.length=0;
  for(let i=0;i<7;i++){
   const started=performance.now(),response=await app.inject({url:api,headers});
   assert.equal(response.statusCode,200);sample.push(performance.now()-started);
  }
  const perRequest=queries.length/7,statements=queries.slice(0,perRequest),explain=[];
  for(const {sql,parameters} of statements){
   const row=(await db.client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,parameters)).rows[0]['QUERY PLAN'][0];
   explain.push({executionMs:row['Execution Time'],planningMs:row['Planning Time'],node:row.Plan['Node Type'],sharedHit:row.Plan['Shared Hit Blocks'],cost:row.Plan['Total Cost'],jit:row.JIT||null});
  }
  const before=first.json(),filtered=await app.inject({url:api+'?status=EXPIRED&search=PERF-',headers});
  assert.equal(filtered.statusCode,200);assert(filtered.json().items.every(x=>x.status==='EXPIRED'));
  assert.equal(before.total,600);assert.equal(before.items.length,50);
  const browserRuns=[];
  for(const scenario of browser?[{name:'loopback',rtt:0},{name:'simulated-180ms',rtt:180}]:[]){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:900}});
   try{
    const page=await context.newPage(),client=await context.newCDPSession(page);
    await client.send('Network.enable');
    if(scenario.rtt)await client.send('Network.emulateNetworkConditions',{offline:false,latency:scenario.rtt,downloadThroughput:250000,uploadThroughput:125000});
    await page.goto(f.appCfg.origin+'/sales-plans');
    await page.locator('#login-username').fill(admin.username);
    await page.locator('#login-password').fill(admin.password);
    const loginStart=performance.now();
    await page.locator('#login-password').press('Enter');
    await page.locator('#business-title').filter({hasText:/销售计划|Sales Plans/}).waitFor({state:'visible',timeout:65000});
    const loginMs=performance.now()-loginStart;
    await page.evaluate(()=>{window.__baselineWorkspace=document.querySelector('.workspace');});
    let requests=0,documents=0,encodedBytes=0;
    page.on('request',r=>{requests++;if(r.resourceType()==='document')documents++;});
    client.on('Network.loadingFinished',e=>{encodedBytes+=e.encodedDataLength;});
    const started=performance.now(),link=page.locator('a[href="/export-licenses"]:visible').first();
    await link.click();
    await page.locator('#business-title').filter({hasText:/出口许可证管理|Export License Management/}).waitFor({state:'visible',timeout:65000});
    const visibleMs=performance.now()-started;
    await page.locator('#export-license-table tbody tr').first().waitFor({state:'visible',timeout:65000});
    const finishedMs=performance.now()-started;
    const stableShell=await page.evaluate(()=>window.__baselineWorkspace===document.querySelector('.workspace'));
    if(root===runRoot){assert.equal(documents,0);assert(stableShell);}
    const navigation={...scenario,loginMs,visibleMs,finishedMs,requests,documents,encodedBytes,stableShell,routeMs:{}};
    for(const [route,content] of [['/overview','.oa-kpis'],['/sales-plans','#business-title'],['/stock-map','#stock-map-canvas']]){
     const routeStart=performance.now();
     await page.evaluate(next=>Router.go(next),route);
     await page.locator(content).first().waitFor({state:'visible',timeout:30000});
     if(route==='/sales-plans')assert.match(await page.locator('#business-title').innerText(),/销售计划|Sales Plans/);
     navigation.routeMs[route]=performance.now()-routeStart;
    }
    browserRuns.push(navigation);
   }finally{await context.close();}
  }
  return {apiMedianMs:sample.sort((a,b)=>a-b)[3],apiBytes:first.rawPayload.length,queriesPerList:perRequest,explain,browserRuns,counts:{total:before.total,filtered:filtered.json().total,indicators:before.indicators,units:before.units}};
 }finally{await app.close();await pool.end();await db.client.end();}
}

(async()=>{
 const baseline=path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'../musonoi-v472-perf-final');
 const browser=process.argv.includes('--api-only')?null:await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});
 try{
  const before=await measure(baseline,4396,browser),after=await measure(runRoot,4397,browser);
  assert.deepEqual(after.counts,before.counts);
  E.save(browser?'v473-performance.json':'v473-sql-performance.json',{syntheticLicenses:600,before,after});
  console.log(JSON.stringify({before,after}));
 }finally{await browser?.close();}
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
