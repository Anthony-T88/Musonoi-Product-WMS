'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{Client}=require('pg'),E=require('./environment.cjs');
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Docker acceptance uses only the ephemeral CI database');
const docker=(args,options={})=>(execFileSync('docker',args,{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],...options})||'').trim(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const results={status:'RUNNING',checks:[],syntheticOnly:true},check=async(name,fn)=>{await fn();results.checks.push({name,status:'PASS'});console.log('PASS '+name);};
(async()=>{const image='musonoi-rc2:ci',f=E.fixture(),c=new Client(E.options(f.database));await c.connect();const names=[];try{
 await check('actual image build with unchanged default-deny packaging design',async()=>{docker(['build','--progress=plain','-f','deploy/Dockerfile','-t',image,'.'],{stdio:'inherit'});});
 await check('final image file inventory excludes backups, private env, keys, runtime and test credentials',async()=>{
  assert.equal(docker(['image','inspect',image,'--format','{{.Config.User}}']),'node');
  results.imageId=docker(['image','inspect',image,'--format','{{.Id}}']);
  const needles=[process.env.POSTGRES_PASSWORD,process.env.WMS_TEST_APP_PASSWORD,...f.accounts.map(a=>a.password)].filter(Boolean);
  const listing=docker(['run','--rm','--user','0','-e','SCAN_NEEDLES','--entrypoint','node',image,'-e',"const fs=require('fs'),needles=JSON.parse(process.env.SCAN_NEEDLES).map(v=>Buffer.from(v));function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=(p==='/'?'':p)+'/'+e.name;if(['/proc','/sys','/dev'].includes(q))continue;if(e.isDirectory())walk(q);else{console.log(q);if(e.isFile()&&fs.statSync(q).size<16777216){const b=fs.readFileSync(q);if(needles.some(n=>b.includes(n)))throw Error('CI credential in image: '+q);if(/\\.(pem|key)$/.test(q)&&/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(b.toString()))throw Error('Private key in image: '+q)}}}}walk('/')"],{env:{...process.env,SCAN_NEEDLES:JSON.stringify(needles)}});
  fs.writeFileSync(path.join(E.runtime,'docker-image-files.txt'),listing+'\n');
  results.imageFileCount=listing.split('\n').length;
  const unsafe=listing.split('\n').filter(p=>p.startsWith('/app/')).filter(p=>/(?:\/\.runtime\/|\/backups\/|\/\.env$|\.(?:key|pem|enc|dump|backup)$|rc2-canary)/.test(p)||!p.startsWith('/app/node_modules/')&&p.includes('/private/'));
  assert.deepEqual(unsafe,[],'Sensitive application file paths');
  results.reviewedPublicFixtures=listing.split('\n').filter(p=>p.startsWith('/app/node_modules/')&&p.includes('/private/'));
  const imageEnv=docker(['image','inspect',image,'--format','{{json .Config.Env}}']);for(const secret of [process.env.POSTGRES_PASSWORD,process.env.WMS_TEST_APP_PASSWORD,...f.accounts.map(a=>a.password)])assert(!secret||!imageEnv.includes(secret));
  assert.equal(docker(['run','--rm','--entrypoint','node',image,'-e','process.stdout.write(String(process.getuid()))']),'1000');
 });
 await check('missing production configuration fails closed',async()=>{let code=0;try{docker(['run','--rm',image]);}catch(e){code=e.status;}assert.notEqual(code,0);});
 await c.query("UPDATE system_info SET environment='production'");
 const url=new URL(f.appCfg.databaseUrl);url.hostname='rc2-postgres';url.port='5432';
 const env={...process.env,DATABASE_URL:url.href,APP_ORIGIN:'https://ci.example.invalid',DB_ALLOWED_HOSTS:'rc2-postgres',DB_EXPECTED_NAME:f.database,DB_TLS_CA_FILE:'/certs/root.crt',DB_EXPECTED_MAJOR:'16'};
 const args=['--network','rc2-ci-net',...['DATABASE_URL','APP_ORIGIN','DB_ALLOWED_HOSTS','DB_EXPECTED_NAME','DB_TLS_CA_FILE','DB_EXPECTED_MAJOR'].flatMap(k=>['-e',k]),'-v',path.resolve('.runtime/ci-tls/server.crt')+':/certs/root.crt:ro'];
 await check('public database CA mount, production TLS, migration verification and real application startup',async()=>{
  docker(['run','-d','--name','rc2-app',...args,'-p','127.0.0.1:4174:4174','-v','rc2-ci-uploads:/app/uploads',image],{env});names.push('rc2-app');
  let healthy=false;for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:4174/api/v1/health');if(r.ok&&(await r.json()).database==='ok'){healthy=true;break;}}catch{}await wait(200);}if(!healthy){console.log(docker(['logs','rc2-app']).replaceAll(url.href,'[DATABASE_URL REDACTED]'));}assert(healthy,'production TLS startup');
 });
 await check('uploads volume persists across independent non-root containers',async()=>{
  docker(['exec','rc2-app','node','-e',"require('fs').writeFileSync('/app/uploads/rc2-persistence','synthetic attachment')"]);
  docker(['stop','rc2-app']);docker(['rm','rc2-app']);names.length=0;
  assert.equal(docker(['run','--rm','-v','rc2-ci-uploads:/app/uploads','--entrypoint','node',image,'-e',"process.stdout.write(require('fs').readFileSync('/app/uploads/rc2-persistence','utf8'))"]),'synthetic attachment');
 });
 await check('valid but untrusted CA certificate causes TLS handshake failure',async()=>{let code=0,error='';const badArgs=args.map(v=>v===path.resolve('.runtime/ci-tls/server.crt')+':/certs/root.crt:ro'?path.resolve('.runtime/ci-tls/wrong.crt')+':/certs/root.crt:ro':v);try{docker(['run','--rm',...badArgs,image],{env});}catch(e){code=e.status;error=String(e.stderr);}assert.notEqual(code,0);assert.match(error,/DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE/);});
 await check('missing latest migration is refused at startup even with valid database TLS',async()=>{
  await c.query("DELETE FROM schema_migrations WHERE version='174_r3_reliable_audit_entity_scopes.sql'");let code=0,error='';try{docker(['run','--rm',...args,image],{env});}catch(e){code=e.status;error=String(e.stderr);}assert.notEqual(code,0);assert.match(error,/DB_SECURITY_SCHEMA_REQUIRED/);
 });
 results.status='PASS';
 }finally{for(const name of names){try{docker(['rm','-f',name]);}catch{}}await c.end();if(results.status!=='PASS')results.status='FAIL';E.save('docker-results.json',results);}
})().catch(e=>{console.error('Docker acceptance failed:',e.code||e.name);process.exitCode=1;});
