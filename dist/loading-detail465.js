'use strict';
window.LoadingDetails465={
 t:(z,e)=>I18n.language==='en'?e:z,
 matches(root){return ProductContext.isCopper()?/^\/outbounds\/loads\/[0-9a-f-]{36}$/.test(location.pathname):/^\/outbounds\/[0-9a-f-]{36}$/.test(location.pathname)&&!!root.querySelector('.co-execution-page');},
 compose(root,s){const P=UI46Pages,t=this.t,co=!ProductContext.isCopper(),id=location.pathname.split('/').pop(),d=co?CobaltExecutionUI.data:P.response(new RegExp('^/loads/'+id+'(?:\\?|$)'));if(!d||co&&d.order?.id!==id||!co&&d.id!==id)return false;
  s.composition.family='managed-document';root.dataset.pageFamily='managed-document';P.cls(root,'r5-document',s);P.cls(root,'loading465',s);const host=co?root.querySelector('.co-execution-page'):P.host(root),nodes=[...host.children],order=co?d.order:d,plan=co?d.outbound?.snapshot?.plan||d.plan:d.loading_plan||{},transport=co?d.outbound?.snapshot?.order?.transport_snapshot||order.transport_snapshot:plan,batch=co?d.plan.preparation_batch_no:d.lot_nos?.join(' / ')||d.lot_no||'—',customer=co?d.outbound?.snapshot?.customer?.name||d.plan.customer_name:d.customer_name,state=co?d.execution?.state||'WAITING':d.workflow_state||d.status;
  document.getElementById('business-title').textContent=t('装车单详情','Loading Order Details');UnifiedNavigation.title();
  const shell=P.el('div','p46-composition loading465-shell',host,s);s.composition.anchor=shell;s.composition.host=host;
  const banner=P.el('section','p46-document-banner loading465-banner',shell,s),top=P.el('div','',banner,s),kicker=P.el('p','r5-document-kicker',top,s);kicker.textContent=t('装车单详情','Loading Order Details');const h=P.el('h2','',top,s);h.dataset.noI18n='';h.textContent=batch;const status=P.el('span','r5-document-status',top,s);status.innerHTML=co?CobaltExecutionUI.state(state):UI.status(state,'loading',V26.states[state]);const meta=P.el('p','loading465-subtitle',top,s);meta.dataset.noI18n='';meta.textContent=customer||'—';const original=P.el('p','loading465-reference',banner,s);original.textContent=t('装车单号：','Loading Order: ')+order.code;original.dataset.noI18n='';
  const {left}=P.grid(shell,s,false),facts=P.card(left,t('业务与车辆信息','Business and Vehicle Information'),s,'loading465-facts'),actions=P.card(left,t('当前办理','Current Actions'),s,'loading465-actions');
  const actionRow=P.el('div','business-toolbar loading465-action-row',actions,s);
  const weightNode=root.querySelector('[data-weight-warning]');
  if(weightNode)P.move(weightNode,actions,s);
  let corrections;
  const addCorrection=n=>{
   if(!n.querySelector('button,form,a,details,.dialog-notice,.error,.panel')){P.hide(n,s);return;}
   corrections||=P.card(left,t('更正与异常办理','Corrections and Exceptions'),s,'loading465-corrections');
   P.move(n,corrections,s);
  };
  P.facts(facts,[[t('备货批次号','Preparation Lot Number'),batch],[t('客户','Customer'),customer],[t('装车单号','Loading Order No.'),order.code],[t('装箱单号','Packing List No.'),plan.packing_list_no||'—'],[t('车牌','Truck'),transport.truck_no||transport.vehicle_no||d.shipping_vehicle_no||order.vehicle_no||'—'],[t('司机','Driver'),transport.driver_name||'—'],[t('销售计划','Sales Plan'),co?d.plan.sales_plan_code:d.plan_code||plan.sales_plan_code||'—'],[t('创建时间','Created At'),order.created_at?BusinessTime.display(order.created_at):'—'],...(co?[[t('合同号','Contract No.'),d.outbound?.snapshot?.contract?.contract_no||d.plan.contract_no||'—'],[t('挂车1 / 挂车2','Trailer 1 / Trailer 2'),[transport.trailer_one,transport.trailer_two].filter(Boolean).join(' / ')||'—'],[t('运输商','Transporter'),transport.transporter||'—'],[t('集装箱号','Container No.'),transport.container_no||'—']]:[])],s);
  let currentTitle='',bagCard=null,transportDetails=null;
  for(const n of nodes){if(n.matches('.ux10-workflow')){P.move(n,shell,s);shell.insertBefore(n,left.parentElement);P.cls(n,'p46-flow',s);}
   else if(n.matches('h2,.co-execution-meta,.co-execution-progress'))P.hide(n,s);
   else if(n.matches('h3')){currentTitle=n.textContent.trim();P.hide(n,s);}
   else if(n.matches('.shipping-kpis,.v34-kpi-grid,.co-stock-metrics')){P.move(n,banner,s);P.cls(n,'r5-document-metrics',s);}
   else if(n.matches('#co-execution-actions,#co-execution-error'))P.move(n,actions,s);
   else if(n.matches('#co-metal-detail')){P.move(n,left,s);facts.after(n);}
   else if(n.matches('#edit-pending-load'))P.move(n,actionRow,s);
   else if(n.matches('.business-table,.table-scroll')&&!n.querySelector('form')){const table=n.querySelector('table'),isBags=table?.id==='co-execution-bags'||!!table?.querySelector('[data-bundle-id]')||!bagCard;const c=P.card(left,currentTitle||t(isBags?'装载实物明细':'审核记录',isBags?'Loaded Item Details':'Review Records'),s,'loading465-table');P.move(n,c,s);if(isBags){bagCard=c;actions.after(c);}currentTitle='';}
   else if(n.matches('.co-pager,.v34-pagination')&&bagCard)P.move(n,bagCard,s);
   else if(n.matches('#co-execution-exceptions,#ux11-load-corrections,#ux11-co-corrections'))addCorrection(n);
   else if(n===weightNode)continue;
   else if(n.matches('p.co-execution-policy'))P.hide(n,s);
   else if(n.matches('.lp-load-summary')){if(!transportDetails){transportDetails=P.el('details','loading465-transport',facts,s);const summary=P.el('summary','',transportDetails,s);summary.textContent=t('运输与装车计划资料','Transport and Loading Plan Details');}for(const child of [...n.children])if(!child.matches('h3'))P.move(child,transportDetails,s);P.hide(n,s);}
   else if(n.matches('#co-execution-departures,details,section.panel')){
    if(n.id==='co-execution-departures'&&!d.departures.length||n.querySelector('#co-execution-history')&&!d.history_total){P.hide(n,s);continue;}
    P.move(n,left,s);P.cls(n,'loading465-history',s);currentTitle='';
   }
   else if(n.matches('p')&&!co&&!n.className&&n.querySelectorAll('br').length>2)P.hide(n,s);
   else if(n.matches('input[type=hidden]'))P.move(n,actions,s);
   else if(n.matches('.error,[role=alert]'))P.move(n,left,s);
   else if(n.matches('.business-toolbar')){
    for(const control of [...n.children])P.move(control,actionRow,s);
    P.hide(n,s);
   }
   else if(n.matches('ol,ul')){
    if(n.children.length){const record=P.el('details','p46-card loading465-history',left,s);P.el('summary','',record,s).textContent=t('办理与审批记录','Activity and Review Records');P.move(n,record,s);}
    else P.hide(n,s);
   }
   else {if(n.matches('p,.co-execution-policy'))P.cls(n,'loading465-note',s);P.move(n,left,s);}}
  if(co)for(const n of root.querySelectorAll(':scope>#ux11-co-corrections'))addCorrection(n);
  if(corrections)left.append(corrections);
  if(co&&d.outbound&&AppConfig.cobaltPackingV44&&!actionRow.querySelector('[href$="/packing-list"]')){
   const link=P.el('a','button secondary',actionRow,s);
   link.href='/outbounds/'+id+'/packing-list';link.textContent=t('装箱单','Packing List');
  }
  if(!actionRow.children.length)P.hide(actionRow,s);
  if(!weightNode&&!actions.querySelector('button,input:not([type=hidden]),form,a'))P.hide(actions,s);
  P.finish(root,s);return true;
 }
};
