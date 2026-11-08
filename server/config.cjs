'use strict';
const fs=require('node:fs'),path=require('node:path');
require('pg').types.setTypeParser(1082,value=>value);
const root=path.resolve(__dirname,'..');
if(fs.existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
function config(){
 const environment=process.env.APP_ENV||'test';
 if(!['test','production'].includes(environment))throw Error('APP_ENV must be test or production');
 if(environment==='production'&&(!process.env.APP_ORIGIN||!process.env.APP_ORIGIN.startsWith('https://')))throw Error('Production requires an explicit HTTPS APP_ORIGIN');
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required; there is no mock fallback');
 return {root,environment,trustedProxyIps:process.env.TRUSTED_PROXY_IPS,databaseUrl:process.env.DATABASE_URL,db:require('./database-connection.cjs').settings(),host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||4174),secure:environment==='production'||(process.env.APP_ORIGIN||'').startsWith('https://'),origin:process.env.APP_ORIGIN||'http://127.0.0.1:4174'};
}
module.exports={root,config};
