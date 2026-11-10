'use strict';

const R=require('./uiux-routes.cjs');
const inventory=require('./uiux-inventory.json');
const languages=['zh-CN','en'];
const desktop={width:1366,height:768},large={width:1440,height:900},wide={width:1920,height:1080},phone={width:390,height:844};
const fullSizes=[desktop,large,wide],allSizes=[...fullSizes,phone];
const narrowKeys=new Set(['overview','inventory','map','sales','receipts','loading-search','outbounds','metal','accounts','permissions','reports','export-licenses']);
const quickKeys=new Set(['overview','inventory','map','receipts','co-prep-work','cu-receipt-edit','arrivals','loading-search','cu-plan-group-edit','cu-plan-order-new','outbounds','metal','permissions','export-licenses']);
const quickRoles={overview:['sales_operator'], 'co-prep-work':['site_supervisor'], permissions:['production_operator']};
const deniedCases=new Set([
 'logistics_field_operator/CU_CATHODE/receipts','logistics_field_operator/CU_CATHODE/receipt-new',
 'site_supervisor/CU_CATHODE/receipts',...R.BOTH.flatMap(p=>[
  'production_manager/'+p+'/stocktakes','production_operator/'+p+'/permissions','production_operator/'+p+'/audit','production_operator/'+p+'/export-licenses'
 ])
]);
// Each exception is scoped to one role, product, state and scenario. Expired entries fail the gate.
const missingExceptions=[];
const retiredRoutes=new Set(['cu-sampling','cu-sampling-detail','cu-weighings','cu-weigh']);
const protectedEndpoint=(key,ids)=>({
 'cu-sampling':'/samples','cu-sampling-detail':'/samples/'+ids.cuSample,
 'cu-weighings':'/weighings','cu-weigh':'/weighings/'+ids.cuWeigh
})[key];

function matrix(mode,specs=R.pages({})){
 if(!['full','quick'].includes(mode))throw Error('Invalid scan mode: '+mode);
 const rows=[];
 for(const spec of specs){
  const guest=!spec.products.length;
  if(mode==='quick'&&!guest&&!quickKeys.has(spec.key))continue;
  for(const product of guest?[null]:spec.products){
   const roles=guest?['guest']:['admin',...(mode==='quick'?quickRoles[spec.key]||[]:spec.roles)];
   for(const role of roles)for(const language of languages){
    const apiDenial=retiredRoutes.has(spec.key);
    const denied=apiDenial||deniedCases.has([role,product,spec.key].join('/'));
    const screenshot=apiDenial||!denied&&(guest||role==='admin'&&spec.screenshot);
    const viewports=spec.key==='register-dialog'?[phone]:mode==='quick'
     ?(screenshot&&narrowKeys.has(spec.key)?[desktop,phone]:[desktop])
     :screenshot?(guest||narrowKeys.has(spec.key)?allSizes:fullSizes):[desktop];
    for(const size of viewports)rows.push({key:spec.key,product,role,language,state:spec.state,size,screenshot,denied,apiDenial});
   }
  }
 }
 return rows;
}

const rowId=r=>[r.key,r.product||'public',r.role,r.language,r.size.width,r.size.height].join('/');
const imageName=r=>[r.key,r.product||'public',r.language,r.role,r.size.width].join('_')+'.png';
const localUrl=s=>new URL(s,'http://127.0.0.1');
function comparable(url){
 const u=localUrl(url),params=new URLSearchParams(u.search);
 params.sort();
 return u.pathname+(params.size?'?'+params:'')+u.hash;
}
function expectedLanding(spec,product,ids){
 const url=localUrl(spec.url);
 const copper=product===R.CU,co=product===R.CO;
 const replacements={
  'master-customers-edit':'/customers',
  'legacy-sales-new':'/sales-plans/new',
  'legacy-sales-edit':'/sales-plans/'+ids.cuPlan+'/edit',
  'legacy-sales-shipping':'/sales-plans/'+ids.cuPlan+'/shipping',
  'co-stock-history-alias':'/inventory/'+ids.coPrep+'#co-position-history',
  'co-prep-alias':'/receipts/'+ids.coPrepEditable,
  'co-preparation-alias':'/receipts/'+ids.coPrep,
  'co-work-alias':'/receipts/'+ids.coPrepEditable,
  'co-loading-execution':'/outbounds/'+ids.coLoad,
  'cu-corrections':'/outbounds',
  'cu-correction-detail':'/outbounds/loads/'+ids.cuCorrectionLoad+'?correction='+ids.cuCorrection,
  shipping:'/outbounds?state=OUTBOUND',
  'cu-invoice':'/outbounds/packing-list/'+ids.cuLoad,
  'former-design-entry':'/workbench'
 };
 if(co)Object.assign(replacements,{'overview-detail':'/inventory',preparation:'/receipts','preparation-new':'/receipts/new'});
 if(copper&&spec.key==='inventory')replacements.inventory='/inventory?status=CURRENT';
 if(co&&spec.key==='map'&&ids.coMapDefault)replacements.map='/stock-map?'+new URLSearchParams({project_id:ids.coMapDefault.project_id,warehouse_id:ids.coMapDefault.id});
 if(copper&&['cu-plan-group-edit','cu-plan-order-new'].includes(spec.key)&&ids.cuGroupChild){
  replacements[spec.key]='/loading-plans/orders/'+ids.cuGroupChild+(ids.cuGroupLocked?'':'/edit');
 }
 return comparable(replacements[spec.key]||url.pathname+url.search+url.hash);
}
function selectors(key,product,landing){
 const co=product===R.CO;
 const main=co?'#business-title, #dashboard h1, #inventory h1':'#business-title, #dashboard h1, #inventory h1, #field h1';
 const checks={
  login:['#login-username','#login-password'],
  'register-dialog':['#registration-modal[open] input[name="username"]'],
  overview:['#overview-range, .oa-panel, .co-metal-section'],
  inventory:[co?'.co2-panel':'#inventory input, #page-content input'],
  map:[co?'#co-map-canvas':'#stock-map-canvas'],
  'loading-search':['.r9-document-filter input','.r9-document-filter select','.r9-document-filter button'],
  metal:['#co-metal-filter','.co-metal-table, #page-content table'],
  'metal-confirmations':['#co-metal-filter','#page-content table'],
  'export-licenses':['#export-license-filter','#export-license-table'],
  'legacy-export-licenses':['#export-license-filter'],
  'export-license-new':['#export-license-application'],
  'cu-export-license-edit':['#export-license-application'],
  'co-export-license-edit':['#export-license-application'],
  'cu-export-license':['#permit-allocations'],
  'co-export-license':['#permit-allocations'],
  'metal-outbound':['#co-metal-filter','#page-content table'],
  permissions:['#account-role-form','#role-save','.s46-matrix, #account-permissions'],
  'cu-receipt-edit':['#page-content form input, #page-content form select'],
  'master-yards-edit':['#page-content form input[name="code"]'],
  'cu-weigh':['#page-content dl, #page-content table'],
  'cu-outbound-detail':['#page-content a[href*="load_id="]'],
  'cu-correction-detail':['#page-content #ux11-load-corrections details'],
  adjustment:['#page-content dl, #page-content table'],
  'cu-plan-group-edit':[landing?.endsWith('/edit')?'#single-plan-form input[name="invoice_no"]':'.loading-plan-facts'],
  'cu-plan-order-new':[landing?.endsWith('/edit')?'#single-plan-form input[name="invoice_no"]':'.loading-plan-facts']
 };
 return [...(!['login','register-dialog'].includes(key)?[main]:[]),...(checks[key]||[])];
}

module.exports={matrix,inventory,expectedLanding,selectors,rowId,imageName,comparable,languages,desktop,phone,missingExceptions,protectedEndpoint};

