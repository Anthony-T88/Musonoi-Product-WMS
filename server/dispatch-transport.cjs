'use strict';

const B=require('./business-common.cjs');
const Month=require('./dispatch-month.cjs');
const copper='/api/v1/plans/:id/dispatch/vehicles/:vehicle/transport';
const cobalt='/api/v1/cobalt/sales/plans/:id/dispatch/vehicles/:vehicle/transport';
const allowed=(path,method)=>method==='POST'&&/^\/api\/v1\/cobalt\/sales\/plans\/[0-9a-f-]{36}\/dispatch\/vehicles\/[0-9a-f-]{36}\/transport$/i.test(path);
const truckKey=value=>value.toUpperCase().replace(/[\s-]+/g,'');
const routeFields=['transporter','destination'];
const cobaltTransportLocked="EXISTS(SELECT 1 FROM co_loading_orders l WHERE l.vehicle_id=v.id AND l.status IN('WAITING','OUTBOUND'))";
function requireForLoading(arrival){
 if(routeFields.some(field=>!arrival?.['dispatch_'+field]?.trim()))
  throw B.error(409,'派车资料不全。请在派车管理再次导入派车单，补全运输商和目的地。');
}

function importMonth(plan,body){
 if(body.transport_only===undefined||body.transport_only===false)return Month.effective(plan,body.shipment_month);
 if(body.transport_only!==true||typeof body.shipment_month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.shipment_month))
  throw B.error(400,'DISPATCH_TRANSPORT_MONTH_REQUIRED');
 return body.shipment_month;
}

async function analyzeImport(c,planId,month,items,{co=false,transportOnly=false,lock=false}={}){
 const groups=new Map();
 for(const item of items){
  const key=truckKey(item.truck_no);
  if(!key)throw B.error(400,'车头号无效');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(item);
 }
 const source=co?`SELECT v.id,v.truck_key,v.transporter,v.destination,v.cancelled_at,${cobaltTransportLocked} transport_locked FROM co_dispatch_vehicles v
  WHERE v.sales_plan_id=$1 AND v.shipment_month=$2 AND v.truck_key=ANY($3::text[])`:
  `SELECT v.id,k.truck_key,v.transporter,v.destination,v.cancelled_at FROM sales_dispatch_vehicle_keys k
  JOIN sales_dispatch_vehicles v ON v.id=k.vehicle_id
  WHERE k.sales_plan_id=$1 AND k.shipment_month=$2 AND k.truck_key=ANY($3::text[])`;
 const {rows}=groups.size?await c.query(source+(lock?' FOR UPDATE OF v':''),[planId,month,[...groups.keys()]]):{rows:[]};
 const known=new Map(rows.map(row=>[row.truck_key,row])),fresh=[],updates=[],preview=[];
 const tally={new_count:0,transport_filled_count:0,duplicate_count:0,unmatched_count:0,transport_conflict_count:0,transport_locked_count:0};
 for(const [key,group] of groups){
  const [item,...duplicates]=group;
  const current=known.get(key);
  let action='DUPLICATE',updated;
  if(!current){
   if(transportOnly){
    action='UNMATCHED';
    tally.unmatched_count++;
   }else{
    action='ADD';
    fresh.push(item);
   }
  }else if(!current.cancelled_at){
   // A repeated plate can supply blank fields only when its spreadsheet values agree.
   const next={transporter:current.transporter,destination:current.destination},source_rows={};
   let conflict=false;
   for(const field of routeFields){
    if(current[field]?.trim())continue;
    const supplied=group.filter(row=>row[field]);
    const values=new Set(supplied.map(row=>row[field]));
    if(values.size>1)conflict=true;
    if(values.size===1){next[field]=supplied[0][field];source_rows[field]=supplied[0].source_row;}
   }
   const changed=routeFields.some(field=>next[field]!==current[field]);
   if(current.transport_locked&&(conflict||changed)){
    action='TRANSPORT_LOCKED';
    tally.transport_locked_count++;
   }else if(conflict){
    action='TRANSPORT_CONFLICT';
    tally.transport_conflict_count++;
   }else if(changed){
    action='FILL_TRANSPORT';
    updated=next;
    updates.push({current,next,source_rows});
   }
  }
  tally.duplicate_count+=duplicates.length+Number(action==='DUPLICATE');
  preview.push({...item,...updated,action,duplicate:action!=='ADD'});
  for(const repeated of duplicates)preview.push({...repeated,action:'DUPLICATE',duplicate:true});
 }
 tally.new_count=fresh.length;
 tally.transport_filled_count=updates.length;
 return {fresh,updates,tally,items:preview.sort((a,b)=>a.source_row-b.source_row)};
}

async function fillFromImport(c,req,plan,month,body,parsed,updates,co){
 if(!updates.length)return;
 const table=co?'co_dispatch_vehicles':'sales_dispatch_vehicles';
 const version=co?'version':'transport_version';
 const changes=updates.map(({current,next})=>({id:current.id,...next}));
 const result=await c.query(`UPDATE ${table} v SET transporter=i.transporter,destination=i.destination,${version}=v.${version}+1
  ${co?',updated_by=$2,updated_at=clock_timestamp()':''}
  FROM jsonb_to_recordset($1::jsonb) AS i(id uuid,transporter text,destination text)
  WHERE v.id=i.id AND v.cancelled_at IS NULL`,[JSON.stringify(changes),...(co?[req.user.id]:[])]);
 if(result.rowCount!==updates.length)throw B.error(409,'DISPATCH_TRANSPORT_STALE');
 for(const {current,next,source_rows} of updates)await B.audit(c,req,'dispatch_vehicle_transport_updated',table,current.id,
  {transporter:current.transporter,destination:current.destination},{...next,project_id:plan.project_id,
   warehouse_id:plan.warehouse_id||null,customer_id:plan.customer_id,sales_plan_id:plan.id,shipment_month:month,
   source:'DISPATCH_FILE',file_name:body.file_name,file_sha256:parsed.file_sha256,source_sheet:parsed.mapping.sheet,source_rows});
}

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
 const visible=co?'v.sales_plan_id=$2':`EXISTS(SELECT 1 FROM sales_dispatch_imports i
  LEFT JOIN sales_dispatch_vehicle_keys k ON k.vehicle_id=v.id
  WHERE i.id=v.import_id AND coalesce(k.sales_plan_id,i.sales_plan_id)=$2)`;
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

module.exports={register,allowed,truckKey,importMonth,analyzeImport,fillFromImport,cobaltTransportLocked,requireForLoading};
