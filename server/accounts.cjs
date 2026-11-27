'use strict';
const B=require('./business-common.cjs'),transaction=require('./account-transaction.cjs'),{hashPassword,validPassword}=require('./security.cjs');
const roles=['admin','export_supervisor','logistics_manager','site_supervisor','logistics_office_operator','logistics_field_operator','production_operator','production_manager'];
const S=require('./management-security.cjs');
const publicUser=u=>Object.fromEntries(Object.entries(u).filter(([k])=>!['password_hash','contact_phone','contact_email'].includes(k)));
const usernamePattern='^[a-z][a-z0-9_]{2,39}$';
function username(v){if(typeof v!=='string'||!new RegExp(usernamePattern).test(v.trim()))throw B.error(400,'登录账号须为3–40位小写字母、数字或下划线，以字母开头');return v.trim();}
function contacts(b){
 const result={};
 for(const key of ['contact_phone','contact_email']){
  if(!Object.hasOwn(b,key))continue;
  const raw=b[key],phone=key==='contact_phone';
  const error=()=>B.error(400,phone?'请输入有效联系号码':'请输入有效联系邮箱');
  if(raw!==null&&typeof raw!=='string')throw error();
  const value=raw?.trim()||null;
  if(value&&(phone?value.length>40||!/^\+?[0-9() .-]+$/.test(value)||!/^\d{5,20}$/.test(value.replace(/\D/g,'')):value.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))throw error();
  result[key]=value;
 }
 return result;
}
function body(b,keys){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))throw B.error(400,'账号参数无效');}
function password(p){if(!validPassword(p))throw B.error(400,'密码须为10–48个字符');return hashPassword(p);}
async function role(c,r){if(!await require('./role-catalog.cjs').valid(c,r))throw B.error(400,'请选择有效角色');return r;}
function name(v){if(typeof v!=='string'||!v.trim()||v.trim().length>80)throw B.error(400,'请输入有效显示名称');return v.trim();}
async function pending(c,id){return (await c.query(`SELECT
 (SELECT count(*)::int FROM receipts WHERE status IN('DRAFT','PENDING') AND(created_by=$1 OR submitted_by=$1)) receipts,
 (SELECT count(*)::int FROM allocations WHERE workflow_state IN('WORKING','RECTIFY','PENDING','PREPARED') AND(created_by=$1 OR submitted_by=$1)) lots,
 (SELECT count(*)::int FROM loading_orders WHERE workflow_state IN('PENDING','READY','DEPARTED_PENDING','DEPARTED_CORRECTION') AND(created_by=$1 OR submitted_by=$1 OR departure_by=$1)) loads`,[id])).rows[0];}
async function actor(c,req){return S.actor(c,req,'users:manage');}
async function locked(c,id,authority){
 const {rows:[u]}=await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[B.uuid(id)]);
 if(!u)throw B.error(404,'用户不存在');
 if(u.role_code==='general_manager'||u.deleted_role_code==='general_manager')throw B.error(403,'总经理账号由维护人员管理');
 await S.target(c,authority,u.id);
 return u;
}
async function keepAdmin(c,u,next){if(u.role_code==='admin'&&u.active&&(!next.active||next.role_code!=='admin'||next.deleted_at)&&!(await c.query("SELECT 1 FROM users WHERE id<>$1 AND role_code='admin' AND active AND deleted_at IS NULL",[u.id])).rowCount)throw B.error(409,'必须保留至少一个有效管理员');}
const sortScopes=values=>values.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
async function validateScopes(c,authority,values){
 if(!Array.isArray(values)||!values.length||values.length>20)throw B.error(400,'至少选择一个授权数据范围');
 const {rows:allowed}=await c.query('SELECT project_id,warehouse_id,customer_id FROM user_scopes WHERE user_id=$1',[authority.id]);
 const normalized=[];
 for(const item of values){
  body(item,['project_id','warehouse_id','customer_id']);
  const scope={project_id:B.uuid(item.project_id).toLowerCase(),warehouse_id:item.warehouse_id?B.uuid(item.warehouse_id).toLowerCase():null,
   customer_id:item.customer_id?B.uuid(item.customer_id).toLowerCase():null};
  if(!allowed.some(a=>a.project_id===scope.project_id&&(!a.warehouse_id||a.warehouse_id===scope.warehouse_id)&&(!a.customer_id||a.customer_id===scope.customer_id))){
   throw B.error(403,'数据范围超出管理员授权');
  }
  if(scope.warehouse_id&&!(await c.query('SELECT 1 FROM warehouses WHERE id=$1 AND project_id=$2',[scope.warehouse_id,scope.project_id])).rowCount||
   scope.customer_id&&!(await c.query('SELECT 1 FROM customers WHERE id=$1 AND project_id=$2',[scope.customer_id,scope.project_id])).rowCount)throw B.error(400,'数据范围无效');
  normalized.push(scope);
 }
 if(new Set(normalized.map(s=>JSON.stringify(s))).size!==normalized.length)throw B.error(400,'授权数据范围不能重复');
 return sortScopes(normalized);
}
async function writeScopes(c,id,values){
 await c.query('DELETE FROM user_scopes WHERE user_id=$1',[id]);
 for(const s of values)await c.query('INSERT INTO user_scopes(user_id,project_id,warehouse_id,customer_id) VALUES($1,$2,$3,$4)',[id,s.project_id,s.warehouse_id,s.customer_id]);
}
async function scopes(c,req,id,values){await writeScopes(c,id,await validateScopes(c,req.user,values));}
async function currentScopes(c,id){
 return sortScopes((await c.query('SELECT project_id,warehouse_id,customer_id FROM user_scopes WHERE user_id=$1',[id])).rows);
}
function access(value,assigned,roleVersion){
 return {username:value.username,display_name:value.display_name,role_code:value.role_code,active:value.active,
  deleted:!!value.deleted_at,scopes:assigned,role_version:roleVersion};
}
async function roleVersion(c,code){
 return (await c.query('SELECT version FROM roles WHERE code=$1',[code])).rows[0]?.version??null;
}
const contactState=u=>[u.contact_phone,u.contact_email];
function publicPayload(b){const {password,...payload}=b;return payload;}
function accountVersion(u){return [u.id,u.deleted_at,u.deleted_role_code,u.password_hash,...contactState(u)];}
async function prepareCreate(c,req,a,savedHash){
 const b=req.body;
 body(b,['username','display_name','password','role_code','active','scopes','contact_phone','contact_email']);
 if(b.active!==undefined&&typeof b.active!=='boolean')throw B.error(400,'账号参数无效');
 const account=username(b.username),contact=contacts(b),display=name(b.display_name),hash=savedHash??password(b.password);
 const r=await S.grantRole(c,a,b.role_code),allowed=await validateScopes(c,a,b.scopes);
 if((await c.query('SELECT 1 FROM users WHERE username=$1',[account])).rowCount)throw B.error(409,'用户名已存在；已删除账号请使用恢复');
 const after=access({username:account,display_name:display,role_code:r.code,active:b.active!==false},allowed,r.version);
 return {target:account,label:display+' · '+account,before:null,after,payload:publicPayload(b),passwordHash:hash,apply:async()=>{
  const {rows:[u]}=await c.query('INSERT INTO users(username,display_name,password_hash,role_code,active,contact_phone,contact_email) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,display_name,role_code,active,contact_phone,contact_email',
   [account,display,hash,r.code,after.active,contact.contact_phone??null,contact.contact_email??null]);
  await writeScopes(c,u.id,allowed);
  await B.audit(c,req,'user_created','users',u.id,null,{...publicUser(u),scopes:allowed});
  return u;
 }};
}
async function prepareUpdate(c,req,a){
 const b=req.body;
 body(b,['display_name','role_code','active','scopes','contact_phone','contact_email']);
 if(!Object.keys(b).length||b.active!==undefined&&typeof b.active!=='boolean')throw B.error(400,'账号参数无效');
 const u=await locked(c,req.params.id,a);
 if(u.deleted_at)throw B.error(409,'账号已删除，请先恢复');
 if(u.id===a.id&&b.role_code!==undefined&&b.role_code!==u.role_code&&!S.isAdmin(a)){
  throw B.error(403,'不能变更自身管理角色');
 }
 const r=b.role_code!==undefined?await S.grantRole(c,a,b.role_code):null;
 const next={...u,...contacts(b),display_name:b.display_name===undefined?u.display_name:name(b.display_name),
  role_code:r?.code??u.role_code,active:b.active??u.active};
 if(u.id===a.id&&(u.role_code!==next.role_code||!next.active||b.scopes!==undefined))throw B.error(409,'不能修改自身角色、账号状态或数据范围');
 if(next.active)await role(c,next.role_code);
 await keepAdmin(c,u,next);
 const prior=await currentScopes(c,u.id),assigned=b.scopes===undefined?prior:await validateScopes(c,a,b.scopes);
 const scopeChanged=JSON.stringify(prior)!==JSON.stringify(assigned);
 const currentVersion=await roleVersion(c,u.role_code);
 return {target:u.id,label:u.display_name+' · '+u.username,before:access(u,prior,currentVersion),
  after:access(next,assigned,r?.version??currentVersion),revision:accountVersion(u),payload:b,
  approval:u.role_code!==next.role_code||u.active!==next.active||scopeChanged,apply:async()=>{
   if(b.scopes!==undefined)await writeScopes(c,u.id,assigned);
   await c.query('UPDATE users SET display_name=$1,role_code=$2,active=$3,contact_phone=$4,contact_email=$5 WHERE id=$6',
    [next.display_name,next.role_code,next.active,next.contact_phone,next.contact_email,u.id]);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);
   await B.audit(c,req,'user_updated','users',u.id,{...publicUser(u),scopes:prior},{...publicUser(next),scopes:assigned});
   return {ok:true};
  }};
}
async function prepareRestore(c,req,a,savedHash){
 const b=req.body;
 body(b,['password','role_code','scopes']);
 const u=await locked(c,req.params.id,a);
 if(!u.deleted_at)throw B.error(409,'账号未删除');
 const hash=savedHash??password(b.password),r=await S.grantRole(c,a,b.role_code||u.deleted_role_code||u.role_code);
 const prior=await currentScopes(c,u.id),assigned=b.scopes===undefined?prior:await validateScopes(c,a,b.scopes);
 const next={...u,active:true,deleted_at:null,role_code:r.code};
 return {target:u.id,label:u.display_name+' · '+u.username,before:access(u,prior,await roleVersion(c,u.role_code)),
  after:access(next,assigned,r.version),revision:accountVersion(u),payload:publicPayload(b),passwordHash:hash,apply:async()=>{
   if(b.scopes!==undefined)await writeScopes(c,u.id,assigned);
   await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);
   await c.query('UPDATE users SET active=true,deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,deleted_role_code=NULL,password_hash=$1,role_code=$2 WHERE id=$3',[hash,r.code,u.id]);
   await B.audit(c,req,'user_restored','users',u.id,publicUser(u),{id:u.id,username:u.username,active:true,role_code:r.code,password_reset:true});
   return {ok:true,id:u.id};
  }};
}
async function prepareReset(c,req,a,savedHash){
 body(req.body,['password']);
 const u=await locked(c,req.params.id,a);
 if(u.deleted_at)throw B.error(409,'账号已删除，请先恢复');
 const hash=savedHash??password(req.body.password);
 const before=access(u,await currentScopes(c,u.id),await roleVersion(c,u.role_code));
 return {target:u.id,label:u.display_name+' · '+u.username,before,after:{...before,password_reset:true},revision:accountVersion(u),payload:{},passwordHash:hash,apply:async()=>{
  await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,u.id]);
  await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);
  await B.audit(c,req,'password_reset','users',u.id,null,{username:u.username,sessions_revoked:true});
  return {ok:true};
 }};
}
module.exports={roles,pending,role,scopes,actor,name,password,body,username,usernamePattern,contacts,validateScopes,writeScopes,register:async({app,pool,permitted,csrf,accessApprovals})=>{
 const admin=permitted('users:manage');
 app.get('/api/v1/users',{preHandler:admin},req=>S.read(pool,req,'users:manage',async(c,authority)=>{const q=req.query;if(q.status&&!['active','disabled','deleted','all'].includes(q.status))throw B.error(400,'账号状态筛选无效');return {items:(await c.query(`SELECT u.id,u.username,u.display_name,u.role_code,u.active,u.created_at,u.last_login_at,u.deleted_at,u.deleted_by,u.deletion_reason,u.deleted_role_code,u.contact_phone,u.contact_email,
 coalesce((SELECT json_agg(s) FROM(SELECT project_id,warehouse_id,customer_id FROM user_scopes WHERE user_id=u.id)s),'[]') scopes FROM users u
 WHERE ($4::boolean OR ${S.userVisible('$5')}) AND($1='' OR u.username ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%') AND($2='' OR u.role_code=$2)
 AND CASE $3 WHEN 'all' THEN true WHEN 'deleted' THEN u.deleted_at IS NOT NULL WHEN 'active' THEN u.active AND u.deleted_at IS NULL WHEN 'disabled' THEN NOT u.active AND u.deleted_at IS NULL ELSE u.deleted_at IS NULL END ORDER BY u.username`,[String(q.q||'').slice(0,80),q.role||'',q.status||'',S.isAdmin(authority),authority.id])).rows.map(require('./employee-identity.cjs').enrich)};}));
 app.get('/api/v1/users/options',{preHandler:admin},req=>S.read(pool,req,'users:manage',async(c,a)=>{const all=(await c.query('SELECT * FROM roles WHERE code=ANY($1) OR NOT built_in ORDER BY name',[roles])).rows,allowed=[];for(const r of all){try{await S.grantRole(c,a,r.code);allowed.push(r);}catch(e){if(e.statusCode!==403)throw e;}}return {roles:allowed,projects:(await c.query('SELECT DISTINCT p.* FROM projects p JOIN user_scopes s ON s.project_id=p.id WHERE s.user_id=$1',[a.id])).rows,warehouses:(await c.query('SELECT w.* FROM warehouses w WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=w.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=w.id))',[a.id])).rows,customers:(await c.query('SELECT c.* FROM customers c WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=c.project_id AND(s.customer_id IS NULL OR s.customer_id=c.id))',[a.id])).rows};}));
 app.post('/api/v1/users',{preHandler:[admin,csrf]},accessApprovals.protect('USER_CREATE',prepareCreate));
 app.patch('/api/v1/users/:id',{preHandler:[admin,csrf]},accessApprovals.protect('USER_UPDATE',prepareUpdate));
 app.get('/api/v1/users/:id/deletion-check',{preHandler:admin},req=>transaction(pool,async c=>{const u=await locked(c,req.params.id,await actor(c,req));return {user:publicUser(u),pending:await pending(c,u.id)};}));
 app.delete('/api/v1/users/:id',{preHandler:[admin,csrf]},req=>transaction(pool,async c=>{const b=req.body;body(b,['username','employee_name','reason','acknowledge_pending']);const u=await locked(c,req.params.id,await actor(c,req));if(u.id===req.user.id)throw B.error(409,'不能删除当前登录账号');if(u.deleted_at)throw B.error(409,'账号已删除，请先恢复');if((b.employee_name!==undefined?![u.display_name,require('./employee-identity.cjs').englishName(u.display_name)].includes(b.employee_name):b.username!==u.username)||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>1000)throw B.error(400,'请确认用户名并填写删除原因');await keepAdmin(c,u,{...u,active:false,deleted_at:true});const tasks=await pending(c,u.id);if(Object.values(tasks).some(n=>n>0)&&b.acknowledge_pending!==true)throw B.error(409,'账号仍有关联待办，请核查并明确确认；审批历史不会转移');const after=(await c.query('UPDATE users SET active=false,deleted_at=now(),deleted_by=$1,deletion_reason=$2,deleted_role_code=role_code WHERE id=$3 RETURNING id,username,active,deleted_at,deleted_by,deletion_reason,deleted_role_code',[req.user.id,b.reason.trim(),u.id])).rows[0];await c.query('DELETE FROM sessions WHERE user_id=$1',[u.id]);await B.audit(c,req,'user_deleted','users',u.id,publicUser(u),{...after,pending:tasks});return after;}));
 app.post('/api/v1/users/:id/restore',{preHandler:[admin,csrf]},accessApprovals.protect('USER_RESTORE',prepareRestore));
 app.post('/api/v1/users/:id/reset-password',{preHandler:[admin,csrf]},accessApprovals.protect('USER_PASSWORD_RESET',prepareReset));
}};
