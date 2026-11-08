'use strict';
// Shared by the application and maintenance tools. Never include URLs in errors.
const fs=require('node:fs'),net=require('node:net'),dns=require('node:dns').promises;
function fail(code){throw Object.assign(Error(code),{code});}
function number(value,fallback,min,max){const n=value===undefined||value===''?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)fail('DB_INVALID_LIMIT');return n;}
function settings(env=process.env){return {tier:env.DEPLOYMENT_TIER,hosts:env.DB_ALLOWED_HOSTS,name:env.DB_EXPECTED_NAME,ca:env.DB_TLS_CA_FILE,poolMax:env.DB_POOL_MAX,waitMs:env.DB_CONNECT_TIMEOUT_MS,major:env.DB_EXPECTED_MAJOR};}
function connection(cfg,purpose='app'){
 const d=cfg.db||settings(),production=cfg.environment==='production',tier=d.tier||(production?'production':'local');
 if(!['local','production','preproduction'].includes(tier)||(tier==='production'&&!production))fail('DB_INVALID_TIER');
 if(d.major!==undefined&&d.major!==''&&![16,17].includes(Number(d.major)))fail('DB_UNSUPPORTED_MAJOR');
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('DB_TLS_BYPASS_FORBIDDEN');
 let u;try{u=new URL(cfg.databaseUrl);}catch{fail('DB_INVALID_URL');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash)fail('DB_URL_OPTIONS_FORBIDDEN');
 let database,user,password;try{database=decodeURIComponent(u.pathname.slice(1));user=decodeURIComponent(u.username);password=decodeURIComponent(u.password);}catch{fail('DB_INVALID_URL');}
 if(!database||!user||!password||!u.hostname)fail('DB_INCOMPLETE_URL');
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(production||tier==='preproduction'){
  const hosts=String(d.hosts||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!hosts.includes(host)||!d.name||database!==d.name)fail('DB_TARGET_NOT_ALLOWED');
  if(purpose==='app'&&user!=='musonoi_app'||purpose==='owner'&&user==='musonoi_app')fail('DB_ACCOUNT_SEPARATION_REQUIRED');
 }
 if(!production&&/production/i.test(database)&&!/^musonoi_[a-z0-9_]*preproduction_test$/.test(database))fail('DB_TEST_PRODUCTION_TARGET_FORBIDDEN');
 if(tier==='preproduction'&&!/^musonoi_[a-z0-9_]+_test$/.test(database))fail('DB_TEST_NAME_REQUIRED');
 let ssl=false;
 if(production){
  if(!d.ca)fail('DB_CA_REQUIRED');let ca;try{ca=fs.readFileSync(d.ca,'utf8');}catch{fail('DB_CA_UNREADABLE');}
  if(!ca.includes('-----BEGIN CERTIFICATE-----'))fail('DB_CA_INVALID');
  ssl={ca,rejectUnauthorized:true,minVersion:'TLSv1.2',...(net.isIP(host)?{}:{servername:host})};
 }
 return {host,port:number(u.port,5432,1,65535),database,user,password,ssl,max:number(d.poolMax,10,1,50),connectionTimeoutMillis:number(d.waitMs,5000,500,60000),options:'-c timezone=Africa/Lubumbashi',application_name:'musonoi-v36-'+purpose};
}
function privateIp(ip){return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^(fc|fd)[0-9a-f]{2}:/i.test(ip);}
async function network(cfg,options){
 if((cfg.db?.tier||(cfg.environment==='production'?'production':'local'))!=='production')return;
 const addresses=net.isIP(options.host)?[{address:options.host}]:await dns.lookup(options.host,{all:true}).catch(()=>fail('DB_DNS_FAILED'));
 if(!addresses.length||addresses.some(r=>!privateIp(r.address)))fail('DB_PRIVATE_NETWORK_REQUIRED');
}
async function verify(client,cfg,purpose='app'){
 const r=(await client.query("SELECT current_setting('server_version_num')::int version,current_user username,current_database() database")).rows[0];
 const major=Math.floor(r.version/10000);if(![16,17].includes(major))fail('DB_UNSUPPORTED_MAJOR');
 if(cfg.environment==='production'){
  if(major!==Number(cfg.db?.major||16))fail('DB_UNCONFIRMED_MAJOR');
  if(!(await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl)fail('DB_TLS_REQUIRED');
  const role=(await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(purpose==='app'&&(r.username!=='musonoi_app'||Object.values(role||{}).some(Boolean)))fail('DB_APP_ROLE_PRIVILEGED');
  if(purpose==='owner'&&r.username==='musonoi_app')fail('DB_ACCOUNT_SEPARATION_REQUIRED');
 }
 return {major,database:r.database,username:r.username};
}
function safeError(e){return {status:'FAILED',code:/^[A-Z0-9_]{2,60}$/.test(e?.code||'')?e.code:'DB_OPERATION_FAILED'};}
module.exports={connection,settings,network,verify,fail,safeError};
