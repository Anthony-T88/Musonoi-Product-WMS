const fs=require('fs'),{spawnSync}=require('child_process');
fs.mkdirSync('test-output',{recursive:true});const results=[];let negativeDatabase;
for(const file of ['tests/v26-flow.cjs','tests/v26-negative.cjs','tests/v26-import.cjs','tests/v26-compatibility.cjs','tests/v26-browser.cjs','tests/v26-recovery.cjs']){
 const r=spawnSync(process.execPath,[file],{env:{...process.env,...(negativeDatabase?{V26_RECOVERY_SOURCE:negativeDatabase}:{})},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');const records=(r.stdout||'').split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean),report=records.find(x=>x.checks!==undefined);if(file.endsWith('v26-negative.cjs'))negativeDatabase=report?.database;
 results.push({file,status:r.status===0?'PASS':'FAIL',checks:report?.checks||0,database:report?.database,output:r.stdout,error:r.stderr});fs.writeFileSync('test-output/v26-results.json',JSON.stringify({at:new Date().toISOString(),policy:'Real isolated PostgreSQL, actual browser UI, real pg_dump/pg_restore. Prior V2.5.5 databases untouched.',results},null,2));if(r.error||r.status!==0){process.exitCode=1;break;}
}
if(!process.exitCode)console.log('V2.6 complete regression PASS: '+results.reduce((s,r)=>s+r.checks,0)+' checks');
