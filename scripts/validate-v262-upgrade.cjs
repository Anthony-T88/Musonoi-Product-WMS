'use strict';
const fs=require('fs'),{Client}=require('pg'),{ownerConfig}=require('./db.cjs');
const target='musonoi_v26_development_test',mode=process.argv[2],filename='test-output/v262-upgrade-preservation.json';
const omitted=['requires_sheets','sheets_per_bundle','seal_no','seal_valid','seal_no_snapshot','sheets_snapshot'];
(async()=>{const c=new Client(ownerConfig(target));await c.connect();try{
 if((await c.query('SELECT environment FROM system_info')).rows[0].environment!=='test')throw Error('Only local TEST is authorized');
 if(mode==='preflight'){
 const conflicts=(await c.query("SELECT planned_location_id,array_agg(lot_no) lots,count(*) FROM allocations WHERE planned_location_id IS NOT NULL AND workflow_state NOT IN('CANCELLED','FULFILLED') GROUP BY planned_location_id HAVING count(*)>1")).rows;
 const legacy=(await c.query("SELECT a.id,a.lot_no,a.workflow_state,a.planned_location_id FROM allocations a WHERE a.workflow_state NOT IN('CANCELLED','FULFILLED') ORDER BY created_at")).rows;
 fs.writeFileSync('test-output/v262-upgrade-conflicts.json',JSON.stringify({target,conflicts,existingActiveLots:legacy},null,2));if(conflicts.length)throw Error('Existing location conflicts require explicit resolution; no migration/data change performed');console.log(JSON.stringify({target,conflicts:conflicts.length,existingActiveLots:legacy.length}));return;
 }
 let original;if(mode==='compare')original=JSON.parse(fs.readFileSync(filename));else if(mode!=='snapshot')throw Error('Use preflight, snapshot or compare');
 const tables=original?Object.keys(original.tables):(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows.map(r=>r.tablename),fingerprints={};
 for(const table of tables){if(!/^[a-z0-9_]+$/.test(table))throw Error('Unsafe identifier');fingerprints[table]=(await c.query(`SELECT count(*)::int AS rows,md5(coalesce(jsonb_agg(to_jsonb(t)-$1::text[] ORDER BY (to_jsonb(t)-$1::text[])::text)::text,'[]')) AS digest FROM "${table}" t`,[omitted])).rows[0];}
 const summary=(await c.query('SELECT (SELECT count(*) FROM users WHERE active) active_accounts,(SELECT count(*) FROM bundles) bundles,(SELECT count(*) FROM receipts) receipts,(SELECT count(*) FROM allocations) lots')).rows[0];
 if(!original){fs.writeFileSync(filename,JSON.stringify({target,status:'BASELINE',summary,tables:fingerprints,additiveColumnsOmitted:omitted},null,2));console.log(JSON.stringify({target,tables:tables.length,summary}));}
 else {const changed=tables.filter(t=>JSON.stringify(original.tables[t])!==JSON.stringify(fingerprints[t]));const result={...original,status:changed.length?'FAIL':'PASS',changed,afterSummary:summary};fs.writeFileSync(filename,JSON.stringify(result,null,2));if(changed.length)throw Error('Original table data changed: '+changed.join(','));console.log(JSON.stringify({status:'PASS',unchangedTables:tables.length,summary}));}
 }finally{await c.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
