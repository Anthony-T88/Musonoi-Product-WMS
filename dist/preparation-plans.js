'use strict';
window.PreparationPlans={
 route:'/preparation/work-plans',
 t:(zh,en)=>I18n.language==='en'?en:zh,
 api(){return (ProductContext.isCopper()?'':'/cobalt')+'/preparation-plans';},
 readPermission(){
  const permissions=CurrentUser.permissions,start=ProductContext.isCopper()?'allocation:write':'co:create';
  if(permissions.includes('plan:read'))return 'plan:read';
  if(permissions.includes(start))return start;
  if(['admin','logistics_manager'].includes(CurrentUser.role_code)&&permissions.includes('allocation:review'))return 'allocation:review';
  return null;
 },
 backLink(){
  const co=!ProductContext.isCopper();
  if(!CurrentUser.permissions.includes(co?'co:read':'allocation:read'))return '';
  return '<a class="button secondary" href="'+(co?'/receipts':'/preparation')+'">'+this.t('返回备货管理','Back to Preparation')+'</a>';
 },
 state(state){return this.t(...({
  DRAFT:['草稿','Draft'],PENDING:['待物流经理审批','Pending Logistics Approval'],
  APPROVED:['已批准','Approved'],REJECTED:['已退回','Returned']
 }[state]||[state,state]));},
 orderRoute(p){return (ProductContext.isCopper()?'/preparation/':'/receipts/')+(p.allocation_id||p.co_preparation_id);},
 startRoute(p){return (ProductContext.isCopper()?'/preparation/new':'/receipts/new')+'?preparation_plan='+p.id;},
 async selected(){
  const id=new URLSearchParams(location.search).get('preparation_plan');
  if(!id){await this.selectPlan();return null;}
  const p=await API.request(this.api()+'/'+encodeURIComponent(id));
  if(!p.actions.start)throw Error(this.t('该计划尚未获批或已生成作业。','This plan is not approved or already has a work order.'));
  return p;
 },
 async selectPlan(){
  const t=this.t,path=location.pathname,q=new URLSearchParams(location.search);
  q.set('executable','1');
  const d=await API.request(this.api()+'?'+q);
  if(location.pathname!==path||new URLSearchParams(location.search).has('preparation_plan'))return;
  const rows=d.items.map(p=>'<tr><td><a href="'+this.route+'/'+p.id+'">'+esc(p.batch_no)+'</a></td><td>'+esc(p.sales_plan_no)+'</td><td>'+esc(p.customer_name)+'</td><td>'+esc(p.shipment_month)+'</td><td><a class="button primary compact" href="'+this.startRoute(p)+'">'+t('创建备货单','Create Preparation Order')+'</a></td></tr>');
  const table=rows.length?ExportLicenses.table([['备货批次号','Preparation Lot Number'],['销售计划','Sales Plan'],['客户','Customer'],['发运月','Shipment Month'],['操作','Actions']],rows,'executable-preparation-plans',true,{actions:[4]}):
   '<p class="wms-feedback" role="status">'+t('暂无可执行的已审批备货计划。','No approved preparation plan is available for execution.')+'</p>';
  Router.page(t('选择备货计划','Select Preparation Plan'),'<section class="wms-page" data-page-composed data-no-i18n><div class="business-toolbar">'+this.backLink()+'</div>'+
   '<form id="executable-preparation-filter" class="filters wms-filter-row"><label>'+t('批次号 / 销售计划 / 客户','Lot Number / Sales Plan / Customer')+'<input type="search" name="search" maxlength="160" value="'+esc(q.get('search')||'')+'"></label><div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a data-wms-reset class="button secondary" href="'+path+'">'+t('重置','Reset')+'</a></div></form>'+
   table+CobaltStockUI.pager(d.page,d.total,d.page_size)+'</section>');
  $('executable-preparation-filter').onsubmit=e=>{e.preventDefault();Router.go(path+'?'+new URLSearchParams(new FormData(e.target)));};
  CobaltStockUI.bindPager(d);ProductContext.dirty=false;
 },
 fields(p,includeBatch=true){
  const t=this.t,rows=[['销售计划','Sales Plan',p.sales_plan_no],['发运月','Shipment Month',p.shipment_month],['客户','Customer',p.customer_name]];
  if(includeBatch)rows.unshift(['备货批次号','Preparation Lot Number',p.batch_no]);
  return UI46Pages.factList(rows.map(([z,e,value])=>[t(z,e),esc(value||'—')]));
 },
 async list(){
  const t=this.t,q=new URLSearchParams(location.search),d=await API.request(this.api()+'?'+q);
  const status=['DRAFT','PENDING','APPROVED','REJECTED'].map(s=>'<option value="'+s+'" '+(s===q.get('state')?'selected':'')+'>'+this.state(s)+'</option>').join('');
  const headings=[['备货批次号','Preparation Lot Number'],['销售计划','Sales Plan'],['发运月','Shipment Month'],['客户','Customer'],['审批状态','Review Status'],['作业','Work Order']];
  const rows=d.items.map(p=>'<tr><td><a href="'+this.route+'/'+p.id+'">'+esc(p.batch_no)+'</a></td><td>'+esc(p.sales_plan_no)+'</td><td>'+esc(p.shipment_month)+'</td><td>'+esc(p.customer_name)+'</td><td>'+UI.status(p.state,'approval',this.state(p.state))+'</td><td>'+
   (p.allocation_id||p.co_preparation_id?'<a href="'+this.orderRoute(p)+'">'+t('查看备货单','View Preparation Order')+'</a>':p.actions.start?'<a href="'+this.startRoute(p)+'">'+t('创建备货单','Create Preparation Order')+'</a>':'—')+'</td></tr>');
  Router.page(t('备货计划','Preparation Plans'),'<section class="wms-page" data-page-composed data-no-i18n>'+
   '<div class="business-toolbar">'+(d.can_create?'<button type="button" id="preparation-plan-create" class="button primary">'+t('新建备货计划','New Preparation Plan')+'</button>':'')+
   this.backLink()+'</div>'+
   '<form id="preparation-plan-filter" class="filters wms-filter-row"><label>'+t('批次号 / 销售计划 / 客户','Lot Number / Sales Plan / Customer')+
   '<input name="search" type="search" maxlength="160" value="'+esc(q.get('search')||'')+'"></label><label>'+t('审批状态','Review Status')+
   '<select name="state"><option value="">'+t('全部','All')+'</option>'+status+'</select></label><div class="wms-filter-actions">'+
   '<button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+this.route+'">'+t('重置','Reset')+'</a></div></form>'+
   ExportLicenses.table(headings,rows,'preparation-plans-table',true)+CobaltStockUI.pager(d.page,d.total,d.page_size)+'</section>');
  $('preparation-plan-filter').onsubmit=e=>{e.preventDefault();Router.go(this.route+'?'+new URLSearchParams(new FormData(e.target)));};
  if($('preparation-plan-create'))$('preparation-plan-create').onclick=()=>this.form();
  CobaltStockUI.bindPager(d);ProductContext.dirty=false;
 },
 async detail(id){
  const t=this.t,p=await API.request(this.api()+'/'+id);
  const labels={CREATE:['创建','Created'],EDIT:['修改','Edited'],SUBMIT:['提交审批','Submitted'],APPROVE:['审批通过','Approved'],REJECT:['退回','Returned'],START:['生成备货作业','Work Order Created']};
  const button=(id,z,e,style='secondary')=>'<button type="button" class="button '+style+'" data-plan-action="'+id+'">'+t(z,e)+'</button>';
  const work=p.allocation_id||p.co_preparation_id?'<a class="button secondary" href="'+this.orderRoute(p)+'">'+t('查看备货单','View Preparation Order')+'</a>':
   p.actions.start?'<a class="button primary" href="'+this.startRoute(p)+'">'+t('创建备货单','Create Preparation Order')+'</a>':'';
  const actions=work+(p.actions.edit?button('edit','修改','Edit')+button('submit','提交审批','Submit for Approval','primary'):'')+
   (p.actions.review?button('approve','审批通过','Approve','primary')+button('reject','退回','Return','danger-outline'):'');
  const back='<a class="button secondary" data-wms-back href="'+this.route+'">'+t('返回备货计划','Back to Plans')+'</a>';
  Router.page(t('备货计划详情','Preparation Plan Details'),'<div class="wms-page" data-page-composed data-no-i18n>'+
   UI46Pages.identity(p.batch_no,UI.status(p.state,'approval',this.state(p.state)),back+actions,this.fields(p,false))+
   ExportLicenses.section(t('办理记录','Activity'),'<ol>'+p.events.map(event=>'<li>'+t(...labels[event.action])+' · '+esc(event.actor)+' · '+esc(BusinessTime.display(event.occurred_at))+
    (event.reason?' · '+esc(event.reason):'')+'</li>').join('')+'</ol>')+'<p id="preparation-plan-error" class="error" role="alert"></p></div>');
  for(const button of document.querySelectorAll('[data-plan-action]'))button.onclick=async()=>{
   const action=button.dataset.planAction;
   if(action==='edit')return this.form(p);
   let reason='';
   if(!await OperationConfirm.ask({title:button.textContent,rows:[[t('备货批次','Preparation Batch'),p.batch_no]],comment:action==='reject',commentRequired:action==='reject',commentLabel:t('退回意见','Return Note'),onComment:value=>{reason=value||'';}}))return;
   button.disabled=true;
   try{await API.request(this.api()+'/'+id+'/'+action,{method:'POST',body:{version:p.version,reason}});await this.detail(id);window.dispatchEvent(new Event('inventory-changed'));}
   catch(err){$('preparation-plan-error').textContent=err.message;button.disabled=false;}
  };
  ProductContext.dirty=false;
 },
 form(prior){
  const t=this.t,base=(ProductContext.isCopper()?'':'/cobalt')+'/sales-workflow/plans';
  dialog(prior?t('修改备货计划','Edit Preparation Plan'):t('新建备货计划','New Preparation Plan'),
   '<form id="preparation-plan-form" class="user-form" data-no-i18n data-wms-validation><div class="form-grid wms-field-grid">'+
   '<label class="wms-field">'+t('搜索销售计划','Search Sales Plans')+'<input id="preparation-sales-search" type="search" maxlength="160"></label>'+
   '<label class="wms-field">'+t('销售计划','Sales Plan')+'<select name="sales_plan_id" required></select></label>'+
   '<label class="wms-field">'+t('客户','Customer')+'<input name="customer" readonly></label>'+
   '<label class="wms-field">'+t('发运月','Shipment Month')+'<input name="shipment_month" type="month" required value="'+esc(prior?.shipment_month||'')+'"></label>'+
   '<label class="wms-field">'+t('备货批次号','Preparation Lot Number')+'<input name="batch_no" maxlength="48" required placeholder="'+(ProductContext.isCopper()?'RMM-CU-YYYY-01':'RMM-CO-YYYY-001')+'" value="'+esc(prior?.batch_no||'')+'"></label>'+
   '</div><p class="error wms-feedback" role="alert"></p><div class="business-toolbar wms-form-actions"><button class="button primary">'+t('保存计划','Save Plan')+'</button></div></form>');
  const form=$('preparation-plan-form'),select=form.elements.sales_plan_id,search=$('preparation-sales-search'),message=form.querySelector('[role=alert]');
  let plans=[],sequence=0;
  const apply=()=>{
   const p=plans.find(row=>row.id===select.value);
   form.elements.customer.value=p?.customer_name||'';
   if(p&&!form.elements.shipment_month.value)form.elements.shipment_month.value=p.shipment_month||'';
  };
  const load=async()=>{
   const n=++sequence,selected=select.value||prior?.sales_plan_id;
   try{
    const d=await API.request(base+'?'+new URLSearchParams({status:'OPEN',search:search.value.trim()}));
    if(!form.isConnected||n!==sequence)return;
    plans=d.items;
    if(prior&&!plans.some(row=>row.id===prior.sales_plan_id))plans=[{id:prior.sales_plan_id,code:prior.sales_plan_no,customer_name:prior.customer_name},...plans];
    select.replaceChildren(new Option(t('请选择','Select'),''));
    for(const p of plans)select.add(new Option(p.code+' · '+p.customer_name,p.id));
    select.value=plans.some(p=>p.id===selected)?selected:'';
    apply();
   }catch(err){if(form.isConnected&&n===sequence)message.textContent=err.message;}
  };
  let timer;
  search.oninput=()=>{clearTimeout(timer);timer=setTimeout(load,250);};
  select.onchange=()=>{form.elements.shipment_month.value='';apply();};
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   const {sales_plan_id,shipment_month,batch_no}=Object.fromEntries(new FormData(form));
   const r=await API.request(this.api()+(prior?'/'+prior.id:''),{method:prior?'PATCH':'POST',
    body:{sales_plan_id,shipment_month,batch_no,...(prior?{version:prior.version}:{})}});
   $('dialog').close();ProductContext.dirty=false;
   if(prior)await this.detail(r.id);else await Router.go(this.route+'/'+r.id);
  });
  load();
 }
};
RoutePermissions.register('preparation-plans',path=>/^\/preparation\/work-plans(?:\/[0-9a-f-]{36})?$/.test(path),()=>PreparationPlans.readPermission()||'plan:read');
Router.add(/^\/preparation\/work-plans$/,()=>PreparationPlans.list());
Router.add(/^\/preparation\/work-plans\/([0-9a-f-]{36})$/,id=>PreparationPlans.detail(id));
Object.assign(ManagementLabels.names,{PREPARATION_PLAN_REVIEW:'备货计划审批'});
Object.assign(ManagementLabels.en,{'备货计划审批':'Preparation Plan Review'});
