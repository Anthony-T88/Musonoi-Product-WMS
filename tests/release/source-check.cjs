'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const baseline='28988c4b814d1120414effc787c9566bf91c022f';
const before=JSON.parse(execFileSync('git',['show',baseline+':db/migration-baseline.json'],{encoding:'utf8'}));
for(const m of before.migrations){assert.equal(crypto.createHash('sha256').update(fs.readFileSync('db/migrations/'+m.version)).digest('hex'),m.checksum,'Historical migration bytes: '+m.version);}
let count=0;for(const dir of ['server','scripts','tests/release','dist']){const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(?:cjs|js)$/.test(p)){execFileSync(process.execPath,['--check',p],{stdio:'pipe'});count++;}}};walk(dir);}
require('../../server/release-integrity.cjs').verify(process.cwd());
console.log(JSON.stringify({status:'PASS',syntaxFiles:count,historicalMigrationsUnchanged:before.migrations.length}));
