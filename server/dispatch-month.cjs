'use strict';
const B=require('./business-common.cjs');
const valid=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const planMonth=plan=>plan.shipment_month||plan.preparation_month||null;
const forbidden=()=>B.error(403,'当前账号不能调整此车辆的派车月份');
const invalidTarget=()=>B.error(409,'请选择同一客户其他月份的有效销售计划');
function canChange(req,plan){return plan.status==='OPEN'&&req.user.permissions.includes('dispatch:month');}
function settings(req,plan){
 return {month:planMonth(plan),can_change:canChange(req,plan)};
}
function effective(plan,supplied){
 const month=planMonth(plan);
 if(!month)throw B.error(409,'请先维护派车发运月份');
 if(supplied&&supplied!==month)throw B.error(409,'派车月份已变更，请刷新后重新预览');
 return month;
}
function validate(body,current){
 if(body.previous_month!==current)throw B.error(409,'车辆的派车月份已变化，请刷新后重试');
}
function transferInput(req){
 const body=req.body;
 if(!valid(body?.shipment_month)||!valid(body.previous_month)||Object.keys(body).some(key=>!['shipment_month','previous_month','target_plan_id'].includes(key)))
  throw B.error(400,'请选择有效发运月份');
 if(!body.target_plan_id)throw B.error(400,'请选择目标销售计划');
 return {...body,target_plan_id:B.uuid(body.target_plan_id).toLowerCase()};
}
function openApproved(product){
 return `p.status='OPEN' AND NOT EXISTS(SELECT 1 FROM sales_plan_approvals approval
  WHERE approval.product_code='${product}' AND approval.plan_id=p.id AND approval.state<>'APPROVED')`;
}
async function targets(c,req,source,co,targetId=null){
 if(!canChange(req,source)||!planMonth(source))return [];
 const product=co?'CO_HYDROXIDE':'CU_CATHODE',month=co?'shipment_month':'preparation_month';
 const plans=co?'co_sales_plans':'sales_plans',customers=co?'co_customer_profiles':'copper_customers';
 const contracts=co?'co_sales_contracts':'customer_contracts';
 const {rows}=await c.query(`SELECT p.id,p.code,p.${month} shipment_month,k.contract_no${co?',p.warehouse_id,w.name warehouse_name':''}
  FROM ${plans} p JOIN ${customers} cu ON cu.id=p.customer_id AND cu.active
  LEFT JOIN ${contracts} k ON k.id=p.contract_id ${co?'JOIN warehouses w ON w.id=p.warehouse_id AND w.active':''}
  WHERE p.id<>$2 AND p.project_id=$3 AND p.customer_id=$4 AND p.${month} IS NOT NULL AND p.${month}<>$5
  AND ($6::uuid IS NULL OR p.id=$6) AND ${openApproved(product)}
  AND NOT EXISTS(SELECT 1 FROM sales_plan_approvals approval WHERE approval.product_code='${product}'
   AND approval.plan_id=$2 AND approval.state<>'APPROVED')
  AND (p.contract_id IS NULL OR (k.active ${co?'':'AND k.deleted_at IS NULL'}
   AND (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date BETWEEN k.effective_date AND k.end_date))
  AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id
   AND (s.customer_id IS NULL OR s.customer_id=p.customer_id)${co?' AND (s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id)':''})
  ORDER BY p.${month} DESC,p.code`,[req.user.id,source.id,source.project_id,source.customer_id,planMonth(source),targetId]);
 return rows;
}
async function lockTransfer(c,req,co,access){
 const body=transferInput(req),sourceId=B.uuid(req.params.id).toLowerCase(),targetId=body.target_plan_id;
 if(sourceId===targetId)throw invalidTarget();
 // Historical-document linking must not resolve the vehicle against its old plan mid-transfer.
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 // Every transfer locks the two plans in the same order, including transfers back to a prior plan.
 const plans=new Map();
 for(const id of [sourceId,targetId].sort())plans.set(id,await access(c,req,id,true));
 const source=plans.get(sourceId);
 if(!canChange(req,source))throw forbidden();
 const [target]=await targets(c,req,source,co,targetId);
 if(!target||target.shipment_month!==body.shipment_month)throw invalidTarget();
 return {body,source,target};
}
async function audit(c,req,co,vehicle,source,target){
 const scope={project_id:source.project_id,customer_id:source.customer_id};
 await B.audit(c,req,'dispatch_vehicle_month_changed',co?'co_dispatch_vehicles':'sales_dispatch_vehicles',vehicle.id,
  {...scope,warehouse_id:source.warehouse_id||null,sales_plan_id:source.id,sales_plan_code:source.code,
   shipment_month:vehicle.shipment_month,import_id:vehicle.import_id},
  {...scope,warehouse_id:target.warehouse_id||null,sales_plan_id:target.id,sales_plan_code:target.code,
   shipment_month:target.shipment_month,import_id:vehicle.import_id});
 return {id:vehicle.id,...scope,warehouse_id:target.warehouse_id||null,sales_plan_id:target.id,
  sales_plan_code:target.code,shipment_month:target.shipment_month};
}
module.exports={settings,effective,validate,transferInput,targets,lockTransfer,audit};
