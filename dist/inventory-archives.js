'use strict';
window.InventoryArchives={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 text:value=>value==null||value===''?'—':esc(value),
 time(value){return !value?'—':/^\d{4}-\d{2}-\d{2}$/.test(value)?esc(value):esc(BusinessTime.display(value));},
 facts(rows){return UI46Pages.factList(rows.map(([zh,en,value])=>[this.t(zh,en),this.text(value)]));},
 table(head,rows){
  if(!rows.length)return '<p class="wms-feedback">'+this.t('暂无记录','No records')+'</p>';
  const labels=head.map(([zh,en])=>this.t(zh,en));
  const markup='<table><thead><tr>'+labels.map(label=>'<th>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+
   rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  return '<div class="business-table">'+UI46Pages.table(markup,{responsive:true,center:labels.map((_,i)=>i)})+'</div>';
 },
 section(zh,en,html){return '<section class="panel wms-section"><h2>'+this.t(zh,en)+'</h2>'+html+'</section>';},
 documentState(state){
  const labels={CONFIRMED:['已确认','Confirmed'],OUTBOUND:['已正式出库','Formally Outbound'],FULFILLED:['已完成','Fulfilled'],
   PREPARED:['已备货','Prepared'],ARCHIVED:['已归档','Archived'],DRAFT:['草稿','Draft'],OPEN:['执行中','Open'],
   APPROVED:['已通过','Approved'],MATCHED:['已匹配','Matched'],CANCELLED:['已取消','Cancelled'],RECEIVED:['已入库','Received']};
  return labels[state]?this.t(...labels[state]):I18n.translate(state||'—',true);
 },
 link(path){
  if(!path||!path.startsWith('/')||path.startsWith('//'))return false;
  const url=new URL(path,location.origin);
  if(url.origin!==location.origin)return false;
  const perm=Router.permission(url.pathname);
  return !!perm&&Business.can(perm);
 },
 action(path){return this.link(path)?'<a class="button secondary compact" href="'+esc(path)+'">'+this.t('查看单据','Open Document')+'</a>':'—';},
 documents(rows){
  return this.section('关联单据','Related Documents',this.table([
   ['类别','Type'],['单据编号','Document No.'],['业务日期','Business Date'],['状态','Status'],['操作','Actions']
  ],rows.map(row=>[this.text(row.label),this.text(row.code),this.time(row.at),this.text(row.state),this.action(row.href)])));
 },
 copper(root,s,history,events,refs,original){
  const b=history.bundle,doc=b.id||b.bundle_no,t=this.t;
  const archive=UI46Pages.el('div','c461-page inventory-archive',root,s);archive.dataset.c461Page='CU-06';
  s.composition.anchor=s.anchor=archive;
  document.getElementById('business-title').textContent=t('捆包详情档案','Bundle Detail Archive');
  const linked=[...history.reservations].reverse().find(record=>record.contract_no);
  const outbound=b.archive_physical_status==='OUTBOUND'||b.status==='已出库';
  const weight=value=>value==null?'—':Tonnes.format(value);
  const summary=this.facts([
   ['捆包片数','Sheets',b.sheets_per_bundle],['铅封号','Seal No.',b.seal_no],['合同号','Contract No.',b.contract_no||linked?.contract_no],
   ['当前货位','Current Location',outbound?null:b.location],...(outbound?[['档案记录货位','Recorded Location',b.location]]:[]),
   ['备货批次','Preparation Batch',b.lot_no],['客户','Customer',b.current_customer||b.allocated_customer||b.customer||linked?.assigned_customer],
   ['毛重（MT）','Gross (MT)',weight(b.gross_weight)],['净重（MT）','Net (MT)',weight(b.weight)],
   ['生产日期','Production Date',b.production_date?.slice(0,10)],['入库时间','Receipt Time',b.archive_inbound_at?BusinessTime.display(b.archive_inbound_at):null]
  ]);
  const status=Copper461.state(b.business_status==='备货作业中'?'PREPARING':b.inventory_state_code||b.business_status||b.status);
  const state=events.map(event=>({...event,href:this.link(event.href)?event.href:null}));
  const kinds={receipt:['入库','Receipt'],preparation:['备货','Preparation'],loading:['装车','Loading'],outbound:['正式出库','Formal Outbound']};
  const docs=history.documents||[],known=new Set(docs.map(row=>row.href));
  const loading=docs.findLast(row=>row.kind==='loading'),dispatch=docs.findLast(row=>row.kind==='outbound');
  const linkRows=docs.map(row=>({...row,label:t(...kinds[row.kind]),state:this.documentState(row.state)}));
  linkRows.push(...refs.filter(e=>!known.has(e.href)).map(e=>({
   label:Copper461.action(e.action),code:e.document_no,at:e.at,state:I18n.translate(e.after_status||e.status||'—',true),href:e.href
  })));
  const secondary=this.facts([
   ['规划货位','Planned Location',b.planned_location],['取样状态','Sampling Status',Inventory.samplingState(b)],
   ['检斤状态','Weighing Status',b.final_weighed===false?t('待检斤','Awaiting Weighing'):b.weight==null?t('未知重量','Unknown Weight'):t('已知重量','Known Weight')],
   ['包装重量（MT）','Packaging (MT)',weight(b.packaging_weight)],['重量规则','Weight Rule',b.weight_rule_version],
   ['原始净重（MT）','Original Net (MT)',weight(b.original_weight)],['入库单号','Receipt No.',b.receipt_code],
   ['入库确认时间','Receipt Confirmation',b.confirmed_at?BusinessTime.display(b.confirmed_at):null],
   ['装车单号','Loading Order',b.loading_document_no||loading?.code],['出库时间','Outbound Time',dispatch?.at?BusinessTime.display(dispatch.at):null]
  ]);
  const filters=new URLSearchParams(location.search);filters.delete('archive');
  const actions='<a class="button secondary" href="/inventory'+(filters.size?'?'+esc(filters):'')+'">'+t('返回库存明细','Back to Inventory')+'</a>'+
   (Business.can('inventory:export')?'<button type="button" id="c461-bundle-export" class="button secondary">'+t('导出','Export')+'</button>':'')+
   '<span id="c461-bundle-actions"></span>';
  const activity=this.table([['业务时间','Time'],['记录','Event'],['操作人','Actor'],['单据依据','Document']],
   state.slice(-4).reverse().map(event=>{
    const detail=[event.note||event.detail,[event.from_location,event.to_location].filter(Boolean).join(' → '),
     [event.before_status,event.after_status].filter(Boolean).map(value=>this.documentState(value)).join(' → ')].filter(Boolean);
    return [this.time(event.at),this.text(Copper461.action(event.action))+(detail.length?'<small>'+esc(detail.join(' · '))+'</small>':''),
     this.text(event.actor_name),event.href?'<a href="'+esc(event.href)+'">'+this.text(event.document_no)+'</a>':this.text(event.document_no)];
   }));
  archive.innerHTML=UI46Pages.identity(doc,status,actions,summary,'archive-identity')+this.documents(linkRows)+
   this.section('业务记录与历史依据','Activity and Historical Evidence',secondary+activity+
    '<a class="button secondary" href="/inventory/'+encodeURIComponent(doc)+'/history">'+t('查看完整流水','Open Full Ledger')+'</a>'+
    '<p class="wms-feedback">'+t('资料来源　库存档案、关联单据和库存流水','Sources: inventory archive, linked documents and stock ledger')+'</p>');
  for(const id of ['v262-correct-sheets','v262-correct-seal']){
   const button=root.querySelector('#'+id);
   if(button)UI46Pages.move(button,archive.querySelector('#c461-bundle-actions'),s);
  }
  for(const node of original)if(node.nodeType===1)UI46Pages.hide(node,s);
  archive.querySelector('#c461-bundle-export')?.addEventListener('click',async e=>{
   const button=e.currentTarget;button.disabled=true;
   try{Copper461.download(await API.request('/inventory/export',{method:'POST',body:{ids:[doc],format:'csv',filters:{lifecycle:'ALL'}},binary:true}));}
   catch(error){notify(error.message);}finally{button.disabled=false;}
  });
 },
 cobaltLabel(kind){
  const labels={'preparation-plan':['备货计划','Preparation Plan'],receipt:['入库备货单','Receipt Preparation'],
   'sales-plan':['销售计划','Sales Plan'],'loading-plan':['装车计划','Loading Plan'],loading:['装车单','Loading Order'],packing:['装箱单','Packing List']};
  return labels[kind]?this.t(...labels[kind]):kind;
 },
 cobaltEvent(action){
  const labels={CREATE:['创建','Created'],SUBMIT:['提交','Submitted'],PRODUCTION_APPROVE:['确认正式入库','Receipt Confirmed'],
   BAG_UPDATE:['更新袋级资料','Bag Updated'],REVIEW_PENDING:['提交装车审核','Submitted for Loading Review'],
   LOADED:['完成装车','Loading Completed'],DEPARTED:['登记离场','Departure Recorded'],
   OUTBOUND_PENDING:['提交出库审批','Submitted for Outbound Review'],LOGISTICS_APPROVED:['物流审核通过','Logistics Review Approved'],
   OUTBOUND:['正式出库','Formally Outbound']};
  return labels[action]?this.t(...labels[action]):CobaltWorkUI.actionName(action);
 },
 async cobalt(id){
  const t=this.t,query=CobaltStock469R2.clean(location.search),filter=new URLSearchParams(query),unit=(query.get('archive_unit')||'').slice(0,80);
  const page=Math.max(1,Math.min(1000000,Number.parseInt(query.get('archive_page'),10)||1));
  filter.delete('archive_unit');filter.delete('archive_page');
  const stock=query.get('stock_state'),base='/cobalt/stock/batches/'+id;
  const args=new URLSearchParams({page_size:'20'});
  if(['IN_STOCK','OUTBOUND'].includes(stock))args.set('stock_state',stock);
  const itemArgs=new URLSearchParams(args);itemArgs.set('page',page);if(unit)itemArgs.set('unit',unit);
  const items=API.request(base+'?'+itemArgs);
  const [detail,summary,trace]=await Promise.all([items,unit?API.request(base+'?'+args):items,API.request(base+'/archive')]);
  const b=summary.batch;
  if(!b)throw Error(t('该批次没有符合条件的授权库存','No authorized inventory in this batch'));
  const href='/inventory/'+id+'/archive',make=(name,value)=>{
   const next=new URLSearchParams(query);value?next.set(name,value):next.delete(name);
   return esc(href+(next.size?'?'+next:''));
  };
  const back='/inventory'+(filter.size?'?'+esc(filter):''),outbound=b.status==='OUTBOUND';
  const state=value=>I18n.translate(CobaltStockUI.status(value)||value||'—',true);
  const summaryHTML=this.facts([
   ['客户','Customer',trace.customer],['合同号','Contract No.',trace.contract_no],['当前货位','Current Location',outbound?null:b.location_codes?.join(' / ')],
   ['吨包袋数','Bags',b.bags],['实物净重（MT）','Physical Net (MT)',CobaltMetal.format(b.effective_net_mt,4)],
   ['钴品位','Cobalt Grade',b.cobalt_grade_pct==null?null:b.cobalt_grade_pct+'%'],
   ['实际入库时间','Actual Receipt Time',b.received_at?BusinessTime.display(b.received_at):null],
   ['预计钴金属量（MT）','Estimated Cobalt Metal (MT)',CobaltMetal.format(trace.outbound_estimated_mt??b.estimated_metal_mt,5)],
   ['ARECOMS 实际确认钴金属量（MT）','Confirmed ARECOMS Cobalt (MT)',CobaltMetal.format(trace.confirmed_metal_mt,5)]
  ]);
  const actions='<a class="button secondary" href="'+back+'">'+t('返回批次列表','Back to Batch List')+'</a>'+
   '<a class="button secondary" href="/inventory/'+id+(filter.size?'?'+esc(filter):'')+'">'+t('查看库存作业','Open Stock Operations')+'</a>';
  const search='<form id="archive-bag-search" class="filters wms-filter-row"><label>'+t('袋号 / 铅封号','Bag / Seal No.')+
   '<input type="search" name="unit" maxlength="80" value="'+esc(unit)+'"></label><div class="wms-filter-actions"><button class="button primary">'+
   t('定位','Find')+'</button><a class="button secondary" href="'+esc(href+(filter.size?'?'+filter:''))+'">'+t('清除','Clear')+'</a></div></form>';
  const bags=this.table([['袋号','Bag No.'],['铅封号','Seal No.'],['毛重（kg）','Gross (kg)'],['净重（MT）','Net (MT)'],
   ['货位','Location'],['取样状态','Sample Status'],['作业状态','Workflow Status']],detail.items.map(row=>[
    this.text(row.bag_no),this.text(row.seal_no),CobaltMetal.format(row.actual_gross_kg,4),
    row.actual_net_kg==null?'—':Tonnes.fixed(Tonnes.scaled(row.actual_net_kg,1),4),
    this.text(outbound?null:row.location_code),row.sampled?t('已取样','Sampled'):t('待取样','Not Sampled'),this.text(state(row.lifecycle_state||row.status))
   ]));
  const pager='<div class="co2-pager">'+(page>1?'<a class="button secondary" href="'+make('archive_page',page-1)+'">'+t('上一页','Previous')+'</a>':'')+
   '<span>'+detail.total+' '+t('袋','bags')+'</span>'+(page*detail.page_size<detail.total?'<a class="button secondary" href="'+make('archive_page',page+1)+'">'+t('下一页','Next')+'</a>':'')+'</div>';
  const related=this.documents(trace.documents.map(row=>({...row,label:this.cobaltLabel(row.kind),state:this.documentState(row.state)})));
  const historyHeads=[['业务时间','Time'],['记录','Event'],['操作人','Actor'],['单据依据','Document']];
  const rows=trace.events.map(event=>[this.time(event.at),this.text(this.cobaltEvent(event.action)),this.text(event.actor),this.text(event.document)]);
  const older=rows.length>4?'<details><summary>'+t('更早记录','Earlier Activity')+'（'+(rows.length-4)+'）</summary>'+
   this.table(historyHeads,rows.slice(4))+'</details>':'';
  const history=this.section('业务记录','Activity',this.table(historyHeads,rows.slice(0,4))+older+
   '<p class="wms-feedback">'+t('资料来源　入库备货单、袋级作业和正式出库记录','Sources: receipt preparations, bag operations and formal outbound records')+'</p>');
  CobaltUI.page(t('批次详情档案','Batch Detail Archive'),'<div class="inventory-archive">'+
   UI46Pages.identity(b.preparation_batch_no,CobaltStock469R2.state(b),actions,summaryHTML,'archive-identity')+
   this.section('逐袋明细','Bag Details',search+bags+pager)+related+history+'</div>');
  $('archive-bag-search').onsubmit=e=>{
   e.preventDefault();const next=new URLSearchParams(filter),value=e.target.elements.unit.value.trim();
   if(value)next.set('archive_unit',value);
   Router.go(href+(next.size?'?'+next:''));
  };
 }
};
RoutePermissions.register('cobalt-stock-archive',
 path=>!ProductContext.isCopper()&&/^\/inventory\/[0-9a-f-]{36}\/archive$/.test(path),()=> 'co:read');
