'use strict';
// One-off local TEST account cleanup. Historical foreign keys continue to reference the same IDs.
const {Client}=require('pg'),{randomUUID}=require('node:crypto'),fs=require('node:fs');
const {hashPassword}=require('../server/security.cjs');
async function reset(connection,username,apply){
 const url=new URL(connection);
 if(url.hostname!=='127.0.0.1'||url.port!=='55432'||!/^\/musonoi_(?:audit_[a-f0-9]{10}|v26_development)_test$/.test(url.pathname))
  throw Error('Expected the local TEST PostgreSQL database');
 const c=new Client({connectionString:url.href});await c.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(21002)');
  const keeper=(await c.query(
   "SELECT u.id,u.username FROM users u WHERE u.username=$1 AND u.role_code='admin' AND u.active AND u.deleted_at IS NULL "+
   'AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.warehouse_id IS NULL AND s.customer_id IS NULL) FOR UPDATE',
   [username])).rows[0];
  if(!keeper)throw Error('The explicitly retained administrator must be active and have a full project scope');
  const count=(await c.query('SELECT count(*)::int n FROM users WHERE id<>$1 AND deleted_at IS NULL',[keeper.id])).rows[0].n;
  if(!apply){await c.query('ROLLBACK');return {mode:'preview',database:url.pathname.slice(1),keeper:keeper.username,otherAccounts:count};}
  const reason='V4.8.1 local TEST account cleanup';
  const all=await c.query(
   "UPDATE users SET active=false,deleted_at=coalesce(deleted_at,clock_timestamp()),deleted_by=coalesce(deleted_by,$1),"+
   "deletion_reason=coalesce(deletion_reason,$2),deleted_role_code=coalesce(deleted_role_code,role_code),"+
   "password_hash=$3,contact_email=NULL,contact_phone=NULL WHERE id<>$1",
   [keeper.id,reason,hashPassword(randomUUID()+randomUUID())]);
  const sessions=await c.query('DELETE FROM sessions WHERE user_id<>$1',[keeper.id]);
  const pending=await c.query("DELETE FROM registration_requests WHERE status='PENDING'");
  const remaining=(await c.query('SELECT count(*)::int n FROM users WHERE active AND deleted_at IS NULL')).rows[0].n;
  if(remaining!==1)throw Error('Expected one remaining account');
  const result={mode:'applied',keeper:keeper.username,deletedAccounts:count,invalidatedProfiles:all.rowCount,
   revokedSessions:sessions.rowCount,cancelledPendingRegistrations:pending.rowCount,remaining};
  await c.query("INSERT INTO audit_logs(actor_id,action,entity_type,after_data,request_id) VALUES($1,'local_test_account_cleanup','users',$2,$3)",
   [keeper.id,result,randomUUID()]);
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{await c.end();}
}
if(require.main===module){
 const [configPath,username,option]=process.argv.slice(2);
 if(!configPath||!username||option&&option!=='--apply')throw Error('Usage: node scripts/reset-local-test-accounts.cjs <TEST config> <keep username> [--apply]');
 const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
 const url=new URL(cfg.appCfg?.databaseUrl);
 if(cfg.appCfg.environment!=='test'||url.pathname!=='/'+cfg.database)throw Error('Config is not an allowed local TEST fixture');
 const password=process.env.WMS_LOCAL_TEST_OWNER_PASSWORD;
 if(!password)throw Error('The local TEST database owner credential is required');
 url.username='musonoi_owner';url.password=password;
 reset(url.href,username,option==='--apply').then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(error.message);process.exitCode=1;
 });
}
module.exports={reset};
