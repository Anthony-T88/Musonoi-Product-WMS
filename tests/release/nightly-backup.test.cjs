'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {businessDay,runtimeEvent,run}=require('../../scripts/nightly-backup.cjs');
const ServiceErrors=require('../../server/service-errors.cjs');

test('the nightly archive selects the complete Lubumbashi day at local midnight',()=>{
 const midnight=new Date('2026-11-26T22:00:00Z');
 const day=businessDay(undefined,midnight);
 assert.equal(day.date,'2026-11-26');
 assert.equal(day.from.toISOString(),'2026-11-25T22:00:00.000Z');
 assert.equal(day.to.toISOString(),'2026-11-26T22:00:00.000Z');
 assert.equal(businessDay(undefined,new Date(midnight-1)).date,'2026-11-25');
 assert.throws(()=>businessDay('2026-11-27',midnight),{code:'BACKUP_DATE_INVALID'});
 assert.throws(()=>businessDay('2026-02-29',midnight),{code:'BACKUP_DATE_INVALID'});
 assert.equal(businessDay('2024-02-29',midnight).date,'2024-02-29');
});

test('host logs with Docker timestamps and structured local request logs keep their timestamps',()=>{
 const time='2026-11-26T01:02:03.012345678Z';
 const payload={event:'wms_http',time,status:200,request_id:'req-1'};
 assert.deepEqual(runtimeEvent(time+' listening'),{time,message:'listening'});
 assert.deepEqual(runtimeEvent(JSON.stringify(payload)),{time,payload});
 assert.equal(runtimeEvent('untimestamped line'),null);
});

test('the app emits timestamped safe diagnostics for the daily archive',()=>{
 let diagnostic;
 const source=Object.assign(Error('test-sensitive raw database message'),{code:'ETIMEDOUT'});
 const errorId=ServiceErrors.report(source,null,event=>{diagnostic=event;});
 const observed=runtimeEvent(JSON.stringify(diagnostic));
 assert(Number.isFinite(Date.parse(observed.time)));
 assert.equal(observed.payload.errorId,errorId);
 assert.equal(observed.payload.status,503);
 assert(!JSON.stringify(observed).includes(source.message));
});

test('the database job cannot label a new full snapshot as a historical restore point',async()=>{
 await assert.rejects(run('database','2020-11-26',{}),{code:'BACKUP_CANNOT_RECONSTRUCT_DATABASE_DATE'});
});

test('overlapping backup directories are rejected before database access',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'musonoi-backup-test-'));
 t.after(()=>fs.rmdir(root));
 const nested=path.join(root,'nested');
 await fs.mkdir(nested,{mode:0o700});
 try{
  await assert.rejects(run('logs',undefined,{WMS_DATABASE_BACKUP_DIR:root,WMS_LOG_BACKUP_DIR:nested}),
   {code:'BACKUP_DIRECTORIES_MUST_BE_SEPARATE'});
 }finally{await fs.rmdir(nested);}
});
