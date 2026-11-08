'use strict';
const fs=require('fs'),crypto=require('crypto'),DB=require('../server/database-connection.cjs'),M=require('./maintenance-connection.cjs'),{hashPassword}=require('../server/security.cjs');
function fields(o,keys){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))DB.fail('BOOTSTRAP_INVALID_MANIFEST');}
function text(v,max=120){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))DB.fail('BOOTSTRAP_INVALID_MANIFEST');return v.trim();}
function validate(input){fields(input,['admin','project','warehouse','formalCells','mapSourceSha256']);fields(input.admin,['username','displayName','language']);fields(input.project,['code','name']);fields(input.warehouse,['code','name']);const a=input.admin;
 if(!/^[a-z][a-z0-9_]{2,79}$/.test(a.username)||!['zh-CN','en'].includes(a.language))DB.fail('BOOTSTRAP_INVALID_MANIFEST');
 if(!Array.isArray(input.formalCells)||input.formalCells.length<1||input.formalCells.length>131||new Set(input.formalCells).size!==input.formalCells.length||input.formalCells.some(v=>!/^P[1-4]-\d{2}$/.test(v))||!/^[a-f0-9]{64}$/.test(input.mapSourceSha256))DB.fail('BOOTSTRAP_INVALID_MAP');
 return {admin:{username:a.username,displayName:text(a.displayName),language:a.language},project:{code:text(input.project.code,40),name:text(input.project.name)},warehouse:{code:text(input.warehouse.code,40),name:text(input.warehouse.name)},formalCells:[...input.formalCells].sort(),mapSourceSha256:input.mapSourceSha256};
}
async function initialize(c,input,password,{apply=false}={}){
 const plan=validate(input),signature=crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 if(typeof password!=='string'||password.length<16||password.length>128||/\r|\n/.test(password))DB.fail('BOOTSTRAP_INVALID_SECRET');
 await c.query('BEGIN');try{
 await c.query('SELECT pg_advisory_xact_lock(21001)');await c.query('SELECT pg_advisory_xact_lock(21002)');
 if((await c.query('SELECT environment FROM system_info WHERE singleton')).rows[0]?.environment!=='production')DB.fail('BOOTSTRAP_PRODUCTION_SCHEMA_REQUIRED');
 const files=fs.readdirSync(require('path').join(__dirname,'../db/migrations')).filter(n=>n.endsWith('.sql')).sort(),versions=(await c.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
 if(versions.length!==138||files.some((file,i)=>versions[i]?.version!==file||versions[i].checksum!==crypto.createHash('sha256').update(fs.readFileSync(require('path').join(__dirname,'../db/migrations',file))).digest('hex')))DB.fail('BOOTSTRAP_MIGRATIONS_INVALID');
 const prior=(await c.query("SELECT after_data FROM audit_logs WHERE action='production_initialized' ORDER BY id LIMIT 1")).rows[0]?.after_data;
 if(prior){if(prior.signature!==signature)DB.fail('BOOTSTRAP_ALREADY_INITIALIZED');const a=(await c.query("SELECT u.id FROM users u JOIN user_scopes s ON s.user_id=u.id JOIN projects p ON p.id=s.project_id JOIN warehouses w ON w.project_id=p.id WHERE u.id=$1 AND u.username=$2 AND u.role_code='admin' AND u.active AND u.deleted_at IS NULL AND p.code=$3 AND w.code=$4 AND s.customer_id IS NULL AND s.warehouse_id IS NULL",[prior.adminId,plan.admin.username,plan.project.code,plan.warehouse.code])).rows[0];if(!a)DB.fail('BOOTSTRAP_EXISTING_STATE_CHANGED');const loc=(await c.query('SELECT code,map_cell_code,map_usage FROM locations WHERE project_id=$1 AND warehouse_id=$2 ORDER BY code',[prior.projectId,prior.warehouseId])).rows;if(loc.length!==plan.formalCells.length+1||!plan.formalCells.every(code=>loc.some(l=>l.code===code&&l.map_cell_code===code&&l.map_usage==='FORMAL'))||!loc.some(l=>l.code==='临时堆存区'&&l.map_cell_code==='P5'&&l.map_usage==='TEMPORARY'))DB.fail('BOOTSTRAP_EXISTING_STATE_CHANGED');await c.query('ROLLBACK');return {status:'ALREADY_INITIALIZED',signature};}
 for(const t of ['users','projects','warehouses','locations','customers','bundles','receipts','allocations','loading_orders'])if(Number((await c.query('SELECT count(*) FROM '+t)).rows[0].count)!==0)DB.fail('BOOTSTRAP_NONEMPTY_DATABASE');
 const source=(await c.query('SELECT source_sha256 FROM stock_map_source WHERE singleton')).rows[0];if(source?.source_sha256!==plan.mapSourceSha256)DB.fail('BOOTSTRAP_MAP_SOURCE_MISMATCH');
 const cells=(await c.query("SELECT code,display_order FROM stock_map_cells WHERE code=ANY($1) AND x IS NOT NULL AND y IS NOT NULL AND width>0 AND height>0",[[...plan.formalCells,'P5']])).rows;if(cells.length!==plan.formalCells.length+1)DB.fail('BOOTSTRAP_MAP_CELL_NOT_VERIFIED');
 const p=(await c.query('INSERT INTO projects(code,name) VALUES($1,$2) RETURNING id',[plan.project.code,plan.project.name])).rows[0].id;
 const w=(await c.query('INSERT INTO warehouses(project_id,code,name) VALUES($1,$2,$3) RETURNING id',[p,plan.warehouse.code,plan.warehouse.name])).rows[0].id;
 for(const cell of cells){const temp=cell.code==='P5';await c.query('INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_order,map_usage,map_review_note) VALUES($1,$2,$3,$4,$5,$6,$7)',[p,w,temp?'临时堆存区':cell.code,cell.code,cell.display_order,temp?'TEMPORARY':'FORMAL','Approved first production initialization']);}
 const adminId=(await c.query("INSERT INTO users(username,display_name,password_hash,role_code,language_code) VALUES($1,$2,$3,'admin',$4) RETURNING id",[plan.admin.username,plan.admin.displayName,hashPassword(password),plan.admin.language])).rows[0].id;
 await c.query('INSERT INTO user_scopes(user_id,project_id) VALUES($1,$2)',[adminId,p]);
 const record={signature,adminId,projectId:p,warehouseId:w,formalLocations:plan.formalCells.length,temporaryLocations:1};
 await c.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES($1,'production_initialized','projects',$2,$3)",[adminId,p,record]);
 await c.query(apply?'COMMIT':'ROLLBACK');return {status:apply?'INITIALIZED':'DRY_RUN_ROLLED_BACK',...record};
 }catch(e){await c.query('ROLLBACK');throw e;}
}
module.exports={initialize,validate};
if(require.main===module)(async()=>{const args=process.argv.slice(2),cfg=M.configuration(),apply=M.authorize(args,cfg);const value=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])DB.fail('BOOTSTRAP_FILES_REQUIRED');return args[i+1];};let input,password;try{input=JSON.parse(fs.readFileSync(value('--config'),'utf8').replace(/^\uFEFF/,''));password=fs.readFileSync(value('--password-file'),'utf8').replace(/\r?\n$/,'');}catch(e){DB.fail(e.code==='BOOTSTRAP_FILES_REQUIRED'?e.code:'BOOTSTRAP_FILES_INVALID');}const c=await M.open(cfg);try{console.log(JSON.stringify(await initialize(c,input,password,{apply})));}finally{await c.end();}})().catch(e=>{console.error(JSON.stringify(DB.safeError(e)));process.exitCode=1;});
