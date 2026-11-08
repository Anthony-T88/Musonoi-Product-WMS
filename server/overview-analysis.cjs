'use strict';
// Presentation of existing scoped projections; no write paths or alternative ledgers.
const T=require('../dist/tonnes.js'),{kgToMt}=require('./stock-balance.cjs');
async function copper(c,req,q,data){
 const execution=req.user.permissions.includes('plan:read')?(await require('./management.cjs').report(c,req,{...q,type:'fulfilment'})).rows:null;
 return {execution,current_customers:data.customers.filter(row=>row.bundles>0).map(row=>({id:row.customer_id,name:row.customer_name,quantity:row.bundles,known_net_mt:row.known_net_weight,unknown:row.unknown_weights})),states:['available','locked','assigned','loaded'].map(key=>({key,quantity:data.metrics[key].bundles}))};
}
async function cobalt(c,req,data){
 const inventory=data.inventory,ids=inventory.map(row=>row.preparation_id),links=ids.length?(await c.query("SELECT l.preparation_id,p.customer_id,c.name FROM co_loading_orders l JOIN co_sales_plans p ON p.id=l.sales_plan_id JOIN co_customer_profiles c ON c.id=p.customer_id WHERE l.preparation_id=ANY($1::uuid[]) AND l.status IN('WAITING','OUTBOUND')",[ids])).rows:[],byPreparation=new Map(links.map(row=>[row.preparation_id,row])),groups=new Map(),states=new Map(['preparing','review','prepared','assigned','loaded'].map(key=>[key,0]));
 for(const row of inventory){const customer=byPreparation.get(row.preparation_id),key=customer?.customer_id||'unassigned';if(!groups.has(key))groups.set(key,{id:customer?.customer_id||null,name:customer?.name||null,quantity:0,total:0n,unknown:0});const group=groups.get(key);group.quantity+=Number(row.bags);group.total+=T.scaled(kgToMt(row.actual_net_kg||'0'),9);group.unknown+=Number(row.unconfirmed_bags);const state=['LOADED','DEPARTED','OUTBOUND_PENDING','LOGISTICS_APPROVED','OUTBOUND_CORRECTION'].includes(row.status)?'loaded':['MATCHED','LOADING','REVIEW_PENDING'].includes(row.status)?'assigned':row.work_status==='PENDING_COMPLETION_REVIEW'?'review':row.work_status==='COMPLETED'?'prepared':'preparing';states.set(state,states.get(state)+Number(row.bags));}
 return {execution:req.user.permissions.includes('plan:read')?data.execution:null,current_customers:[...groups.values()].map(({total,...row})=>({...row,known_net_mt:T.fixed(total,9)})),states:[...states].map(([key,quantity])=>({key,quantity}))};
}
module.exports={copper,cobalt};
