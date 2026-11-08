'use strict';
const B=require('./business-common.cjs'),{digest}=require('./security.cjs');
const isAdmin=a=>a.role_code==='admin';
const builtIn=r=>r.built_in||require('./role-catalog.cjs').builtins.includes(r.code);
async function actor(c,req,permission){
 const sid=req.cookies?.musonoi_session;
 const a=sid&&(await c.query('SELECT u.id,u.role_code,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND u.deleted_at IS NULL',[digest(sid)])).rows[0];
 if(!a||a.id!==req.user?.id)throw B.error(401,'登录已失效，请重新登录');
 a.permissions=(await c.query('SELECT permission_code FROM role_permissions WHERE role_code=$1',[a.role_code])).rows.map(r=>r.permission_code);
 if(permission&&!a.permissions.includes(permission))throw B.error(403,'管理授权已失效');
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&digest(String(req.headers['x-csrf-token']||''))!==a.csrf_hash)throw B.error(403,'安全令牌已失效，请重新登录');
 req.user={...req.user,...a};return a;
}
async function read(pool,req,permission,fn){const c=await pool.connect();try{await c.query('BEGIN READ ONLY');await c.query('SELECT pg_advisory_xact_lock_shared(21002)');const a=await actor(c,req,permission),result=await fn(c,a);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
// Whole-target containment: overlap with one scope is insufficient for an account with several scopes.
function userVisible(parameter='$1',alias='u'){
 return `(${alias}.role_code<>'admin' AND coalesce(${alias}.deleted_role_code,'')<>'admin'
 AND NOT EXISTS(SELECT 1 FROM role_permissions higher WHERE higher.role_code=${alias}.role_code AND NOT EXISTS(SELECT 1 FROM users me JOIN role_permissions own ON own.role_code=me.role_code WHERE me.id=${parameter} AND own.permission_code=higher.permission_code))
 AND EXISTS(SELECT 1 FROM user_scopes target WHERE target.user_id=${alias}.id)
 AND NOT EXISTS(SELECT 1 FROM user_scopes target WHERE target.user_id=${alias}.id AND NOT EXISTS(SELECT 1 FROM user_scopes own WHERE own.user_id=${parameter} AND own.project_id=target.project_id AND(own.warehouse_id IS NULL OR own.warehouse_id=target.warehouse_id) AND(own.customer_id IS NULL OR own.customer_id=target.customer_id))))`;
}
async function target(c,a,id){if(isAdmin(a))return;const r=await c.query(`SELECT 1 FROM users u WHERE u.id=$2 AND ${userVisible('$1')}`,[a.id,id]);if(!r.rowCount)throw B.error(404,'账号不存在或不在可管理范围内');}
async function grantRole(c,a,code){
 const role=await require('./role-catalog.cjs').valid(c,code);if(!role)throw B.error(400,'请选择有效角色');
 if(!isAdmin(a)){if(code==='admin')throw B.error(403,'仅系统管理员可分配管理员角色');if(builtIn(role)&&code!==a.role_code)throw B.error(403,'不同内置岗位须由系统管理员分配');const permissions=(await c.query('SELECT permission_code FROM role_permissions WHERE role_code=$1',[code])).rows.map(r=>r.permission_code);if(permissions.some(p=>!a.permissions.includes(p)))throw B.error(403,'角色权限超出本人授权上限');}
 return role;
}
function grantPermissions(a,permissions){if(!isAdmin(a)&&permissions.some(p=>!a.permissions.includes(p)))throw B.error(403,'不能授予超出本人授权上限的权限');}
async function manageRole(c,a,role){
 if(isAdmin(a))return;
 if(builtIn(role)||role.code===a.role_code)throw B.error(403,'受限管理人员不能修改内置岗位或自身角色');
 await grantRole(c,a,role.code);
 if((await c.query(`SELECT 1 FROM users u WHERE u.role_code=$2 AND NOT ${userVisible('$1')} LIMIT 1`,[a.id,role.code])).rowCount)throw B.error(403,'该角色存在超出本人管理范围的账号');
}
function systemAdministrator(a){if(!isAdmin(a))throw B.error(403,'此操作仅限系统管理员');}
async function visibleRoles(c,a,rows){if(isAdmin(a))return rows;const result=[];for(const r of rows){try{await manageRole(c,a,r);result.push(r);}catch(e){if(e.statusCode!==403)throw e;}}return result;}
module.exports={actor,read,isAdmin,builtIn,userVisible,target,grantRole,grantPermissions,manageRole,systemAdministrator,visibleRoles};
