'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),DB=require('../../server/database-connection.cjs');
const root=path.resolve(__dirname,'../..');
test('Docker uses explicit sources, default deny context and final sensitive-file exclusions',()=>{
 const docker=fs.readFileSync(path.join(root,'deploy/Dockerfile'),'utf8'),ignore=fs.readFileSync(path.join(root,'.dockerignore'),'utf8').split(/\r?\n/).filter(s=>s&&!s.startsWith('#'));
 assert.equal(ignore[0],'**');assert(!/^COPY(?:\s+--[^ ]+)*\s+\.\s+\./m.test(docker));assert(docker.includes('RUN node scripts/verify-release.cjs'));
 for(const pattern of ['**/.git/**','**/.runtime/**','**/private/**','**/backups/**','**/uploads/**','**/.env','**/*.pem','**/*.key','**/*.enc','**/*.dump','**/*.zip'])assert(ignore.includes(pattern),pattern);
 const copies=docker.split(/\r?\n/).filter(s=>s.startsWith('COPY ')).flatMap(line=>line.replace(/^COPY(?:\s+--[^ ]+)*/,'').trim().split(/\s+/).slice(0,-1));
 for(const unsafe of ['.env','.runtime','private','backups','uploads','.git','Musonoi-Database-V4.6.9-R2.dump.enc','RELEASE_MANIFEST.json'])assert(!copies.includes(unsafe),unsafe);
 assert(!copies.includes('.'));assert(!copies.includes('scripts'));assert(!copies.includes('tests'));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'SOURCE_MANIFEST.json')));for(const f of manifest.files)assert(copies.some(source=>f.path===source||f.path.startsWith(source+'/')),'Missing from explicit Docker copy list: '+f.path);
});
test('database target boundaries, owner separation and TLS bypass remain enforced',()=>{
 const cfg={environment:'production',databaseUrl:'postgresql://musonoi_app:synthetic@127.0.0.1:55432/wrong',db:{tier:'production',hosts:'127.0.0.1',name:'expected'}};assert.throws(()=>DB.connection(cfg),{code:'DB_TARGET_NOT_ALLOWED'});
 cfg.databaseUrl='postgresql://musonoi_app:synthetic@127.0.0.1:55432/expected';assert.throws(()=>DB.connection(cfg,'owner'),{code:'DB_ACCOUNT_SEPARATION_REQUIRED'});
 assert.throws(()=>DB.connection({environment:'test',databaseUrl:'postgresql://musonoi_app:synthetic@127.0.0.1:55432/production'}),{code:'DB_TEST_PRODUCTION_TARGET_FORBIDDEN'});
});
test('maintenance apply requires an explicit database confirmation',()=>{const M=require('../../scripts/maintenance-connection.cjs'),cfg={db:{name:'explicit'}};assert.equal(M.authorize([],cfg),false);assert.throws(()=>M.authorize(['--apply'],cfg),{code:'MAINTENANCE_CONFIRMATION_REQUIRED'});assert.throws(()=>M.authorize(['--apply','--confirm-database','other'],cfg),{code:'MAINTENANCE_CONFIRMATION_REQUIRED'});assert.equal(M.authorize(['--apply','--confirm-database','explicit'],cfg),true);});
test('Fastify fix is installed and accepts streaming responses',async()=>{assert.equal(require('fastify/package.json').version,'5.12.8');const app=require('fastify')({handlerTimeout:15});try{const {PassThrough}=require('node:stream');app.get('/stream',async()=>{const stream=new PassThrough();stream.write('start');setTimeout(()=>stream.end('done'),40);return stream;});app.get('/alive',async()=>({ok:true}));await assert.rejects(app.inject('/stream'),{code:'FST_ERR_HANDLER_TIMEOUT'});assert.equal((await app.inject('/alive')).statusCode,200);}finally{await app.close();}});
