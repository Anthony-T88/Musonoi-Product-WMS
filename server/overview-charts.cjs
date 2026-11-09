'use strict';
// Flow charts aggregate authorized receipt and outbound rows.
// Stock points read the historical ledger at each period close.
const T=require('../dist/tonnes.js');
function trend(rows,window,{dateKey='date',weightKey='net_weight',kilograms=false,asOf=null,inbound=[]}={}){
 const from=window.from.slice(0,10),requestedTo=window.to.slice(0,10),observed=asOf?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf)):requestedTo,to=observed<requestedTo?observed:requestedTo,monthly=(Date.parse(to)-Date.parse(from))/86400000>92;
 const key=date=>String(date).slice(0,monthly?7:10),map=new Map();
 const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
 if(monthly)start.setUTCDate(1);
 for(const d=new Date(start);d<=end;monthly?d.setUTCMonth(d.getUTCMonth()+1):d.setUTCDate(d.getUTCDate()+1))map.set(key(d.toISOString()),{period:key(d.toISOString()),total:0n,vehicles:0,known:0,unknown_weights:0});
 for(const row of rows){const bucket=map.get(key(row[dateKey]));if(!bucket)continue;bucket.vehicles++;bucket.unknown_weights+=Number(row.unknown_weights||0);if(row[weightKey]==null){if(!row.unknown_weights)bucket.unknown_weights++;continue;}bucket.total+=T.scaled(String(row[weightKey]),9)/(kilograms?1000n:1n);bucket.known++;}
 const receipts=new Map([...map.keys()].map(k=>[k,{total:0n,known:0,prepared:0,bundles:0,units:0,unknown:0}]));
 for(const row of inbound){const b=receipts.get(key(row.date));if(!b)continue;b.units++;b.bundles+=Number(row.bundles||0);b.unknown+=Number(row.unknown_weights??(row.net_weight==null?1:0));if(!row.prepared)continue;b.prepared++;if(row.net_weight==null)continue;b.known++;b.total+=T.scaled(String(row.net_weight),9);}
 return {granularity:monthly?'month':'day',unit:'MT',from,to:from>to?requestedTo:to,requested_to:requestedTo,observed_through:observed,future_window:from>to,time_zone:'Africa/Lubumbashi',basis:'FINAL_APPROVAL_CANONICAL_OUTBOUND',inbound_basis:'CONFIRMED_RECEIPT_DATE_CUTOFF_EVIDENCE',rows:[...map.values()].map(b=>{const r=receipts.get(b.period);return {period:b.period,net_weight:b.vehicles&&!b.known?null:T.fixed(b.total,9),vehicles:b.vehicles,unknown_weights:b.unknown_weights,inbound_net_weight:r.units&&!r.known?null:T.fixed(r.total,9),inbound_bundles:r.bundles,inbound_units:r.units,inbound_unknown_weights:r.unknown};})};
}
function closingPoints(chart,cutoff){
 const limit=Math.min(+new Date(cutoff),+new Date(chart.to+'T00:00:00+02:00')+86400000);
 return chart.rows.map(({period})=>{
  let next;
  if(chart.granularity==='month'){
   const [year,month]=period.split('-').map(Number);
   next=Date.UTC(year,month,1)-7200000;
  }else next=+new Date(period+'T00:00:00+02:00')+86400000;
  return {period,cutoff:new Date(Math.min(next,limit)).toISOString()};
 });
}
async function stock(c,req,chart,f,cutoff,{co=false,epoch=null}={}){
 const points=closingPoints(chart,cutoff);
 const scopeSupported=!co||(!['customer_id','contract_id','sales_plan_id','status'].some(key=>f[key])&&(await c.query(
  `SELECT EXISTS(SELECT 1 FROM warehouses w JOIN user_scopes s ON s.project_id=w.project_id
   WHERE s.user_id=$1 AND s.customer_id IS NULL AND(s.warehouse_id IS NULL OR s.warehouse_id=w.id)
    AND ($2::uuid IS NULL OR w.project_id=$2) AND ($3::uuid IS NULL OR w.id=$3)) AS ok`,
  [req.user.id,f.project_id||null,f.warehouse_id||null])).rows[0].ok);
 if(co&&!epoch)epoch=(await c.query('SELECT activated_at FROM co_report_epoch WHERE singleton')).rows[0]?.activated_at;
 let records=[];
 if(points.length&&scopeSupported&&epoch){
  if(co){
   records=(await c.query(`WITH points AS(SELECT * FROM jsonb_to_recordset($1) AS p(period text,cutoff timestamptz)),
    scoped AS(SELECT m.occurred_at,m.bags_delta,m.unknown_bags_delta,m.known_net_delta_kg
     FROM co_report_movements m JOIN co_bags b ON b.id=m.bag_id
     WHERE ($4::uuid IS NULL OR m.project_id=$4) AND ($5::uuid IS NULL OR m.warehouse_id=$5)
      AND ($6::uuid IS NULL OR b.preparation_id=$6)
      AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$2 AND s.project_id=m.project_id
       AND(s.warehouse_id IS NULL OR s.warehouse_id=m.warehouse_id) AND s.customer_id IS NULL))
    SELECT p.period,coalesce(sum(m.bags_delta),0)::int units,coalesce(sum(m.unknown_bags_delta),0)::int unknown,
     (coalesce(sum(m.known_net_delta_kg),0)/1000)::text net
    FROM points p LEFT JOIN scoped m ON m.occurred_at<p.cutoff WHERE p.cutoff>$3 GROUP BY p.period`,
    [JSON.stringify(points),req.user.id,epoch,f.project_id||null,f.warehouse_id||null,f.preparation_id||null])).rows;
  }else{
   const scope={...f};delete scope.customer_id;
   records=(await c.query(`WITH points AS(SELECT * FROM jsonb_to_recordset($1) AS p(period text,cutoff timestamptz)),
    revisions AS(SELECT p.period,(SELECT max(id) FROM inventory_revisions WHERE posted_at<p.cutoff) revision
     FROM points p WHERE p.cutoff>$3),
    snapshots AS(SELECT r.revision,a.* FROM (SELECT DISTINCT revision FROM revisions WHERE revision IS NOT NULL) r
     CROSS JOIN LATERAL(SELECT count(*)::int units,count(*) FILTER(WHERE s.state->>'weight' IS NULL)::int unknown,
      coalesce(sum((s.state->>'weight')::numeric),0)::text net FROM v32_inventory_history(r.revision) s
      WHERE s.state->>'physical_status'='IN_STOCK' AND v24_visible($2,s.state,$4)
       AND ($5::text IS NULL OR coalesce(s.state->>'allocated_customer_id',s.state->>'dispatched_customer_id',s.state->>'customer_id')=$5)) a)
    SELECT r.period,s.units,s.unknown,s.net FROM revisions r JOIN snapshots s USING(revision)`,
    [JSON.stringify(points),req.user.id,epoch,scope,f.customer_id||null])).rows;
  }
 }
 const byPeriod=new Map(records.map(r=>[r.period,r]));
 return {...chart,stock_scope_supported:scopeSupported,stock_traceable_from:epoch,rows:chart.rows.map(row=>{
  const r=byPeriod.get(row.period);
  return {...row,stock_units:r?.units??null,stock_unknown_units:r?.unknown??null,stock_known_net_mt:r&&(!r.units||r.units>r.unknown)?r.net:null};
 })};
}
module.exports={trend,stock};
