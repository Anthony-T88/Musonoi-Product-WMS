'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const historical=require('../../db/migration-baseline.json').migrations.slice(0,174);
// Pin the audited 174-entry chain independently of the review branches.
assert.equal(crypto.createHash('sha256').update(JSON.stringify(historical)).digest('hex'),'ed03f2c4e05a64ef0d8932423249d14b29f0177f533eda34a31e5444be8384ee');
for(const m of historical){assert.equal(crypto.createHash('sha256').update(fs.readFileSync('db/migrations/'+m.version)).digest('hex'),m.checksum,'Historical migration bytes: '+m.version);}
let count=0;for(const dir of ['server','scripts','tests/release','dist']){const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(?:cjs|js)$/.test(p)){execFileSync(process.execPath,['--check',p],{stdio:'pipe'});count++;}}};walk(dir);}
const source=require('../../server/release-integrity.cjs').verify(process.cwd());
const release=require('../../server/release.cjs'),manifest=require('../../RELEASE_MANIFEST.json');
assert.equal(manifest.version,release.version);
const chain=require('../../scripts/migration-chain.cjs').load();
assert.equal(manifest.runtimeRequiredMigrations,chain.length);
assert.equal(release.requiredMigration,chain.at(-1).version);
assert.equal(manifest.sourceFiles,source.files);
const vm=require('node:vm'),client={};
vm.runInNewContext(fs.readFileSync('dist/release.js','utf8'),client);
for(const [field,serverField] of [['version','version'],['displayVersion','displayVersion'],['revision','frontendRevision']]){
 assert.equal(client.ClientRelease[field],release[serverField]);
}
const shell=fs.readFileSync('dist/index.html','utf8'),worker=fs.readFileSync('dist/sw.js','utf8');
assert(shell.includes('/release.js?rev='+release.frontendRevision));
assert(worker.includes('/release.js?rev='+release.frontendRevision)&&worker.includes("'musonoi-static-'+ClientRelease.revision"));
for(const file of manifest.files){
 assert.equal(path.resolve(file.path).startsWith(process.cwd()+path.sep),true);
 const bytes=fs.readFileSync(file.path);
 assert.equal(bytes.length,file.bytes,file.path);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
}
console.log(JSON.stringify({status:'PASS',version:release.version,syntaxFiles:count,sourceFiles:source.files,releaseFiles:manifest.files.length,historicalMigrationsUnchanged:historical.length}));
