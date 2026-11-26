'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomBytes}=require('node:crypto'),{Readable}=require('node:stream');
const Backup=require('../../scripts/database-backup.cjs');

test('encrypted backups authenticate data, reject replacement and leave no published plaintext on failure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'musonoi-backup-test-'));
 const files=Object.fromEntries(['archive','restore','damaged','unauthorized','unfinished'].map(name=>[name,path.join(dir,name)]));
 const key=randomBytes(32),other=randomBytes(32),input=Buffer.from('synthetic PostgreSQL backup data');
 try{
  await Backup.seal(Readable.from([input]),files.archive,key);
  const sealed=await fs.readFile(files.archive);
  assert(!sealed.includes(input));
  await Backup.verify(files.archive,key);
  await Backup.unseal(files.archive,files.restore,key);
  assert.deepEqual(await fs.readFile(files.restore),input);
  await assert.rejects(()=>Backup.seal(Readable.from([input]),files.archive,key),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(files.archive),sealed);
  await assert.rejects(()=>Backup.unseal(files.archive,files.unauthorized,other));
  await assert.rejects(()=>fs.stat(files.unauthorized),{code:'ENOENT'});
  const tampered=Buffer.from(sealed);tampered[25]^=1;
  await fs.writeFile(files.damaged,tampered);
  await assert.rejects(()=>Backup.verify(files.damaged,key));
  await assert.rejects(()=>Backup.seal(Readable.from([input]),files.unfinished,key,async()=>{throw Error('dump did not complete');}),/dump did not complete/);
  await assert.rejects(()=>fs.stat(files.unfinished),{code:'ENOENT'});
  assert.deepEqual((await fs.readdir(dir)).sort(),['archive','damaged','restore']);
 }finally{
  for(const file of Object.values(files)){
   try{await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  await fs.rmdir(dir);
 }
});
