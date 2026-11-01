'use strict';
module.exports=async function(c,bundle){
 const events=(await c.query(`SELECT 'EVENT' source,e.id::text source_id,e.occurred_at at,u.display_name actor_name,e.event_type action,
 coalesce(e.after_data->>'code',m.code,l.code,a.lot_no,CASE WHEN e.event_type='INBOUND' THEN r.code END) document_no,
 CASE WHEN e.after_data->>'move_id' IS NOT NULL THEN NULL WHEN l.id IS NOT NULL THEN '/outbounds/loads/'||l.id WHEN a.id IS NOT NULL THEN '/preparation/'||a.id WHEN r.id IS NOT NULL AND e.event_type='INBOUND' THEN '/receipts/'||r.id END href,
 prior.state->>'business_status' before_status,current.state->>'business_status' after_status,
 coalesce(fromloc.code,e.before_data->>'location') from_location,coalesce(toloc.code,e.after_data->>'location') to_location,e.after_data->>'reason' note
 FROM inventory_events e LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN stock_moves m ON m.id::text=e.after_data->>'move_id'
 LEFT JOIN loading_orders l ON l.id::text=coalesce(e.after_data->>'loading_id',e.after_data->>'outbound_id')
 LEFT JOIN allocations a ON a.id::text=e.after_data->>'allocation_id' LEFT JOIN receipts r ON r.id=$2
 LEFT JOIN locations fromloc ON fromloc.id::text=e.before_data->>'location_id' LEFT JOIN locations toloc ON toloc.id::text=e.after_data->>'location_id'
 LEFT JOIN LATERAL(SELECT h.state FROM inventory_history h WHERE h.bundle_id=e.bundle_id AND h.revision_id<e.revision_id ORDER BY h.revision_id DESC LIMIT 1)prior ON true
 LEFT JOIN inventory_history current ON current.bundle_id=e.bundle_id AND current.revision_id=e.revision_id
 WHERE e.bundle_id=$1 ORDER BY e.occurred_at,e.id`,[bundle.uuid,bundle.receipt_id||null])).rows;
 const work=(await c.query(`SELECT 'LOT_WORK' source,h.id::text source_id,h.occurred_at at,u.display_name actor_name,h.action,a.lot_no document_no,'/preparation/'||a.id href,
 coalesce(h.before_data->>'workflow_state',h.before_data->>'sample_stage',h.before_data->>'physical_status') before_status,
 coalesce(h.after_data->>'workflow_state',h.after_data->>'sample_stage',h.after_data->>'physical_status') after_status,h.note
 FROM lot_work_history h JOIN allocations a ON a.id=h.allocation_id LEFT JOIN users u ON u.id=h.actor_id WHERE h.bundle_id=$1 ORDER BY h.occurred_at,h.id`,[bundle.uuid])).rows;
 const reviews=(await c.query(`SELECT 'WORKFLOW' source,s.id::text source_id,s.occurred_at at,u.display_name actor_name,s.action,coalesce(lp.packing_list_no,l.code,a.lot_no) document_no,
 CASE WHEN l.id IS NOT NULL THEN '/outbounds/loads/'||l.id ELSE '/preparation/'||a.id END href,s.action after_status,s.note
 FROM workflow_reviews s LEFT JOIN users u ON u.id=s.actor_id LEFT JOIN loading_orders l ON l.id=s.loading_id LEFT JOIN allocations a ON a.id=s.allocation_id
 LEFT JOIN loading_plan_matches pm ON pm.loading_id=l.id LEFT JOIN loading_plan_documents lp ON lp.id=pm.document_id
 WHERE EXISTS(SELECT 1 FROM loading_items i WHERE i.loading_id=l.id AND i.bundle_id=$1 AND(NOT i.plan_removed OR s.occurred_at<=i.removed_at))
 OR EXISTS(SELECT 1 FROM allocation_items i WHERE i.allocation_id=a.id AND i.bundle_id=$1) ORDER BY s.occurred_at,s.id`,[bundle.uuid])).rows;
 const matches=(await c.query(`SELECT 'MATCHING' source,h.id::text source_id,h.occurred_at at,u.display_name actor_name,h.action,d.packing_list_no document_no,'/outbounds/loads/'||h.loading_id href,h.action after_status,h.note
 FROM loading_plan_match_history h JOIN loading_plan_documents d ON d.id=h.document_id LEFT JOIN users u ON u.id=h.actor_id
 WHERE EXISTS(SELECT 1 FROM loading_items i WHERE i.loading_id=h.loading_id AND i.bundle_id=$1 AND(NOT i.plan_removed OR h.occurred_at<=i.removed_at)) ORDER BY h.occurred_at,h.id`,[bundle.uuid])).rows;
 return [...events,...work,...reviews,...matches].sort((a,b)=>new Date(a.at)-new Date(b.at)||a.source.localeCompare(b.source)||Number(a.source_id)-Number(b.source_id));
};
