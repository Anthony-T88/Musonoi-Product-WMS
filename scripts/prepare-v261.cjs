const {Client}=require('pg'),{ownerConfig,migrate}=require('./db.cjs');
(async()=>{
 const c=new Client(ownerConfig());await c.connect();try{if(!(await c.query("SELECT 1 FROM pg_database WHERE datname='musonoi_v26_regression_test'")).rowCount)await c.query('CREATE DATABASE musonoi_v26_regression_test TEMPLATE musonoi_map_regression_test OWNER musonoi_owner');}finally{await c.end();}
 // Regressions have a stable historical seed. Never clone today's real working data.
 await migrate('musonoi_v26_regression_test','041_v26_scoped_operations.sql');
 const a=new Client(ownerConfig());await a.connect();try{if(!(await a.query("SELECT 1 FROM pg_database WHERE datname='musonoi_v261_regression_test'")).rowCount)await a.query('CREATE DATABASE musonoi_v261_regression_test TEMPLATE musonoi_v26_regression_test OWNER musonoi_owner');}finally{await a.end();}
 await migrate('musonoi_v261_regression_test');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
