'use strict';

const CU='CU_CATHODE',CO='CO_HYDROXIDE',BOTH=[CU,CO],missingId='00000000-0000-0000-0000-000000000001';

// Resolve document examples from the same isolated database used by the release tests.
// Missing business states stay in the inventory, with an explicit coverage reason.
async function examples(client,fixture){
 const find=async sql=>(await client.query(sql)).rows[0]?.value??null;
 const specs={
  cuCustomer:'SELECT id value FROM copper_customers ORDER BY code LIMIT 1',
  cuContract:'SELECT id value FROM customer_contracts ORDER BY contract_no LIMIT 1',
  cuPlan:"SELECT id value FROM sales_plans ORDER BY (status='OPEN') DESC,code DESC LIMIT 1",
  cuArrival:'SELECT dispatch_vehicle_id value FROM vehicle_arrivals ORDER BY registered_at DESC LIMIT 1',
  cuArrivalPending:'SELECT v.id value FROM sales_dispatch_vehicles v LEFT JOIN vehicle_arrivals a ON a.dispatch_vehicle_id=v.id WHERE a.id IS NULL AND v.cancelled_at IS NULL LIMIT 1',
  cuPlanDoc:'SELECT id value FROM loading_plan_documents ORDER BY created_at DESC LIMIT 1',
  cuPlanGroup:"SELECT id value FROM loading_plan_groups WHERE name NOT LIKE 'Synthetic UIUX %' ORDER BY created_at DESC LIMIT 1",
  cuLoad:"SELECT id value FROM loading_orders WHERE code NOT LIKE 'UIUX-LEGACY-%' ORDER BY created_at DESC LIMIT 1",
  cuLoadPending:"SELECT id value FROM loading_orders WHERE code NOT LIKE 'UIUX-LEGACY-%' AND status NOT IN('OUTBOUND','CANCELLED') ORDER BY created_at DESC LIMIT 1",
  cuReceipt:'SELECT id value FROM receipts ORDER BY created_at DESC LIMIT 1',
  cuReceiptDraft:"SELECT id value FROM receipts WHERE status='DRAFT' ORDER BY created_at DESC LIMIT 1",
  cuLot:'SELECT id value FROM allocations ORDER BY created_at DESC LIMIT 1',
  cuSample:'SELECT allocation_id value FROM allocation_items WHERE sample_required IS TRUE LIMIT 1',
  cuWeigh:'SELECT id value FROM weighings ORDER BY created_at DESC LIMIT 1',
  cuOutbound:'SELECT id value FROM outbound_orders ORDER BY created_at DESC LIMIT 1',
  cuBundle:'SELECT bundle_no value FROM bundles ORDER BY created_at DESC LIMIT 1',
  cuCount:'SELECT id value FROM stocktakes ORDER BY created_at DESC LIMIT 1',
  cuCorrection:'SELECT id value FROM outbound_corrections ORDER BY requested_at DESC LIMIT 1',
  cuAdjustment:'SELECT id value FROM stock_adjustments ORDER BY created_at DESC LIMIT 1',
  cuMasterBatch:'SELECT id value FROM batches LIMIT 1',
  cuMasterYard:'SELECT id value FROM yards LIMIT 1',
  cuMasterLocation:'SELECT id value FROM locations LIMIT 1',
  coPlan:"SELECT id value FROM co_sales_plans ORDER BY (status='OPEN') DESC,created_at DESC LIMIT 1",
  coArrival:'SELECT v.id value FROM co_dispatch_vehicles v LEFT JOIN co_vehicle_arrivals a ON a.dispatch_vehicle_id=v.id WHERE a.id IS NULL AND v.cancelled_at IS NULL LIMIT 1',
  coArrivalDoc:'SELECT id value FROM co_vehicle_arrivals ORDER BY registered_at DESC LIMIT 1',
  coPlanDoc:'SELECT id value FROM co_loading_plans ORDER BY created_at DESC LIMIT 1',
  coDraftPlan:"SELECT id value FROM co_loading_plans WHERE status='DRAFT' ORDER BY created_at DESC LIMIT 1",
  coLoad:'SELECT id value FROM co_loading_orders ORDER BY created_at DESC LIMIT 1',
  coDraft:'SELECT id value FROM co_preparations WHERE status=\'DRAFT\' ORDER BY created_at DESC LIMIT 1',
  coCount:'SELECT id value FROM co_stocktakes ORDER BY created_at DESC LIMIT 1',
  permit:'SELECT id value FROM gate_permits ORDER BY created_at DESC LIMIT 1'
 };
 const ids={coPrep:fixture.preparation,coPrepEditable:fixture.estimatedPreparation,warehouse:fixture.warehouse,project:fixture.project};
 for(const [key,sql] of Object.entries(specs)){
  try{ids[key]=await find(sql);}
  catch(e){if(!['42P01','42703'].includes(e.code))throw e;ids[key]=null;}
 }
 if(ids.cuPlanGroup){
  const {docSQL}=require('../../server/loading-plans.cjs');
  const {rows}=await client.query(docSQL+' WHERE d.group_id=$1',[ids.cuPlanGroup]);
  if(rows.length===1){ids.cuGroupChild=rows[0].id;ids.cuGroupLocked=['OUTBOUND','CANCELLED'].includes(rows[0].status);}
 }
 if(ids.cuCorrection)ids.cuCorrectionLoad=(await client.query('SELECT loading_id FROM outbound_corrections WHERE id=$1',[ids.cuCorrection])).rows[0].loading_id;
 const admin=fixture.accounts.find(a=>a.role==='admin').id;
 ids.coMapDefault=(await client.query(`SELECT w.id,w.project_id FROM warehouses w WHERE EXISTS(SELECT 1 FROM user_scopes s
  WHERE s.user_id=$1 AND s.project_id=w.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=w.id) AND s.customer_id IS NULL)
  ORDER BY w.name LIMIT 1`,[admin])).rows[0];
 return ids;
}

function pages(ids){
 const cases=[];
 const add=(key,template,products=BOTH,{example,screenshot=false,roles=[],query='',state='standard'}={})=>{
  const value=example?ids[example]:null;
  cases.push({key,template,products,roles,state,screenshot,fixture:example||null,available:!example||!!value,
   url:template.replace(':id',encodeURIComponent(value||missingId))+query});
 };
 const keyRoles=['sales_operator','logistics_manager','logistics_field_operator','site_supervisor','production_manager','production_operator','customer_admin'];
 add('login','/',[],{screenshot:true});
 add('register-dialog','/',[],{state:'registration dialog'});
 add('overview','/overview',BOTH,{screenshot:true,roles:keyRoles});
 add('todo','/overview',BOTH,{query:'?management=todos',roles:['sales_operator','logistics_manager']});
 add('overview-detail','/overview/details',BOTH,{query:'?metric=physical'});
 add('warnings','/overview/warning-settings',[CU]);
 add('inventory','/inventory',BOTH,{screenshot:true,roles:['production_operator','customer_admin']});
 add('cu-bag','/inventory/:id',[CU],{example:'cuBundle'});
 add('cu-bag-history','/inventory/:id/history',[CU],{example:'cuBundle'});
 add('co-stock-detail','/inventory/:id',[CO],{example:'coPrep',screenshot:true});
 add('co-stock-history-alias','/inventory/:id/history',[CO],{example:'coPrep'});
 add('map','/stock-map',BOTH,{screenshot:true});
 add('map-move','/stock-map/relocate',[CU]);
 add('customers','/customers',BOTH,{screenshot:true,roles:['sales_operator','customer_admin']});
 add('co-customer-edit','/customers',[CO],{query:'?editor=customer'});
 add('co-contract-edit','/customers',[CO],{query:'?editor=contract'});
 add('master','/customers/master-data',[CU]);
 for(const [name,example] of [['customers','cuCustomer'],['batches','cuMasterBatch'],['warehouses','warehouse'],['yards','cuMasterYard'],['locations','cuMasterLocation']]){
  add('master-'+name+'-new','/customers/master-data/'+name+'/new',[CU]);
  add('master-'+name+'-edit','/customers/master-data/'+name+'/:id',[CU],{example});
 }
 add('cu-contract-new','/customers/contracts/new',[CU]);
 add('cu-contract-detail','/customers/contracts/:id',[CU],{example:'cuContract'});
 add('cu-contract-edit','/customers/contracts/:id/edit',[CU],{example:'cuContract'});
 add('sales','/sales-plans',BOTH,{screenshot:true,roles:['sales_operator','sales_manager','commerce_manager','customer_admin']});
 add('sales-new','/sales-plans/new',BOTH,{roles:['sales_operator']});
 for(const [product,prefix] of [[CU,'cu'],[CO,'co']]){
  add(prefix+'-sales-detail','/sales-plans/:id',[product],{example:prefix+'Plan',screenshot:true,state:'approved'});
  add(prefix+'-sales-edit','/sales-plans/:id/edit',[product],{example:prefix+'Plan'});
  add(prefix+'-dispatch','/sales-plans/:id/dispatch',[product],{example:prefix+'Plan',screenshot:true,roles:['logistics_manager']});
 }
 add('cu-sales-shipping','/sales-plans/:id/shipping',[CU],{example:'cuPlan'});
 add('legacy-sales-new','/preparation/plans/new',[CU]);
 add('legacy-sales-edit','/preparation/plans/:id/edit',[CU],{example:'cuPlan'});
 add('legacy-sales-shipping','/preparation/plans/:id/shipping',[CU],{example:'cuPlan'});
 add('receipts','/receipts',BOTH,{screenshot:true,roles:['logistics_field_operator','site_supervisor','production_manager']});
 add('receipt-new','/receipts/new',BOTH,{screenshot:true,roles:['logistics_field_operator']});
 add('cu-receipt','/receipts/:id',[CU],{example:'cuReceipt'});
 add('cu-receipt-edit','/receipts/:id/edit',[CU],{example:'cuReceiptDraft',state:'draft'});
 add('cu-receipt-import','/receipts/import',[CU]);
 add('co-prep','/receipts/:id',[CO],{example:'coPrep',screenshot:true,state:'completed'});
 add('co-prep-work','/receipts/:id',[CO],{example:'coPrepEditable',screenshot:true,state:'editable',roles:['logistics_field_operator','site_supervisor']});
 add('co-prep-draft','/receipts/:id',[CO],{example:'coDraft',state:'draft'});
 add('co-prep-alias','/receipts/:id/work',[CO],{example:'coPrepEditable'});
 add('preparation','/preparation',BOTH,{screenshot:true,roles:['logistics_field_operator','site_supervisor']});
 add('preparation-new','/preparation/new',BOTH);
 add('cu-lot','/preparation/:id',[CU],{example:'cuLot',screenshot:true});
 add('co-preparation-alias','/preparation/:id',[CO],{example:'coPrep'});
 add('co-work-alias','/preparation/:id/work',[CO],{example:'coPrepEditable'});
 add('cu-sampling','/preparation/history-sampling',[CU]);
 add('cu-sampling-detail','/preparation/history-sampling/:id',[CU],{example:'cuLot'});
 add('cu-weighings','/outbounds/weighings',[CU]);
 add('cu-weigh-new','/outbounds/weighings/new',[CU]);
 add('cu-weigh','/outbounds/weighings/:id',[CU],{example:'cuWeigh'});
 add('arrivals','/loading-plans',BOTH,{screenshot:true,roles:['logistics_field_operator','logistics_manager']});
 for(const [product,key,example] of [[CU,'cu-arrival','cuArrivalPending'],[CO,'co-arrival','coArrival']]){
  add(key,'/loading-plans',[product],{example,state:'waiting-arrival'});
  const entry=cases.at(-1);
  entry.url='/loading-plans?'+new URLSearchParams({vehicle_id:ids[example]||missingId});
 }
 add('loading-search','/loading-plans/query',BOTH,{screenshot:true});
 add('loading-new','/loading-plans/new',BOTH);
 add('cu-plan-group','/loading-plans/:id',[CU],{example:'cuPlanGroup'});
 add('cu-plan-group-edit','/loading-plans/:id/edit',[CU],{example:'cuPlanGroup'});
 add('cu-plan-group-cancel','/loading-plans/:id/cancel',[CU],{example:'cuPlanGroup'});
 add('cu-plan-order-new','/loading-plans/:id/orders/new',[CU],{example:'cuPlanGroup'});
 add('cu-loading-plan','/loading-plans/orders/:id',[CU],{example:'cuPlanDoc',screenshot:true});
 add('cu-loading-plan-edit','/loading-plans/orders/:id/edit',[CU],{example:'cuPlanDoc'});
 add('cu-loading-plan-cancel','/loading-plans/orders/:id/cancel',[CU],{example:'cuPlanDoc'});
 add('co-loading-plan','/loading-plans/orders/:id',[CO],{example:'coPlanDoc',screenshot:true});
 add('co-loading-edit','/loading-plans/:id/edit',[CO],{example:'coDraftPlan',state:'draft'});
 add('co-loading-execution','/loading-plans/execution/:id',[CO],{example:'coLoad'});
 add('outbounds','/outbounds',BOTH,{screenshot:true,roles:['logistics_manager','production_manager']});
 add('outbound-vehicles','/outbounds',BOTH,{query:'?view=departures',screenshot:true,roles:['sales_operator','sales_manager']});
 add('printers','/outbounds',BOTH,{query:'?view=printers'});
 add('templates','/outbounds/templates',BOTH);
 add('weight-settings','/outbounds/weight-settings',BOTH);
 add('cu-loads','/outbounds/loads',[CU]);
 add('cu-load-new','/outbounds/loads/new',[CU]);
 add('cu-load-detail','/outbounds/loads/:id',[CU],{example:'cuLoad',screenshot:true,state:'posted'});
 add('cu-load-matching','/outbounds/loads/:id/matching',[CU],{example:'cuLoadPending',state:'pending'});
 add('cu-outbound-detail','/outbounds/:id',[CU],{example:'cuOutbound'});
 add('co-outbound-detail','/outbounds/:id',[CO],{example:'coLoad',screenshot:true,state:'posted'});
 add('cu-corrections','/outbounds/corrections',[CU]);
 add('cu-correction-detail','/outbounds/corrections/:id',[CU],{example:'cuCorrection'});
 add('cu-packing-legacy','/outbounds/packing-list/:id',[CU],{example:'cuLoad'});
 add('co-packing','/outbounds/:id/packing-list',[CO],{example:'coLoad',screenshot:true});
 add('shipping','/export-shipments',BOTH,{screenshot:true});
 add('cu-invoice','/export-shipments/:id',[CU],{example:'cuLoad',screenshot:true});
 add('metal','/cobalt-metal',[CO],{screenshot:true,roles:['logistics_manager','production_manager']});
 add('metal-outbound','/cobalt-metal',[CO],{query:'?view=outbound',screenshot:true,state:'confirmed and pending'});
 add('metal-confirmations','/cobalt-metal',[CO],{query:'?view=outbound&status=PENDING_ARECOMS',screenshot:true});
 add('stocktakes','/stocktaking',BOTH,{screenshot:true,roles:['site_supervisor','production_manager']});
 add('stocktake-new','/stocktaking/new',BOTH);
 add('cu-stocktake','/stocktaking/:id',[CU],{example:'cuCount'});
 add('co-stocktake','/stocktaking/:id',[CO],{example:'coCount'});
 add('adjustment','/stocktaking/adjustments/:id',[CU],{example:'cuAdjustment'});
 for(const [key,query] of [['reports',''],['reports-outbound','?section=outbound&view=shipping'],['reports-inventory','?section=inventory'],['reports-monthly','?section=outbound&view=trend']]){
  add(key,'/reports',BOTH,{query,screenshot:key==='reports',roles:key==='reports'?['logistics_manager']:[]});
 }
 add('workbench','/workbench',BOTH);
 add('accounts','/workbench/accounts',BOTH,{screenshot:true});
 add('permissions','/workbench/permissions',BOTH,{screenshot:true,roles:['limited_role_manager','production_operator']});
 add('diagnostics','/workbench/diagnostics',BOTH);
 add('former-design-entry','/workbench/design',BOTH);
 add('audit','/audit',BOTH,{screenshot:true,roles:['production_operator']});
 return cases;
}

module.exports={CU,CO,BOTH,examples,pages,missingId};
