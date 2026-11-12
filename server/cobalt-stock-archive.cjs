'use strict';
const C=require('./cobalt.cjs');

async function details(c,req,id){
 const preparation=await C.document(c,req,id);
 const {rows:[row]}=await c.query(`
  SELECT pp.id preparation_plan_id,pp.batch_no,pp.state preparation_plan_state,pp.created_at plan_created,
    coalesce(ob.snapshot#>>'{customer,name}',buyer.name,planned_buyer.name) customer,
    coalesce(ob.snapshot#>>'{contract,contract_no}',contract.contract_no,planned_contract.contract_no) contract_no,
    sales.id sales_id,sales.code sales_no,sales.status sales_status,sales.created_at sales_created,
    lp.id loading_plan_id,lp.code loading_plan_no,lp.status loading_plan_status,lp.planned_load_date,
    l.id loading_id,l.code loading_no,l.created_at loading_created,execution.state loading_state,
    ob.posted_at,packing.document_no packing_no,packing.updated_at packing_updated,
    metal.estimated_metal_mt::text outbound_estimated_mt,metal.confirmed_metal_mt::text confirmed_metal_mt
  FROM co_preparations p
  LEFT JOIN preparation_plans pp ON pp.co_preparation_id=p.id
  LEFT JOIN co_sales_plans planned ON planned.id=pp.co_sales_plan_id
  LEFT JOIN co_customer_profiles planned_buyer ON planned_buyer.id=planned.customer_id
  LEFT JOIN co_sales_contracts planned_contract ON planned_contract.id=planned.contract_id
  LEFT JOIN co_load_executions execution ON execution.preparation_id=p.id
  LEFT JOIN co_loading_orders l ON l.id=execution.order_id AND l.status<>'CANCELLED'
  LEFT JOIN co_loading_plans lp ON lp.id=l.plan_id
  LEFT JOIN co_sales_plans sales ON sales.id=coalesce(l.sales_plan_id,pp.co_sales_plan_id)
  LEFT JOIN co_customer_profiles buyer ON buyer.id=sales.customer_id
  LEFT JOIN co_sales_contracts contract ON contract.id=sales.contract_id
  LEFT JOIN co_outbounds ob ON ob.order_id=l.id
  LEFT JOIN co_metal_outbound metal ON metal.outbound_id=ob.id
  LEFT JOIN co_packing_documents packing ON packing.order_id=l.id
  WHERE p.id=$1`,[preparation.id]);
 const doc=(kind,id,code,at,state,href)=>id&&code?{kind,code,at,state,href}:null;
 const documents=[
  doc('preparation-plan',row.preparation_plan_id,row.batch_no,row.plan_created,row.preparation_plan_state,'/preparation/work-plans/'+row.preparation_plan_id),
  doc('receipt',preparation.id,preparation.document_no,preparation.created_at,preparation.status,'/receipts/'+preparation.id),
  doc('sales-plan',row.sales_id,row.sales_no,row.sales_created,row.sales_status,'/sales-plans/'+row.sales_id),
  doc('loading-plan',row.loading_plan_id,row.loading_plan_no,row.planned_load_date,row.loading_plan_status,'/loading-plans/orders/'+row.loading_plan_id),
  doc('loading',row.loading_id,row.loading_no,row.posted_at||row.loading_created,row.loading_state,'/outbounds/'+row.loading_id),
  doc('packing',row.loading_id,row.packing_no,row.packing_updated,'ARCHIVED','/outbounds/'+row.loading_id+'/packing-list')
 ].filter(Boolean);
 const {rows:events}=await c.query(`
  SELECT log.action,log.at,u.display_name actor,log.document FROM (
   SELECT action,occurred_at at,actor_id,$2::text document FROM co_events WHERE preparation_id=$1
   UNION ALL SELECT action,occurred_at,actor_id,$2 FROM co_work_events WHERE preparation_id=$1
   UNION ALL SELECT coalesce(reason,'LOCATION_CHANGE'),occurred_at,actor_id,$2 FROM co_location_events WHERE preparation_id=$1
   UNION ALL SELECT coalesce(after_data->>'state',entity_type),occurred_at,actor_id,$4 FROM co_execution_events
      WHERE order_id=$3 AND after_data->>'state' IS DISTINCT FROM before_data->>'state'
  ) log LEFT JOIN users u ON u.id=log.actor_id ORDER BY log.at DESC,log.action LIMIT 500`,
  [preparation.id,preparation.document_no,row.loading_id,row.loading_no]);
 return {customer:row.customer,contract_no:row.contract_no,outbound_estimated_mt:row.outbound_estimated_mt,
  confirmed_metal_mt:row.confirmed_metal_mt,documents,events};
}
module.exports={details};
