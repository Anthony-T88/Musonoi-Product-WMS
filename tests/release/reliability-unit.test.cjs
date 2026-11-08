'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Lease=require('../../server/authorization-lease.cjs');
test('co matching review catalog only offers the approved site supervisor role',()=>{
 const P=require('../../server/workflow-permissions.cjs');
 assert.deepEqual(P.catalog['co:loading-review'].roles,['site_supervisor']);
 assert.equal(P.assignable('admin','co:loading-review'),false);
 assert.equal(P.assignable('site_supervisor','co:loading-review'),true);
});
test('cancelled request cannot retain an authorization lease',async()=>{
 let returned=0;const client={query:async()=>({rows:[]}),release:()=>returned++};
 await assert.rejects(()=>Lease.acquire({raw:{aborted:true}},{connect:async()=>client}));
 assert.equal(returned,0,'already cancelled request must not take a connection');
});
test('rollback failure destroys rather than recycles a leased connection',async()=>{
 const error=Error('synthetic disconnected connection');let released;
 const req={authorizationLease:{query:async()=>{throw error;},release:e=>{released=e;}}};
 await Lease.release(req).catch(()=>{});assert.equal(released,error);assert.equal(req.authorizationLease,null);
});
test('only exact configured immediate proxies can supply a single client IP',()=>{
 const {policy}=require('../../server/trusted-proxy.cjs');assert.equal(policy('').trust,false);
 for(const value of ['true','*','0.0.0.0/0','127.0.0.1/8','invalid'])assert.throws(()=>policy(value));
 const p=policy('127.0.0.1,::1');assert(p.trust('::ffff:127.0.0.1',0));assert(!p.trust('127.0.0.1',1));assert(!p.trust('198.51.100.1',0));
 for(const h of ['192.0.2.1, 192.0.2.2','invalid',''])assert.throws(()=>p.validate({raw:{socket:{remoteAddress:'127.0.0.1'}},headers:{'x-forwarded-for':h}}));
 p.validate({raw:{socket:{remoteAddress:'198.51.100.1'}},headers:{'x-forwarded-for':'forged'}});
});
test('every literal application audit entity has an explicit reviewed scope policy',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..');
 const matrix=require('./fixtures/rc2-audit-entity-matrix.json'),known=new Set(matrix.entries.map(e=>e.entity));
 assert.equal(matrix.defaultPolicy,'ADMIN_ONLY');assert.equal(matrix.historicalBackfill,false);
 for(const file of fs.readdirSync(path.join(root,'server')).filter(f=>f.endsWith('.cjs'))){const source=fs.readFileSync(path.join(root,'server',file),'utf8');for(const m of source.matchAll(/\b(?:B|C)\.audit\([^,\n]+,[^,\n]+,[^,\n]+,\s*(['"])([^'"]+)\1/g))assert(known.has(m[2]),file+': unmapped '+m[2]);}
 for(const entity of ['co_stocktakes','stocktakes','stock_adjustments','sampling_batches','weighings','outbound_corrections','gate_permits','sales_plan_review','sales_plan_close'])assert.equal(matrix.entries.find(e=>e.entity===entity)?.policy,'AUTHORITATIVE',entity);
});
