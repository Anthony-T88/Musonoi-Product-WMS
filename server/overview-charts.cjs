'use strict';
// Pure presentation aggregation of already authorized, canonical outbound rows.
// No queries, write paths, independent scope rules or fabricated observations.
const T=require('../dist/tonnes.js');
function trend(rows,window,{dateKey='date',weightKey='net_weight',kilograms=false,asOf=null,inbound=[]}={}){
 const from=window.from.slice(0,10),requestedTo=window.to.slice(0,10),observed=asOf?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf)):requestedTo,to=observed<requestedTo?observed:requestedTo,monthly=(Date.parse(to)-Date.parse(from))/86400000>92;
 const key=date=>String(date).slice(0,monthly?7:10),map=new Map();
 const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
 if(monthly)start.setUTCDate(1);
 for(const d=new Date(start);d<=end;monthly?d.setUTCMonth(d.getUTCMonth()+1):d.setUTCDate(d.getUTCDate()+1))map.set(key(d.toISOString()),{period:key(d.toISOString()),total:0n,vehicles:0,known:0,unknown_weights:0});
 for(const row of rows){const bucket=map.get(key(row[dateKey]));if(!bucket)continue;bucket.vehicles++;bucket.unknown_weights+=Number(row.unknown_weights||0);if(row[weightKey]==null){if(!row.unknown_weights)bucket.unknown_weights++;continue;}bucket.total+=T.scaled(String(row[weightKey]),9)/(kilograms?1000n:1n);bucket.known++;}
 const receipts=new Map([...map.keys()].map(k=>[k,{total:0n,known:0,prepared:0,bundles:0,units:0,unknown:0}]));
 for(const row of inbound){const b=receipts.get(key(row.date));if(!b)continue;b.units++;b.bundles+=Number(row.bundles||0);if(!row.prepared)continue;b.prepared++;if(row.net_weight==null){b.unknown++;continue;}b.known++;b.total+=T.scaled(String(row.net_weight),9);}
 return {granularity:monthly?'month':'day',unit:'MT',from,to:from>to?requestedTo:to,requested_to:requestedTo,observed_through:observed,future_window:from>to,time_zone:'Africa/Lubumbashi',basis:'FINAL_APPROVAL_CANONICAL_OUTBOUND',inbound_basis:'CONFIRMED_RECEIPT_DATE_CUTOFF_EVIDENCE',rows:[...map.values()].map(b=>{const r=receipts.get(b.period);return {period:b.period,net_weight:b.vehicles&&!b.known?null:T.fixed(b.total,9),vehicles:b.vehicles,unknown_weights:b.unknown_weights,inbound_net_weight:r.prepared&&!r.known?null:T.fixed(r.total,9),inbound_bundles:r.bundles,inbound_units:r.units,inbound_unknown_weights:r.unknown};})};
}
module.exports={trend};
