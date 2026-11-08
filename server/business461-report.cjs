'use strict';
// Chart values are projections of the existing report result, not new measures.
function chart(r,rows){const type=r.type,weight=type==='structure'||type==='outbound'||type==='fulfilment';let data;
 if(type==='loading')data=[['total',r.summary.total],['completed',r.summary.completed],['incomplete',r.summary.incomplete],['overdue',r.summary.overdue]].map(([label,value])=>({label,value}));
 else data=rows.slice(0,12).map(x=>({label:String(x.document_no||x.loading_plan_no||x.task_code&&[x.task_code,x.finding,x.status].filter(Boolean).join(' · ')||x[r.filters.group_by]||x.customer_name||x.lot_no||x.location||x.inventory_state||x.date||x.month||x.contract_no||x.vehicle_no||'—'),value:weight?(type==='fulfilment'?x.outbound_net_weight:x.known_net_weight??x.net_weight):x.bundles,target:type==='fulfilment'?x.planned_net_weight:null,unknown_weights:x.unknown_weights||0}));
 return {type,unit:weight?'MT':'count',rows:data,total_groups:r.rows.length,shown:data.length,unmeasured_weights:r.summary.unknown_weights||0,overdue_is_subset:type==='loading',same_filtered_result:true};
}
module.exports={chart};
