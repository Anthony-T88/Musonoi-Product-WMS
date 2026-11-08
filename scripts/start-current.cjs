'use strict';
// Local preview never migrates, seeds, resets or cleans a database.
const {config}=require('../server/config.cjs'),release=require('../server/release.cjs'),cfg=config();
if(cfg.environment!=='test')throw Error('Local preview requires TEST');
const url=new URL(cfg.databaseUrl);url.pathname='/musonoi_v26_development_test';const port=Number(process.env.LOCAL_TEST_PORT||process.env.V262_PORT||4176);
require('../server/app.cjs').build({config:{...cfg,databaseUrl:url.href,port,origin:'http://127.0.0.1:'+port}}).then(async app=>{const {Client}=require('pg'),{ownerConfig}=require('./db.cjs'),c=new Client(ownerConfig('musonoi_v26_development_test'));await c.connect();try{if(!(await c.query('SELECT 1 FROM schema_migrations WHERE version=$1',[release.requiredMigration])).rowCount)throw Error('Database migration required before starting '+release.version);}finally{await c.end();}return app.listen({host:'127.0.0.1',port});}).then(address=>console.log('V'+release.version+' local TEST: '+address)).catch(e=>{console.error(e.message);process.exitCode=1;});
