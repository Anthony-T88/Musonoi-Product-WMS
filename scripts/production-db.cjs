'use strict';
// Explicit maintenance entrypoint; no application owner credentials are needed at runtime.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),DB=require('../server/database-connection.cjs'),M=require('./maintenance-connection.cjs');
async function migrate(client,{apply=false,backupVerified=false,appPassword,environment='production'}={}){
 if(!['production','test'].includes(environment))DB.fail('MIGRATION_INVALID_ENVIRONMENT');
 await client.query('BEGIN');try{
 await client.query('SELECT pg_advisory_xact_lock(21001)');
 const existing=(await client.query("SELECT to_regclass('public.system_info') existing")).rows[0].existing;
 if(existing){if((await client.query('SELECT environment FROM system_info WHERE singleton')).rows[0]?.environment!==environment)DB.fail('MIGRATION_TEST_CONVERSION_FORBIDDEN');if(apply&&!backupVerified)DB.fail('MIGRATION_VERIFIED_BACKUP_REQUIRED');}
 const role=(await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='musonoi_app'")).rows[0];
 if(role&&Object.values(role).some(Boolean))DB.fail('DB_APP_ROLE_PRIVILEGED');
 if(!role){if(typeof appPassword!=='string'||appPassword.length<24)DB.fail('DB_APP_SECRET_REQUIRED');await client.query('CREATE ROLE musonoi_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '+client.escapeLiteral(appPassword));}
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 const folder=path.join(__dirname,'../db/migrations'),files=fs.readdirSync(folder).filter(f=>f.endsWith('.sql')).sort();if(files.length!==138)DB.fail('MIGRATION_CHAIN_UNEXPECTED');
 let added=0;for(const file of files){const sql=fs.readFileSync(path.join(folder,file),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex'),old=(await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[file])).rows[0];if(old){if(old.checksum!==checksum)DB.fail('MIGRATION_CHECKSUM_CHANGED');continue;}await client.query(sql);await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[file,checksum]);added++;}
 await client.query('INSERT INTO system_info(singleton,environment) VALUES(true,$1) ON CONFLICT DO NOTHING',[environment]);
 await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO musonoi_app');
 await client.query('GRANT SELECT ON roles,permissions,role_permissions,projects,customers,warehouses,locations,batches,bundles,inventory_view,user_scopes,system_info TO musonoi_app');
 await client.query('GRANT SELECT,INSERT,UPDATE ON users TO musonoi_app; GRANT SELECT,INSERT,UPDATE,DELETE ON sessions TO musonoi_app; GRANT SELECT,INSERT ON audit_logs TO musonoi_app; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO musonoi_app');
 await client.query(apply?'COMMIT':'ROLLBACK');return {status:apply?'APPLIED':'DRY_RUN_ROLLED_BACK',migrations:files.length,added};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={migrate};
if(require.main===module)(async()=>{const cfg=M.configuration(),apply=M.authorize(process.argv.slice(2),cfg),c=await M.open(cfg);try{console.log(JSON.stringify(await migrate(c,{apply,backupVerified:process.env.PRODUCTION_BACKUP_VERIFIED==='yes',appPassword:process.env.APP_DB_PASSWORD})));}finally{await c.end();}})().catch(e=>{console.error(JSON.stringify(DB.safeError(e)));process.exitCode=1;});
