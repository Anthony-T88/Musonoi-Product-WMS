'use strict';
const C=require('./control-common.cjs'),{where}=require('./inventory.cjs');
async function preparation(c,req){const w=where(req.user.id),extra=[];for(const key of ['project_id','warehouse_id'])if(req.query[key]){w.values.push(C.uuid(req.query[key]));extra.push(`v.${key}=$${w.values.length}`);}const rows=(await c.query(`WITH assigned AS(SELECT DISTINCT ON(v.uuid) v.uuid,p.customer_id,cu.name customer_name,a.id allocation_id,a.lot_no,p.preparation_month,
 CASE WHEN v.final_weighed IS DISTINCT FROM false THEN v.weight END weight,
 EXISTS(SELECT 1 FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id WHERE li.bundle_id=v.uuid AND li.active AND lo.status<>'CANCELLED' AND lo.status='LOADED' AND(lo.workflow_state IN('READY','DEPARTED_PENDING','DEPARTED_CORRECTION') OR lo.workflow_state IS NULL)) loaded
 FROM inventory_view v JOIN bundles b ON b.id=v.uuid JOIN reservations r ON r.bundle_id=v.uuid AND r.released_at IS NULL JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id JOIN copper_customers cu ON cu.id=p.customer_id
 WHERE ${w.text} AND b.physical_status='IN_STOCK' AND a.workflow_state IS DISTINCT FROM 'CANCELLED' ${extra.length?'AND '+extra.join(' AND '):''})
 SELECT * FROM assigned ORDER BY customer_name`,w.values)).rows;return {items:require('./preparation-tree.cjs').aggregate(rows),unit:'MT',scope:'Current active assignment including loaded goods awaiting final outbound; excludes posted outbound and released bundles'};}
module.exports=async({app,pool,permitted})=>{app.get('/api/v1/preparation/summary',{preHandler:permitted('allocation:read')},req=>C.read(pool,c=>preparation(c,req)));app.get('/api/v1/stock-map/preparation',{preHandler:permitted('inventory:read')},req=>C.read(pool,c=>preparation(c,req)));};
module.exports.preparation=preparation;
