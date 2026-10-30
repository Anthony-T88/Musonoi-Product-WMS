'use strict';
const fs=require('node:fs'),path=require('node:path'),{Pool,Client}=require('pg'),{createHash,randomBytes}=require('node:crypto');
const {root}=require('../server/config.cjs'),{hashPassword}=require('../server/security.cjs');
const runtime=path.join(root,'.runtime');fs.mkdirSync(runtime,{recursive:true});
function ownerConfig(database='postgres'){return {host:'127.0.0.1',port:55432,user:'musonoi_owner',password:fs.readFileSync(path.join(runtime,'pg-password.txt'),'utf8').trim(),database};}
async function provision(){
 const client=new Client(ownerConfig());await client.connect();try{
 const appPassword=randomBytes(24).toString('hex');
 if(!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='musonoi_app'")).rowCount)await client.query(`CREATE ROLE musonoi_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
 else throw Error('App role already exists; provision refused to rotate credentials. Use existing .env.');
 await client.query('CREATE DATABASE musonoi_inventory_v25_test OWNER musonoi_owner');
 fs.writeFileSync(path.join(root,'.env'),`APP_ENV=test\nPORT=4174\nAPP_ORIGIN=http://127.0.0.1:4174\nDATABASE_URL=postgresql://musonoi_app:${appPassword}@127.0.0.1:55432/musonoi_inventory_v25_test\n`,{mode:0o600});
 console.log('Provisioned isolated local database; app credentials written only to ignored .env');
 }finally{await client.end();}
}
async function migrate(database='musonoi_inventory_v25_test',through=null){
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
async function seed(database='musonoi_inventory_v25_test',accountFile='test-accounts.json',storageFixture=false){
 if(!/^[a-zA-Z0-9_-]+\.json$/.test(accountFile))throw Error('Invalid local credential filename');
 if((process.env.APP_ENV||'test')!=='test')throw Error('Test seed is forbidden outside APP_ENV=test');
 if(!/^musonoi_[a-z0-9_]+_test$/.test(database))throw Error('Test database name required');
 const client=new Client(ownerConfig(database));await client.connect();try{await client.query('BEGIN');
 if((await client.query('SELECT environment FROM system_info')).rows[0].environment!=='test')throw Error('Not a test database');
 if((await client.query("SELECT to_regprocedure('storage_assert_location(uuid,boolean)') AS guard")).rows[0].guard)throw Error('Historical mixed demo seed must be imported before storage guard migration; restore a verified TEST baseline instead.');
 if(Number((await client.query('SELECT count(*) FROM bundles')).rows[0].count)>0)throw Error('Seed refused: inventory already exists');
 const pid=(await client.query("INSERT INTO projects(code,name) VALUES('MSN','穆松尼项目（隔离测试）') RETURNING id")).rows[0].id;
 const wid=(await client.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'YARD-01','测试堆场') RETURNING id",[pid])).rows[0].id;
 const I=require('../dist/demo-data.js'),maps={customer:new Map(),location:new Map(),batch:new Map()};
 for(const k of Object.keys(maps))for(const [i,value] of [...new Set(I.data.map(r=>r[k]))].entries()){
 let row;if(k==='customer')row=await client.query('INSERT INTO customers(project_id,code,name) VALUES($1,$2,$3) RETURNING id',[pid,'C'+i,value]);
 if(k==='location')row=await client.query('INSERT INTO locations(project_id,warehouse_id,code) VALUES($1,$2,$3) RETURNING id',[pid,wid,value]);
 if(k==='batch')row=await client.query('INSERT INTO batches(project_id,code) VALUES($1,$2) RETURNING id',[pid,value]);maps[k].set(value,row.rows[0].id);}
 for(const r of I.data){let fixtureLocation=maps.location.get(r.location);if(storageFixture)fixtureLocation=(await client.query('INSERT INTO locations(project_id,warehouse_id,code) VALUES($1,$2,$3) RETURNING id',[pid,wid,'REG-'+r.id])).rows[0].id;await client.query('INSERT INTO bundles(bundle_no,project_id,batch_id,location_id,customer_id,reserved_for_customer_id,net_weight,physical_status,sample_status,inbound_date,inbound_at,data_kind,grade,purity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'DEMO\',$12,$13)',[r.id,pid,maps.batch.get(r.batch),fixtureLocation,maps.customer.get(r.customer),r.status==='已预留'?maps.customer.get(r.customer):null,r.weight.toFixed(6),r.status==='已出库'?'OUTBOUND':'IN_STOCK',{'未取样':'NOT_SAMPLED','取样中':'SAMPLING','已取样':'SAMPLED'}[r.sample],r.date,r.date+'T08:00:00Z',r.grade,r.purity]);}
 const accounts=[];for(const [username,role] of [['test_admin','admin'],['test_viewer','readonly'],['test_sales','sales']]){
 const password=randomBytes(15).toString('base64url')+'a7!';const uid=(await client.query('INSERT INTO users(username,display_name,password_hash,role_code) VALUES($1,$2,$3,$4) RETURNING id',[username,{'admin':'测试管理员','readonly':'测试只读用户','sales':'测试销售'}[role],hashPassword(password),role])).rows[0].id;
 await client.query('INSERT INTO user_scopes(user_id,project_id,customer_id) VALUES($1,$2,$3)',[uid,pid,role==='admin'?null:[...maps.customer.values()][0]]);accounts.push({username,password,role});}
 await require('./opening-snapshot.cjs')(client,storageFixture); // Explicit TEST-only aged reservations at insertion, never rewrite history.
 await client.query('INSERT INTO audit_logs(action,entity_type,after_data) VALUES($1,$2,$3)',['test_seed','test_fixture',{count:128,data_kind:'DEMO'}]);
 await client.query('COMMIT');fs.writeFileSync(path.join(runtime,accountFile),JSON.stringify(accounts,null,2),{mode:0o600});console.log((storageFixture?'EXPLICIT compliant TEST fixture: one original demo bundle per REG location; no historical business data altered. ':'')+'Seeded 128 DEMO records and 3 accounts. Credentials written only to ignored runtime JSON.');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}
module.exports={ownerConfig,migrate,seed};
if(require.main===module)(async()=>{const task=process.argv[2];if(task==='provision')await provision();else if(task==='migrate')await migrate(process.argv[3]);else if(task==='seed-test')await seed();else throw Error('Use provision | migrate [database] | seed-test');})().catch(e=>{console.error(e.message);process.exitCode=1;});
