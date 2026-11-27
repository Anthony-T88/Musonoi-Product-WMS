'use strict';

const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createInterface}=require('node:readline');
const {Readable,compose}=require('node:stream');
const {createGzip}=require('node:zlib');
const DB=require('../server/database-connection.cjs');
const Audit=require('../server/audit-security.cjs');
const Maintenance=require('./maintenance-connection.cjs');
const Archive=require('./database-backup.cjs');

const timeZone='Africa/Lubumbashi';
const localDate=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
const dayMs=86400000;
const logTimestamp=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s(.*)$/;
const localTestDb=/^musonoi_[a-z0-9_]+_test$/;

function businessDay(requested,now=new Date()){
 const today=localDate.format(now);
 const yesterday=new Date(new Date(today+'T00:00:00Z').getTime()-dayMs).toISOString().slice(0,10);
 const date=requested??yesterday;
 const calendar=new Date(date+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(calendar.getTime())||
  calendar.toISOString().slice(0,10)!==date||date<'2000-01-01'||date>yesterday)DB.fail('BACKUP_DATE_INVALID');
 const from=new Date(date+'T00:00:00+02:00');
 return {date,yesterday,from,to:new Date(from.getTime()+dayMs),lockDay:Math.floor(calendar.getTime()/dayMs)};
}

function absolute(setting,value){
 if(!value||!path.isAbsolute(value))DB.fail(setting+'_REQUIRES_ABSOLUTE_PATH');
 return path.resolve(value);
}

async function backupDirectory(setting,value){
 const dir=absolute(setting,value),stat=await fsp.lstat(dir);
 if(!stat.isDirectory()||(process.platform!=='win32'&&(stat.mode&0o077)))DB.fail('BACKUP_DIRECTORY_NOT_PRIVATE');
 return fsp.realpath(dir);
}

async function backupDirectories(env){
 const database=await backupDirectory('WMS_DATABASE_BACKUP_DIR',env.WMS_DATABASE_BACKUP_DIR);
 const logs=await backupDirectory('WMS_LOG_BACKUP_DIR',env.WMS_LOG_BACKUP_DIR);
 const relative=path.relative(database,logs);
 const reverse=path.relative(logs,database);
 const inside=rel=>!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);
 if(inside(relative)||inside(reverse))DB.fail('BACKUP_DIRECTORIES_MUST_BE_SEPARATE');
 return {database,logs};
}

function configuration(env){
 if(env.APP_ENV==='production')return Maintenance.configuration(env);
 if(env.APP_ENV!=='test')DB.fail('BACKUP_ENVIRONMENT_REQUIRED');
 const cfg={environment:'test',databaseUrl:env.DATABASE_OWNER_URL,db:DB.settings(env)};
 const db=DB.connection(cfg,'owner');
 const tier=cfg.db.tier||'local';
 if(db.user==='musonoi_app'||!localTestDb.test(db.database))DB.fail('BACKUP_TEST_OWNER_TARGET_REQUIRED');
 if(tier==='local'&&!['127.0.0.1','::1','localhost'].includes(db.host))DB.fail('BACKUP_TEST_LOOPBACK_REQUIRED');
 return cfg;
}

function runtimeEvent(line){
 line=line.trimStart();
 const match=logTimestamp.exec(line);
 if(match)return {time:match[1],message:match[2]};
 if(!line.startsWith('{'))return null;
 try{
  const payload=JSON.parse(line);
  if(['wms_http','service_error'].includes(payload.event)&&typeof payload.time==='string'){
   return {time:payload.time,payload};
  }
 }catch{}
 return null;
}

async function* runtimeRecords(file,day,counts){
 const input=fs.createReadStream(file);
 const lines=createInterface({input,crlfDelay:Infinity});
 try{
  for await(const line of lines){
   if(!line)continue;
   const event=runtimeEvent(line);
   const ms=event?Date.parse(event.time):NaN;
   if(!Number.isFinite(ms)){counts.undated++;continue;}
   if(ms<day.from||ms>=day.to)continue;
   counts.runtime++;
   yield JSON.stringify({type:'runtime',...event})+'\n';
  }
 }finally{lines.close();input.destroy();}
}

async function* auditRecords(client,day,counts){
 let afterTime=null,afterId=null;
 for(;;){
  const {rows}=await client.query(
   "SELECT a.*,a.id::text AS id,a.occurred_at::text AS occurred_at FROM audit_logs a "+
   "WHERE a.occurred_at >= $1 AND a.occurred_at < $2 "+
   "AND ($3::timestamptz IS NULL OR (a.occurred_at,a.id) > ($3::timestamptz,$4::bigint)) "+
   "ORDER BY a.occurred_at,a.id LIMIT 500",[day.from,day.to,afterTime,afterId]);
  for(const row of rows){
   counts.audit++;
   yield JSON.stringify({type:'audit',record:Audit.record(row)})+'\n';
  }
  if(rows.length<500)return;
  const last=rows.at(-1);
  afterTime=last.occurred_at;
  afterId=last.id;
 }
}

async function captureLogs(client,day,input,output,key){
 const stat=await fsp.lstat(input);
 if(!stat.isFile())DB.fail('BACKUP_RUNTIME_LOG_NOT_REGULAR');
 const counts={audit:0,runtime:0,undated:0};
 async function* lines(){
  yield JSON.stringify({type:'header',version:1,date:day.date,time_zone:timeZone,
   from:day.from.toISOString(),to:day.to.toISOString(),captured_at:new Date().toISOString()})+'\n';
  yield* auditRecords(client,day,counts);
  yield* runtimeRecords(input,day,counts);
  yield JSON.stringify({type:'summary',...counts})+'\n';
 }
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 let committed=false;
 try{
  await Archive.seal(compose(Readable.from(lines()),createGzip()),output,key,async()=>{
   await client.query('COMMIT');
   committed=true;
  });
 }catch(error){
  if(!committed)await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }
 return counts;
}

async function inspectArtifact(filename){
 try{
  const stat=await fsp.lstat(filename);
  if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)))DB.fail('BACKUP_ARTIFACT_NOT_PRIVATE');
  return stat;
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

async function checksum(filename){
 const hash=createHash('sha256');
 for await(const chunk of fs.createReadStream(filename))hash.update(chunk);
 return hash.digest('hex');
}

async function history(client,dbName,started,result){
 await client.query(`
  INSERT INTO backup_runs(database_name,started_at,finished_at,status,file_name,sha256,bytes,error_code)
  SELECT $1,$2,clock_timestamp(),$3,$4,$5,$6,$7
  WHERE $3='FAILED' OR NOT EXISTS(
   SELECT FROM backup_runs WHERE database_name=$1 AND status='SUCCESS' AND file_name=$4 AND sha256=$5
  )`,[dbName,started,result.status,result.file_name,result.sha256??null,result.bytes??null,result.error_code??null]);
}

async function run(job,date,env=process.env){
 if(!['database','logs'].includes(job))DB.fail('NIGHTLY_BACKUP_ARGUMENTS_INVALID');
 const started=new Date(),day=businessDay(date,started);
 if(job==='database'&&day.date!==day.yesterday)DB.fail('BACKUP_CANNOT_RECONSTRUCT_DATABASE_DATE');
 const dirs=await backupDirectories(env);
 const filename=day.date+(job==='database'?'.dump.enc':'.jsonl.gz.enc');
 const output=path.join(dirs[job],filename);
 const cfg=configuration(env),connection=DB.connection(cfg,'owner');
 const key=Archive.keyFrom(absolute('WMS_BACKUP_KEY_FILE',env.WMS_BACKUP_KEY_FILE));
 let client,locked=false;
 try{
  client=await Maintenance.open(cfg);
  client.on('error',()=>{}); // In-flight and subsequent queries surface connection failures.
  if((await client.query('SELECT environment FROM system_info WHERE singleton')).rows[0]?.environment!==cfg.environment){
   DB.fail('BACKUP_TARGET_ENVIRONMENT_MISMATCH');
  }
  locked=(await client.query('SELECT pg_try_advisory_lock($1,$2) AS acquired',
   [job==='database'?49002:49003,day.lockDay])).rows[0].acquired;
  if(!locked)DB.fail('BACKUP_ALREADY_RUNNING');
  const existing=await inspectArtifact(output);
  let counts;
  if(existing)await Archive.verify(output,key);
  else if(job==='database')await Archive.captureDatabase(output,key,cfg,env);
  else counts=await captureLogs(client,day,absolute('WMS_RUNTIME_LOG_FILE',env.WMS_RUNTIME_LOG_FILE),output,key);
  const stat=await inspectArtifact(output);
  if(!stat)DB.fail('BACKUP_ARTIFACT_MISSING');
  const sha256=await checksum(output);
  await history(client,connection.database,started,{status:'SUCCESS',file_name:filename,sha256,bytes:stat.size});
  return {status:'PASS',job,date:day.date,existing:!!existing,file:filename,bytes:stat.size,sha256,...(counts?{counts}:{})};
 }catch(error){
  if(locked)await history(client,connection.database,started,{status:'FAILED',file_name:filename,
   error_code:DB.safeError(error).code}).catch(()=>{});
  throw error;
 }finally{
  try{await client?.end();}finally{key.fill(0);}
 }
}

module.exports={businessDay,runtimeEvent,run};

if(require.main===module){
 (async()=>{
  const [job,option,date,...extra]=process.argv.slice(2);
  if(extra.length||(option!==undefined&&(option!=='--date'||!date)))DB.fail('NIGHTLY_BACKUP_ARGUMENTS_INVALID');
  console.log(JSON.stringify(await run(job,date)));
 })().catch(error=>{console.error(JSON.stringify(DB.safeError(error)));process.exitCode=1;});
}
