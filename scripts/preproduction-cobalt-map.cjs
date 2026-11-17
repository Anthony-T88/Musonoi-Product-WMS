'use strict';
const {Client}=require('pg');
const DB=require('../server/database-connection.cjs');
const {installSitePlan,site}=require('../server/cobalt-map-config.cjs');
const {authorize}=require('./maintenance-connection.cjs');

async function provision(c,{projectCode,warehouseCode,username,apply=false}){
 await c.query('BEGIN');
 try{
  const {rows:[state]}=await c.query('SELECT environment FROM system_info WHERE singleton');
  if(state?.environment!=='test')DB.fail('PREPRODUCTION_ONLY');
  const {rows:[target]}=await c.query(`SELECT w.id warehouse_id,p.id project_id,u.id actor_id
   FROM warehouses w JOIN projects p ON p.id=w.project_id JOIN users u ON u.username=$3
   JOIN role_permissions r ON r.role_code=u.role_code AND r.permission_code='co:location-manage'
   WHERE p.code=$1 AND w.code=$2 AND w.active AND u.active AND u.deleted_at IS NULL AND u.role_code='admin'
   AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.project_id=p.id AND s.customer_id IS NULL
     AND (s.warehouse_id IS NULL OR s.warehouse_id=w.id))`,[projectCode,warehouseCode,username]);
  if(!target)DB.fail('CO_SITE_TARGET_OR_ACTOR_NOT_FOUND');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['co-layout:'+target.warehouse_id]);
  const {rows:[existing]}=await c.query(`SELECT EXISTS(SELECT 1 FROM co_stock_map_configs WHERE warehouse_id=$1) configured,
   EXISTS(SELECT 1 FROM co_zones WHERE warehouse_id=$1) zones`,[target.warehouse_id]);
  if(!existing.configured&&existing.zones)DB.fail('CO_SITE_EXISTING_ZONES_REQUIRE_REVIEW');
  let result;
  try{
   result=await installSitePlan(c,{user:{id:target.actor_id}},{project_id:target.project_id,warehouse_id:target.warehouse_id,
    layout_key:site.key,reason:'Provision reviewed cobalt site plan on preproduction'});
  }catch(error){if(/^CO_[A-Z_]+$/.test(error.message))error.code=error.message;throw error;}
  const {rows:[count]}=await c.query(`SELECT count(*)::int locations,count(*) FILTER(WHERE occupied_by IS NOT NULL)::int occupied
   FROM co_locations WHERE warehouse_id=$1 AND code=ANY($2::text[])`,[target.warehouse_id,site.locations.map(x=>x.code)]);
  if(count.locations!==site.locations.length||(!result.already_configured&&count.occupied!==0))DB.fail('CO_SITE_LOCATION_CHECK_FAILED');
  await c.query(apply?'COMMIT':'ROLLBACK');
  return {status:apply?'CO_SITE_APPLIED':'CO_SITE_DRY_RUN_ROLLED_BACK',project:projectCode,warehouse:warehouseCode,
   layout:site.key,...count,already_configured:Boolean(result.already_configured)};
 }catch(error){await c.query('ROLLBACK');throw error;}
}

async function main(){
 if(process.env.APP_ENV!=='test'||process.env.DEPLOYMENT_TIER!=='preproduction')DB.fail('PREPRODUCTION_ONLY');
 const [projectCode,warehouseCode,username,...args]=process.argv.slice(2);
 if([projectCode,warehouseCode,username].some(value=>!value||!/^[-a-zA-Z0-9_.]{1,80}$/.test(value)))DB.fail('CO_SITE_INVALID_TARGET');
 const cfg={environment:'test',databaseUrl:process.env.DATABASE_OWNER_URL,db:DB.settings()};
 const apply=authorize(args,cfg);
 if(apply&&process.env.TEST_BACKUP_VERIFIED!=='yes')DB.fail('TEST_BACKUP_NOT_VERIFIED');
 const c=new Client(DB.connection(cfg,'owner'));
 try{
  await c.connect();await DB.verify(c,cfg,'owner');
  console.log(JSON.stringify(await provision(c,{projectCode,warehouseCode,username,apply})));
 }finally{await c.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify(DB.safeError(error)));process.exitCode=1;});
module.exports={provision};
