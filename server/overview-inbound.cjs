'use strict';
// Confirmed receipt dates, valued from evidence available at the selected cutoff.
// Read-only; opening balances, transfers and returns are not production receipts.
async function copper(c,x,states){
 const byId=new Map(states.filter(s=>s.date>=x.w.from&&s.date<=x.w.to).map(s=>[s.bundle_id||s.uuid||s.id,s]));
 if(!byId.size)return [];
 const events=(await c.query(`SELECT b.id bundle_id FROM bundles b JOIN receipts r ON r.id=b.receipt_id WHERE b.id=ANY($1::uuid[]) AND r.confirmed_at IS NOT NULL AND r.confirmed_at<$2 ORDER BY b.id`,[[...byId.keys()],x.w.end])).rows;
 return events.flatMap(e=>{const s=byId.get(e.bundle_id);if(!s)return [];const prepared=['PREPARED','PARTIAL','FULFILLED'].includes(s.lot_workflow_state)||s.physical_status==='OUTBOUND';return [{date:s.date,net_weight:prepared?s.net_weight:null,bundles:prepared?0:1,prepared,unknown_weights:prepared&&s.net_weight==null?1:0}];});
}
async function cobalt(c,req,q,w,asOf){
 asOf=new Date(Math.min(+new Date(asOf),Date.parse(w.to+'T00:00:00+02:00')+86400000)).toISOString();
 const values=[req.user.id,w.from,w.to,asOf],where=[`p.status='RECEIVED'`,`i.received_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Lubumbashi')`,`i.received_at < LEAST((($3::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi'),$4::timestamptz)`,`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id) AND(s.customer_id IS NULL OR s.customer_id=sp.customer_id))`];
 for(const key of ['project_id','warehouse_id','customer_id','contract_id','preparation_id'])if(q[key]){values.push(q[key]);where.push((key==='preparation_id'?'p.id':['project_id','warehouse_id'].includes(key)?'p.'+key:'sp.'+key)+'=$'+values.length);}
 if(q.status){values.push(q.status);where.push(`coalesce(e.state,CASE WHEN o.id IS NOT NULL THEN 'MATCHED' ELSE work.status END)=$${values.length}`);}
 // Retain the last known in-stock weight when the same bag has since shipped.
 // Ledger history before its baseline is deliberately unknown.
 return (await c.query(`SELECT to_char(i.received_at AT TIME ZONE 'Africa/Lubumbashi','YYYY-MM-DD') date,CASE WHEN evidence.bags>0 AND evidence.unknown=0 THEN evidence.net::text ELSE NULL END net_kg FROM co_inventory i JOIN co_preparations p ON p.id=i.preparation_id LEFT JOIN co_work_batches work ON work.preparation_id=p.id LEFT JOIN co_loading_orders o ON o.preparation_id=p.id AND o.status IN('WAITING','OUTBOUND') LEFT JOIN co_load_executions e ON e.order_id=o.id LEFT JOIN co_sales_plans sp ON sp.id=o.sales_plan_id LEFT JOIN LATERAL(SELECT sum(m.bags_delta) bags,sum(m.unknown_bags_delta) unknown,sum(m.known_net_delta_kg) net FROM co_report_movements m WHERE m.bag_id=i.bag_id AND m.occurred_at<LEAST($4::timestamptz,coalesce((SELECT min(exit.occurred_at) FROM co_report_movements exit WHERE exit.bag_id=i.bag_id AND exit.kind='OUTBOUND' AND exit.occurred_at<$4::timestamptz),'infinity'::timestamptz))) evidence ON true WHERE ${where.join(' AND ')}`,values)).rows.map(r=>({date:r.date,net_weight:r.net_kg==null?null:require('./stock-balance.cjs').kgToMt(r.net_kg),prepared:true,bundles:0,unknown_weights:r.net_kg==null?1:0}));
}
module.exports={copper,cobalt};
