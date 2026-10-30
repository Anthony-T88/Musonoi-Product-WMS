'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {config}=require('../server/config.cjs'),{prepare}=require('../scripts/prepare-regression.cjs');
(async()=>{const {database,accountFile}=await prepare();const url=new URL(config().databaseUrl);url.pathname='/'+database;const env={...process.env,DATABASE_URL:url.href,V22_TEMPLATE_DATABASE:database,V22_ACCOUNTS_FILE:accountFile};const files=['test.cjs','tests/integration.cjs',...Array.from({length:6},(_,i)=>'tests/v22-'+(i+1)+'.cjs'),'tests/v22-rebuild.cjs'],results=[];
 for(const file of files){const result=spawnSync(process.execPath,[file],{env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error||result.status!==0)throw Error(file+' failed: '+(result.error?.message||result.status));results.push({file,status:'PASS',output:result.stdout.trim()});}
 const report={version:'2.2.0',at:new Date().toISOString(),database,results};fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/v22-results.json',JSON.stringify(report,null,2));console.log('V2.2 full suite PASS; real PostgreSQL results: test-output/v22-results.json');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
