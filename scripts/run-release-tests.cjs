'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),mode=process.argv[2]||'unit';
if(!['unit','integration','ui','security','reliability','acceptance'].includes(mode))throw Error('Unknown release test mode');
const suites=mode==='acceptance'?['unit','integration','security','reliability','ui']:[mode];
for(const suite of suites){
 if(['integration','security','reliability'].includes(suite)&&(!process.env.WMS_TEST_OWNER_URL||!process.env.WMS_TEST_APP_PASSWORD))throw Error('Integration tests require WMS_TEST_OWNER_URL and WMS_TEST_APP_PASSWORD for an isolated TEST server');
 const files=suite==='unit'?fs.readdirSync(path.join(root,'tests/release')).filter(f=>f.endsWith('.test.cjs')&&!['database.test.cjs','ui.test.cjs','security.test.cjs','reliability.test.cjs'].includes(f)):suite==='reliability'?['reliability.test.cjs','pool-reliability.cjs','core-flows.cjs','copper-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','stocktake-core.cjs','lock-order.cjs']:[suite==='integration'?'database.test.cjs':suite==='security'?'security.test.cjs':suite==='reliability'?'reliability.test.cjs':'ui.test.cjs'];
 const run=spawnSync(process.execPath,['--test','--test-concurrency=1',...files.map(f=>path.join(root,'tests/release',f))],{cwd:root,env:{...process.env},stdio:'inherit',windowsHide:true});
 const output=path.join(root,'.runtime/release-tests');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'runner-'+suite+'.json'),JSON.stringify({suite,status:run.status===0?'PASS':'FAIL',exitCode:run.status,checkedAt:new Date().toISOString()},null,2));
 if(run.status!==0){process.exitCode=run.status||1;break;}
}
