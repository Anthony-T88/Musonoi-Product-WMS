'use strict';

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync,execFileSync}=require('node:child_process'),E=require('./environment.cjs');

const out=path.resolve(process.argv[2]||path.join(E.runtime,'uiux/verification')),pixel=process.argv.includes('--pixel');
assert(process.argv.slice(3).every(flag=>flag==='--pixel'),'Usage: uiux-verify.cjs OUTPUT [--pixel]');
fs.mkdirSync(out,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:E.root,encoding:'utf8'}).trim();
const result={commit,syntheticOnly:true,startedAt:new Date().toISOString(),stages:[]};
const save=()=>fs.writeFileSync(path.join(out,'exits.json'),JSON.stringify(result,null,2)+'\n');
const run=(stage,args)=>{
 const proc=spawnSync(process.execPath,args,{cwd:E.root,stdio:'inherit',windowsHide:true});
 result.stages.push({stage,exitCode:proc.status??1,signal:proc.signal});
 save();
 if(proc.status!==0)throw Error(stage+' failed');
};
const full=path.join(out,'full'),quick=path.join(out,'quick');
try{
 run('source',['tests/release/source-check.cjs']);
 run('static',['tests/release/uiux-quality.cjs','static']);
 run('acceptance',['scripts/run-release-tests.cjs','acceptance']);
 for(const name of ['unit','integration','security','reliability','ui']){
  fs.copyFileSync(path.join(E.runtime,'runner-'+name+'.json'),path.join(out,'runner-'+name+'.json'));
 }
 const shipment=JSON.parse(fs.readFileSync(path.join(E.runtime,'rc2-shipment-results.json'),'utf8'));
 fs.writeFileSync(path.join(out,'shipment-results.json'),JSON.stringify(shipment,null,2)+'\n');
 assert.equal(shipment.status,'PASS','Shipment report checks');
 run('fixtures',['tests/release/uiux-fixtures.cjs']);
 run('quick-scan',['tests/release/uiux-audit.cjs','current',quick,'--quick']);
 run('quick-layout',['tests/release/uiux-quality.cjs','layout',quick,'quick']);
 run('full-scan',['tests/release/uiux-audit.cjs','current',full]);
 run('full-layout',['tests/release/uiux-quality.cjs','layout',full,'full']);
 if(pixel)run('pixel',['tests/release/uiux-quality.cjs','compare',full,'full']);
 run('workflows',['tests/release/uiux-workflows.cjs',path.join(out,'workflows')]);
 result.status='PASS';
}catch(error){
 result.status='FAIL';result.reason=error.message;console.error(error.message);process.exitCode=1;
}finally{
 result.finishedAt=new Date().toISOString();save();
}

