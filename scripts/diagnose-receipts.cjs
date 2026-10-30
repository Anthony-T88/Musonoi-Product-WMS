'use strict';
const fs=require('fs'),crypto=require('crypto'),{Client}=require('pg'),{ownerConfig}=require('./db.cjs');
(async()=>{const c=new Client(ownerConfig('musonoi_v26_development_test'));await c.connect();try{
 console.log('database',(await c.query('select current_database(),environment from system_info')).rows);
 const m=(await c.query('select version,checksum from schema_migrations order by version')).rows;
 console.log('migrations',{count:m.length,last:m.at(-1).version,drift:m.filter(r=>crypto.createHash('sha256').update(fs.readFileSync('db/migrations/'+r.version)).digest('hex')!==r.checksum).map(r=>r.version)});
 console.log('receipt states',(await c.query('select status,workflow_version,(submitted_by is null) missing_submitter,count(*) from receipts group by 1,2,3')).rows);
 console.log('active identities',(await c.query('select username,role_code from users where active order by username')).rows);
 const def=(await c.query("select pg_get_functiondef('confirm_receipt(uuid,uuid,integer)'::regprocedure) def")).rows[0].def;
 console.log('nullable self-review expression',def.includes('self_review_exception=(actor=r.created_by OR actor=r.submitted_by)'));
 console.log('totals',(await c.query('select (select count(*) from receipts) receipts,(select count(*) from bundles) bundles')).rows);
 const tables=(await c.query("select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','sessions','audit_logs') order by tablename")).rows;
 const fingerprints={};for(const {tablename:t} of tables){if(!/^[a-z0-9_]+$/.test(t))throw Error('Unexpected table name');fingerprints[t]=(await c.query(`select count(*)::int rows,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) digest from "${t}" t`)).rows[0];}
 if(process.argv[2]==='--snapshot'){fs.writeFileSync('test-output/receipt-repair-before.json',JSON.stringify(fingerprints,null,2));console.log('saved data fingerprints',tables.length);}
 if(process.argv[2]==='--compare'){const original=JSON.parse(fs.readFileSync('test-output/receipt-repair-before.json'));const changes=Object.keys(original).filter(t=>JSON.stringify(original[t])!==JSON.stringify(fingerprints[t]));if(changes.length)throw Error('Data changed: '+changes.join(','));console.log('unchanged business/security tables',tables.length);fs.writeFileSync('test-output/receipt-repair-data-preservation.json',JSON.stringify({status:'PASS',tables:tables.length,changes,excluded:['schema_migrations','sessions','audit_logs']},null,2));}
}finally{await c.end();}})().catch(e=>{console.error(e.code,e.message);process.exitCode=1;});
