const W=require('./workflow-common.cjs');
async function read(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(24000)');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function full(c,req,project,permission,warehouse){if(!req.user.permissions.includes(permission))throw W.error(403,'没有库存管理权限');const q=await c.query('SELECT 1 FROM user_scopes WHERE user_id=$1 AND project_id=$2 AND customer_id IS NULL AND(warehouse_id IS NULL OR warehouse_id=$3)',[req.user.id,W.uuid(project),warehouse||null]);if(!q.rowCount)throw W.error(403,'该操作需要相应项目/仓库的完整客户库存范围');}
function filter(b={}){const f={};for(const k of ['project_id','customer_id','warehouse_id','yard_id','location_id','batch_id','allocated_customer_id'])if(b[k])f[k]=W.uuid(b[k]).toLowerCase();return f;}
async function tip(c){return(await c.query('SELECT coalesce(max(id),0)::text AS id FROM inventory_revisions')).rows[0].id;}
async function states(c,revision){return(await c.query('SELECT DISTINCT ON(bundle_id) state FROM inventory_history WHERE revision_id<=$1 ORDER BY bundle_id,revision_id DESC',[revision])).rows.map(r=>r.state);}
module.exports={...W,read,full,filter,tip,states};
