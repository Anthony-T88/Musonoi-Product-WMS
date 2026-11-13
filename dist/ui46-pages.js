'use strict';
// Concrete page composition for the approved design system. Native forms,
// controls, tables and their event handlers are moved, never duplicated.
window.UI46Pages={
 t:(z,e)=>I18n.language==='en'?e:z,cache:new Map(),ready:false,
 init(){if(this.ready)return;this.ready=true;this.bindFieldValidation();Object.assign(TRANSLATIONS.en,{'计划发运数量（吨）':'Planned Shipment Quantity (MT)','计划备货批次数量':'Planned Lots','预计ARECOMS金属吨':'Planned ARECOMS MT','计划车辆数量':'Planned Vehicles','销售业务员提交 → 销售经理审批 → 商务部经理终审。终审通过后方可派车、备货或装车。':'Sales Operator → Sales Manager → Commercial Department Manager. Dispatch, preparation and loading require final approval.','提交销售经理审批':'Submit for Sales Approval','保存并重新提交审批':'Save and Resubmit for Approval','返回销售管理':'Back to Sales Plans','商务部经理终审':'Commercial Department Manager Review','销售经理审批':'Sales Manager Review','通过并送商务部经理审批':'Approve and Send to Commercial Manager','终审通过，完成创建':'Approve and Create','审批说明（驳回必填）':'Review Note (required when rejecting)','驳回业务员修改':'Return to Sales Operator','销售审批说明':'Sales Review Note','商务审批说明':'Commercial Review Note'});I18n.pattern=new RegExp(Object.keys(TRANSLATIONS.en).filter(Boolean).sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');const request=API.request.bind(API);API.request=async(url,options)=>{const key=this.signature(),data=await request(url,options);if((!options?.method||options.method==='GET')&&this.signature()===key&&!/^\/(auth|me|users|roles|product-context)/.test(url)){this.cache.set(url.split('?')[0],{key,data});if(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);}return data;};window.addEventListener('session-expired',()=>this.cache.clear());
  // Sales already has authorized server pagination. Do not paginate that page
  // again with the generic client-side table helper.
  if(typeof PageTables!=='undefined'){const enhance=PageTables.enhance.bind(PageTables);PageTables.enhance=()=>{if(UI46.enabled()&&!UI46.copperMap()){const table=document.getElementById('ux10-sales-table');if(table&&!table.dataset.v34Server){table.dataset.v34Server='true';table.dataset.p46Server='';}}enhance();if(UI46.state?.composition)this.normalize(UI46.state);};}
 },
 signature(){return (window.ProductContext?.code||'')+'|'+location.pathname+location.search;},
 chrome(enabled){const top=document.querySelector('.top-actions');if(!top)return;if(!enabled){if(this.chromeState){for(const {node,marker}of this.chromeState.moves.reverse())if(marker.isConnected)marker.replaceWith(node);document.removeEventListener('click',this.chromeState.outside);this.chromeState.menu.remove();this.chromeState=null;}return;}if(this.chromeState)return;
  const menu=document.createElement('details');menu.className='p46-account-menu';const summary=document.createElement('summary'),items=document.createElement('div');items.className='p46-account-items';menu.append(summary,items);top.append(menu);const moves=[];
  for(const [selector,target]of [['.avatar',summary],['#signed-user',summary],['#logout',items]]){const node=top.querySelector(selector);if(!node)continue;const marker=document.createComment('v46-header-position');node.before(marker);target.append(node);moves.push({node,marker});}
  menu.addEventListener('click',e=>{if(e.target.closest('button'))menu.open=false;});const outside=e=>{if(!menu.contains(e.target))menu.open=false;};document.addEventListener('click',outside);this.chromeState={menu,moves,outside};
 },
 family(root){const p=location.pathname,q=new URLSearchParams(location.search);
  if(root.id==='dashboard-content'||p==='/overview'&&!q.has('management'))return 'overview';
  if(p==='/stock-map')return 'map';
  if(root.querySelector('[data-operation-workspace]'))return 'workstation';
  if(/\/dispatch$/.test(p))return 'dispatch';
  if(p==='/workbench/permissions')return 'permissions';
  if(p==='/inventory')return 'inventory';
  if(p==='/reports')return 'reports';
  if(p==='/outbounds/templates'||p==='/outbounds/weight-settings'||p.endsWith('/warning-settings')||q.get('view')==='printers')return 'settings';
  if(p.endsWith('/import'))return 'import';
  if(q.has('editor')||/\/(new|edit|relocate|cancel)$/.test(p)||/^\/customers\/master-data\/[^/]+\//.test(p)||q.get('tab')==='arrivals'&&q.has('vehicle_id'))return 'form';
  if(p==='/customers')return 'customers';
  if(/\/history(?:-sampling)?$/.test(p)||p.includes('history-sampling'))return 'history';
  if(/\/sales-plans\/[0-9a-f-]{36}$/.test(p))return 'sales-detail';
  if(/\/work$/.test(p)||p.startsWith('/preparation/')||p.includes('/execution/')||/^\/stocktaking\/[0-9a-f-]{36}$/.test(p))return 'operation';
  if(p.includes('packing-list')||p.startsWith('/export-shipments/'))return 'archive';
  if(q.has('permit')||/\/[0-9a-f-]{36}$/.test(p)||p.startsWith('/inventory/'))return 'detail';
  if(p==='/audit')return 'audit';
  return root.querySelector('table')?'list':root.querySelector('form.user-form')?'form':'content';
 },
 valid(s){return s.anchor===s.composition?.anchor&&!!s.composition?.anchor?.isConnected&&(!s.composition.watch||s.composition.watch.every(n=>n.isConnected));},
 restore(s){window.Operations468R4?.restore(s);for(const r of s.composition?.classes||[])r.node.classList.remove(r.name);for(const r of s.composition?.hidden||[])r.node.hidden=r.old;for(const table of s.root.querySelectorAll('table[data-p46-server]')){delete table.dataset.v34Server;delete table.dataset.p46Server;}delete s.root.dataset.pageFamily;},
 cls(node,name,s){if(!node||node.classList.contains(name))return;node.classList.add(name);s.composition.classes.push({node,name});},
 hide(node,s){if(!s.composition.hidden.some(r=>r.node===node))s.composition.hidden.push({node,old:node.hidden});node.hidden=true;},
 el(tag,cls,parent,s){return UI46.generated(tag,cls,parent,s);},
 move(node,parent,s){if(node&&node!==parent&&!node.contains?.(parent))UI46.move(node,parent,s);},
 head(parent,text,s,tag='h2'){const h=this.el(tag,'p46-card-title',parent,s);h.textContent=text;return h;},
 card(parent,title,s,kind=''){
  const c=this.el('section','p46-card '+kind,parent,s),main=document.getElementById('business-title')?.textContent.trim();
  if(title&&title.trim()!==main)this.head(c,title,s);
  return c;
 },
 host(root){return root.querySelector('.ux10-sales,.co-sales-page,.co-reports-page,.co-execution-page,.co-count-page,.co-preparation-detail,.co-work-page,.co-stock-page,.gate-page')||root.querySelector(':scope>.co-page')||root;},
 compose(root,s){s.composition={classes:[],hidden:[],watch:[],family:this.family(root)};s.root.dataset.pageFamily=s.composition.family;this.cls(root,'p46-root',s);
  const composed=root.querySelector(':scope > [data-page-composed]');
  if(composed){s.composition.anchor=composed;this.finish(root,s);return;}
  if(window.Operations468R4?.compose(root,s))return;
  if(window.LoadingDetails465?.matches(root)&&LoadingDetails465.compose(root,s))return;
  if(window.DocumentLayouts?.matches(root)){DocumentLayouts.compose(root,s);return;}const f=s.composition.family;if(f==='workstation'){this.workstation(root,s);return;}
  if(f==='overview'){this.overview(root,s);return;}
  if(f==='inventory'){this.inventory(root,s);return;}
  if(f==='customers'){UI46.customerSections(root,s);this.decorate(root,s);this.finish(root,s);return;}
  if(location.pathname==='/loading-plans'&&!new URLSearchParams(location.search).has('vehicle_id'))this.cls(root,'p46-arrivals',s);
  if(f==='reports'){this.cls(root,'p46-reports',s);this.finish(root,s);return;}
  if(f==='map'){this.decorate(root,s);this.finish(root,s);return;}
  const host=this.host(root);s.composition.host=host;this.cls(host,'p46-host',s);const nodes=[...host.childNodes].filter(n=>n.nodeType===1||n.nodeType===3&&n.textContent.trim());s.composition.original=nodes;
  const shell=this.el('div','p46-composition p46-'+f,host,s);s.composition.anchor=shell;
  const flow=root.querySelector('.ux10-workflow');if(flow&&!shell.contains(flow))this.move(flow,shell,s);
  if(f==='dispatch'){if(flow)this.hide(flow,s);this.dispatch(host,nodes,shell,s);}
  else if(f==='form'||f==='import'){this.form(host,nodes,shell,s);}
  else if(f==='settings'){this.settings(host,nodes,shell,s);}
  else if(f==='sales-detail'||f==='detail'||f==='operation'||f==='archive'||f==='history'){this.detail(host,nodes,shell,s,f);}
  else if(f==='permissions'){this.permissions(host,nodes,shell,s);}
  else this.list(host,nodes,shell,s);
  // Root-level contextual corrections and histories belong to this document.
  for(const n of [...root.children])if(n!==host&&!n.contains(host)&&n!==shell&&!n.matches('[data-ui46-generated]')&&!shell.contains(n)&&!n.matches('.ux10-workflow')){if(n.matches('#ux11-load-corrections,#ux11-co-corrections'))this.move(n,s.composition.left||shell,s);}
  this.decorate(shell,s);this.finish(root,s);
 },
 // Values passed as markup have already been escaped by the document renderer.
 factList(entries){
  return '<dl class="wms-facts">'+entries.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>';
 },
 identity(title,status,actions,summary,classes=''){
  return '<section class="panel wms-identity wms-section '+classes+'" data-no-i18n><header><div><h2>'+esc(title)+'</h2>'+status+'</div>'+
   (actions?'<div class="business-toolbar wms-document-actions">'+actions+'</div>':'')+'</header>'+summary+'</section>';
 },
 table(html,{responsive=false,numeric=[],center=[],actions=[]}={}){
  const template=document.createElement('template');
  template.innerHTML=html;
  const table=template.content.querySelector('table'),head=table.tHead.rows[0];
  table.classList.add('wms-table');
  if(responsive)table.classList.add('permit-sales-table');
  for(const [index,column] of [...head.cells].entries()){
   column.scope='col';
   const kind=numeric.includes(index)?'number':center.includes(index)?'center':actions.includes(index)?'actions':null;
   if(kind)column.dataset.wmsColumn=kind;
  }
  for(const row of table.tBodies[0].rows){
   if(row.cells.length!==head.cells.length)continue;
   for(const [index,cell] of [...row.cells].entries()){
    const column=head.cells[index];
    if(column.dataset.wmsColumn)cell.dataset.wmsColumn=column.dataset.wmsColumn;
    if(!responsive)continue;
    cell.dataset.label=column.textContent;
    const value=document.createElement('div');
    value.append(...cell.childNodes);cell.append(value);
   }
  }
  return template.innerHTML;
 },
 bindFieldValidation(){
  let next=0;
  const feedback=new WeakMap();
  document.addEventListener('invalid',event=>{
   const control=event.target,field=control.closest('form[data-wms-validation] .wms-field');
   if(!field||!control.validity||control.getAttribute('aria-invalid')==='true'&&!feedback.has(control))return;
   let message=feedback.get(control);
   if(!message){
    message=document.createElement('small');
    message.id='wms-field-error-'+(++next);
    message.className='wms-field-error';
    field.append(message);
    control.setAttribute('aria-describedby',[control.getAttribute('aria-describedby'),message.id].filter(Boolean).join(' '));
    feedback.set(control,message);
   }
   event.preventDefault();
   message.textContent=control.validity.valueMissing
    ?control.matches('select')?this.t('请选择此项。','Select a value.'):this.t('请填写此项。','Enter a value.')
    :this.t('请核对输入格式和允许范围。','Check the input format and allowed range.');
   message.hidden=false;
   control.setAttribute('aria-invalid','true');
   if(control.form.querySelector('.wms-field :invalid')===control)control.focus();
  },true);
  const clear=event=>{
   const control=event.target,message=feedback.get(control);
   if(!message)return;
   message.hidden=true;
   message.textContent='';
   control.removeAttribute('aria-invalid');
  };
  document.addEventListener('input',clear);
  document.addEventListener('change',clear);
 },
 async submit(event,run){
  event.preventDefault();
  const form=event.target,button=event.submitter,error=form.querySelector('[role="alert"]');
  if(form.getAttribute('aria-busy')==='true')return;
  form.setAttribute('aria-busy','true');
  if(button)button.disabled=true;
  if(error)error.textContent='';
  try{await run();}
  catch(err){if(error)error.textContent=err.message;else notify(err.message);}
  finally{
   form.removeAttribute('aria-busy');
   if(button?.isConnected)button.disabled=false;
  }
 },
 alignControls(root,s){
  if(location.pathname.startsWith('/stock-map'))return;
  const forms=root.querySelectorAll('form.filters,form[id$="-filter"],.user-form .form-grid:not(.permit-books)');
  for(const node of forms){
   if(!node.querySelector('label input,label select,label textarea'))continue;
   if(!node.matches('form')){
    if(node.querySelector(':scope > label'))this.cls(node,'wms-field-grid',s);
    continue;
   }
   const direct=node.querySelector(':scope > label'),fields=node.querySelector(':scope > .form-grid');
   if(!direct&&!fields)continue;
   this.cls(node,'wms-filter-row',s);
   let actions=node.querySelector(':scope > .wms-filter-actions,:scope > .business-toolbar,:scope > .s468-filter-actions,:scope > .c461-filter-actions');
   if(!actions){
    const children=[...node.children];
    const index=children.findIndex(el=>el.matches('button[type=submit],button:not([type])'));
    if(index!==-1){
     const controls=[];
     for(const el of children.slice(index)){
      if(!el.matches('button,a.button'))break;
      controls.push(el);
     }
     actions=this.el('div','wms-filter-actions',node,s);
     for(const control of controls)this.move(control,actions,s);
    }
   }
   if(actions)this.cls(actions,'wms-filter-actions',s);
  }
 },
 finish(root,s){this.alignControls(root,s);if(!s.composition.anchor)s.composition.anchor=s.generated.find(n=>n.isConnected)||root.firstElementChild;s.anchor=s.composition.anchor;for(const form of root.querySelectorAll('form'))if(!form.closest('[hidden]')&&!form.matches('.filters,form[id$="-filter"]'))s.composition.watch.push(form);this.normalize(s);},
 grid(shell,s,right=true){const grid=this.el('div','p46-grid'+(right?'':' p46-full'),shell,s),left=this.el('div','p46-main',grid,s),aside=right?this.el('aside','p46-aside',grid,s):null;s.composition.left=left;s.composition.aside=aside;return {grid,left,aside};},
 isFilter(n){return n.nodeType===1&&n.matches('form.filters,form[id$="-filter"],form.account-toolbar,.filters,.co-stock-filter');},
 isStats(n){return n.nodeType===1&&n.matches('.shipping-kpis,.yard-counts,.co-stock-metrics,.co-report-metrics,.v34-kpi-grid,.v34-summary,.v261-summary,.receipt-bundle-total');},
 isTable(n){return n.nodeType===1&&n.matches('.business-table,.v34-table-wrap,.account-table-scroll,.table-scroll');},
 isPager(n){return n.nodeType===1&&n.matches('.v34-pagination,.pagination,.co-pagination,.co-pager');},
 list(host,nodes,shell,s){const tools=this.el('div','p46-toolbar',shell,s),filters=[],tail=[];let title='';
  for(const n of nodes){if(n.nodeType!==1){tail.push(n);continue;}if(n.matches('.ux10-workflow')){this.hide(n,s);continue;}if(n.matches('.business-toolbar')&&!this.isFilter(n)){this.move(n,tools,s);continue;}if(this.isFilter(n)){filters.push(n);continue;}tail.push(n);}
  if(!tools.textContent.trim())tools.hidden=true;
  const sales=this.response(/sales-workflow\/plans$/);if(location.pathname==='/sales-plans'&&sales?.summary)this.stats(shell,[['计划总数','Plans',sales.summary.all],['待审批','Pending Approval',Number(sales.summary.sales_pending||0)+Number(sales.summary.commerce_pending||0)],['执行中','Open',sales.summary.open]],s);
  if(location.pathname.startsWith('/loading-plans'))for(const n of tail.filter(n=>this.isStats(n))){this.cls(n,'p46-stat-strip',s);this.move(n,shell,s);}
  for(const form of filters){this.cls(form,'p46-filter',s);this.move(form,shell,s);}
  let card=null;for(const n of tail){if(shell.contains(n))continue;if(n.nodeType===1&&/^H[23]$/.test(n.tagName)){title=n.textContent.trim();this.hide(n,s);continue;}if(this.isStats(n)){this.cls(n,'p46-stat-strip',s);this.move(n,shell,s);continue;}if(this.isTable(n)){if(!card||card.querySelector('table'))card=this.card(shell,title||document.getElementById('business-title').textContent,s,'p46-table-card');this.move(n,card,s);continue;}if(n.nodeType===1&&n.matches('.v34-table-tools')){if(!card)card=this.card(shell,title||this.t('业务记录','Records'),s,'p46-table-card');this.move(n,card,s);continue;}if(this.isPager(n)){this.move(n,card||shell,s);continue;}if(n.nodeType===1&&n.matches('p')&&!n.classList.contains('error')){const note=this.card(shell,'',s,'p46-note');this.move(n,note,s);continue;}if(n.nodeType===1&&n.matches('#account-content')){this.move(n,shell,s);this.cls(n,'p46-account-content',s);continue;}if(n.nodeType===1&&n.matches('form')){card=this.card(shell,title||this.t('业务信息','Business Information'),s);this.move(n,card,s);continue;}if(n.nodeType===1&&n.matches('dl')){card=this.card(shell,title||this.t('摘要','Summary'),s);this.move(n,card,s);this.cls(n,'p46-facts',s);continue;}this.move(n,card||shell,s);}
 },
 response(pattern){for(const [url,{key,data}]of [...this.cache].reverse())if(key===this.signature()&&pattern.test(url))return data;return null;},
 record(){const id=location.pathname.split('/').filter(x=>/^[0-9a-f-]{36}$/i.test(x)).pop();for(const [url,{key,data}]of [...this.cache].reverse()){if(key!==this.signature()||!data||typeof data!=='object'||Array.isArray(data)||data.items&&!data.task||id&&!url.includes(id)||/options|eligibility|weight|corrections/.test(url))continue;const choices=[data.plan,data.receipt,data.order,data.lot,data.allocation,data.load,data.document,data.batch,data.stocktake,data.preparation,data.task,data.header,data];const hit=choices.find(x=>x&&typeof x==='object'&&!Array.isArray(x)&&(x.code||x.lot_no||x.preparation_batch_no||x.document_no));if(hit)return hit;}return null;},
 banner(shell,nodes,s,record=this.record()){const found=nodes.find(n=>n.nodeType===1&&n.matches('h2')&&n.textContent.trim()),contextCode=nodes.find(n=>n.nodeType===1&&n.matches('.lp-context,.lot-context-grid'))?.textContent.match(/\b(?:CO-)?SP-[A-Za-z0-9/-]+\b/)?.[0],code=record?.lot_no||record?.code||record?.preparation_batch_no||record?.document_no||found?.textContent.trim()||contextCode;if(!code)return null;
  const banner=this.el('section','p46-document-banner',shell,s);shell.prepend(banner);const heading=this.el('div','p46-document-heading',banner,s);this.head(heading,code,s);const state=nodes.find(n=>n.nodeType===1&&n.matches('.ux10-plan-state,.co-state,.v34-state,.status-pill'));if(state){this.move(state,heading,s);this.cls(state,'p46-document-state',s);}const p=this.el('p','p46-document-meta',heading,s),meta=[ProductContext.isCopper()?this.t('阴极铜','Copper Cathodes'):this.t('氢氧化钴','Cobalt Hydroxide'),record?.customer_name,record?.shipment_month||record?.business_date||record?.production_date].filter(Boolean);p.textContent=meta.join(' · ');if(found)this.hide(found,s);return banner;},
 factsFrom(form){const rows=[];for(const control of form.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')){const label=UI46.fieldLabel(control),value=control.tagName==='SELECT'?(control.value?control.selectedOptions[0]?.textContent:''):control.value;if(label&&value?.trim())rows.push([label.replace(/\*\s*$/,''),value.trim()]);}return rows;},
 facts(parent,rows,s){const dl=this.el('dl','p46-facts',parent,s);for(const [k,v]of rows){const row=this.el('div','p46-fact',dl,s),dt=this.el('dt','',row,s),dd=this.el('dd','',row,s);dt.textContent=k;dd.textContent=v;dd.dataset.noI18n='';}return dl;},
 form(host,nodes,shell,s){const forms=nodes.filter(n=>n.nodeType===1&&n.matches('form')&&!this.isFilter(n));if(!forms.length){const native=host.querySelector('form.user-form,form:not(.filters)');if(native)forms.push(native);}const {left,aside}=this.grid(shell,s);const used=new Set();
  for(const form of forms){const card=this.card(left,this.t('业务信息','Business Information'),s,'p46-form-card');this.move(form,card,s);this.arrangeForm(form,s);used.add(form);s.form=form;s.summary=this.card(aside,this.t('填写摘要','Entry Summary'),s,'ui46-entry-summary');UI46.summary(s);}
  const tool=this.el('div','p46-toolbar',left,s);for(const n of nodes){if(used.has(n)||n.matches?.('.ux10-workflow')||shell.contains(n))continue;if(n.nodeType===1&&n.matches('.business-toolbar'))this.move(n,tool,s);else if(n.nodeType===1&&n.matches('p')&&!n.classList.contains('error')){const note=this.card(aside,this.t('填写说明','Guidance'),s,'p46-guidance');this.move(n,note,s);}else this.move(n,left,s);}if(!tool.textContent.trim())tool.hidden=true;
 },
 arrangeForm(form,s){this.cls(form,'p46-native-form',s);for(const grid of form.querySelectorAll('.form-grid'))this.cls(grid,'p46-field-grid',s);
  // Group the actual labels without moving controls outside their form.
  const grid=[...form.querySelectorAll('.form-grid')].find(g=>g.children.length>=4&&!g.closest('table'));if(grid&&!grid.querySelector('table')){const labels=[...grid.children].filter(n=>n.matches('label')),groups=[[],[]];for(const label of labels){const input=label.querySelector('input,select,textarea'),text=UI46.fieldLabel(input||label);groups[/数量|吨|重量|净重|毛重|车辆数|容差|溢短|Quantity|Weight|Vehicles|Tolerance|MT/i.test(text)||/^(target_weight|quantity_tolerance|planned_.*(?:count|mt)|total_bags)$/.test(input?.name)?1:0].push(label);}if(groups.every(g=>g.length)){const wrapper=this.el('div','p46-form-sections',grid,s);for(const [i,items]of groups.entries()){const section=this.el('section','p46-form-section',wrapper,s);this.head(section,this.t(i?'02  数量与执行要求':'01  基本信息',i?'02  Quantity & Requirements':'01  Basic Information'),s);const fields=this.el('div','p46-field-grid',section,s);for(const n of items)this.move(n,fields,s);}this.cls(grid,'p46-section-host',s);}}
  for(const container of [form,...form.querySelectorAll('fieldset')]){const buttons=[...container.children].filter(n=>n.matches('button,.business-toolbar')&&!n.querySelector('input,select,textarea'));if(buttons.length){const footer=this.el('div','p46-form-footer',container,s);for(const n of buttons)this.move(n,footer,s);}}
 },
 detail(host,nodes,shell,s,family){const record=this.record(),path=location.pathname;
  const planDetail=/^\/loading-plans\/(?:orders\/)?[0-9a-f-]{36}$/.test(path);
  if(!planDetail&&(!ProductContext.isCopper()||!/^\/preparation\/[0-9a-f-]{36}$/.test(path)))this.banner(shell,nodes,s,record);
  if(planDetail)this.cls(s.root,'loading-plan-detail',s);const flow=shell.querySelector('.ux10-workflow');if(flow)this.cls(flow,'p46-flow',s);const mainOnly=ProductContext.isCopper()&&/^\/preparation\/[0-9a-f-]{36}$/.test(location.pathname)||/^\/loading-plans\/(?:orders\/)?[0-9a-f-]{36}$/.test(location.pathname),{left,aside}=this.grid(shell,s,!mainOnly),side=aside||left,sales=family==='sales-detail',used=new Set();
  const review=host.querySelector('.ux10-review');if(review){const card=this.card(side,this.t('当前办理','Current Actions'),s,'p46-action-card');this.move(review,card,s);used.add(review);}
  const form=host.querySelector('#ux10-plan-form');if(sales&&form){const card=this.card(left,this.t('基本信息','Basic Information'),s);this.facts(card,this.factsFrom(form),s);const editable=!!form.querySelector('button[type=submit],button:not([type])');if(editable){const editor=this.el('details','p46-edit-section',left,s),summary=this.el('summary','',editor,s);summary.textContent=this.t('编辑计划信息','Edit Plan Information');this.move(form,editor,s);this.arrangeForm(form,s);}else{this.move(form,shell,s);this.hide(form,s);}used.add(form);}
  let content=null;for(const n of nodes){if(used.has(n)||n===flow||n.matches?.('.ux10-plan-state')||n.matches?.('h2')&&n.hidden||n===review||used.has(n.parentElement)||shell.contains(n)&&n.parentElement!==host)continue;
   if(n.nodeType===1&&n.matches('dl')){const card=this.card(n.matches('.ux10-plan-audit')?side:left,this.t(n.matches('.ux10-plan-audit')?'审批记录':n.matches('.lp-fields')?'装车与运输资料':'基本信息',n.matches('.ux10-plan-audit')?'Approval Records':n.matches('.lp-fields')?'Loading and Transport':'Basic Information'),s);this.move(n,card,s);this.cls(n,'p46-facts-native',s);continue;}
   if(n.nodeType===1&&n.matches('.lp-context,.lot-context-grid,.lp-load-summary')&&!n.querySelector('table,form')){const card=this.card(left,this.t('单据信息','Document Information'),s);this.move(n,card,s);this.cls(n,'p46-context',s);continue;}
   if(n.nodeType===1&&n.matches('.business-toolbar')&&n.querySelector('[data-v26-action],[data-sales-review],[data-count-action],#gate-confirm-exit')){const action=side.querySelector('.p46-action-card')||this.card(side,this.t('当前办理','Current Actions'),s,'p46-action-card');this.move(n,action,s);continue;}
   if(n.nodeType===1&&n.matches('form')&&!this.isFilter(n)){const action=!!n.querySelector('button[data-count-action],button[data-review]')||/review|approval|gate-exit|complete/i.test(n.id);const card=this.card(action?side:left,this.t(action?'当前办理':'业务作业',action?'Current Actions':'Operations'),s,action?'p46-action-card':'');this.move(n,card,s);this.arrangeForm(n,s);continue;}
   if(n.nodeType===1&&/^H[23]$/.test(n.tagName)){content=this.card(left,n.textContent.trim(),s);this.hide(n,s);continue;}
   if(n.nodeType===1&&n.matches('ol')&&!n.matches('.ux10-workflow ol')){const card=this.card(side,this.t('办理记录','Activity'),s,'p46-activity');this.move(n,card,s);continue;}
   if(this.isStats(n)){this.cls(n,'p46-stat-strip',s);this.move(n,left,s);continue;}
   if(this.isTable(n)){if(!content)content=this.card(left,this.t('业务明细','Business Details'),s,'p46-table-card');this.move(n,content,s);continue;}
   if(n.nodeType===1&&n.matches('p')&&!n.classList.contains('error')){if(!n.textContent.trim())continue;const note=this.card(left,'',s,'p46-note');this.move(n,note,s);continue;}
   if(n.nodeType===1&&n.matches('.business-toolbar')){const toolbar=this.el('div','p46-toolbar',left,s);this.move(n,toolbar,s);if(planDetail){this.cls(toolbar,'loading-plan-actions',s);left.prepend(toolbar);}continue;}
   this.move(n,content||left,s);
  }
  if(aside&&!aside.children.length){this.hide(aside,s);this.cls(aside.parentElement,'p46-full',s);}
 },
 dispatch(host,nodes,shell,s){this.banner(shell,nodes,s);const toolbar=this.el('div','p46-toolbar',shell,s),filter=nodes.find(n=>this.isFilter(n)),stats=nodes.find(n=>this.isStats(n));for(const n of nodes)if(n.matches?.('.business-toolbar')&&!this.isFilter(n))this.move(n,toolbar,s);
  if(stats){this.cls(stats,'p46-stat-strip',s);this.move(stats,shell,s);}if(filter){this.cls(filter,'p46-filter',s);this.move(filter,shell,s);}
  const {left,aside}=this.grid(shell,s),form=host.querySelector('#dispatch-form,#co-dispatch-form,form.user-form:not(.filters)'),importBox=form?.closest('.lp-load-summary,section')||form;if(importBox){const card=this.card(left,this.t('导入客户派车单','Import Dispatch File'),s,'p46-import');this.move(importBox,card,s);this.arrangeForm(form,s);}
  const card=this.card(left,this.t('派车记录','Dispatch Records'),s,'p46-table-card');let guidance;for(const n of nodes){if(shell.contains(n)||n.matches?.('.ux10-workflow'))continue;if(n.matches?.('.lp-context,.lot-context-grid')){const summary=this.card(aside,this.t('关联销售计划','Related Sales Plan'),s);this.move(n,summary,s);this.cls(n,'p46-context',s);}else if(n.matches?.('h3'))this.hide(n,s);else if(n.matches?.('p')&&!n.classList.contains('error')){if(/暂无|No .*record|No Record/i.test(n.textContent)){this.move(n,card,s);this.cls(card,'p46-empty',s);}else{guidance||=this.card(aside,this.t('派车规则','Dispatch Rules'),s,'p46-guidance');this.move(n,guidance,s);}}else this.move(n,card,s);}
  if(!aside.querySelector('.p46-context')){const plan=this.record();if(plan){const summary=this.card(aside,this.t('关联销售计划','Related Sales Plan'),s),rows=[[this.t('计划号','Plan'),plan.code],[this.t('客户','Customer'),plan.customer_name],[this.t('合同号','Contract'),plan.contract_no],[this.t('发运月份','Shipment Month'),plan.shipment_month]].filter(([,value])=>value);this.cls(this.facts(summary,rows,s),'p46-context',s);aside.prepend(summary);}}
  // Dispatch has no separate six-step outbound approval. It inherits its plan.
  for(const flow of shell.querySelectorAll('.ux10-workflow'))this.hide(flow,s);
 },
 settings(host,nodes,shell,s){const {left,aside}=this.grid(shell,s);const nav=this.card(aside,this.t('设置导航','Settings'),s,'p46-settings-nav');for(const [label,href]of [[this.t('装箱单模板','Packing Template'),'/outbounds/templates'],[this.t('车辆净重预警','Net Weight Warning'),'/outbounds/weight-settings']]){if(location.pathname.startsWith('/outbounds/')){const a=this.el('a','p46-related-link',nav,s);a.href=href;a.textContent=label;}}let card=null;for(const n of nodes){if(n.matches?.('form')&&!this.isFilter(n)){card=this.card(left,document.getElementById('business-title').textContent,s,'p46-form-card');this.move(n,card,s);this.arrangeForm(n,s);}else if(n.matches?.('h2,h3')){card=this.card(left,n.textContent,s);this.hide(n,s);}else if(n.matches?.('p')){const note=this.card(aside,'',s,'p46-guidance');this.move(n,note,s);}else if(n.matches?.('.business-toolbar')){const tools=this.el('div','p46-toolbar',shell,s);shell.prepend(tools);this.move(n,tools,s);}else this.move(n,card||left,s);}if(nav.children.length<=1)nav.hidden=true;},
 permissions(host,nodes,shell,s){for(const n of nodes)this.move(n,shell,s);const layout=shell.querySelector('.account-role-layout');if(layout)this.cls(layout,'p46-permissions',s);const form=shell.querySelector('#account-role-form');if(form){this.cls(form,'p46-permission-form',s);for(const fieldset of form.querySelectorAll('fieldset'))this.cls(fieldset,'p46-permission-group',s);}},
 stats(parent,items,s){const strip=this.el('div','p46-stats',parent,s);for(const [z,e,value]of items){const cell=this.el('div','p46-stat',strip,s),label=this.el('span','',cell,s),strong=this.el('strong','',cell,s);label.textContent=this.t(z,e);strong.textContent=value==null?'—':String(value);}return strip;},
 workstation(root,s){const workspace=root.querySelector('[data-operation-workspace]');this.cls(workspace,'p46-workstation',s);const heading=workspace.querySelector('.op-heading'),split=workspace.querySelector('.op-split');if(split)for(const selector of ['.op-heading','.op-stats','.op-filter']){const node=workspace.querySelector(selector);if(node){this.move(node,workspace,s);workspace.insertBefore(node,split);}}s.composition.anchor=heading||workspace;s.anchor=s.composition.anchor;OperationWorkspace.fit(OperationWorkspace.active);},
 overview(root,s){const analysis=root.querySelector('[data-overview-analysis]');if(analysis){s.composition.anchor=analysis;this.finish(root,s);return;}const host=root.querySelector('.co-overview-page')||root;UI46.overviewLayout(host,s);this.cls(root,'p46-overview',s);for(const section of root.querySelectorAll('.v34-overview-section')){const grid=section.querySelector(':scope>.v34-kpi-grid');if(grid){this.cls(grid,'p46-stat-strip',s);this.cls(section,'p46-overview-metrics',s);}}this.decorate(root,s);this.finish(root,s);},
 inventory(root,s){this.cls(root,'p46-inventory',s);for(const section of root.querySelectorAll(':scope>.panel'))this.cls(section,'p46-card',s);for(const n of root.querySelectorAll('.metrics,.metric-grid,.inventory-metrics'))this.cls(n,'p46-stat-strip',s);this.finish(root,s);},
 
 decorate(root,s){for(const n of root.querySelectorAll('form.filters,form[id$="-filter"]'))if(!n.classList.contains('wms-map-filter-row'))this.cls(n,'p46-filter',s);for(const n of root.querySelectorAll('.business-table,.table-scroll,.account-table-scroll'))this.cls(n,'p46-table-wrap',s);for(const n of root.querySelectorAll('.co-stock-metrics,.co-report-metrics,.shipping-kpis,.yard-counts'))this.cls(n,'p46-stat-strip',s);for(const n of root.querySelectorAll('dl:not(.p46-facts,.v470-lot-plan-grid,.wms-facts)'))if(!n.closest('.map465-detail-body'))this.cls(n,'p46-facts-native',s);for(const n of root.querySelectorAll('.ux10-workflow'))this.cls(n,'p46-flow',s);},
 normalize(s){const root=s.root;if(!s.composition)return;for(const form of root.querySelectorAll('form[data-v34-reset]')){const original=form.querySelector('a[href],button[type=reset]');if(original&&/重置|清除|Reset|Clear/i.test(original.textContent))for(const b of [...form.children].filter(n=>n.matches('button[type=button]')&&!n.id&&/清除条件|Clear (Filters|Conditions)/i.test(n.textContent)))this.hide(b,s);}
  const sales=root.querySelector('#ux10-sales-table');if(sales&&root.querySelector('.co-pager')){for(const pager of root.querySelectorAll('.v34-pagination'))this.hide(pager,s);for(const row of sales.tBodies[0]?.rows||[])if(row.hidden){if(!s.composition.hidden.some(r=>r.node===row))s.composition.hidden.push({node:row,old:true});row.hidden=false;}}
 },
 refresh(s){window.Operations468R4?.refresh(s);if(s.composition.family==='managed-document')DocumentLayouts.fitPacking(s.root);if(s.form)UI46.summary(s);this.normalize(s);},
};
