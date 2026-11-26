'use strict';

const B=require('./business-common.cjs');
const S=require('./management-security.cjs');
const transaction=require('./account-transaction.cjs');
const {digest,verifyPassword}=require('./security.cjs');

const role='general_manager',permission='access-change:approve';
const states=['PENDING','APPROVED','REJECTED','STALE','WITHDRAWN'];
const common="r.id,r.kind,r.target_key,r.target_label,r.requested_by,r.requested_at,r.state,r.before_data,r.after_data,r.reviewed_by,r.reviewed_at,r.decision_note";
const permittedApprover=a=>a.role_code===role&&a.permissions.includes(permission);
const permissionByKind={USER_CREATE:'users:manage',USER_UPDATE:'users:manage',USER_RESTORE:'users:manage',
 USER_PASSWORD_RESET:'users:manage',REGISTRATION_GRANT:'users:manage',ROLE_PERMISSIONS:'roles:manage'};
const forbidden=()=>B.error(403,'仅总经理可审批权限变更');
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'&&!(value instanceof Date)){
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 }
 return value;
}
const fingerprint=plan=>digest(JSON.stringify(canonical([plan.before,plan.after,plan.revision??null])));
const audit=(c,req,action,id,before,after)=>B.audit(c,req,action,'access_change_requests',id,before,after);

async function provisioned(c){
 return (await c.query("SELECT EXISTS(SELECT 1 FROM users WHERE role_code='general_manager' AND active AND deleted_at IS NULL) active")).rows[0].active;
}
async function requester(c,change,required){
 const {rows:[user]}=await c.query('SELECT id,username,display_name,role_code,language_code FROM users WHERE id=$1 AND active AND deleted_at IS NULL',[change.requested_by]);
 if(!user||user.role_code!==change.requester_role)throw B.error(409,'申请人的管理授权已变化');
 const {rows}=await c.query('SELECT permission_code FROM role_permissions WHERE role_code=$1',[user.role_code]);
 user.permissions=rows.map(row=>row.permission_code);
 if(!user.permissions.includes(required))throw B.error(409,'申请人的管理授权已变化');
 return user;
}

function create({app,pool,auth,csrf,cfg}){
 const operations=new Map();
 function protect(kind,prepare){
  const required=permissionByKind[kind];
  operations.set(kind,{prepare,required});
  return req=>transaction(pool,async c=>{
   const authority=await S.actor(c,req,required);
   const plan=await prepare(c,req,authority);
   if(plan.approval===false||cfg.environment!=='production'&&!await provisioned(c))return plan.apply();
   if(authority.role_code===role)throw forbidden();
   const {rows:[row]}=await c.query(
    "INSERT INTO access_change_requests(kind,target_key,target_label,requested_by,requester_role,before_data,after_data,payload,pending_password_hash,fingerprint) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (kind,target_key) WHERE state='PENDING' DO NOTHING RETURNING id,state",
    [kind,plan.target,plan.label,authority.id,authority.role_code,plan.before??null,plan.after,plan.payload,plan.passwordHash??null,fingerprint(plan)]);
   if(!row)throw B.error(409,'同一对象已有待审批的变更，请先处理或撤回原申请');
   await audit(c,req,'access_change_submitted',row.id,null,{kind,target:plan.target,before:plan.before,after:plan.after});
   return {...row,approval_pending:true};
  });
 }
 async function decide(c,req,authority){
  const b=req.body;
  if(!b||typeof b!=='object'||Object.keys(b).some(k=>!['decision','note','password'].includes(k))||
   !['APPROVED','REJECTED','WITHDRAWN'].includes(b.decision)||
   b.note!==undefined&&(typeof b.note!=='string'||b.note.length>500||/[\x00-\x1f]/.test(b.note))){
   throw B.error(400,'审批参数无效');
  }
  const note=b.note?.trim()||null;
  const {rows:[change]}=await c.query('SELECT * FROM access_change_requests WHERE id=$1 FOR UPDATE',[B.uuid(req.params.id)]);
  if(!change)throw B.error(404,'权限变更申请不存在');
  if(b.decision==='WITHDRAWN'){
   if(change.requested_by!==authority.id)throw B.error(404,'权限变更申请不存在');
  }else{
   if(!permittedApprover(authority)||change.requested_by===authority.id)throw forbidden();
   if(b.decision==='REJECTED'&&!note)throw B.error(400,'请填写驳回原因');
   const {rows:[manager]}=await c.query('SELECT password_hash FROM users WHERE id=$1',[authority.id]);
   if(typeof b.password!=='string'||b.password.length>128||!verifyPassword(b.password,manager.password_hash)){
    throw B.error(403,'总经理当前密码不正确');
   }
  }
  if(change.state!=='PENDING')throw B.error(409,'申请状态已变化，请刷新');
  let state=b.decision,decisionNote=note;
  if(state==='APPROVED'){
   await c.query('SAVEPOINT access_review');
   try{
    const operation=operations.get(change.kind);
    const actor=await requester(c,change,operation.required);
    const source={id:req.id,user:actor,params:{id:change.target_key,code:change.target_key},body:change.payload};
    const plan=await operation.prepare(c,source,actor,change.pending_password_hash);
    if(plan.target!==change.target_key||fingerprint(plan)!==change.fingerprint)throw B.error(409,'申请对象或权限已变化，请重新提交');
    await plan.apply();
   }catch(e){
    await c.query('ROLLBACK TO SAVEPOINT access_review');
    if(![400,403,404,409].includes(e.statusCode)&&e.code!=='23505')throw e;
    state='STALE';
    decisionNote='申请对象或管理授权已变化，请重新提交';
   }
   await c.query('RELEASE SAVEPOINT access_review');
  }
  const {rows:[result]}=await c.query("UPDATE access_change_requests SET state=$2,reviewed_by=$3,reviewed_at=clock_timestamp(),decision_note=$4,pending_password_hash=NULL WHERE id=$1 RETURNING id,state,reviewed_at,decision_note",
   [change.id,state,authority.id,decisionNote]);
  await audit(c,req,'access_change_decided',change.id,{state:'PENDING'},
   {state,kind:change.kind,target:change.target_key,requested_by:change.requested_by,note:decisionNote});
  return result;
 }

 app.get('/api/v1/security/access-requests',{preHandler:auth},req=>S.read(pool,req,null,async(c,a)=>{
  const canReview=permittedApprover(a);
  if(!canReview&&!a.permissions.some(p=>['users:manage','roles:manage'].includes(p)))throw forbidden();
  const state=req.query.state??'PENDING';
  const page=Number(req.query.page??1);
  if(!['ALL',...states].includes(state)||!Number.isInteger(page)||page<1||page>10000)throw B.error(400,'审批筛选无效');
  const {rows}=await c.query(
   'SELECT '+common+',sender.display_name requester_name,reviewer.display_name reviewer_name FROM access_change_requests r '+
   'JOIN users sender ON sender.id=r.requested_by LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by '+
   "WHERE ($1 OR r.requested_by=$2) AND ($3='ALL' OR r.state=$3) ORDER BY r.requested_at DESC,r.id LIMIT 51 OFFSET $4",
   [canReview,a.id,state,(page-1)*50]);
  const items=rows.slice(0,50);
  const contexts=items.flatMap(item=>[item.before_data,item.after_data]).filter(Boolean);
  const codes=[...new Set(contexts.map(item=>item.role_code).filter(Boolean))];
  const ids=[...new Set(contexts.flatMap(item=>(item.scopes||[]).flatMap(scope=>Object.values(scope))).filter(Boolean))];
  const names=(await c.query('SELECT code,name,name_en FROM roles WHERE code=ANY($1::text[])',[codes])).rows;
  const scopes=(await c.query('SELECT id,name FROM projects WHERE id=ANY($1::uuid[]) UNION ALL '+
   'SELECT id,name FROM warehouses WHERE id=ANY($1::uuid[]) UNION ALL SELECT id,name FROM customers WHERE id=ANY($1::uuid[])',[ids])).rows;
  const labels=require('./workflow-permissions.cjs').catalog;
  const keys=[...new Set(contexts.flatMap(item=>item.permissions||[]))];
  return {items,page,has_more:rows.length>50,can_review:canReview,approver_ready:await provisioned(c),
   role_names:Object.fromEntries(names.map(r=>[r.code,req.user.language_code==='en'?r.name_en:r.name])),
   scope_names:Object.fromEntries(scopes.map(r=>[r.id,r.name])),
   permission_names:Object.fromEntries(keys.map(key=>[key,labels[key]?.zh||key])),
   permission_names_en:Object.fromEntries(keys.map(key=>[key,labels[key]?.en||key]))};
 }));
 app.post('/api/v1/security/access-requests/:id/decision',{
  preHandler:[auth,csrf],config:{rateLimit:{max:20,timeWindow:'1 minute'}}
 },req=>transaction(pool,async c=>decide(c,req,await S.actor(c,req,null))));
 return {protect};
}

module.exports={create,role,permission};
