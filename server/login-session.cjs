'use strict';

const {createHmac}=require('node:crypto');
const {digest,token}=require('./security.cjs');
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

module.exports={current,csrf,audit,open};
