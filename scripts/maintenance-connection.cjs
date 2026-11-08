'use strict';
const {Client}=require('pg'),DB=require('../server/database-connection.cjs');
function configuration(env=process.env){if(env.APP_ENV!=='production')DB.fail('MAINTENANCE_PRODUCTION_MODE_REQUIRED');return {environment:'production',databaseUrl:env.DATABASE_OWNER_URL,db:DB.settings(env)};}
async function open(cfg){const options=DB.connection(cfg,'owner');await DB.network(cfg,options);const c=new Client(options);try{await c.connect();await DB.verify(c,cfg,'owner');return c;}catch(e){await c.end().catch(()=>{});throw e;}}
function authorize(args,cfg){const apply=args.includes('--apply');const i=args.indexOf('--confirm-database');if(apply&&(i<0||args[i+1]!==cfg.db.name))DB.fail('MAINTENANCE_CONFIRMATION_REQUIRED');return apply;}
module.exports={configuration,open,authorize};
