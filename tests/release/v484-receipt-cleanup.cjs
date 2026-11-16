'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Client}=require('pg');
const E=require('./environment.cjs');

test('scoped purge dry-run, rejection and apply on a real synthetic copper workflow',async()=>{
 const fixture=E.fixture(),core=JSON.parse(fs.readFileSync(path.join(E.runtime,'rc2-copper-results.json'),'utf8'));
 assert.equal(core.syntheticOnly,true);assert.equal(core.database,fixture.database);
 const owner=E.configuration(),c=new Client(E.options(fixture.database));
 await c.connect();
 try{
  const {rows:[target]}=await c.query(`SELECT r.id,r.code,(r.created_at AT TIME ZONE 'Africa/Lubumbashi')::date::text AS receipt_day,
    (SELECT count(*)::int FROM bundles WHERE receipt_id=r.id) units
    FROM bundles b JOIN receipts r ON r.id=b.receipt_id WHERE b.id=$1`,[core.remainingBundle]);
  const {rows:loads}=await c.query(`SELECT l.id,l.code,count(*)::int quantity FROM loading_orders l
    JOIN loading_items i ON i.loading_id=l.id JOIN bundles b ON b.id=i.bundle_id
    WHERE b.receipt_id=$1 GROUP BY l.id,l.code`,[target.id]);
  assert.equal(loads.length,1);assert(target.units>=2);
  const load=loads[0],parameters={receipt_code:target.code,receipt_day:target.receipt_day,expected_units:target.units,
   load_code:load.code,expected_loaded:load.quantity};
  const purge=(apply,args=parameters)=>spawnSync(process.env.WMS_TEST_PSQL||'psql',[
   '-X','-h',owner.hostname,'-p',owner.port,'-U',decodeURIComponent(owner.username),'-d',fixture.database,
   ...Object.entries({...args,apply}).flatMap(([key,value])=>['-v',key+'='+value]),'-f','deploy/remove-copper-test-chain.sql'
  ],{cwd:E.root,env:{...process.env,PGPASSWORD:decodeURIComponent(owner.password)},encoding:'utf8',windowsHide:true});
  const preserved=async()=>(await c.query(`SELECT
   (SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) FROM users u) accounts,
   (SELECT md5(string_agg(to_jsonb(b)::text,',' ORDER BY id)) FROM bundles b WHERE receipt_id IS DISTINCT FROM $1) other_bundles,
   (SELECT md5(string_agg(to_jsonb(l)::text,',' ORDER BY id)) FROM loading_orders l WHERE id<>$2) other_loads,
   (SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY tgrelid,tgname)) FROM pg_trigger t WHERE NOT tgisinternal) guards`,[target.id,load.id])).rows[0];
  const before=await preserved();
  const wrong=purge(true,{...parameters,expected_units:target.units+1});
  assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/TEST_RECEIPT_IDENTITY_CHANGED/);
  const dry=purge(false);assert.equal(dry.status,0,dry.stderr);assert.match(dry.stdout,/TEST_RECEIPT_CLEANUP_DRY_RUN_ROLLED_BACK/);
  assert.equal((await c.query('SELECT count(*)::int n FROM bundles WHERE receipt_id=$1',[target.id])).rows[0].n,target.units);
  assert.deepEqual(await preserved(),before);
  const applied=purge(true);assert.equal(applied.status,0,applied.stderr);assert.match(applied.stdout,/TEST_RECEIPT_CLEANUP_COMMITTED/);
  const absence=(await c.query(`SELECT (SELECT count(*)::int FROM receipts WHERE id=$1) receipts,
   (SELECT count(*)::int FROM bundles WHERE receipt_id=$1) bundles,
   (SELECT count(*)::int FROM loading_orders WHERE id=$2) loads,
   (SELECT count(*)::int FROM inventory_events WHERE receipt_id=$1) events,
   (SELECT count(*)::int FROM audit_logs WHERE action='test_receipt_chain_removed' AND entity_id=$1::uuid::text) audit`,[target.id,load.id])).rows[0];
  assert.deepEqual(absence,{receipts:0,bundles:0,loads:0,events:0,audit:1});
  assert.deepEqual(await preserved(),before);
  const replay=purge(true);assert.equal(replay.status,0,replay.stderr);assert.match(replay.stderr,/TEST_RECEIPT_ALREADY_ABSENT/);
 }finally{await c.end();}
});
