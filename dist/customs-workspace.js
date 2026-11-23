'use strict';

window.CustomsWorkspace={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 can:p=>CurrentUser.permissions.includes(p),
 permission(){return ['customs:bp','load:read','packing-template:write'].find(p=>this.can(p));},
 base(){return (ProductContext.isCopper()?'':'/cobalt')+'/customs';},
 tab(path){
  if(path.startsWith('/customs/templates'))return 'templates';
  if(path.startsWith('/customs/packing-list'))return 'packing';
  return 'bp';
 },
 nav(tab){
  const t=this.t,options=[
   ['packing','/customs/packing-list','装箱单','Packing Lists','load:read'],
   ['bp','/customs/bp','BP表','BP Sheet','customs:bp'],
   ['templates','/customs/templates','装箱单模板','Packing List Template','packing-template:write']
  ];
  return '<nav class="business-toolbar" aria-label="'+t('清关单据导航','Customs Documents Navigation')+'" data-customs-nav data-no-i18n>'+
   options.filter(x=>this.can(x[4])).map(([key,url,zh,en])=>'<a class="button secondary" href="'+url+'"'+
    (tab===key?' aria-current="page"':'')+'>'+t(zh,en)+'</a>').join('')+'</nav>';
 },
 decorate(tab){
  const root=$('page-content');
  if(!root.querySelector('[data-customs-nav]'))root.insertAdjacentHTML('afterbegin',this.nav(tab));
 },
 async packing(){
  const t=this.t,q=new URLSearchParams(location.search),d=await API.request(this.base()+'/packing-list?'+q);
  const co=!ProductContext.isCopper();
  const labels=[['备货批次号','Preparation Lot'],['装车单号','Loading Order'],['装箱单号','Packing List No.'],['客户','Customer'],['车牌号','Truck Plate'],
   ['单证状态','Document Status'],['操作','Actions']];
  const rows=d.items.map(row=>{
   const id=co?row.order_id:row.id,revision=co?row.packing_revision:row.revision;
   return '<tr>'+[co?row.preparation_batch_no:row.lot_no,row.code,row.packing_list_no||row.document_no,row.customer_name,
    co?row.transport_snapshot?.truck_no:row.shipping_vehicle_no||row.vehicle_no,revision?t('已生成','Generated')+' · r'+revision:t('未生成','Not Generated')]
    .map(v=>'<td>'+esc(v||'—')+'</td>').join('')+'<td><a class="button secondary compact" href="/customs/packing-list/'+esc(id)+'">'+
    t('打开装箱单','Open Packing List')+'</a></td></tr>';
  });
  Router.page(t('清关单据管理','Customs Documents'),'<div class="wms-page" data-no-i18n data-page-composed>'+this.nav('packing')+
   this.filter(q,'/customs/packing-list',t('批次号 / 车牌 / 装箱单号','Lot / Truck / Packing List No.'))+
   ExportLicenses.table(labels,rows,'customs-packing-list',true,{actions:[6]})+CobaltStockUI.pager(d.page,d.total,d.page_size||50)+'</div>');
  this.bindFilter('/customs/packing-list',d);
 },
 filter(q,href,label){
  const t=this.t;
  return '<form id="customs-filter" class="filters wms-filter-row"><label>'+label+'<input type="search" name="search" maxlength="160" value="'+
   esc(q.get('search')||'')+'"></label><div class="wms-filter-actions"><button class="button primary">'+
   t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+href+'">'+t('重置','Reset')+'</a></div></form>';
 },
 bindFilter(href,d){
  $('customs-filter').onsubmit=e=>{e.preventDefault();Router.go(href+'?'+new URLSearchParams(new FormData(e.target)));};
  CobaltStockUI.bindPager(d);
 },
 route(path){
  if(path==='/outbounds/templates')return '/customs/templates';
  if(path==='/export-shipments'||path==='/outbounds'&&new URLSearchParams(location.search).get('view')==='shipments')return '/customs/packing-list';
  const old=/^\/outbounds\/(?:(?:packing-list\/([0-9a-f-]{36}))|(?:([0-9a-f-]{36})\/packing-list))$/i.exec(path);
  if(old)return '/customs/packing-list/'+(old[1]||old[2]);
  if(/^\/export-shipments\/[0-9a-f-]{36}$/i.test(path))return '/customs/packing-list/'+path.split('/').pop();
  if(path==='/customs')return this.can('customs:bp')?'/customs/bp':this.can('load:read')?'/customs/packing-list':'/customs/templates';
  return path.startsWith('/customs/')?path:null;
 },
 async render(path){
  const tab=this.tab(path),required={bp:'customs:bp',packing:'load:read',templates:'packing-template:write'}[tab],t=this.t;
  if(!this.can(required))throw Object.assign(Error(t('当前账号没有此页面权限','This account does not have permission for this page')),{statusCode:403});
  if(path==='/customs/bp')return CustomsBP.open();
  if(path==='/customs/templates'){
   await UnifiedOutbound.templates();
  }else if(path==='/customs/packing-list')return this.packing();
  else if(/^\/customs\/packing-list\/[0-9a-f-]{36}$/i.test(path)){
   if(ProductContext.isCopper())await Shipping.detail(path.split('/').pop());
   else await CobaltPackingUI.route();
  }else throw Object.assign(Error(t('找不到页面','Page not found')),{statusCode:404});
  this.decorate(tab);
 },
 install(){
  Router.add(/^\/customs(?:\/(?:bp|templates|packing-list(?:\/[0-9a-f-]{36})?))?$/,()=>this.render(location.pathname));
  RoutePermissions.register('customs',path=>/^\/customs(?:\/|$)/.test(path),path=>path==='/customs'?this.permission():({bp:'customs:bp',packing:'load:read',templates:'packing-template:write'})[this.tab(path)]);
  const previous=Router.performShow.bind(Router);
  Router.performShow=async(...args)=>{
   const path=this.route(location.pathname);
   if(!path)return previous(...args);
   if(path!==location.pathname){
    const q=new URLSearchParams(location.search);q.delete('view');
    history.replaceState(history.state,'',path+(q.size?'?'+q:'')+location.hash);
   }
   Router.current=path;Router.rendering=true;
   try{await this.render(path);I18n.apply();UnifiedNavigation.refresh();UnifiedNavigation.title();window.scrollTo({top:0});}
   catch(error){Router.page(this.t('清关单据管理','Customs Documents'),'<p class="wms-feedback error" role="alert">'+esc(error.message)+'</p>');}
   finally{Router.rendering=false;AdaptiveLayout.queue();}
  };
  const coPage=ProductContext.cobaltPage.bind(ProductContext);
  ProductContext.cobaltPage=path=>!ProductContext.isCopper()&&path.startsWith('/customs')||coPage(path);
  const language=CobaltUI.languageChanged.bind(CobaltUI);
  CobaltUI.languageChanged=()=>location.pathname.startsWith('/customs/')?this.language():language();
 },
 async language(){
  if(location.pathname==='/customs/bp'&&($('customs-bp-form')||$('customs-bp-proof')))return CustomsBP.translateEditor();
  if(/^\/customs\/packing-list\/[0-9a-f-]{36}$/i.test(location.pathname)&&!ProductContext.isCopper()){
   await CobaltPackingUI.language();this.decorate('packing');return;
  }
  await Router.show();
 }
};
