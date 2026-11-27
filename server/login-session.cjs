'use strict';

const {createHmac}=require('node:crypto');
const {digest,token,hashPassword,verifyPassword,validPassword}=require('./security.cjs');
const accountTransaction=require('./account-transaction.cjs');

const current='s.replaced_at IS NULL';
const csrf=sid=>createHmac('sha256',sid).update('musonoi-session-csrf').digest('base64url');

function audit(c,req,user,action,outcome,details={}){
 return c.query('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data,request_id,outcome) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [user?.id||null,action,'users',user?.id||null,{username:user?.username||String(req.body?.username||'').slice(0,80),ip:req.ip,...details},req.id,outcome]);
}

async function open(pool,req,user,allowed,denied,userInfo){
 return accountTransaction(pool,async c=>{
  const updated=(await c.query('SELECT id,username,display_name,role_code,language_code,password_hash,active,deleted_at FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
  if(!updated?.active||updated.deleted_at||updated.password_hash!==user.password_hash||!await allowed(c,updated))throw denied;
  await c.query('DELETE FROM sessions WHERE expires_at<=now()');
  const replaced=await c.query('UPDATE sessions SET replaced_at=clock_timestamp() WHERE user_id=$1 AND replaced_at IS NULL RETURNING created_at,expires_at,replaced_at',[user.id]);
  const invalidated=replaced.rows.filter(s=>s.expires_at>s.replaced_at);
  if(invalidated.length)await audit(c,req,user,'login_session_replaced','COMMITTED',{sessions:invalidated.map(({created_at,replaced_at})=>({created_at,replaced_at}))});
  const sid=token(),csrfToken=csrf(sid);
  const session=(await c.query("INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours') RETURNING created_at,expires_at",[digest(sid),user.id,digest(csrfToken)])).rows[0];
  const language=req.body.language||updated.language_code;
  await c.query('UPDATE users SET last_login_at=now(),language_code=$2 WHERE id=$1',[user.id,language]);
  await audit(c,req,user,'login','COMMITTED',session);
  const {password_hash,active,deleted_at,...publicUser}=updated;
  return {sid,csrfToken,user:await userInfo(c,{...publicUser,language_code:language})};
 });
}

async function changePassword(pool,req,allowed){
 const {body}=req,fields=['current_password','new_password','confirm_password'];
 if(!body||Object.keys(body).length!==fields.length||fields.some(key=>!Object.hasOwn(body,key)||
  typeof body[key]!=='string'||!body[key].length)||body.current_password.length>128){
  return {status:400,code:'PASSWORD_FIELDS_INVALID',error:'请输入当前密码、新密码和确认密码。'};
 }
 if(!validPassword(body.new_password))return {status:400,code:'NEW_PASSWORD_LENGTH',error:'新密码须为10–48个字符。'};
 if(body.new_password!==body.confirm_password)return {status:400,code:'PASSWORD_CONFIRMATION_MISMATCH',error:'两次输入的新密码不一致。'};
 return accountTransaction(pool,async c=>{
  const {rows:[user]}=await c.query(
   'SELECT u.id,u.username,u.role_code,u.password_hash,u.deleted_at FROM users u JOIN sessions s ON s.user_id=u.id '+
   'WHERE u.id=$1 AND u.active AND u.deleted_at IS NULL AND s.token_hash=$2 AND s.csrf_hash=$3 AND s.expires_at>clock_timestamp() AND '+current+' FOR UPDATE OF u',
   [req.user.id,digest(req.cookies.musonoi_session),req.user.csrf_hash]);
  if(!user||!await allowed(c,user))return {status:401,error:'登录已失效，请重新登录。'};
  const maxFailures=5;
  const {rows:recent}=await c.query(
   "SELECT action FROM audit_logs WHERE entity_type='users' AND entity_id=$1 "+
   "AND action IN ('password_change_failed','password_changed','password_reset') "+
   "AND occurred_at>clock_timestamp()-interval '15 minutes' ORDER BY id DESC LIMIT $2",
   [user.id,maxFailures]);
  if(recent.length===maxFailures&&recent.every(row=>row.action==='password_change_failed')){
   return {status:429,code:'PASSWORD_CHANGE_THROTTLED',error:'尝试次数过多，请稍后再试。'};
  }
  if(!verifyPassword(body.current_password,user.password_hash)){
   await audit(c,req,user,'password_change_failed','FAILED');
   return {status:400,code:'CURRENT_PASSWORD_INCORRECT',error:'当前密码不正确。'};
  }
  if(body.new_password===body.current_password)return {status:400,code:'PASSWORD_UNCHANGED',error:'新密码须与当前密码不同。'};
  // The account lifecycle trigger revokes all sessions on a password hash change.
  await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashPassword(body.new_password),user.id]);
  await audit(c,req,user,'password_changed','COMMITTED',{sessions_revoked:true});
  return {status:200};
 });
}

module.exports={current,csrf,audit,open,changePassword};
