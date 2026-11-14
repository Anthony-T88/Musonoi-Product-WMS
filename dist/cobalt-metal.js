'use strict';
window.CobaltMetal={
 base:'/cobalt/metal',t:(zh,en)=>CobaltUI.t(zh,en),
 format(value,digits=5){return value==null||value===''?'—':Tonnes.fixed(Tonnes.scaled(value,digits),digits);},
 kg(value){return value==null||value===''?'—':Tonnes.fixed(Tonnes.scaled(value,1),4);},
 status(value){const states={
  PENDING_OUTBOUND:['待正式出库','Awaiting Formal Outbound'],PENDING_ARECOMS:['待ARECOMS确认','Awaiting ARECOMS Confirmation'],
  COMPLETED:['已完结','Completed'],SUBMITTED:['待审批','Awaiting Approval'],
  CONFIRMED:['已确认','Confirmed'],REJECTED:['已退回','Returned']
 };return this.t(...(states[value]||[value,value]));},
 missing(){return this.t('待计算','Awaiting Weight');},
 amount(value,digits=5){return value==null?this.missing():this.format(value,digits)+' MT';},
 pending(){return this.t('待确认','Awaiting Confirmation');},
 error(e){
  const errors={CO_METAL_AMOUNT:['请输入大于0且最多五位小数的金属量','Enter a positive metal amount with up to five decimal places'],
   CO_METAL_REASON无效:['请填写原因，最多1000字','Enter a reason of up to 1,000 characters'],
   CO_METAL_STALE:['记录已更新，请刷新后重试','The record changed. Refresh and try again'],
   CO_METAL_PERMISSION:['此操作需要当前节点审批权限','Approval permission is required'],
   CO_METAL_PENDING:['已有一笔申请待审核','A request is already awaiting approval'],
   CO_METAL_EXPORT_LIMIT:['请缩小筛选范围后再导出','Narrow the filters before exporting'],
   CO_METAL_FILTER:['筛选条件无效','Invalid filter criteria'],
   CO_METAL_NOT_POSTED:['找不到已正式出库的记录','No formal outbound record was found']};
  return errors[e.message]?this.t(...errors[e.message]):CobaltUI.error(e);
 },
 basis(r){
  const t=this.t,labels=[];
  if(r.bags>r.estimated_bags+r.missing_bags)labels.push(t('实际检斤','Measured'));
  if(r.estimated_bags)labels.push(t('预计重量口径','Estimated Weight')+' '+r.estimated_bags);
  if(r.missing_bags)labels.push(this.missing()+' '+r.missing_bags);
  return labels.join(' · ')||'—';
 },
 card(label,value){
  const text=String(value),mt=text.endsWith(' MT');
  return '<article class="v34-kpi"><span>'+esc(label)+'</span><strong>'+esc(mt?text.slice(0,-3):text)+(mt?'<small> MT</small>':'')+'</strong></article>';
 },
 overview(data,cards){
  return data&&cards?this.stockCards(data.inventory,cards,data.period||data.month):'';
 },
 stockCards(inventory,cards,period){
  const a=OverviewAnalysis,t=this.t,metal=this.format(inventory.estimated_mt);
  return '<div class="oa-kpis oa-kpis-cobalt">'+
   a.batchCard(t('备货作业中吨包','Bags in Preparation'),cards.preparing)+
   a.batchCard(t('已备货待出库库存','Prepared Stock Awaiting Outbound'),cards.prepared,true)+
   a.batchCard(t('装车中库存','Stock in Loading'),cards.loading,true)+
   a.card(t('在库库存预估金属量','Estimated In-Stock Cobalt Metal'),metal,metal==='—'?'':t('金属吨','MT of cobalt'),t('按在库预计钴金属量汇总','Estimated cobalt metal in stock'))+
   a.card(t('ARECOMS确认车数与钴金属量','ARECOMS Confirmed Vehicles and Cobalt'),CountValues.display(period?.completed??0)+' '+t('车','vehicles')+' / '+this.format(period?.confirmed_mt??'0'),t('金属吨','MT of cobalt'),'')+
   a.batchCard(t('已出库重量','Outbound Weight'),cards.outbound,true)+
   '</div>';
 },
 confirmationCards(period,withTitle=true,shipmentVehicles=period.vehicles){
  const a=OverviewAnalysis,t=this.t,vehicles=t('车','vehicles'),confirmed=this.format(period.confirmed_mt??'0');
  return '<section class="oa-arecoms" aria-label="'+t('ARECOMS确认汇总','ARECOMS Confirmation Summary')+'">'+
   (withTitle?'<h2>'+t('ARECOMS金属量确认','ARECOMS Metal Confirmation')+'</h2>':'')+'<div class="oa-kpis oa-kpis-confirmation">'+
   a.card(t('发运车辆数','Shipment Vehicles'),CountValues.display(shipmentVehicles),vehicles,'')+
   a.card(t('ARECOMS金属量确认进度','ARECOMS Confirmation Progress'),CountValues.display(period.completed)+' '+vehicles+' / '+CountValues.display(period.vehicles),vehicles,'')+
   a.card(t('已确认车数与钴金属量','Confirmed Vehicles and Cobalt'),CountValues.display(period.completed)+' '+vehicles+' / '+confirmed,t('金属吨','MT of cobalt'),'')+
   '</div></section>';
 },
 chart(rows){
  const t=this.t,max=Math.max(0,...rows.flatMap(r=>[Number(r.estimated_mt),Number(r.confirmed_mt)]))||1;
  const bar=(value,kind,label)=>value==null?'<span>—</span>':
   `<span title="${esc(value)} MT"><meter class="${kind}" aria-label="${esc(label)}" min="0" max="${max}" value="${Number(value)}">${esc(value)} MT</meter> <strong>${esc(value)}</strong></span>`;
  const table=CobaltSalesUI.table([['正式出库月份','Formal Outbound Month'],['预计钴金属量（MT）','Estimated Cobalt (MT)'],
   ['ARECOMS已确认（MT）','Confirmed ARECOMS (MT)'],['待确认车辆','Vehicles Awaiting Confirmation']],
  rows.map(r=>`<tr><th scope="row">${esc(r.period)}</th><td>${bar(r.estimated_mt,'co-metal-estimate',t('预计钴金属量','Estimated Cobalt'))}</td>
   <td>${bar(r.confirmed_mt,'co-metal-confirmed',t('ARECOMS确认钴金属量','Confirmed ARECOMS Cobalt'))}</td><td>${r.pending} / ${r.vehicles}</td></tr>`),'co-metal-months');
  return rows.length?table.replace('<table id="co-metal-months"','<table id="co-metal-months" data-v34-enhanced="true"'):OverviewAnalysis.empty('所选期间暂无正式出库记录','No formal outbound records in the selected period');
 },
 receipt(m){
  if(!m?.inventory.bags)return '';
  const t=this.t,i=m.inventory;
  return '<section class="co-metal-section"><h2>'+t('入库预计钴金属量','Estimated Cobalt at Receipt')+'</h2><div class="v34-kpi-grid">'+
   this.card(t('实物净重','Wet Net Weight'),this.amount(i.net_mt,4))+
   this.card(t('预计钴金属量','Estimated Cobalt'),this.amount(i.estimated_mt))+'</div><p>'+esc(this.basis(i))+'</p></section>';
 },
 work(d){
  if(!d.metal)return '';
  const t=this.t,m=d.metal,complete=m.measured_bags===m.bags;
  return '<section class="co-metal-section"><h2>'+t('备货批次金属量','Preparation Batch Metal')+'</h2><div class="v34-kpi-grid">'+
   this.card(t('备货批次','Preparation Batch'),d.preparation_batch_no)+this.card(t('袋数','Bags'),m.bags)+
   this.card(t('实物毛重','Measured Gross'),this.amount(m.gross_mt,4))+this.card(t('实物净重','Measured Wet Net'),this.amount(m.measured_net_mt,4))+
   this.card(t('预计钴金属量','Estimated Cobalt'),this.amount(m.measured_estimated_mt))+'</div><p>'+
   t('预估钴品位 40% · 预估水分 10%','Estimated cobalt grade 40% · estimated moisture 10%')+
   (complete?'':' · '+t('实际检斤','Measured Bags')+' '+m.measured_bags+' / '+m.bags)+'</p></section>';
 },
 async route(){
  try{await this.list();}
  catch(e){CobaltUI.page(this.t('钴金属量管理','Cobalt Metal Management'),'<p class="error" role="alert">'+esc(this.error(e))+'</p>');}
 },
 async list(){
  const t=this.t,q=new URLSearchParams(location.search),canStock=CobaltUI.can('co:read'),canOutbound=CobaltUI.can('outbound:read');
  const outbound=canOutbound&&(q.get('view')==='outbound'||!canStock),view=outbound?'outbound':'inventory';q.set('view',view);
  const d=await API.request(this.base+'?'+q),base='/cobalt-metal';
  const fields=outbound?[['PENDING_ARECOMS',this.status('PENDING_ARECOMS')],['COMPLETED',this.status('COMPLETED')]]:
   ['PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED','MATCHED','LOADING','REVIEW_PENDING','LOADED','DEPARTED','OUTBOUND_PENDING','LOGISTICS_APPROVED','OUTBOUND_CORRECTION'].map(k=>[k,this.stockStatus(k)]);
  const sorts=[['date',t('日期','Date')],['batch',t('备货批次','Preparation Batch')],['net',t('实物净重','Wet Net Weight')],...(outbound?[['metal',t('确认金属量','Confirmed Metal')]]:[])];
  const options=(values,key)=>values.map(([v,label])=>`<option value="${v}" ${v===q.get(key)?'selected':''}>${esc(label)}</option>`).join('');
  const tabs='<div class="business-toolbar">'+(canStock?'<a class="button '+(outbound?'secondary':'primary')+'" href="'+base+'">'+t('库存金属量明细','Inventory Metal')+'</a>':'')+
   (canOutbound?'<a class="button '+(outbound&&!q.get('status')?'primary':'secondary')+'" href="'+base+'?view=outbound">'+t('正式出库金属量明细','Formal Outbound Metal')+'</a>'+
   '<a class="button '+(q.get('status')==='PENDING_ARECOMS'?'primary':'secondary')+'" href="'+base+'?view=outbound&status=PENDING_ARECOMS">'+t('ARECOMS待确认清单','ARECOMS Confirmation Queue')+'</a>':'')+'</div>';
  const exportLink=CobaltUI.can('inventory:export')?'<button id="co-metal-export" class="button secondary" type="button">'+t('导出 Excel','Export Excel')+'</button>':'';
  const dateField=(key,zh,en)=>`<label>${t(zh,en)}<input type="date" name="${key}" value="${esc(q.get(key)||'')}"></label>`;
  const headers=outbound?[['备货批次','Preparation Batch'],['装车单','Loading Order'],['客户 / 合同','Customer / Contract'],['车牌','Truck'],
   ['正式出库日期','Formal Outbound Date'],['实物净重（MT）','Wet Net (MT)'],['预计金属量（MT）','Estimated Metal (MT)'],
   ['ARECOMS确认（MT）','Confirmed ARECOMS (MT)'],['差异（MT）','Difference (MT)'],['发运状态','Shipment Status']]:
   [['备货批次 / 入库单','Preparation Batch / Receipt'],['库存状态','Stock Status'],['袋数','Bags'],['实物净重（MT）','Wet Net (MT)'],
   ['预计金属量（MT）','Estimated Metal (MT)'],['重量依据','Weight Basis'],['货位','Locations'],['入库时间','Receipt Time']];
  const val=(v,missing=this.missing())=>esc(v??missing),cells=values=>values.map(v=>'<td>'+v+'</td>').join('');
  const rows=d.items.map(r=>'<tr>'+(outbound?cells([
   val(r.preparation_batch_no,'—'),`<a href="/outbounds/${r.order_id}#co-metal-detail">${esc(r.order_no)}</a>`,esc(r.customer_name)+' / '+esc(r.contract_no),
   val(r.truck_no,'—'),val(r.posted_day),val(r.net_mt),val(r.estimated_mt),val(r.confirmed_mt,this.pending()),
   val(r.difference_mt,r.confirmed_mt==null?this.pending():this.missing()),esc(this.status(r.shipment_status))
  ]):cells([
   `<a href="/receipts/${r.preparation_id}">${esc(r.preparation_batch_no||r.document_no)}</a>`+(r.preparation_batch_no?'<br>'+esc(r.document_no):''),
   esc(this.stockStatus(r.status)),r.bags,val(r.net_mt),val(r.estimated_mt),esc(this.basis(r)),val(r.location_codes,'—'),esc(BusinessTime.display(r.received_at))
  ]))+'</tr>');
  CobaltUI.page(t('钴金属量管理','Cobalt Metal Management'),`<div class="co-metal-page">
   ${d.summary.period?'<div class="oa467 co-metal-kpis" data-no-i18n>'+this.confirmationCards(d.summary.period,false)+'</div>':''}
   ${tabs}<form id="co-metal-filter" class="filters co-metal-filters"><input type="hidden" name="view" value="${view}">
   <label>${t('搜索','Search')}<input type="search" name="search" maxlength="160" value="${esc(q.get('search')||'')}"
    placeholder="${t(outbound?'批次、装车单、客户、合同或车牌':'入库单、批次、袋号、铅封或货位',outbound?'Batch, order, customer, contract or truck':'Receipt, batch, bag, seal or location')}"></label>
   <label>${t('状态','Status')}<select name="status"><option value="">${t('全部','All')}</option>${options(fields,'status')}</select></label>
   ${outbound?dateField('from','出库开始日期','Outbound From')+dateField('to','出库截止日期','Outbound To'):''}
   <label>${t('排序','Sort By')}<select name="sort">${options(sorts,'sort')}</select></label>
   <label>${t('顺序','Direction')}<select name="direction">${options([['desc',t('降序','Descending')],['asc',t('升序','Ascending')]],'direction')}</select></label>
   <div class="business-toolbar"><button class="button primary">${t('查询','Search')}</button><a class="button secondary" href="${base}?view=${view}">${t('重置','Reset')}</a>${exportLink}</div></form>
   <p id="co-metal-list-error" class="error" role="alert"></p>${CobaltSalesUI.table(headers,rows,'co-metal-list')}${CobaltStockUI.pager(d.page,d.total,50)}</div>`);
  $('co-metal-filter').onsubmit=e=>{e.preventDefault();Router.go(base+'?'+new URLSearchParams(new FormData(e.target)));};
  CobaltStockUI.bindPager(d);
  if($('co-metal-export'))$('co-metal-export').onclick=async()=>{
   try{
    const response=await fetch('/api/v1'+this.base+'/export?'+q,{headers:{'X-Product-Code':'CO_HYDROXIDE'}});
    if(!response.ok)throw Error((await response.json()).message);
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='cobalt-metal.xlsx';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch(e){$('co-metal-list-error').textContent=this.error(e);}
  };
  ProductContext.dirty=false;
 },
 stockStatus(s){return ['PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED'].includes(s)?CobaltWorkUI.status(s):CobaltExecutionUI.state(s);},
 outbound(d){
  const t=this.t,r=d.metal;
  if(!r)return '<p>'+t('发运业务状态','Shipment Status')+' · '+this.status(d.shipment_status)+'</p>';
  const amount=r.confirmed_mt==null?this.pending():this.amount(r.confirmed_mt);
  const fields=[
   [t('出库实物净重','Outbound Wet Net'),this.amount(r.net_mt,4)],
   [t('出库预计钴金属量','Estimated Cobalt at Outbound'),this.amount(r.estimated_mt)],
   [t('ARECOMS确认金属量','Confirmed ARECOMS Metal'),amount],
   [t('金属量差异 / 差异率','Metal Difference / Rate'),r.confirmed_mt==null?this.pending():
    this.amount(r.difference_mt)+(r.difference_pct==null?'':' / '+r.difference_pct+'%')],
   [t('发运业务状态','Shipment Status'),this.status(r.shipment_status)],
   [t('ARECOMS确认状态','ARECOMS Confirmation Status'),r.latest_action==='SUBMITTED'?this.status('SUBMITTED'):r.confirmed_at?this.status('CONFIRMED'):this.pending()]
  ];
  const history=CobaltSalesUI.table([['版本','Version'],['操作','Action'],['金属量（MT）','Metal (MT)'],['操作人','Actor'],['时间','Time'],['原因','Reason']],
   r.history.map(e=>`<tr><td>${e.version}</td><td>${esc(this.status(e.action))}</td><td>${esc(e.display_mt??'—')}</td>
    <td>${esc(e.actor_name)}</td><td>${esc(BusinessTime.display(e.occurred_at))}</td><td>${esc(e.reason)}</td></tr>`),'co-metal-history');
  const submit=r.can_submit?`<form id="co-metal-submit" class="user-form"><label>${t('ARECOMS实际金属量（MT）','Actual ARECOMS Metal (MT)')}
   <input name="amount_mt" type="text" inputmode="decimal" pattern="[0-9]{1,16}(\\.[0-9]{1,5})?" required></label>
   <label>${t('录入或修改原因','Reason for Entry or Revision')}<textarea name="reason" maxlength="1000" required></textarea></label>
   <button class="button primary">${t(r.confirmed_at?'提交修订审批':'提交金属量确认',r.confirmed_at?'Submit Revision for Approval':'Submit Metal for Confirmation')}</button></form>`:'';
  const decide=r.can_decide?`<form id="co-metal-decision" class="user-form"><label>${t('审批意见','Review Reason')}<textarea name="reason" maxlength="1000" required></textarea></label>
   <div class="business-toolbar"><button class="button primary" value="confirm">${t('确认ARECOMS金属量','Confirm ARECOMS Metal')}</button>
   <button class="button secondary" value="reject">${t('退回修改','Return for Changes')}</button></div></form>`:'';
  return `<section class="co-metal-section" id="co-metal-detail"><h3>${t('钴金属量与发运完结','Cobalt Metal and Shipment Completion')}</h3>
   <div class="v34-kpi-grid">${fields.map(([label,v])=>this.card(label,v)).join('')}</div>
   ${r.legacy_metal_mt!=null?'<p>'+t('历史预录参考值','Legacy Pre-entered Reference')+' · '+esc(this.amount(r.legacy_metal_mt))+'</p>':''}
   ${r.pending_metal_mt!=null?'<p>'+t('本次待审批值','Proposed Metal')+' · '+esc(this.amount(r.pending_metal_mt))+'</p>':''}
   ${r.confirmed_at?'<p>'+t('有效确认','Effective Confirmation')+' · '+esc(r.confirmed_by_name)+' · '+esc(BusinessTime.display(r.confirmed_at))+'</p>':''}
   ${submit}${decide}<p id="co-metal-error" class="error" role="alert"></p>
   <details ${r.history.length?'open':''}><summary>${t('ARECOMS历史记录','ARECOMS History')}</summary>${history}</details></section>`;
 },
 bindOutbound(r,reload){
  if(!r)return;
  for(const [id,action] of [['co-metal-submit','submit'],['co-metal-decision',null]]){
   const form=$(id);if(!form)continue;
   form.onsubmit=async e=>{
    e.preventDefault();const button=e.submitter,kind=action||button.value,values=Object.fromEntries(new FormData(form));button.disabled=true;
    try{
     await API.request(this.base+'/outbounds/'+r.order_id+'/'+kind,{method:'POST',body:{version:r.version,...values}});
     ProductContext.dirty=false;await reload();
    }catch(err){$('co-metal-error').textContent=this.error(err);button.disabled=false;}
   };
  }
 }
};
