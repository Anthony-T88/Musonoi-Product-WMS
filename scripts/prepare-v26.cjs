'use strict';
const {Client}=require('pg'),{ownerConfig,migrate}=require('./db.cjs');
(async()=>{const name=process.argv[2]||'musonoi_v26_development_test';if(!/^musonoi_v26_[a-z0-9_]+_test$/.test(name))throw Error('Isolated V2.6 TEST name required');
 const c=new Client(ownerConfig());await c.connect();try{if(!(await c.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await c.query(`CREATE DATABASE "${name}" TEMPLATE musonoi_map_regression_test OWNER musonoi_owner`);}finally{await c.end();}
 const t=new Client(ownerConfig(name));await t.connect();try{if((await t.query('SELECT environment FROM system_info')).rows[0].environment!=='test')throw Error('TEST only');}finally{await t.end();}await migrate(name);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
