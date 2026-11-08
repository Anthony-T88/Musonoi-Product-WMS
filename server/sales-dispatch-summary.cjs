'use strict';
// Aggregates only already-authorized plans. Match each product's current
// dispatch list; never sum spreadsheet row_count or duplicate imports.
async function counts(c,product,ids){
 if(!ids.length)return new Map();
 const co=product==='CO_HYDROXIDE',sql=co?`
  SELECT sales_plan_id id,
   count(*) FILTER(WHERE cancelled_at IS NULL)::int active,
   count(*) FILTER(WHERE cancelled_at IS NULL AND import_id IS NOT NULL)::int imported,
   count(*) FILTER(WHERE cancelled_at IS NULL AND import_id IS NULL)::int manual,
   count(*) FILTER(WHERE cancelled_at IS NOT NULL)::int cancelled
  FROM co_dispatch_vehicles WHERE sales_plan_id=ANY($1::uuid[]) GROUP BY sales_plan_id`:`
  SELECT k.sales_plan_id id,
   count(*) FILTER(WHERE v.cancelled_at IS NULL)::int active,
   count(*) FILTER(WHERE v.cancelled_at IS NULL)::int imported,
   0::int manual,count(*) FILTER(WHERE v.cancelled_at IS NOT NULL)::int cancelled
  FROM sales_dispatch_vehicle_keys k JOIN sales_dispatch_vehicles v ON v.id=k.vehicle_id
  WHERE k.sales_plan_id=ANY($1::uuid[]) GROUP BY k.sales_plan_id`;
 const rows=(await c.query(sql,[ids])).rows;
 return new Map(ids.map(id=>{const r=rows.find(r=>r.id===id);return[id,{active:r?.active??0,imported:r?.imported??0,manual:r?.manual??0,cancelled:r?.cancelled??0,basis:'CURRENT_EFFECTIVE_VEHICLES_ALL_SHIPMENT_MONTHS'}];}));
}
module.exports={counts};
