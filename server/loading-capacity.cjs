'use strict';
const T=require('../dist/tonnes.js');
// Net payload warning only. Unknown capacity/weight is never treated as zero.
function warning(total,dispatch,fallback=null,context={}){
 const capacity=dispatch?.capacity_tonnes||null,threshold=capacity||fallback||null,known=total.total_net_weight!==null&&total.total_net_weight!==undefined,delta=threshold&&known?T.scaled(total.total_net_weight,6)-T.scaled(threshold,6):null;
 return {...context,dispatch_capacity_tonnes:capacity,net_limit_tonnes:threshold,limit_source:capacity?'DISPATCH':threshold?'ADMIN_FALLBACK':'UNSET',dispatch_import_id:dispatch?.import_id||null,over_limit:delta!==null&&delta>0n,excess_net_tonnes:delta!==null&&delta>0n?T.fixed(delta,6):null,remaining_net_tonnes:delta!==null&&delta<=0n?T.fixed(-delta,6):null,missing_dispatch_capacity:!capacity,missing_weights:!known||total.total_gross_weight===null};
}
module.exports={warning};
