'use strict';
// Legacy business relations belong exclusively to CU_CATHODE.
// V3.8 opens only exact method/path cobalt preparation endpoints; other cobalt business stays closed.
const products=Object.freeze([
 Object.freeze({code:'CU_CATHODE',name:'阴极铜',name_en:'Copper Cathodes',businessEnabled:true}),
 Object.freeze({code:'CO_HYDROXIDE',name:'氢氧化钴',name_en:'Cobalt Hydroxide',businessEnabled:false})
]);
const valid=code=>products.some(p=>p.code===code);
const globalPath=p=>/^\/api\/v1\/(?:config|health|page-layout|me|me\/language|auth\/(?:login|logout|csrf|registration-token|registration-requests)|product-context)$/.test(p)||/^\/api\/v1\/(?:users|security\/(?:roles|policy))(?:\/|$)/.test(p)||/^\/api\/v1\/(?:audit|v27\/(?:audit|backups))(?:\/|$)/.test(p);
const failure=(statusCode,message)=>Object.assign(Error(message),{statusCode});
function install({app,auth,csrf,secure,cobaltEnabled=false,cobaltWorkEnabled=false,cobaltStockEnabled=false,cobaltSalesEnabled=false,cobaltLoadingEnabled=false,cobaltExecutionEnabled=false,cobaltPackingEnabled=false,cobaltMetalEnabled=false}){
 app.addHook('preHandler',async req=>{
  const path=req.url.split('?')[0];if(!path.startsWith('/api/v1/'))return;
  const cookie=req.cookies.musonoi_product,header=req.headers['x-product-code'];
  if(cookie&&!valid(cookie)||header&&!valid(header))throw failure(400,'产品类型无效');
  req.productCode=header||cookie||'CU_CATHODE';
  if(path!=='/api/v1/product-context'&&header&&cookie&&header!==cookie)throw failure(409,'产品已在其他页面切换，请刷新页面');
  if(require('./gate-printers.cjs').allowed(path,req.method))return;
  if(globalPath(path)||(path==='/api/v1/historical-movements'&&req.method==='GET')||
   /^\/api\/v1\/historical-movements\/(?:destinations|batch\/(?:preview|confirm)|[0-9a-f-]{36}(?:\/(?:source|void))?)$/.test(path)||
   path==='/api/v1/operations/status'&&req.method==='GET'&&req.query?.path==='/me/language')return;
  // Never let query parameters relabel a copper response as cobalt.
  if(req.query?.product_code&&req.query.product_code!==req.productCode)throw failure(400,'产品上下文不一致');
  const coRoute=require('./historical-backfill.cjs').allowed(path,req.method)||require('./historical-movements.cjs').allowed(path,req.method)||require('./document-drafts.cjs').allowed(path,req.method)||require('./preparation-plans.cjs').allowed(path,req.method)||require('./export-licenses.cjs').allowed(path,req.method)||(cobaltSalesEnabled&&require('./sales-invoices.cjs').allowed(path,req.method))||(cobaltMetalEnabled&&require('./cobalt-metal.cjs').allowed(path,req.method))||(cobaltPackingEnabled&&require('./stock-balance.cjs').allowed(path,req.method))||(cobaltSalesEnabled&&require('./cobalt461.cjs').allowed(path,req.method))||(cobaltStockEnabled&&require('./cobalt-stocktaking.cjs').allowed(path,req.method))||(path.startsWith('/api/v1/cobalt/')&&require('./outbound-workspace.cjs').allowed(path,req.method))||(path.startsWith('/api/v1/cobalt/')&&require('./sales-approval.cjs').allowed(path,req.method))||(cobaltPackingEnabled&&path.startsWith('/api/v1/cobalt/')&&require('./gate-permits.cjs').allowed(path,req.method))||(cobaltPackingEnabled&&require('./cobalt-overview.cjs').allowed(path,req.method))||(cobaltPackingEnabled&&require('./cobalt-reports.cjs').allowed(path,req.method))||require('./cobalt.cjs').allowed(path,req.method)||(cobaltWorkEnabled&&require('./cobalt-work.cjs').allowed(path,req.method))||(cobaltStockEnabled&&require('./cobalt-stock.cjs').allowed(path,req.method))||(cobaltSalesEnabled&&require('./cobalt-sales.cjs').allowed(path,req.method))||(cobaltLoadingEnabled&&require('./cobalt-loading.cjs').allowed(path,req.method))||(cobaltExecutionEnabled&&require('./cobalt-execution.cjs').allowed(path,req.method))||(cobaltPackingEnabled&&require('./cobalt-packing.cjs').allowed(path,req.method));if(coRoute&&cobaltEnabled){if(req.productCode!=='CO_HYDROXIDE')throw failure(409,'CO_PRODUCT_REQUIRED');return;}
  // Implicit HEAD and any unlisted cobalt method must never fall through as copper.
  if(path==='/api/v1/cobalt'||path.startsWith('/api/v1/cobalt/')){await auth(req);throw failure(409,'CO_ROUTE_NOT_AVAILABLE');}
  if(req.productCode!=='CU_CATHODE'){await auth(req);throw failure(409,'氢氧化钴功能建设中');}
 });
 app.get('/api/v1/product-context',{preHandler:auth},req=>({productCode:req.cookies.musonoi_product||'CU_CATHODE',products:products.map(p=>p.code==='CO_HYDROXIDE'?{...p,businessEnabled:cobaltEnabled,implementedModules:cobaltEnabled?['preparation','preparation-receipt',...(cobaltWorkEnabled?['preparation-work','completion-review']:[]),...(cobaltStockEnabled?['stock-query','stock-locations','stock-map']:[]),...(cobaltSalesEnabled?['sales-plans','dispatch','vehicle-arrival']:[]),...(cobaltLoadingEnabled?['loading-plans','whole-batch-matching','bag-reservations']:[]),...(cobaltExecutionEnabled?['actual-loading','vehicle-departure','formal-outbound']:[]),...(cobaltPackingEnabled?['packing-list-preview','packing-list-archive','packing-list-history','statistics-reports']:[]),...(cobaltMetalEnabled?['metal-management']:[])]:[]}:p),legacyDatasetProduct:'CU_CATHODE',isolation:cobaltEnabled?'independent-cobalt-model; exact-v38-whitelist':'legacy-copper-only; cobalt-business-disabled'}));
 app.post('/api/v1/product-context',{preHandler:[auth,csrf]},async(req,reply)=>{
  const code=req.body?.productCode;if(!valid(code)||Object.keys(req.body||{}).some(k=>k!=='productCode'))throw failure(400,'产品类型无效');
  reply.setCookie('musonoi_product',code,{path:'/',httpOnly:true,sameSite:'strict',secure,maxAge:31536000});return {productCode:code};
 });
}
module.exports={products,valid,globalPath,install};
