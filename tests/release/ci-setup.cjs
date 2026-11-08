'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
if(process.env.GITHUB_ACTIONS!=='true'||!process.env.GITHUB_ENV)throw Error('Ephemeral GitHub CI only');
fs.mkdirSync('.runtime/ci-tls',{recursive:true});
const owner=crypto.randomBytes(32).toString('base64url'),app=crypto.randomBytes(32).toString('base64url');
const env={POSTGRES_PASSWORD:owner,WMS_TEST_OWNER_URL:'postgresql://musonoi_owner:'+owner+'@127.0.0.1:55432/postgres',WMS_TEST_APP_PASSWORD:app};
for(const value of Object.values(env))console.log('::add-mask::'+value);
fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=rc2-postgres','-addext','subjectAltName=DNS:rc2-postgres,IP:127.0.0.1','-keyout','.runtime/ci-tls/server.key','-out','.runtime/ci-tls/server.crt'],{stdio:'ignore'});
fs.chmodSync('.runtime/ci-tls/server.key',0o600);
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=untrusted-ci-ca','-keyout','.runtime/ci-tls/wrong.key','-out','.runtime/ci-tls/wrong.crt'],{stdio:'ignore'});
for(const [p,v]of [['.env','CI_CANARY_ENV_DO_NOT_SHIP=yes'],['server/private/rc2-canary.key','CI_CANARY_PRIVATE_DO_NOT_SHIP'],['db/private/rc2-canary.dump','CI_CANARY_DATABASE_DO_NOT_SHIP'],['uploads/rc2-canary.txt','CI_CANARY_UPLOAD_DO_NOT_SHIP']]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);}
console.log('Generated fresh CI-only database credentials, short-lived TLS material and build canaries.');
