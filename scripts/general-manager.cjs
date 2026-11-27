'use strict';

const fs=require('node:fs');
const DB=require('../server/database-connection.cjs');
const Maintenance=require('./maintenance-connection.cjs');
const {hashPassword}=require('../server/security.cjs');
const {supported}=require('../server/languages.cjs');

async function configure(client,{username,displayName,language='zh-CN',password},{apply=false,rotate=false,backupVerified=false,environment='production'}={}){
 if(!/^[a-z][a-z0-9_]{2,39}$/.test(username||'')||typeof displayName!=='string'||!displayName.trim()||displayName.length>80||
  /[\x00-\x1f]/.test(displayName)||!supported.includes(language)||typeof password!=='string'||password.length<20||password.length>128){
  DB.fail('GENERAL_MANAGER_CONFIGURATION_INVALID');
 }
 if(apply&&!backupVerified)DB.fail('MIGRATION_VERIFIED_BACKUP_REQUIRED');
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(21002)');
  const {rows:[tag]}=await client.query('SELECT environment FROM system_info WHERE singleton');
  if(tag?.environment!==environment)DB.fail('GENERAL_MANAGER_ENVIRONMENT_MISMATCH');
  const {rows:[current]}=await client.query("SELECT id,username FROM users WHERE role_code='general_manager' AND active AND deleted_at IS NULL FOR UPDATE");
  if(rotate?current?.username!==username:!!current)DB.fail('GENERAL_MANAGER_ACTIVE_ACCOUNT_CONFLICT');
  let change;
  if(rotate){
   await client.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashPassword(password),current.id]);
   await client.query('DELETE FROM sessions WHERE user_id=$1',[current.id]);
   change=current;
  }else{
   if((await client.query('SELECT 1 FROM users WHERE username=$1',[username])).rowCount)DB.fail('GENERAL_MANAGER_USERNAME_TAKEN');
   const {rows:[created]}=await client.query(
    "INSERT INTO users(username,display_name,role_code,language_code,password_hash) VALUES($1,$2,'general_manager',$3,$4) RETURNING id,username",
    [username,displayName.trim(),language,hashPassword(password)]);
   change=created;
  }
  await client.query("INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES($1,'users',$2,$3)",
   [rotate?'general_manager_password_rotated':'general_manager_provisioned',change.id,{username:change.username,source:'maintenance'}]);
  await client.query(apply?'COMMIT':'ROLLBACK');
  return {status:apply?(rotate?'ROTATED':'PROVISIONED'):'DRY_RUN_ROLLED_BACK',username};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
module.exports={configure};
if(require.main===module)(async()=>{
 const cfg=Maintenance.configuration(),args=process.argv.slice(2),apply=Maintenance.authorize(args,cfg);
 const env=process.env;
 const password=fs.readFileSync(env.WMS_MANAGER_PASSWORD_FILE,'utf8').replace(/\r?\n$/,'');
 const client=await Maintenance.open(cfg);
 try{
  console.log(JSON.stringify(await configure(client,{username:env.WMS_MANAGER_USERNAME,displayName:env.WMS_MANAGER_DISPLAY_NAME,
   language:env.WMS_MANAGER_LANGUAGE,password},{apply,rotate:args.includes('--rotate'),backupVerified:env.PRODUCTION_BACKUP_VERIFIED==='yes'})));
 }finally{await client.end();}
})().catch(e=>{console.error(JSON.stringify(DB.safeError(e)));process.exitCode=1;});
