'use strict';

const B=require('./business-common.cjs');
const copper='/api/v1/plans/:id/dispatch/vehicles/:vehicle/transport';
const cobalt='/api/v1/cobalt/sales/plans/:id/dispatch/vehicles/:vehicle/transport';
const allowed=(path,method)=>method==='POST'&&/^\/api\/v1\/cobalt\/sales\/plans\/[0-9a-f-]{36}\/dispatch\/vehicles\/[0-9a-f-]{36}\/transport$/i.test(path);

function values(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['version','transporter','destination'].includes(k)))
  throw B.error(400,'DISPATCH_TRANSPORT_INVALID');
 return [B.text(body.transporter,'运输商',160),B.text(body.destination,'目的地',1000)];
}

async function save(c,req,co){
 const id=B.uuid(req.params.vehicle),fields=values(req.body),version=B.version(req.body.version);
 const p=co?await require('./cobalt-sales.cjs').access(c,req,'plan',req.params.id,true):await require('./allocations.cjs').planAccess(c,req,req.params.id,true);
 const table=co?'co_dispatch_vehicles':'sales_dispatch_vehicles';
 const versionField=co?'version':'transport_version';
 const visible=co?'v.sales_plan_id=$2':'EXISTS(SELECT 1 FROM sales_dispatch_imports x WHERE x.id=v.import_id AND x.sales_plan_id=$2)';
 const {rows:[old]}=await c.query('SELECT v.* FROM '+table+' v WHERE v.id=$1 AND '+visible+' FOR UPDATE',[id,p.id]);
 if(!old)throw B.error(404,'DISPATCH_TRANSPORT_NOT_FOUND');
 if(old.cancelled_at||old[versionField]!==version)throw B.error(409,'DISPATCH_TRANSPORT_STALE');
 const clause=co?',updated_at=clock_timestamp(),updated_by=$4':'';
 const {rows:[saved]}=await c.query('UPDATE '+table+' SET transporter=$2,destination=$3,'+versionField+'='+versionField+'+1'+clause+' WHERE id=$1 RETURNING *',
  [id,...fields,...(co?[req.user.id]:[])]);
 const result={id,version:saved[versionField],transporter:saved.transporter,destination:saved.destination,
  project_id:p.project_id,warehouse_id:p.warehouse_id||null,customer_id:p.customer_id,sales_plan_id:p.id};
 await B.audit(c,req,'dispatch_vehicle_transport_updated',table,id,{transporter:old.transporter,destination:old.destination},result);
 return result;
}

function register({app,pool,permitted,csrf}){
 for(const co of [false,true])app.post(co?cobalt:copper,{preHandler:[permitted('dispatch:write'),csrf]},req=>
  co?require('./cobalt-sales.cjs').mutation(pool,req,'dispatch:write',c=>save(c,req,co)):
     B.mutate(pool,req,c=>save(c,req,co)));
}

module.exports={register,allowed};
