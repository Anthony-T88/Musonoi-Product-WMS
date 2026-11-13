'use strict';
module.exports=async function documents(c,bundleId){
 const {rows}=await c.query(`
 SELECT * FROM (
  SELECT 'receipt' kind,r.code,coalesce(r.confirmed_at,r.created_at) at,r.status state,'/receipts/'||r.id href
   FROM bundles b JOIN receipts r ON r.id=b.receipt_id WHERE b.id=$1
  UNION ALL
  SELECT 'preparation',coalesce(a.lot_no,a.code),coalesce(a.reviewed_at,a.created_at),
   coalesce(a.workflow_state,a.status),'/preparation/'||a.id FROM allocations a
   JOIN allocation_items i ON i.allocation_id=a.id WHERE i.bundle_id=$1
  UNION ALL
  SELECT 'loading',l.code,coalesce(l.loaded_at,l.created_at),coalesce(l.workflow_state,l.status),
   '/outbounds/loads/'||l.id FROM loading_orders l JOIN loading_items i ON i.loading_id=l.id
   WHERE i.bundle_id=$1 AND NOT i.plan_removed
  UNION ALL
  SELECT 'outbound',l.code,l.manager_at,l.workflow_state,'/outbounds/loads/'||l.id
   FROM loading_orders l JOIN loading_items i ON i.loading_id=l.id
   WHERE i.bundle_id=$1 AND NOT i.plan_removed AND l.workflow_state='OUTBOUND'
  UNION ALL
  SELECT 'outbound',o.code,coalesce(o.confirmed_at,o.created_at),o.status,'/outbounds/'||o.id
   FROM outbound_orders o JOIN loading_items i ON i.loading_id=o.loading_id
   WHERE i.bundle_id=$1 AND NOT i.plan_removed
 ) linked ORDER BY at,kind,code`,[bundleId]);
 return rows;
};
