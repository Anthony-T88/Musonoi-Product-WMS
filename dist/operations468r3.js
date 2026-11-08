'use strict';
// Recompose the existing arrival form, retaining its actual inputs, validation,
// versions, confirmation dialog and submit handler.
window.Operations468R3={
 t:(z,e)=>I18n.language==='en'?e:z,
 arrival(host,nodes,shell,s){const form=host.querySelector('#yard-arrival-form,#co-arrival-form');if(!form)return false;const P=UI46Pages,t=this.t,panel=P.el('section','o468r3-arrival',shell,s);s.composition.host=host;s.form=form;s.summary=null;
  const context=nodes.find(n=>n.nodeType===1&&n.matches('.lot-context-grid,.lp-context'));if(context){P.move(context,panel,s);P.cls(context,'o468r3-context',s);P.cls(context,'u468-arrival-context',s);const entries=[...context.querySelectorAll('article')],order=form.id==='co-arrival-form'?[0,3,1]:[0,1,2],chosen=order.map(i=>entries[i]).filter(Boolean);for(const n of entries)if(!chosen.includes(n))P.hide(n,s);for(const n of chosen)P.move(n,context,s);}
  P.move(form,panel,s);P.cls(form,'o468r3-form',s);form.dataset.b461Arranged='true';(s.composition.businessForms||=[]).push(form);
  const oldGrids=[...form.querySelectorAll('.form-grid')],grid=P.el('div','o468r3-columns',form,s),left=P.el('section','o468r3-group',grid,s),right=P.el('section','o468r3-group',grid,s);for(const [parent,zh,en]of [[left,'车辆与到达时间','Vehicle and Arrival'],[right,'司机与证件','Driver and Documents']]){const heading=P.head(parent,t(zh,en),s);heading.dataset.c461Zh=zh;heading.dataset.c461En=en;}const a=P.el('div','o468r3-fields',left,s),b=P.el('div','o468r3-fields',right,s),moved=new Set();
  for(const key of ['arrived_at','trailer_one','trailer_two','container_no','driver_name','passport_no','transporter','exception_remark']){const control=form.elements.namedItem(key),label=control?.closest('label');if(!label||moved.has(label))continue;P.move(label,['arrived_at','trailer_one','trailer_two','container_no'].includes(key)?a:b,s);if(control.tagName==='TEXTAREA'||key==='exception_remark')P.cls(label,'o468r3-wide',s);moved.add(label);}
  for(const label of [...form.querySelectorAll('label')].filter(n=>!grid.contains(n)))P.move(label,b,s);for(const old of oldGrids)if(!old.querySelector('input,select,textarea'))P.hide(old,s);form.prepend(grid);
  const footer=P.el('div','o468r3-footer',form,s);for(const node of [...form.children])if(node!==footer&&node.matches('button,.business-toolbar,.error,[role=alert]'))P.move(node,footer,s);
  for(const node of nodes){if(node===form||node===context||shell.contains(node)||node.nodeType!==1)continue;if(node.matches('p:not(.error)'))P.hide(node,s);else if(node.matches('.ux10-workflow'))P.hide(node,s);else{const history=P.el('details','o468r3-history',panel,s);const summary=P.el('summary','',history,s);summary.textContent=t('登记记录','Arrival History');summary.dataset.c461Zh='登记记录';summary.dataset.c461En='Arrival History';P.move(node,history,s);}}
  return true;
 }
};
