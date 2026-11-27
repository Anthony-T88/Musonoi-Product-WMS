'use strict';

window.CustomsWorkspace={
 t:(zh,en)=>I18n.label(zh,en),
 can:p=>CurrentUser.permissions.includes(p),
 bpPermission(){return ['customs:bp','customs:bp-template'].find(p=>this.can(p));},
 permission(){return ['load:read',this.bpPermission(),'packing-template:write'].find(p=>p&&this.can(p));},
 pagePermission(path){return path==='/customs'?this.permission():{bp:this.bpPermission(),packing:'load:read',templates:'packing-template:write'}[this.tab(path)];},
 base(){return (ProductContext.isCopper()?'':'/cobalt')+'/customs';},
 tab(path){
  if(path.startsWith('/customs/templates'))return 'templates';
  if(path.startsWith('/customs/packing-list'))return 'packing';
  return 'bp';
 },
 nav(tab){
  const t=this.t,options=[
   ['packing',this.can('load:read')?'/customs/packing-list':'/customs/templates','商业发票与装箱单','Commercial Invoice & Packing List',this.can('load:read')||this.can('packing-template:write')],
   ['bp','/customs/bp','BP表','BP Sheet',!!this.bpPermission()]
  ];
  return '<nav class="business-toolbar" aria-label="'+t('清关单据导航','Customs Documents Navigation')+'" data-customs-nav data-no-i18n>'+
   options.filter(x=>x[4]).map(([key,url,zh,en])=>'<a class="button secondary" href="'+url+'"'+
    (key===(tab==='templates'?'packing':tab)?' aria-current="page"':'')+'>'+t(zh,en)+'</a>').join('')+'</nav>';
 },
 decorate(tab){
  const root=$('page-content');
  if(!root.querySelector('[data-customs-nav]'))root.insertAdjacentHTML('afterbegin',this.nav(tab));
 },
 async packing(){
  const t=this.t,path='/customs/packing-list',key=location.href,product=ProductContext.code,co=!ProductContext.isCopper();
  const q=new URLSearchParams(location.search),query=Management.applyPageSize(new URLSearchParams(q));
  const data=await API.request(this.base()+'/packing-list?'+query);
  if(key!==location.href||product!==ProductContext.code)return;
  const rows=data.items.map(row=>this.packingRow(row,co));
  const labels=[['批次号','Lot No.'],['车牌 / 客户','Truck / Customer'],['净重（吨）','Net Weight (MT)'],
   ['装箱单号','Packing List No.'],['单据状态','Document Status'],['装车日期','Loading Date']];
  const entries=rows.map(row=>{
   const select='<button type="button" class="packing-lot-link" data-packing-select="'+esc(row.id)+
    '" aria-pressed="false" aria-controls="customs-packing-preview" aria-label="'+esc(t('预览批次 ','Preview lot ')+(row.batch||row.code))+
    '">'+esc(row.batch||'—')+'</button>';
   const cells=[select,esc(row.truck||'—')+'<small>'+esc(row.customer||'—')+'</small>',
    esc(row.weight),esc(row.number||'—'),this.packingStatus(row.revision),esc(row.loadingDate||'—')];
   return '<tr data-packing-row="'+esc(row.id)+'">'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>';
  });
  const template=this.can('packing-template:write')?'<a class="button secondary compact" data-packing-template href="/customs/templates">'+
   t('装箱单模板','Packing List Template')+'</a>':'';
  Router.page(t('清关单据管理','Customs Documents'),'<div class="wms-page customs-packing-workspace" data-no-i18n data-page-composed>'+
   '<div class="packing-workspace-toolbar">'+this.nav('packing')+template+'</div>'+this.packingFilters(q,data.customer_options)+
   '<div class="customs-packing-split"><section class="wms-section packing-list-panel" aria-labelledby="customs-packing-list-heading">'+
   '<header class="packing-panel-heading"><h2 id="customs-packing-list-heading">'+t('批次列表','Lot List')+'</h2></header>'+
   ExportLicenses.table(labels,entries,'customs-packing-list',true,{numeric:[2]})+Management.pager(data)+'</section>'+
   '<aside id="customs-packing-preview" class="wms-preview" aria-labelledby="customs-packing-preview-heading" tabindex="-1">'+
   '<header class="packing-panel-heading"><h2 id="customs-packing-preview-heading">'+
   t('清关单据预览','Customs Document Preview')+'</h2></header><div class="packing-preview-body" aria-live="polite"></div></aside></div></div>');
  $('customs-packing-filter').onsubmit=e=>{
   e.preventDefault();
   const params=new URLSearchParams([...new FormData(e.target)].filter(([,value])=>value.trim()));
   Router.go(path+(params.size?'?'+params:''));
  };
  Management.bindPaging(data,params=>Router.go(path+'?'+params));
  const panels=$('customs-packing-list').querySelectorAll('[data-packing-row]'),preview=$('customs-packing-preview');
  const select=(row,explicit=false)=>{
   for(const tr of panels){
    const active=row?.id===tr.dataset.packingRow;
    tr.toggleAttribute('data-selected',active);
    for(const control of tr.querySelectorAll('[data-packing-select]'))control.setAttribute('aria-pressed',String(active));
   }
   history.replaceState({...history.state,packingSelection:{id:row?.id,product}},'');
   this.packingPreview(preview,row,co);
   if(explicit&&matchMedia('(max-width:1080px)').matches){
    preview.scrollIntoView({block:'start'});
    preview.focus({preventScroll:true});
   }
  };
  for(const [i,element] of [...panels].entries())element.onclick=()=>select(rows[i],true);
  const selected=history.state?.packingSelection;
  select((selected?.product===product&&rows.find(row=>row.id===selected.id))||rows[0]);
  ProductContext.dirty=false;
 },
 packingRow(row,co){
  const revision=co?row.packing_revision:row.revision,weight=co?row.actual_net_kg:row.total_net_weight;
  return {
   id:co?row.order_id:row.id,batch:co?row.preparation_batch_no:row.lot_no,customer:row.customer_name,code:row.code,
   truck:co?row.transport_snapshot?.truck_no:row.shipping_vehicle_no||row.vehicle_no,
   number:PlanDisplay.documentNo(row.document_no||row.packing_list_no,row.historical_import),weight:weight==null?'—':co?CobaltLoadingUI.mt(weight):Tonnes.format(weight),
   revision,generated:co?row.document_generated_at:row.generated_at,loadingDate:row.loading_date,
   planId:co?row.plan_id:row.loading_plan_id,planCode:row.loading_plan_code,
   transporter:row.transporter,destination:row.destination,posted:co||row.posted
  };
 },
 packingFilters(q,customers){
  const t=this.t,options=(name,entries)=>entries.map(([v,label])=>'<option value="'+esc(v)+'"'+
   (v===q.get(name)?' selected':'')+'>'+esc(label)+'</option>').join('');
  return '<form id="customs-packing-filter" class="filters wms-filter-row wms-compact-filters">'+
   '<label>'+t('批次号 / 装箱单号','Lot / Packing List No.')+'<input type="search" name="search" maxlength="160" value="'+esc(q.get('search')||'')+'"></label>'+
   '<label>'+t('客户','Customer')+'<select name="customer_id">'+options('customer_id',[['',t('全部客户','All Customers')],...customers.map(c=>[c.id,c.name])])+'</select></label>'+
   '<label>'+t('单据状态','Document Status')+'<select name="document_status">'+options('document_status',[
    ['',t('全部状态','All Statuses')],['MISSING',t('待生成','Awaiting Generation')],['GENERATED',t('已生成','Generated')]])+'</select></label>'+
   '<label>'+t('创建日期','Created Date')+'<input type="date" name="created_date" value="'+esc(q.get('created_date')||'')+'"></label>'+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+
   '</button><a class="button secondary" data-wms-reset href="/customs/packing-list">'+t('重置','Reset')+'</a></div></form>';
 },
 packingStatus(revision){
  return '<span class="packing-document-status '+(revision?'is-generated':'is-pending')+'">'+
   (revision?this.t('已生成','Generated'):this.t('待生成','Awaiting Generation'))+'</span>';
 },
 packingPreview(preview,row,co){
  const t=this.t,body=preview.querySelector('.packing-preview-body');
  if(!row){body.innerHTML='<p class="wms-feedback">'+t('当前筛选无清关单据。','No customs documents match these filters.')+'</p>';return;}
  const detail='/customs/packing-list/'+esc(row.id),facts=entries=>UI46Pages.factList(entries);
  const text=value=>esc(value||'—'),link=(href,value)=>value?'<a href="'+esc(href)+'">'+esc(value)+'</a>':'—';
  const plan=row.planId&&this.can('loading-plan:read')?link('/loading-plans/orders/'+row.planId,row.planCode):text(row.planCode);
  const revisions='<details class="packing-preview-revisions"><summary>'+t('装箱单版本与历史','Revisions and History')+'</summary>'+
   facts([[t('当前版本','Current Revision'),row.revision?'r'+esc(row.revision):t('待首次生成','Awaiting First Generation')],
    [t('生成时间','Generated At'),BusinessTime.display(row.generated)]])+'<div class="packing-revision-list" aria-live="polite"></div></details>';
  body.innerHTML='<div class="packing-preview-title"><div><h3>'+text(row.number||row.code)+'</h3><span>'+text(row.batch)+'</span></div>'+
   this.packingStatus(row.revision)+'</div>'+
   facts([[t('客户','Customer'),text(row.customer)],[t('车头号','Truck Plate'),text(row.truck)],
    [t('净重（吨）','Net Weight (MT)'),text(row.weight)],[t('业务节点','Workflow Stage'),row.posted?
     t('已正式出库','Stock Issue Posted'):t('物流经理已审批','Logistics Manager Approved')]])+
   '<section><h3>'+t('关联单据','Related Documents')+'</h3>'+facts([
    [t('装车单号','Loading Order No.'),link((co?'/outbounds/':'/outbounds/loads/')+row.id,row.code)],[t('装车计划号','Loading Plan No.'),plan]])+'</section>'+
   '<section><h3>'+t('运输资料','Transport Details')+'</h3>'+facts([
    [t('运输商','Transporter'),text(row.transporter)],[t('目的地','Destination'),text(row.destination)]])+'</section>'+revisions+
   '<div class="business-toolbar"><a class="button primary" href="'+detail+'">'+t('单据详情','Document Details')+'</a>'+
   (Shipping.canGenerate()?'<button type="button" class="button secondary" data-packing-generate>'+
    (row.revision?t('生成新版本','Generate New Revision'):t('生成清关单据','Generate Customs Documents'))+'</button>':'')+
   (row.revision?'<a class="button secondary" href="'+detail+'?preview=archive#packing-list-preview">'+t('预览 / 打印','Preview / Print')+'</a>'+
    (this.can('inventory:export')?'<button type="button" class="button secondary" data-packing-download>'+t('下载归档','Download Archive')+'</button>':''):'')+'</div>';
  const history=body.querySelector('details'),download=body.querySelector('[data-packing-download]'),
   generate=body.querySelector('[data-packing-generate]');
  if(row.revision)history.ontoggle=()=>{
   if(history.open)this.packingHistory(history,this.base()+'/packing-list/'+row.id+'/revisions',detail);
  };
  if(download)download.onclick=()=>co?CobaltPackingUI.download(row.revision,row.id):Shipping.download(row.id);
  if(generate)generate.onclick=()=>this.generate(row,co,generate);
 },
 async generate(row,co,button){
  const t=this.t,path=(co?CobaltPackingUI.base:'/shipping')+'/'+row.id;
  button.disabled=true;
  try{
   const data=await API.request(path);
   if(!button.isConnected)return;
   const title=data.document?t('生成新版本','Generate New Revision'):t('生成清关单据','Generate Customs Documents');
   const blocked=!co&&data.missing_weights.length>0;
   const fields=co?
    '<label class="wms-field" data-field-span="full">'+t('生成或修订原因（至少5个字符）','Generation or Revision Reason (At Least 5 Characters)')+
    '<textarea name="reason" required minlength="5" maxlength="1000"></textarea></label>':
    '<label class="wms-field">'+t('商业发票单价（美元/吨）','Commercial Invoice Unit Price (USD/MT)')+
    '<input name="unit_price_usd" type="number" required min="0.01" max="999999999.99" step="0.01" value="'+esc(data.document?.unit_price_usd||'')+'"></label>'+
    '<label class="wms-field">'+t('运费单价（美元/吨）','Freight Rate (USD/MT)')+'<input readonly value="50.00"></label>';
   dialog(title,'<form id="customs-document-generate" class="user-form" data-wms-validation data-no-i18n>'+
    '<div class="form-grid wms-field-grid">'+fields+'</div><p class="error" role="alert">'+
    (blocked?t('原始重量缺失：','Missing original weights: ')+esc(data.missing_weights.join(' / ')):'')+
    '</p><div class="wms-filter-actions"><button class="button primary"'+(blocked?' disabled':'')+'>'+
    t('生成','Generate')+'</button></div></form>',{protectForm:'#customs-document-generate'});
   const form=$('customs-document-generate'),expected_revision=data.document?.revision||0;
   form.onsubmit=e=>UI46Pages.submit(e,async()=>{
    const payload={expected_revision,source_signature:data.source_signature};
    if(co){
     payload.reason=form.elements.reason.value;
     if(!await OperationConfirm.ask({title,rows:[[t('装箱单号','Packing List No.'),data.source.document_no],
      [t('全部袋数','All Bags'),data.source.bag_count],
      [t('目标版本','Target Revision'),expected_revision+1]],note:payload.reason}))return;
    }else{
     payload.transport_version=data.transport.version;
     payload.unit_price_usd=form.elements.unit_price_usd.value;
    }
    try{await API.request(path+(co?'/generate':'/packing-list'),{method:'POST',body:payload});}
    catch(error){throw Error(co?CobaltPackingUI.error(error):I18n.translate(error.message,true));}
    if(form.isConnected){$('dialog').close();await Router.show();}
   });
  }catch(error){if(button.isConnected)notify(co?CobaltPackingUI.error(error):I18n.translate(error.message,true));}
  finally{if(button.isConnected)button.disabled=false;}
 },
 async packingHistory(history,path,detail){
  const t=this.t,host=history.querySelector('.packing-revision-list');
  if(host.dataset.loaded||host.getAttribute('aria-busy')==='true')return;
  host.setAttribute('aria-busy','true');
  host.textContent=t('正在读取版本记录…','Loading revisions…');
  try{
   const {items}=await API.request(path);
   if(!host.isConnected)return;
   host.innerHTML=items.length?'<ul>'+items.map(r=>'<li><strong>r'+esc(r.revision)+'</strong><time>'+
    esc(BusinessTime.display(r.generated_at))+'</time>'+(r.reason?'<span>'+esc(r.reason)+'</span>':'')+'</li>').join('')+'</ul>'+
    '<a href="'+detail+'">'+t('查看完整版本记录','View Full Revision History')+'</a>':
    '<p class="wms-feedback">'+t('暂无归档版本。','No archived revisions.')+'</p>';
   host.dataset.loaded='true';
  }catch(e){
   host.textContent=t('版本记录暂不可用。收起后重新展开可重试。','Revision history unavailable. Collapse and reopen to retry.');
  }finally{
   host.removeAttribute('aria-busy');
  }
 },
 route(path){
  if(path==='/outbounds/templates')return '/customs/templates';
  if(path==='/export-shipments'||path==='/outbounds'&&new URLSearchParams(location.search).get('view')==='shipments')return '/customs/packing-list';
  const old=/^\/outbounds\/(?:(?:packing-list\/([0-9a-f-]{36}))|(?:([0-9a-f-]{36})\/packing-list))$/i.exec(path);
  if(old)return '/customs/packing-list/'+(old[1]||old[2]);
  if(/^\/export-shipments\/[0-9a-f-]{36}$/i.test(path))return '/customs/packing-list/'+path.split('/').pop();
  if(path==='/customs')return this.can('load:read')?'/customs/packing-list':this.bpPermission()?'/customs/bp':'/customs/templates';
  return path.startsWith('/customs/')?path:null;
 },
 async render(path){
  const tab=this.tab(path),required=this.pagePermission(path),t=this.t;
  if(!this.can(required))throw Object.assign(Error(t('当前账号没有此页面权限','This account does not have permission for this page')),{statusCode:403});
  if(path==='/customs/bp')return CustomsBP.open();
  if(path==='/customs/templates'){
   await UnifiedOutbound.templates();
  }else if(path==='/customs/packing-list')return this.packing();
  else if(/^\/customs\/packing-list\/[0-9a-f-]{36}$/i.test(path)){
   if(ProductContext.isCopper())await Shipping.detail(path.split('/').pop());
   else{
    await CobaltPackingUI.route();
    if(new URLSearchParams(location.search).get('preview')==='archive'&&$('co-packing-preview-section')&&CobaltPackingUI.data?.document){
     await CobaltPackingUI.preview(CobaltPackingUI.data.document.revision);
    }
   }
  }else throw Object.assign(Error(t('找不到页面','Page not found')),{statusCode:404});
  this.decorate(tab);
 },
 install(){
  Router.add(/^\/customs(?:\/(?:bp|templates|packing-list(?:\/[0-9a-f-]{36})?))?$/,()=>this.render(location.pathname));
  RoutePermissions.register('customs',path=>/^\/customs(?:\/|$)/.test(path),path=>this.pagePermission(path)||'customs:bp');
  const previous=Router.performShow.bind(Router);
  Router.performShow=async(...args)=>{
   const path=this.route(location.pathname);
   if(!path)return previous(...args);
   if(path!==location.pathname){
    const q=new URLSearchParams(location.search);q.delete('view');
    history.replaceState(history.state,'',path+(q.size?'?'+q:'')+location.hash);
   }
   Router.current=path;Router.rendering=true;
   try{await this.render(path);I18n.apply();UnifiedNavigation.refresh();UnifiedNavigation.title();if(!Router.scrollHash(location.hash))window.scrollTo({top:0});}
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
