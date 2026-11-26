'use strict';

const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const {randomBytes,randomUUID,createCipheriv,createDecipheriv}=require('node:crypto');
const {Writable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {spawn}=require('node:child_process');
const magic=Buffer.from('WMS490B1'),ivSize=12,tagSize=16,headerSize=magic.length+ivSize;
const failure=code=>Object.assign(Error(code),{code});

async function atomicOutput(output,write){
 const destination=path.resolve(output),dir=path.dirname(destination);
 const temp=path.join(dir,'.wms-backup-'+randomUUID());
 const file=await fsp.open(temp,'wx',0o600);
 try{
  await file.close();
  await write(temp);
  const written=await fsp.open(temp,'r+');
  try{await written.sync();}finally{await written.close();}
  await fsp.link(temp,destination); // Same-directory publication never overwrites an existing backup.
 }finally{await fsp.unlink(temp);}
}
async function seal(source,output,key,beforePublish=async()=>{}){
 const iv=randomBytes(ivSize),header=Buffer.concat([magic,iv]);
 const cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(header);
 await atomicOutput(output,async temp=>{
  await fsp.writeFile(temp,header);
  await pipeline(source,cipher,fs.createWriteStream(temp,{flags:'a'}));
  await beforePublish();
  await fsp.appendFile(temp,cipher.getAuthTag());
 });
}
async function openArchive(input,key,destination){
 const file=await fsp.open(input,'r');
 try{
  const {size}=await file.stat();
  if(size<=headerSize+tagSize)throw failure('BACKUP_FORMAT_INVALID');
  const header=Buffer.alloc(headerSize),tag=Buffer.alloc(tagSize);
  const first=await file.read(header,0,headerSize,0),last=await file.read(tag,0,tagSize,size-tagSize);
  if(first.bytesRead!==headerSize||last.bytesRead!==tagSize||!header.subarray(0,magic.length).equals(magic)){
   throw failure('BACKUP_FORMAT_INVALID');
  }
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(magic.length));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  await pipeline(file.createReadStream({start:headerSize,end:size-tagSize-1,autoClose:false}),decipher,destination);
 }finally{await file.close();}
}
async function verify(input,key){
 await openArchive(input,key,new Writable({write(chunk,encoding,done){done();}}));
}
async function unseal(input,output,key){
 await atomicOutput(output,temp=>openArchive(input,key,fs.createWriteStream(temp,{flags:'w'})));
}
function keyFrom(file){
 const text=fs.readFileSync(file,'utf8').trim();
 if(!/^[0-9a-f]{64}$/i.test(text))throw failure('BACKUP_KEY_INVALID');
 return Buffer.from(text,'hex');
}
async function dump(output,key){
 const DB=require('../server/database-connection.cjs'),M=require('./maintenance-connection.cjs');
 const cfg=M.configuration();
 const client=await M.open(cfg);
 try{
  if((await client.query('SELECT environment FROM system_info WHERE singleton')).rows[0]?.environment!=='production'){
   throw failure('BACKUP_TARGET_ENVIRONMENT_MISMATCH');
  }
 }finally{await client.end();}
 const db=DB.connection(cfg,'owner');
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^PG/i.test(name)));
 Object.assign(env,{PGPASSWORD:db.password,PGSSLMODE:'verify-full',PGSSLROOTCERT:cfg.db.ca,
  PGGSSENCMODE:'disable',PGAPPNAME:'musonoi-encrypted-backup',PGCONNECT_TIMEOUT:'10'});
 const proc=spawn(process.env.WMS_PG_DUMP||'pg_dump',
  ['--format=custom','--no-password','--host',db.host,'--port',String(db.port),'--username',db.user,'--dbname',db.database],
  {env,windowsHide:true,stdio:['ignore','pipe','ignore']});
 const completed=new Promise(resolve=>{
  proc.once('error',()=>resolve(false));
  proc.once('close',code=>resolve(code===0));
 });
 try{
  await seal(proc.stdout,output,key,async()=>{if(!await completed)throw failure('BACKUP_DUMP_FAILED');});
 }catch(e){
  proc.kill();
  await completed;
  throw e;
 }
 await verify(output,key);
}
module.exports={seal,unseal,verify};
if(require.main===module)(async()=>{
 const [mode,input,output]=process.argv.slice(2);
 if(!['backup','verify','decrypt'].includes(mode)||!input||(mode==='decrypt')!==!!output)throw failure('BACKUP_ARGUMENTS_INVALID');
 const key=keyFrom(process.env.WMS_BACKUP_KEY_FILE);
 try{
  if(mode==='backup')await dump(input,key);
  if(mode==='verify')await verify(input,key);
  if(mode==='decrypt')await unseal(input,output,key);
  console.log(JSON.stringify({status:'PASS',operation:mode}));
 }finally{key.fill(0);}
})().catch(e=>{console.error(JSON.stringify(require('../server/database-connection.cjs').safeError(e)));process.exitCode=1;});
