'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Chain=require('../../scripts/migration-chain.cjs');
const root=path.resolve(__dirname,'../..'),chain=Chain.load();
test('release migration baseline accepts the reviewed chain and known historical filename gaps',()=>{assert.equal(chain.length,173);assert.equal(chain.at(-1).version,'173_r3_security_scope_and_sessions.sql');assert(chain.some(e=>e.version==='004b_bundle_row_lock.sql'));});
test('applied migrations must be a checksum-matching prefix; unknown versions and holes fail closed',()=>{
 assert.equal(Chain.applied([],chain).size,0);assert.equal(Chain.applied(chain.slice(0,138),chain).size,138);assert.equal(Chain.applied(chain,chain,{complete:true}).size,173);
 for(const [rows,options,code] of [[[{version:'999_unknown.sql',checksum:'a'.repeat(64)}],{},'MIGRATION_DATABASE_VERSION_UNKNOWN'],[[{...chain[0],checksum:'a'.repeat(64)}],{},'MIGRATION_CHECKSUM_CHANGED'],[[chain[1]],{},'MIGRATION_DATABASE_HISTORY_GAP'],[chain.slice(0,-1),{complete:true},'MIGRATION_DATABASE_INCOMPLETE']])assert.throws(()=>Chain.applied(rows,chain,options),{code});
});
test('missing, injected, edited SQL and reordered baseline are rejected before any database query',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'musonoi-migration-test-')),sql=path.join(dir,'migrations');fs.cpSync(path.join(root,'db/migrations'),sql,{recursive:true});const base=path.join(dir,'baseline.json');fs.copyFileSync(path.join(root,'db/migration-baseline.json'),base);const options={directory:sql,baselineFile:base},first=chain[0];
 fs.renameSync(path.join(sql,first.version),path.join(dir,first.version));assert.throws(()=>Chain.load(options),{code:'MIGRATION_CHAIN_UNEXPECTED'});fs.renameSync(path.join(dir,first.version),path.join(sql,first.version));
 fs.writeFileSync(path.join(sql,'999_injected.sql'),'SELECT 1;');assert.throws(()=>Chain.load(options),{code:'MIGRATION_CHAIN_UNEXPECTED'});fs.unlinkSync(path.join(sql,'999_injected.sql'));
 fs.appendFileSync(path.join(sql,first.version),'\n-- changed');assert.throws(()=>Chain.load(options),{code:'MIGRATION_SOURCE_CHECKSUM_CHANGED'});fs.copyFileSync(path.join(root,'db/migrations',first.version),path.join(sql,first.version));
 const b=JSON.parse(fs.readFileSync(base));b.migrations.reverse();fs.writeFileSync(base,JSON.stringify(b));assert.throws(()=>Chain.load(options),{code:'MIGRATION_BASELINE_INVALID'});
});
test('172 exact signatures and function snapshots reject silent replacement drift and overloads',async()=>{
 const fixture=require('./fixtures/172-functions.json');
 for(const stage of ['before','after']){const rows=fixture[stage].map(r=>({...r}));await Chain.guard172({query:async()=>({rows})},stage);await assert.rejects(()=>Chain.guard172({query:async()=>({rows:rows.slice(1)})},stage),{code:'MIGRATION_172_FUNCTION_BASELINE_MISMATCH'});await assert.rejects(()=>Chain.guard172({query:async()=>({rows:[...rows,{...rows[0],signature:'unexpected()'}]})},stage),{code:'MIGRATION_172_FUNCTION_BASELINE_MISMATCH'});rows[0].body+='\n-- drift';await assert.rejects(()=>Chain.guard172({query:async()=>({rows})},stage),{code:'MIGRATION_172_FUNCTION_BASELINE_MISMATCH'});}
 assert(fixture.before.every((b,i)=>b.bodySha256!==fixture.after[i].bodySha256));
});
