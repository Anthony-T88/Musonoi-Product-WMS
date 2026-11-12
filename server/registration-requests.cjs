'use strict';
const B=require('./business-common.cjs'),A=require('./accounts.cjs'),transaction=require('./account-transaction.cjs'),{token,digest}=require('./security.cjs');
const S=require('./management-security.cjs'),Policy=require('../dist/registration-policy.js');
module.exports=async({app,pool,permitted,csrf,secure,origin})=>{
 const admin=permitted('users:manage'),publicFields='id,username,display_name,contact,contact_phone,contact_email,status,created_at,reviewed_at,review_reason,approved_user_id';
 app.get('/api/v1/auth/registration-token',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(req,reply)=>{const value=token();reply.setCookie('musonoi_registration_csrf',value,{path:'/api/v1/auth/registration-requests',httpOnly:true,sameSite:'strict',secure,maxAge:1800});return{csrfToken:value};});
 app.post('/api/v1/auth/registration-requests',{config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(req,reply)=>{
  const cookie=req.cookies.musonoi_registration_csrf;
  if(req.headers.origin!==origin||!cookie||digest(cookie)!==digest(String(req.headers['x-csrf-token']||'')))throw B.error(403,'注册申请安全令牌无效，请重新打开申请窗口');
  A.body(req.body,['username','display_name','password','confirm','contact','contact_phone','contact_email']);
  const reject=(status,errors)=>reply.code(status).send({type:'field_validation',code:'REGISTRATION_FIELDS_INVALID',error:Policy.errors[Object.values(errors)[0]][0],fields:Object.entries(errors).map(([field,code])=>({field,code}))});
  // Existing API clients submit a single password. The web form also sends its confirmation.
  const {errors,values:b}=Policy.validate(req.body,{requireConfirmation:false});
  if(Object.keys(errors).length)return reject(400,errors);
  const hash=A.password(b.password);
  try {
   return await transaction(pool,async c=>{
    if((await c.query('SELECT 1 FROM users WHERE username=$1',[b.username])).rowCount)return reject(409,{username:'USERNAME_USED'});
    const result=await c.query("INSERT INTO registration_requests(username,display_name,password_hash,contact,contact_phone,contact_email) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (username) WHERE status='PENDING' DO NOTHING RETURNING id,status,created_at",[b.username,b.display_name,hash,b.contact,b.contact_phone,b.contact_email]);
    if(!result.rowCount)return reject(409,{username:'USERNAME_PENDING'});
    reply.code(201);
    return result.rows[0];
   });
  }catch(e){
   if(e.code==='23505'&&e.constraint==='registration_requests_pending_username')return reject(409,{username:'USERNAME_PENDING'});
   throw e;
  }
 });
 app.get('/api/v1/users/registration-requests',{preHandler:admin},req=>S.read(pool,req,'users:manage',async(c,a)=>{S.systemAdministrator(a);const status=req.query.status||'PENDING';if(!['PENDING','APPROVED','REJECTED','ALL'].includes(status))throw B.error(400,'申请状态筛选无效');return{items:(await c.query('SELECT '+publicFields+' FROM registration_requests WHERE ($1=\'ALL\' OR status=$1) ORDER BY created_at DESC LIMIT 200',[status])).rows,pending:(await c.query("SELECT count(*)::int n FROM registration_requests WHERE status='PENDING'")).rows[0].n};}));
 app.post('/api/v1/users/registration-requests/:id/review',{preHandler:[admin,csrf]},req=>transaction(pool,async c=>{
  A.body(req.body,['decision','role_code','scopes','reason']);const b=req.body;if(!['APPROVED','REJECTED'].includes(b.decision)||b.reason!==undefined&&(typeof b.reason!=='string'||b.reason.length>1000))throw B.error(400,'申请审批参数无效');S.systemAdministrator(await A.actor(c,req));const r=(await c.query('SELECT * FROM registration_requests WHERE id=$1 FOR UPDATE',[B.uuid(req.params.id)])).rows[0];if(!r)throw B.error(404,'注册申请不存在');if(r.status!=='PENDING')throw B.error(409,'该注册申请已审批，请刷新列表');let userId=null;
  if(b.decision==='APPROVED'){await A.role(c,b.role_code);if((await c.query('SELECT 1 FROM users WHERE username=$1',[r.username])).rowCount)throw B.error(409,'该账号已存在，未重复创建');userId=(await c.query('INSERT INTO users(username,display_name,password_hash,role_code,active,contact_phone,contact_email) VALUES($1,$2,$3,$4,true,$5,$6) RETURNING id',[r.username,r.display_name,r.password_hash,b.role_code,r.contact_phone,r.contact_email])).rows[0].id;await A.scopes(c,req,userId,b.scopes);await B.audit(c,req,'user_created','users',userId,null,{username:r.username,display_name:r.display_name,role_code:b.role_code,scopes:b.scopes,registration_request_id:r.id});}
  else if(!b.reason?.trim())throw B.error(400,'驳回申请须填写原因');
  const updated=(await c.query('UPDATE registration_requests SET status=$1,reviewed_at=now(),reviewed_by=$2,review_reason=$3,approved_user_id=$4 WHERE id=$5 RETURNING '+publicFields,[b.decision,req.user.id,b.reason?.trim()||null,userId,r.id])).rows[0];await B.audit(c,req,'registration_'+b.decision.toLowerCase(),'registration_requests',r.id,{status:r.status},{status:updated.status,approved_user_id:userId,reason:updated.review_reason});return updated;
 }));
};
module.exports.pending=async(c,req)=>{
 if(req.user.role_code!=='admin'||!req.user.permissions.includes('users:manage'))return [];
 const {rows}=await c.query(`SELECT id,username document_no,status,created_at,'REGISTRATION_REQUEST_REVIEW' kind,
  'REGISTRATION_REQUEST' doc_type,'/workbench/accounts?registrations=pending' href
  FROM registration_requests WHERE status='PENDING' ORDER BY created_at DESC,id`);
 return rows;
};
