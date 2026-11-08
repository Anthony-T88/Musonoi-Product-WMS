'use strict';
const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg'),{createHash}=require('node:crypto');
const {root}=require('../server/config.cjs');const runtime=path.join(root,'.runtime');
function ownerConfig(database='postgres'){return {host:'127.0.0.1',port:55432,user:'musonoi_owner',password:fs.readFileSync(path.join(runtime,'pg-password.txt'),'utf8').trim(),database};}
async function migrate(database,through=null){
 if((process.env.APP_ENV||'test')!=='test'||!/^musonoi_[a-z0-9_]+_test$/.test(database))throw Error('Unexpected database target');
 const client=new Client(ownerConfig(database));await client.connect();try{
 await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(21001)');
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 if(through&&!fs.existsSync(path.join(root,'db/migrations',through)))throw Error('Unknown historical fixture baseline');
 for(const file of fs.readdirSync(path.join(root,'db/migrations')).filter(x=>x.endsWith('.sql')&&(!through||x<=through)).sort()){
 const sql=fs.readFileSync(path.join(root,'db/migrations',file),'utf8'),hash=createHash('sha256').update(sql).digest('hex'),old=(await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[file])).rows[0];
 if(old){if(old.checksum!==hash)throw Error('Applied migration checksum changed: '+file);continue;}
 await client.query(sql);await client.query('INSERT INTO schema_migrations VALUES($1,$2,now())',[file,hash]);}
 const environment=process.env.APP_ENV||'test';
 await client.query('INSERT INTO system_info VALUES(true,$1) ON CONFLICT DO NOTHING',[environment]);
 if((await client.query('SELECT environment FROM system_info')).rows[0].environment!==environment)throw Error('Database environment mismatch');
 await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO musonoi_app');
 await client.query('GRANT SELECT ON roles,permissions,role_permissions,projects,customers,warehouses,locations,batches,bundles,inventory_view,user_scopes,system_info TO musonoi_app');
 await client.query('GRANT SELECT,INSERT,UPDATE ON users TO musonoi_app; GRANT SELECT,INSERT,UPDATE,DELETE ON sessions TO musonoi_app; GRANT SELECT,INSERT ON audit_logs TO musonoi_app; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO musonoi_app');
 await client.query('COMMIT');console.log('Migrations applied and least-privilege grants verified: '+database);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}

module.exports={ownerConfig,migrate};
if(require.main===module){if(process.argv[2]!=='migrate'||!process.argv[3]){console.error('Use migrate <explicit_TEST_database>');process.exitCode=1;}else migrate(process.argv[3]).catch(e=>{console.error(e.message);process.exitCode=1;});}
