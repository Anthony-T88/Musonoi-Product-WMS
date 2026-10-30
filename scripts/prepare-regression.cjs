'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Client}=require('pg');
const {ownerConfig,migrate,seed}=require('./db.cjs'),{config,root}=require('../server/config.cjs');
async function prepare(version='v22'){
 if(!['v22','v23','v24','v25'].includes(version))throw Error('Unsupported regression version');
 if(config().environment!=='test')throw Error('Regression initialization requires APP_ENV=test');
 const database='musonoi_'+version+'_regression_test',owner=new Client(ownerConfig());await owner.connect();let existed;
 try{existed=(await owner.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount>0;if(!existed)await owner.query('CREATE DATABASE '+database+' OWNER musonoi_owner');}finally{await owner.end();}
 await migrate(database);
 if(!existed)await seed(database,version+'-regression-accounts.json');
 const c=new Client(ownerConfig(database));await c.connect();try{
  assert.equal((await c.query('SELECT environment FROM system_info')).rows[0].environment,'test');
  const actual=(await c.query('SELECT bundle_no,net_weight::text AS weight FROM bundles ORDER BY bundle_no')).rows;
  const expected=require('../dist/demo-data.js').data.map(r=>({bundle_no:r.id,weight:r.weight.toFixed(6)})).sort((a,b)=>a.bundle_no.localeCompare(b.bundle_no));
  assert.deepEqual(actual,expected,'Regression fixture was modified; existing database is preserved. Restore its baseline to a new isolated database instead of clearing business data.');
 }finally{await c.end();}
 const file=path.join(root,'.runtime',fs.existsSync(path.join(root,'.runtime',version+'-regression-accounts.json'))?version+'-regression-accounts.json':'test-accounts.json');
 if(!fs.existsSync(file))throw Error('Local regression credentials are missing; existing passwords will not be reset');
 console.log('Independent 128-bundle TEST regression database ready; no developer database was overwritten.');
 return {database,accountFile:file};
}
module.exports={prepare};
if(require.main===module)prepare(process.argv[2]||'v22').catch(e=>{console.error(e.message);process.exitCode=1;});
