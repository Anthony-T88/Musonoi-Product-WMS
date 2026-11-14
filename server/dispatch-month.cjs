'use strict';
const B=require('./business-common.cjs');
const roles=new Set(['sales_operator','sales_manager','admin']);
function canChange(req,plan){return plan.status==='OPEN'&&roles.has(req.user.role_code)&&req.user.permissions.includes('dispatch:month');}
async function settings(c,req,plan){
 const current=(await c.query('SELECT shipment_month,version FROM dispatch_month_overrides WHERE product_code=$1 AND sales_plan_id=$2',[req.productCode,plan.id])).rows[0];
 const scheduled=plan.shipment_month||plan.preparation_month||null;
 return {scheduled,month:current?.shipment_month||scheduled,version:current?.version||0,can_change:canChange(req,plan)};
}
async function effective(c,req,plan,supplied){
 const {month}=await settings(c,req,plan);
 if(!month)throw B.error(409,'请先维护派车发运月份');
 if(supplied&&supplied!==month)throw B.error(409,'派车月份已变更，请刷新后重新预览');
 return month;
}
async function change(c,req,plan){
 if(!canChange(req,plan))throw B.error(403,'当前账号不能变更此销售计划的派车月份');
 const b=req.body,validMonth=typeof b?.shipment_month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(b.shipment_month);
 if(!validMonth||!Number.isSafeInteger(b.version)||b.version<0||Object.keys(b).some(k=>!['shipment_month','version'].includes(k)))
  throw B.error(400,'请选择有效发运月份');
 const before=await settings(c,req,plan);
 if(before.version!==b.version)throw B.error(409,'派车月份已变更，请刷新后重新预览');
 const {rows:[row]}=await c.query(
  'INSERT INTO dispatch_month_overrides(product_code,sales_plan_id,shipment_month,updated_by) VALUES($1,$2,$3,$4) '+
  'ON CONFLICT(product_code,sales_plan_id) DO UPDATE SET shipment_month=excluded.shipment_month,version=dispatch_month_overrides.version+1,updated_by=excluded.updated_by,updated_at=clock_timestamp() RETURNING version',
  [req.productCode,plan.id,b.shipment_month,req.user.id]);
 const after={...before,month:b.shipment_month,version:row.version};
 await B.audit(c,req,'dispatch_month_changed',req.productCode==='CU_CATHODE'?'sales_plans':'co_sales_plans',plan.id,before,
  {...after,product_code:req.productCode,project_id:plan.project_id,customer_id:plan.customer_id,warehouse_id:plan.warehouse_id||null});
 return {...after,id:plan.id,project_id:plan.project_id,customer_id:plan.customer_id,warehouse_id:plan.warehouse_id||null};
}
module.exports={settings,effective,change};
