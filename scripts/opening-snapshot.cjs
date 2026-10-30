// Used only by the explicit empty TEST database seed. Existing production data is never seeded.
module.exports=async(c,agedTestLocks=false)=>{
 await c.query("INSERT INTO sales_plans(code,project_id,customer_id,target_weight,origin,remark) SELECT 'LEGACY-'||reserved_for_customer_id::text,project_id,reserved_for_customer_id,sum(net_weight),'LEGACY','Explicit V1 fixture opening snapshot; historical actor/time unknown' FROM bundles WHERE reserved_for_customer_id IS NOT NULL AND physical_status='IN_STOCK' GROUP BY project_id,reserved_for_customer_id");
 await c.query("INSERT INTO allocations(code,plan_id,status,origin,remark) SELECT 'LEGACY-'||id::text,id,'DRAFT','LEGACY','Explicit opening snapshot' FROM sales_plans WHERE origin='LEGACY'");
 await c.query("INSERT INTO allocation_items SELECT a.id,b.id FROM allocations a JOIN sales_plans p ON p.id=a.plan_id JOIN bundles b ON b.project_id=p.project_id AND b.reserved_for_customer_id=p.customer_id WHERE a.origin='LEGACY' AND b.physical_status='IN_STOCK'");
 await c.query("INSERT INTO reservations(allocation_id,bundle_id,weight,origin,locked_at) SELECT i.allocation_id,b.id,b.net_weight,'LEGACY',clock_timestamp()-($1::boolean::int*interval '2 days') FROM allocation_items i JOIN allocations a ON a.id=i.allocation_id JOIN bundles b ON b.id=i.bundle_id WHERE a.origin='LEGACY'",[agedTestLocks]);
 await c.query("UPDATE allocations SET status='LOCKED',version=version+1 WHERE origin='LEGACY'");
};
