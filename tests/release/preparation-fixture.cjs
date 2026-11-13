'use strict';
const C='CO_HYDROXIDE';
const prefix=product=>product===C?'/cobalt':'';
const localMonth=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7);
async function salesPlan(api,f,product){
 const co=product===C,customer=f.customers[product],month=localMonth();
 const plan=await api('sales_operator',product,co?'/cobalt/sales/plans':'/plans',{
  project_id:f.project,customer_id:customer.id,contract_id:customer.contract,target_weight:'30',remark:'Synthetic preparation plan validation',
  ...(co?{shipment_month:month,planned_vehicle_count:1,status:'OPEN'}:{preparation_month:month,quantity_tolerance:'5'})
 });
 const url=prefix(product)+'/sales-workflow/plans/'+plan.id;
 for(const role of ['sales_manager','commerce_manager']){
  const state=await api(role,product,url);
  await api(role,product,url+'/review',{version:state.approval_version,decision:'APPROVED'});
 }
 return plan.id;
}
async function draft(api,product,plan,batch){
 return api('export_supervisor',product,prefix(product)+'/preparation-plans',{
  sales_plan_id:plan,batch_no:batch,shipment_month:localMonth()
 });
}
async function approved(api,product,plan,batch){
 const doc=await draft(api,product,plan,batch),url=prefix(product)+'/preparation-plans/'+doc.id;
 const pending=await api('export_supervisor',product,url+'/submit',{version:doc.version});
 return api('logistics_manager',product,url+'/approve',{version:pending.version});
}
function batch(product,suffix){
 return 'RMM-'+(product===C?'CO':'CU')+'-'+localMonth().slice(0,4)+'-'+String(suffix).padStart(product===C?3:2,'0');
}
module.exports={salesPlan,draft,approved,batch};
