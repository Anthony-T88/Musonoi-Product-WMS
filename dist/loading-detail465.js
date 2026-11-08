'use strict';
window.LoadingDetails465={
 t:(z,e)=>I18n.language==='en'?e:z,
 matches(root){return ProductContext.isCopper()?/^\/outbounds\/loads\/[0-9a-f-]{36}$/.test(location.pathname):/^\/outbounds\/[0-9a-f-]{36}$/.test(location.pathname)&&!!root.querySelector('.co-execution-page');},
 compose(root,s){const P=UI46Pages,t=this.t,co=!ProductContext.isCopper(),id=location.pathname.split('/').pop(),d=co?CobaltExecutionUI.data:P.response(new RegExp('^/loads/'+id+'(?:\\?|$)'));if(!d||co&&d.order?.id!==id||!co&&d.id!==id)return false;
  s.composition.family='managed-document';root.dataset.pageFamily='managed-document';P.cls(root,'r5-document',s);P.cls(root,'loading465',s);const host=co?root.querySelector('.co-execution-page'):P.host(root),nodes=[...host.children],order=co?d.order:d,plan=co?d.outbound?.snapshot?.plan||d.plan:d.loading_plan||{},transport=co?d.outbound?.snapshot?.order?.transport_snapshot||order.transport_snapshot:plan,batch=co?d.plan.preparation_batch_no:d.lot_nos?.join(' / ')||d.lot_no||'—',customer=co?d.outbound?.snapshot?.customer?.name||d.plan.customer_name:d.customer_name,state=co?d.execution?.state||'WAITING':d.workflow_state||d.status;
  document.getElementById('business-title').textContent=t('装车单详情','Loading Order Details');UnifiedNavigation.title();
  const shell=P.el('div','p46-composition loading465-shell',host,s);s.composition.anchor=shell;s.composition.host=host;
  const banner=P.el('section','p46-document-banner loading465-banner',shell,s),top=P.el('div','',banner,s),kicker=P.el('p','r5-document-kicker',top,s);kicker.textContent=t('装车单详情','Loading Order Details');const h=P.el('h2','',top,s);h.dataset.noI18n='';h.textContent=batch;const status=P.el('span','r5-document-status',top,s);status.innerHTML=co?CobaltExecutionUI.state(state):UI.status(state,'loading',V26.states[state]);const meta=P.el('p','loading465-subtitle',top,s);meta.dataset.noI18n='';meta.textContent=customer||'—';const original=P.el('p','loading465-reference',banner,s);original.textContent=t('装车单号：','Loading Order: ')+order.code;original.dataset.noI18n='';
  const {left,aside}=P.grid(shell,s,true),facts=P.card(left,t('业务与车辆信息','Business and Vehicle Information'),s,'loading465-facts'),actions=P.card(aside,t('当前办理','Current Actions'),s,'loading465-actions');
  P.facts(facts,[[t('备货批次号','Preparation Batch'),batch],[t('客户','Customer'),customer],[t('装车单号','Loading Order No.'),order.code],[t('装箱单号','Packing List No.'),plan.packing_list_no||'—'],[t('车牌','Truck'),transport.truck_no||transport.vehicle_no||d.shipping_vehicle_no||order.vehicle_no||'—'],[t('司机','Driver'),transport.driver_name||'—'],[t('销售计划','Sales Plan'),co?d.plan.sales_plan_code:d.plan_code||plan.sales_plan_code||'—'],[t('创建时间','Created At'),order.created_at?BusinessTime.display(order.created_at):'—']],s);
  const weightNode=root.querySelector('[data-weight-warning]');let currentTitle='',bagCard=null,historyCard=null,transportDetails=null;for(const n of nodes){if(n.matches('.ux10-workflow')){P.move(n,shell,s);shell.insertBefore(n,left.parentElement);P.cls(n,'p46-flow',s);}
   else if(n.matches('h2,.co-execution-meta,.co-execution-progress'))P.hide(n,s);
   else if(n.matches('h3')){currentTitle=n.textContent.trim();P.hide(n,s);}
   else if(n.matches('.shipping-kpis,.v34-kpi-grid,.co-stock-metrics')){P.move(n,banner,s);P.cls(n,'r5-document-metrics',s);}
   else if(n.matches('#co-execution-actions')||n.matches('.business-toolbar')&&n.querySelector('[data-v26-action],#v26-departure-date')||n.matches('#edit-pending-load'))P.move(n,actions,s);
   else if(n.matches('.business-table,.table-scroll')&&!n.querySelector('form')){const table=n.querySelector('table'),isBags=table?.id==='co-execution-bags'||!!table?.querySelector('[data-bundle-id]')||!bagCard;const c=P.card(left,currentTitle||t(isBags?'装载实物明细':'审核记录',isBags?'Loaded Item Details':'Review Records'),s,'loading465-table');P.move(n,c,s);if(isBags)bagCard=c;currentTitle='';}
   else if(n.matches('.co-pager,.v34-pagination')&&bagCard)P.move(n,bagCard,s);
   else if(n.matches('#co-execution-exceptions,#ux11-load-corrections,#ux11-co-corrections')){const c=P.card(left,t('更正与异常办理','Corrections and Exceptions'),s,'loading465-corrections');P.move(n,c,s);}
   else if(n===weightNode){/* The native weight summary moves to the bottom action area below. */}
   else if(n.matches('.lp-load-summary')){if(!transportDetails){transportDetails=P.el('details','loading465-transport',facts,s);const summary=P.el('summary','',transportDetails,s);summary.textContent=t('运输与装车计划资料','Transport and Loading Plan Details');}for(const child of [...n.children])if(!child.matches('h3'))P.move(child,transportDetails,s);P.hide(n,s);}
   else if(n.matches('#co-execution-departures')||n.matches('details')||n.matches('section.panel')){const card=P.card(left,currentTitle||t('业务记录与历史','Business Records and History'),s,'loading465-history');P.move(n,card,s);currentTitle='';}
   else if(n.matches('p')&&!co&&!n.className&&n.querySelectorAll('br').length>2)P.hide(n,s);
   else if(n.matches('input[type=hidden]'))P.move(n,actions,s);
   else if(n.matches('.error,[role=alert]'))P.move(n,actions,s);
   else if(n.matches('.business-toolbar')){if(n.querySelector('a,button,input,select')){const card=P.card(aside,t('关联操作','Related Actions'),s,'loading465-related');P.move(n,card,s);}else P.hide(n,s);}
   else if(n.matches('ol,ul')){historyCard=historyCard||P.card(left,t('办理与审批记录','Activity and Review Records'),s,'loading465-history');P.move(n,historyCard,s);}
   else {if(n.matches('p,.co-execution-policy'))P.cls(n,'loading465-note',s);P.move(n,left,s);}}
  for(const n of [...root.children])if(n!==host&&!n.contains(host)&&!n.matches('[data-ui46-generated],.ux10-workflow')&&n.matches('#ux11-load-corrections,#ux11-co-corrections')){const c=P.card(left,t('更正与异常办理','Corrections and Exceptions'),s,'loading465-corrections');P.move(n,c,s);}
  if(!actions.querySelector('button,input:not([type=hidden]),form,a')){const p=P.el('p','loading465-note',actions,s);p.textContent=t('当前状态或账号没有待办理操作。审核及更正记录可在左侧查看。','No action is available for this state and account. Review and correction records remain on the left.');}
  // Keep the original controls and weight node, including their existing handlers and evidence.
  if(weightNode){const capacity=P.el('section','loading465-capacity',actions,s);P.move(weightNode,capacity,s);const heading=actions.querySelector(':scope>.p46-card-title');if(heading)heading.after(capacity);else actions.prepend(capacity);}
  P.cls(actions,'loading465-bottom-actions',s);shell.append(actions);if(!aside.children.length){P.hide(aside,s);left.parentElement.style.gridTemplateColumns='minmax(0,1fr)';}
  P.finish(root,s);return true;
 }
};
