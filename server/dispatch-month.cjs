'use strict';
const B=require('./business-common.cjs');
const roles=new Set(['sales_operator','sales_manager','admin']);
const valid=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function canChange(req,plan){return plan.status==='OPEN'&&roles.has(req.user.role_code)&&req.user.permissions.includes('dispatch:month');}
function settings(req,plan){
 const month=plan.shipment_month||plan.preparation_month||null;
 return {month,can_change:canChange(req,plan)};
}
function effective(plan,supplied){
 const month=plan.shipment_month||plan.preparation_month||null;
 if(!month)throw B.error(409,'请先维护派车发运月份');
 if(supplied&&supplied!==month)throw B.error(409,'派车月份已变更，请刷新后重新预览');
 return month;
}
function validate(req,plan,current){
 if(!canChange(req,plan))throw B.error(403,'当前账号不能调整此车辆的派车月份');
 const b=req.body;
 if(!valid(b?.shipment_month)||!valid(b.previous_month)||Object.keys(b).some(key=>!['shipment_month','previous_month'].includes(key)))
  throw B.error(400,'请选择有效发运月份');
 if(b.previous_month!==current)throw B.error(409,'车辆的派车月份已变化，请刷新后重试');
 return b.shipment_month;
}
module.exports={settings,effective,canChange,validate};
