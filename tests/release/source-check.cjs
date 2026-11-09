'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const historical=require('../../db/migration-baseline.json').migrations.slice(0,174);
// Pin the audited 174-entry chain independently of the review branches.
assert.equal(crypto.createHash('sha256').update(JSON.stringify(historical)).digest('hex'),'ed03f2c4e05a64ef0d8932423249d14b29f0177f533eda34a31e5444be8384ee');
for(const m of historical){assert.equal(crypto.createHash('sha256').update(fs.readFileSync('db/migrations/'+m.version)).digest('hex'),m.checksum,'Historical migration bytes: '+m.version);}
let count=0;for(const dir of ['server','scripts','tests/release','dist']){const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(?:cjs|js)$/.test(p)){execFileSync(process.execPath,['--check',p],{stdio:'pipe'});count++;}}};walk(dir);}
require('../../server/release-integrity.cjs').verify(process.cwd());
console.log(JSON.stringify({status:'PASS',syntaxFiles:count,historicalMigrationsUnchanged:historical.length}));
