'use strict';

window.CustomsBP={
 selected:new Set(),selectedCustomer:null,product:null,preview:null,proof:null,editing:null,
 t:(zh,en)=>I18n.label(zh,en),
 base(){return CustomsWorkspace.base()+'/bp';},
 feedback(error){
  const labels={
   BP_INVALID_FIELD:['请核对填写内容及长度。','Check the submitted fields and their lengths.'],
   BP_SELECTION_REQUIRED:['请勾选至少一个批次。','Select at least one lot.'],
   BP_CUSTOMER_MISMATCH:['同一张BP表只能选择同一客户的批次。','Choose lots for a single customer per BP sheet.'],
   BP_NOT_FOUND:['BP表不存在或超出查看范围。','This BP sheet is unavailable in your scope.'],
   BP_SOURCE_CHANGED:['选中单据的审批或数据已变化，请重新选择并生成预览。','A selected document or approval changed. Select the lots again.'],
   BP_REQUIRED_DETAILS:['装车单缺少车头号、件数或重量，请补齐来源单据后重试。','Complete the truck plate, package count or weights on the loading order and try again.'],
   BP_DECLARATION_REQUIRED:['请选择运输方式、出境口岸、清关代理和签署日期。','Select the transport mode, exit border, customs agency and signature date.'],
   BP_TEMPLATE_FIELDS_REQUIRED:['请填写所有模板固定资料。','Complete all fixed template fields.'],
   BP_TEMPLATE_CHANGED:['模板已有新版本，请重新打开后编辑。','A newer template exists. Reopen it to make changes.'],
   BP_BATCH_LOCKED:['所选批次已生成BP表，请返回列表查看已生成记录。','A selected lot is already on a BP sheet. Return to the list to view the issued sheet.'],
   BP_REVISION_CHANGED:['该BP表已有新版本，请返回列表重新打开。','A newer BP revision exists. Open the sheet again from the list.'],
   BP_AGENCY_CHANGED:['清关代理已更新，请刷新记录后重新选择。','The customs agency changed. Refresh the book and make a new selection.'],
   BP_AGENCY_NOT_FOUND:['清关代理已删除或超出查看范围。','The customs agency was removed or is outside your scope.'],
   BP_AGENCY_PROJECT:['当前账号没有该项目的代理记录簿权限。','This account cannot manage the agency book for that project.'],
   BP_AGENCY_DUPLICATE:['记录簿已有同名清关代理。','An agency with that name already exists.'],
   BP_INVALID_WEIGHT:['请填写有效的净重和毛重，净重不能大于毛重。','Enter valid weights. Net weight must not exceed gross weight.'],
   BP_INVALID_QUANTITY:['件数须为正整数。','Package count must be a positive whole number.'],
   BP_NUMBER_IN_USE:['该BP编号已使用，请换一个编号。','This BP number is already in use. Choose another number.']
  };
  return labels[error.message]?this.t(...labels[error.message]):error.message;
 },
 filter(q,customers,archive){
  const t=this.t,field=(name,zh,en,type,limit='')=>'<label>'+t(zh,en)+'<input type="'+type+'" name="'+name+
   '" value="'+esc(q.get(name)||'')+'"'+(limit?' maxlength="'+limit+'"':'')+'></label>';
  const options='<option value="">'+t('全部客户','All Customers')+'</option>'+customers.map(({id,name})=>
   '<option value="'+esc(id)+'"'+(id===q.get('customer_id')?' selected':'')+'>'+esc(name)+'</option>').join('');
  return '<form id="customs-bp-filter" class="filters wms-filter-row wms-compact-filters">'+
   (archive?'<input type="hidden" name="view" value="documents">'+field('document_no','BP编号','BP Number','search',80):'')+
   field('batch_no','批次号','Lot No.','search',160)+
   '<label>'+t('客户','Customer')+'<select name="customer_id">'+options+'</select></label>'+
   (archive?field('generated_date','生成日期','Generated Date','date'):'')+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+
   '</button><a class="button secondary" data-wms-reset href="/customs/bp'+(archive?'?view=documents':'')+'">'+t('重置','Reset')+'</a></div></form>';
 },
 pagination(list,query,d){
  const t=this.t,archive=list==='documents',prefix=archive?'document_':'',page=d[prefix+'page'],
   size=d[prefix+'page_size'],total=d[prefix+'total'],pages=Math.max(1,Math.ceil(total/size));
  const url=n=>{const q=new URLSearchParams(query);q.set(prefix+'page',n);return '/customs/bp?'+q;};
  const link=(n,zh,en,enabled)=>enabled?'<a class="button secondary" href="'+esc(url(n))+'">'+t(zh,en)+'</a>':
   '<button type="button" class="button secondary" disabled>'+t(zh,en)+'</button>';
  return '<div class="v34-pagination" data-bp-pager="'+list+'"><span>'+page+' / '+pages+' · '+total+'</span>'+
   '<label>'+t('每页','Per page')+' <select aria-label="'+t('每页行数','Rows per page')+'" data-bp-size="'+prefix+'">'+
   RowsPerPage.standard.map(n=>'<option value="'+n+'"'+(n===size?' selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
   link(page-1,'上一页','Previous',page>1)+link(page+1,'下一页','Next',page<pages)+'</div>';
 },
 clearSelection(){
  this.selected.clear();
  this.selectedCustomer=null;
 },
 async page(){
  if(this.product!==ProductContext.code){this.product=ProductContext.code;this.clearSelection();this.preview=null;this.proof=null;this.editing=null;}
  const t=this.t,url=location.href,base=this.base(),q=new URLSearchParams(location.search);
  const archive=q.get('view')==='documents'||!q.has('view')&&(q.has('document_no')||q.has('generated_date'));
  if(archive)q.set('view','documents');
  for(const prefix of ['','document_'])q.set(prefix+'page_size',
   RowsPerPage.read('bp-'+prefix+'page',RowsPerPage.standard,q.get(prefix+'page_size')));
  const d=await API.request(base+'?'+q);
  if(location.href!==url||this.base()!==base)return;
  const pendingTitle=t('待创建BP表批次','Lots Pending BP Creation'),archiveTitle=t('已创建BP表批次','Lots on Created BP Sheets');
  const tab=(value,label,count,active)=>{
   const params=new URLSearchParams(q);
   params.set('view',value);
   if(value==='batches')for(const key of ['document_no','generated_date'])params.delete(key);
   return '<a class="button secondary" href="/customs/bp?'+esc(params)+'"'+(active?' aria-current="page"':'')+'>'+label+' <strong>'+count+'</strong></a>';
  };
  const headers=[['选择','Select'],['备货批次','Preparation Lot'],['客户','Customer'],['车头号','Truck Plate'],['净重','Net Weight'],['物流审批时间','Logistics Approval']];
  const rows=d.items.map((row,i)=>'<tr><td><input type="checkbox" data-bp-select="'+i+'" aria-label="'+esc(t('选择批次 ','Select lot ')+(row.batch||row.truck))+
   '"></td><td>'+esc(row.batch||'—')+'</td><td>'+esc(row.customer)+
   '</td><td>'+esc(row.truck||'—')+'</td><td>'+esc(this.displayWeight(row.net_mt))+'</td><td>'+esc(BusinessTime.display(row.approved_at))+'</td></tr>');
  Router.page(t('清关单据管理','Customs Documents'),'<div class="wms-page" data-page-composed data-no-i18n>'+CustomsWorkspace.nav('bp')+
   '<div class="bp-list-toolbar"><nav class="bp-list-tabs" aria-label="'+t('BP表列表','BP Sheet Lists')+'">'+
   tab('batches',pendingTitle,d.total,!archive)+tab('documents',archiveTitle,d.document_total,archive)+'</nav><div class="bp-archive-actions">'+
   this.templateButton()+'</div></div>'+this.filter(q,d.customer_options,archive)+
   (archive?'<section class="wms-section" aria-label="'+archiveTitle+'">'+this.documents(d.documents)+this.pagination('documents',q,d)+'</section>':
   '<section id="customs-bp-pending" class="wms-section" aria-label="'+pendingTitle+'">'+
   ExportLicenses.table(headers,rows,'customs-bp-batches',true,{numeric:[4]})+this.pagination('batches',q,d)+
   '<div class="business-toolbar"><span id="customs-bp-selection" role="status"></span>'+
   '<button type="button" class="button secondary" id="customs-bp-clear">'+t('清除已选','Clear Selection')+'</button>'+
   '<button type="button" class="button primary" id="customs-bp-preview">'+t('编制BP表','Prepare BP Sheet')+'</button></div>'+
   '<p class="error" id="customs-bp-error" role="alert"></p></section>')+'</div>');
  $('customs-bp-filter').onsubmit=e=>{
   e.preventDefault();
   const filters=new URLSearchParams([...new FormData(e.target)].filter(([,value])=>value.trim()));
   Router.go('/customs/bp'+(filters.size?'?'+filters:''));
  };
  for(const select of document.querySelectorAll('[data-bp-size]'))select.onchange=()=>{
   const prefix=select.dataset.bpSize,next=new URLSearchParams(q);
   RowsPerPage.remember('bp-'+prefix+'page',select.value);
   next.set(prefix+'page_size',select.value);next.delete(prefix+'page');
   Router.go('/customs/bp?'+next);
  };
  for(const button of document.querySelectorAll('[data-bp-expand]'))button.onclick=()=>this.expand(button);
  for(const button of document.querySelectorAll('[data-bp-edit-doc]'))button.onclick=()=>this.editDocument(button);
  this.bindTools();
  if(!archive)this.bindSelection(d.items);
  ProductContext.dirty=false;
 },
 documents(documents){
  const t=this.t,headers=[['BP编号','BP Number'],['车辆数','Vehicles'],['客户','Customer'],['总净重','Total Net Weight'],['总毛重','Total Gross Weight'],['生成时间','Generated At'],['操作','Actions']];
  const rows=documents.flatMap(row=>{
   const id=esc(row.id),panel='customs-bp-batch-'+id,number=esc(row.document_no);
   return ['<tr><td>'+number+' <span class="bp-archive-version">r'+row.revision+'</span></td><td>'+row.vehicle_count+'</td><td>'+esc(row.customer||'—')+'</td><td>'+
    esc(this.displayWeight(row.net_mt))+'</td><td>'+esc(this.displayWeight(row.gross_mt))+'</td><td>'+esc(BusinessTime.display(row.created_at))+
    '</td><td><div class="bp-archive-actions"><button type="button" class="button secondary compact" data-bp-expand="'+id+'" data-bp-number="'+number+
    '" aria-expanded="false" aria-controls="'+panel+'" aria-label="'+t('展开批次','Expand Lots')+' '+number+'">'+t('展开批次','Expand Lots')+
    '</button><button type="button" class="button secondary compact" data-bp-edit-doc="'+id+'" aria-label="'+t('编辑BP表 ','Edit BP Sheet ')+number+'">'+t('编辑','Edit')+
    '</button>'+this.excelLink(id,row.revision)+'<a class="button secondary compact" href="/api/v1'+this.base()+'/'+id+'/print" target="_blank" rel="noopener">'+t('预览 / 打印','Preview / Print')+'</a></div></td></tr>',
    '<tr class="bp-batch-expansion" id="'+panel+'" hidden><td colspan="7"><div class="bp-batch-panel" aria-live="polite"></div></td></tr>'];
  });
  return ExportLicenses.table(headers,rows,'customs-bp-documents',true,{numeric:[1,3,4],actions:[6]});
 },
 excelLink(id,revision,classes='button secondary compact'){
  return '<a class="'+classes+'" data-bp-excel href="/api/v1'+this.base()+'/'+esc(id)+'/excel?revision='+revision+
   '" download>'+this.t('下载 Excel','Download Excel')+'</a>';
 },
 async editDocument(button){
  button.disabled=true;
  try{
   const data=await API.request(this.base()+'/'+button.dataset.bpEditDoc);
   if(!button.isConnected)return;
   this.preview={...data,archivedAgency:data.header.agency};
   this.editor();
  }catch(error){if(button.isConnected)notify(this.feedback(error));}
  finally{button.disabled=false;}
 },
 agencyButton(){return '<button type="button" class="button secondary compact" data-bp-agency-book>'+this.t('清关代理记录簿','Customs Agency Book')+'</button>';},
 templateButton(){return CustomsWorkspace.can('customs:bp-template')?
  '<button type="button" class="button secondary compact" data-bp-template>'+this.t('BP表模板','BP Sheet Template')+'</button>':'';},
 bindTools(){
  const button=document.querySelector('[data-bp-template]');
  if(button)button.onclick=()=>this.editTemplate(button);
 },
 async editTemplate(button){
  const t=this.t,path=this.base()+'/template';
  button.disabled=true;
  try{
   const template=await API.request(path);
   if(!button.isConnected)return;
   const fixed=['issuer','address','rccm','id_nat','nif','contact','loading_point','destination'];
   const fields=[['title','单据标题','Document Title',180],...this.headerLabels().filter(([key])=>fixed.includes(key))];
   dialog(t('编辑BP表模板','Edit BP Sheet Template'),'<form class="user-form" id="bp-template-form" data-no-i18n data-wms-validation>'+
    '<p>'+esc(ProductContext.isCopper()?t('阴极铜','Copper Cathodes'):t('氢氧化钴','Cobalt Hydroxide'))+
    (template.revision?' · r'+template.revision:'')+'</p><div class="form-grid wms-field-grid">'+fields.map(([key,zh,en,max])=>
     '<label class="wms-field">'+t(zh,en)+'<input name="'+key+'" maxlength="'+max+'" value="'+esc(template.fields[key])+'" required></label>').join('')+
    '</div><p class="error" role="alert"></p><div class="business-toolbar wms-form-actions"><button type="button" id="bp-template-cancel" class="button secondary">'+
    t('取消','Cancel')+'</button><button class="button primary">'+t('保存模板','Save Template')+'</button></div></form>');
   $('bp-template-cancel').onclick=()=>$('dialog').close();
   const form=$('bp-template-form');
   form.onsubmit=e=>UI46Pages.submit(e,async()=>{
    try{
     const fields=Object.fromEntries(new FormData(form));
     const saved=await API.request(path,{method:'POST',body:{revision:template.revision,fields}});
     $('dialog').close();notify(t('BP表模板已保存','BP sheet template saved')+' · r'+saved.revision);
    }catch(error){throw Error(this.feedback(error));}
   });
  }catch(error){if(button.isConnected)notify(this.feedback(error));}
  finally{button.disabled=false;}
 },
 bindAgencyBook(){
  const button=document.querySelector('[data-bp-agency-book]');
  if(button)button.onclick=()=>this.agencyBook(button);
 },
 async agencyBook(trigger){
  const t=this.t,path=this.base()+'/agencies',draft=this.preview;
  const url=path+(draft?.project_id?'?'+new URLSearchParams({project_id:draft.project_id}):'');
  trigger.disabled=true;
  try{
   let book=await API.request(url),project=draft?.project_id||book.projects[0]?.id,record=null;
   if(!trigger.isConnected)return;
   dialog(t('清关代理记录簿','Customs Agency Book'),'<div id="bp-agency-book" data-no-i18n></div>');
   const host=$('bp-agency-book');
   const updateChoices=()=>{
    if(draft===this.preview&&draft){
     draft.agencies=book.items;
     if(draft.agencyId){
      const selected=book.items.find(item=>item.id===draft.agencyId);
      draft.agencyId=selected?.id||'';
      draft.header.agency=selected?.name||draft.archivedAgency||'';
     }
    }
   };
   const refresh=async()=>{
    book=await API.request(url);
    updateChoices();
    record=null;draw();
   };
   $('dialog').addEventListener('close',()=>{if(draft&&draft===this.preview&&trigger.isConnected)this.editor();},{once:true});
   const draw=()=>{
    if(!host.isConnected)return;
    if(!project){host.textContent=t('当前账号没有可用项目。','No projects are available to this account.');return;}
    const items=book.items.filter(item=>item.project_id===project);
    const choice=!draft&&book.projects.length>1?'<label class="wms-field">'+t('项目','Project')+'<select id="bp-agency-project">'+
     book.projects.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===project?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>':'';
    const rows=items.map(({id,name})=>'<tr><td>'+esc(name)+'</td><td><div class="bp-archive-actions">'+
     '<button type="button" class="button secondary compact" data-bp-agency-edit="'+esc(id)+'">'+t('编辑','Edit')+'</button>'+
     '<button type="button" class="button danger-outline compact" data-bp-agency-remove="'+esc(id)+'">'+t('删除','Delete')+'</button></div></td></tr>');
    host.innerHTML=choice+ExportLicenses.table([['代理名称','Agency Name'],['操作','Actions']],rows,'bp-agency-table',true,{actions:[1]})+
     '<form id="bp-agency-form" class="user-form" data-wms-validation><label class="wms-field">'+t('代理名称','Agency Name')+
     '<input name="name" required maxlength="1000" value="'+esc(record?.name||'')+'"></label><p class="error" role="alert"></p>'+
     '<div class="business-toolbar wms-form-actions"><button type="button" class="button secondary" id="bp-agency-cancel">'+
     (record?t('取消编辑','Cancel Edit'):t('关闭','Close'))+'</button><button type="submit" class="button primary">'+
     (record?t('保存修改','Save Changes'):t('新增代理','Add Agency'))+'</button></div></form>';
    const form=$('bp-agency-form');
    if(choice)$('bp-agency-project').onchange=e=>{project=e.target.value;record=null;draw();};
    $('bp-agency-cancel').onclick=()=>{if(record){record=null;draw();}else $('dialog').close();};
    form.onsubmit=e=>UI46Pages.submit(e,async()=>{
     try{
      const name=form.elements.name.value.trim();
      await API.request(record?path+'/'+record.id:path,{method:record?'PATCH':'POST',body:record?{name,version:record.version}:{name,project_id:project}});
      await refresh();
     }catch(error){throw Error(this.feedback(error));}
    });
    for(const control of host.querySelectorAll('[data-bp-agency-edit]'))control.onclick=()=>{
     record=items.find(item=>item.id===control.dataset.bpAgencyEdit);draw();$('bp-agency-form').elements.name.focus();
    };
    for(const control of host.querySelectorAll('[data-bp-agency-remove]'))control.onclick=async()=>{
     const selected=items.find(item=>item.id===control.dataset.bpAgencyRemove);
     if(!await OperationConfirm.ask({title:t('删除清关代理','Delete Customs Agency'),danger:true,
      rows:[[t('代理名称','Agency Name'),selected.name]],note:t('已生成BP表保留原代理名称。','Issued BP sheets retain the agency name.')}))return;
     control.disabled=true;
     try{await API.request(path+'/'+selected.id,{method:'DELETE',body:{version:selected.version}});await refresh();}
     catch(error){form.querySelector('[role="alert"]').textContent=this.feedback(error);}
     finally{control.disabled=false;}
    };
   };
   updateChoices();draw();
  }catch(error){if(trigger.isConnected)notify(this.feedback(error));}
  finally{trigger.disabled=false;}
 },
 async expand(button){
  const t=this.t,panel=$(button.getAttribute('aria-controls')),inside=panel.querySelector('.bp-batch-panel'),open=panel.hidden;
  panel.hidden=!open;
  const caption=open?t('收起批次','Collapse Lots'):t('展开批次','Expand Lots');
  button.textContent=caption;
  button.setAttribute('aria-label',caption+' '+button.dataset.bpNumber);
  button.setAttribute('aria-expanded',String(open));
  if(!open||inside.dataset.loaded||inside.getAttribute('aria-busy')==='true')return;
  inside.setAttribute('aria-busy','true');
  inside.textContent=t('正在读取批次…','Loading lots…');
  try{
   const {items}=await API.request(this.base()+'/'+button.dataset.bpExpand+'/batches');
   if(!inside.isConnected)return;
   const rows=items.map(row=>'<tr>'+[row.batch,row.truck,PlanDisplay.documentNo(row.packing_list_no),this.displayWeight(row.net_mt),this.displayWeight(row.gross_mt),BusinessTime.longDate(row.loading_date)]
    .map(value=>'<td>'+esc(value||'—')+'</td>').join('')+'</tr>');
   inside.innerHTML=ExportLicenses.table([['批次号','Lot No.'],['车头号','Truck Plate'],['装箱单号','Packing List No.'],
    ['净重','Net Weight'],['毛重','Gross Weight'],['装车日期','Loading Date']],rows,panel.id+'-details',true,{numeric:[3,4]});
   inside.dataset.loaded='true';
  }catch(e){
   inside.textContent=this.feedback(e);
  }finally{
   inside.removeAttribute('aria-busy');
  }
 },
 bindSelection(batches){
  const t=this.t,button=$('customs-bp-preview'),clear=$('customs-bp-clear'),status=$('customs-bp-selection'),error=$('customs-bp-error');
  const controls=[...document.querySelectorAll('[data-bp-select]')];
  let pending=false;
  const sync=()=>{
   const count=this.selected.size;
   status.textContent=count>200?t('每张BP最多选200辆车。','Select up to 200 vehicles per BP sheet.'):
    this.selectedCustomer?this.selectedCustomer.name+' · '+t('已选择 '+count+' 辆车，仅可继续勾选同一客户','Selected '+count+' vehicle(s). Add lots for this customer only.'):
     t('每张BP表可选择同一客户的一个或多个批次','Select one or more lots for a single customer');
   button.disabled=pending||!count||count>200;
   clear.disabled=!count;
   for(const input of controls){
    const row=batches[Number(input.dataset.bpSelect)];
    input.checked=row.source_ids.every(id=>this.selected.has(id));
    input.disabled=!!this.selectedCustomer&&row.customer_id!==this.selectedCustomer.id;
    input.setAttribute('aria-describedby','customs-bp-selection');
   }
  };
  for(const input of controls)input.onchange=()=>{
   const row=batches[Number(input.dataset.bpSelect)];
   if(input.checked){
    if(this.selectedCustomer&&row.customer_id!==this.selectedCustomer.id){
     error.textContent=this.feedback(Error('BP_CUSTOMER_MISMATCH'));sync();return;
    }
    this.selectedCustomer={id:row.customer_id,name:row.customer};
    for(const id of row.source_ids)this.selected.add(id);
   }else{
    for(const id of row.source_ids)this.selected.delete(id);
    if(!this.selected.size)this.clearSelection();
   }
   error.textContent='';
   sync();
  };
  clear.onclick=()=>{this.clearSelection();error.textContent='';sync();};
  button.onclick=async()=>{
   pending=true;sync();
   const ids=[...this.selected].sort();
   error.textContent='';
   try{
    const data=await API.request(this.base()+'/preview',{method:'POST',body:{ids}});
    if(button.isConnected&&ids.length===this.selected.size&&ids.every(id=>this.selected.has(id))){this.preview={...data,ids,suggestion:data.number};this.editor();}
   }catch(e){if(button.isConnected)error.textContent=this.feedback(e);}
   finally{pending=false;if(button.isConnected)sync();}
  };
  sync();
 },
 headerLabels(){
  return [['issuer','公司名称','Issuer',180],['address','公司地址','Company Address',360],['rccm','RCCM','RCCM',120],
   ['id_nat','IDNAT','IDNAT',120],['nif','NIF','NIF',120],['contact','联系方式','Contact',360],['customer','客户','Customer',1000],
   ['product','产品','Product',120],['mode','运输方式','Transport Mode',60],['destination','最终目的地','Final Destination',1000],
   ['border','出境口岸','Exit Border',120],['agency','清关代理','Customs Agency',1000],['license','许可证','License',1000],
   ['loading_point','装车地点','Loading Point',360],['loading_date','装车日期','Loading Date',160],['signature_date','签署日期','Signature Date',10]];
 },
 open(){
  if(!CustomsWorkspace.can('customs:bp')){
   this.frame(this.t('BP表','BP Sheets'),'<div class="business-toolbar">'+this.templateButton()+'</div>');
   this.bindTools();return;
  }
  if(this.product===ProductContext.code&&this.preview)return this.translateEditor();
  return this.page();
 },
 frame(title,content){
  Router.page(title,'<div class="wms-page customs-bp-review" data-page-composed data-no-i18n>'+CustomsWorkspace.nav('bp')+content+'</div>');
 },
 displayWeight(value){
  return value?Tonnes.fixed(Tonnes.scaled(value,3),3)+' MT':'—';
 },
 total(key){
  const values=this.preview.rows.map(row=>row[key]);
  if(values.some(v=>!v))return '—';
  if(key==='quantity')return values.reduce((sum,v)=>sum+BigInt(v),0n)+' '+this.t('件','pcs');
  const weight=values.reduce((sum,v)=>sum+Tonnes.scaled(v,6),0n);
  return this.displayWeight(Tonnes.fixed(weight,6));
 },
 editor(){
  const t=this.t,d=this.preview,header=d.header,labels=new Map(this.headerLabels().map(([key,zh,en])=>[key,t(zh,en)]));
  const fixed=['issuer','address','rccm','id_nat','nif','contact','loading_point','destination'];
  const product=ProductContext.isCopper()?t('阴极铜','Copper Cathodes'):t('氢氧化钴','Cobalt Hydroxide');
  const summary={...header,product,loading_date:BusinessTime.longDate(header.loading_date)};
  const facts=keys=>UI46Pages.factList(keys.map(key=>[labels.get(key),esc(summary[key]||'—')]));
  const history=d.versions?'<details class="bp-versions"><summary>'+t('历史版本','Revision History')+'</summary><ul>'+
   d.versions.map(v=>'<li><a href="/api/v1'+this.base()+'/'+esc(d.id)+'/print?revision='+v.revision+'" target="_blank" rel="noopener">r'+v.revision+'</a> · '+
   esc(BusinessTime.display(v.created_at))+' · '+this.excelLink(d.id,v.revision,'bp-version-download')+'</li>').join('')+'</ul></details>':'';
  const select=(key,entries,selected,placeholder,required=true)=>'<label class="wms-field">'+labels.get(key)+
   '<select name="'+key+'"'+(required?' required':'')+'><option value="">'+esc(placeholder)+'</option>'+
   entries.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';
  const placeholder=t('请选择','Select');
  const agency=select('agency',d.agencies.map(record=>[record.id,record.name]),d.agencyId,
   d.archivedAgency?t('沿用归档代理 ','Keep filed agency ')+d.archivedAgency:placeholder,!d.archivedAgency);
  const heading=[[t('车辆','Vehicles'),d.rows.length],[t('件数','Packages'),this.total('quantity')],
   [t('总净重','Total Net'),this.total('net_mt')],[t('总毛重','Total Gross'),this.total('gross_mt')]];
  const vehicleColumns=[['批次号','Lot No.'],['车头号','Truck Plate'],['运输商','Transporter'],['件数','Packages'],
   ['净重','Net Weight'],['毛重','Gross Weight']];
  const rows=d.rows.map(row=>'<tr>'+[row.batch,row.truck,row.transporter,row.quantity,this.displayWeight(row.net_mt),this.displayWeight(row.gross_mt)]
   .map(value=>'<td>'+esc(value||'—')+'</td>').join('')+'</tr>');
  const missing=!d.id&&d.rows.some(row=>!row.truck||!row.quantity||!row.net_mt||!row.gross_mt);
  const problem=missing?'BP_REQUIRED_DETAILS':'';
  this.frame(d.id?t('编辑BP表','Edit BP Sheet'):t('编制BP表','Prepare BP Sheet'),
   '<form id="customs-bp-form" class="user-form" data-wms-validation>'+
   '<section class="wms-section"><div class="bp-review-heading"><h2>'+t('单据资料','Document Details')+'</h2><span>'+
    (d.id?'r'+d.revision:t('待生成','Awaiting Generation'))+'</span></div>'+
   '<div class="bp-review-overview"><label class="wms-field">'+t('BP编号','BP Number')+
   '<input id="bp-number" name="number" maxlength="80" value="'+esc(d.number)+'" aria-describedby="bp-number-hint" '+(d.id?'readonly':'required')+'>'+
   '<small id="bp-number-hint"></small></label>'+facts(['customer','product','license','loading_date'])+'</div>'+
   '<details class="bp-template-details"><summary>'+t('模板固定资料','Fixed Template Details')+'</summary>'+facts(fixed)+'</details>'+history+'</section>'+
   '<section class="wms-section"><div class="bp-review-heading"><h2>'+t('申报选择','Declaration Selections')+'</h2>'+this.agencyButton()+'</div>'+
   '<div class="form-grid wms-field-grid bp-declaration-fields">'+select('mode',d.options.modes.map(v=>[v,v]),header.mode,placeholder)+
   select('border',d.options.borders.map(v=>[v,v]),header.border,placeholder)+agency+
   '<label class="wms-field">'+labels.get('signature_date')+'<input type="date" name="signature_date" value="'+esc(header.signature_date)+'" required></label></div></section>'+
   '<section class="wms-section"><div class="bp-review-heading"><h2>'+t('车辆明细','Vehicles')+'</h2></div>'+
   ExportLicenses.table(vehicleColumns,rows,'customs-bp-review-rows',true,{numeric:[3,4,5]})+'</section>'+
   '<section class="wms-section bp-review-footer">'+UI46Pages.factList(heading.map(([name,value])=>[name,esc(value)]))+
   '<div class="business-toolbar wms-form-actions"><button type="button" id="customs-bp-back" class="button secondary">'+
   t('返回BP表列表','Back to BP Sheets')+'</button><button class="button primary"'+(problem?' disabled':'')+'>'+
   t('预览BP表','Preview BP Sheet')+'</button></div>'+
   '<p id="customs-bp-save-error" class="error" role="alert">'+esc(problem?this.feedback(Error(problem)):'')+'</p></section></form>');
  const form=$('customs-bp-form'),number=$('bp-number'),hint=$('bp-number-hint'),error=$('customs-bp-save-error');
  const sync=()=>{
   d.number=number.value;
   hint.textContent=d.id?'':number.value.trim()===d.suggestion?
    t('系统建议 · 生成时确认','Suggested · confirmed on generation'):t('手工编号','Manual number');
   for(const key of ['mode','border','signature_date'])header[key]=form.elements[key].value;
   d.agencyId=form.elements.agency.value;
   header.agency=d.agencies.find(item=>item.id===d.agencyId)?.name||d.archivedAgency||'';
  };
  sync();
  form.oninput=()=>{sync();if(!problem)error.textContent='';ProductContext.dirty=true;};
  this.bindAgencyBook();
  $('customs-bp-back').onclick=()=>{this.preview=null;this.proof=null;this.page();};
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   try{
    sync();
    const payload=this.payload();
    const outline=await API.request(this.documentPath()+'/print/preview',{method:'POST',body:payload});
    if(!form.isConnected)return;
    if(JSON.stringify(payload)!==JSON.stringify(this.payload()))throw Error(t('资料已修改，请重新预览。','Details changed. Open the preview again.'));
    if(!d.id&&d.number.trim()===d.suggestion)d.number=d.suggestion=outline.number;
    this.proof={...outline,payload};this.printPreview();
   }catch(failure){
    if(failure.message==='BP_NUMBER_IN_USE'){number.setAttribute('aria-invalid','true');number.focus();}
    throw Error(this.feedback(failure));
   }
  });
 },
 payload(){
  const d=this.preview,{mode,border,signature_date}=d.header;
  const agency=d.agencies.find(item=>item.id===d.agencyId);
  return {...(d.id?{revision:d.revision}:{ids:d.ids,token:d.token,number:d.number.trim()===d.suggestion?'':d.number}),
   header:{mode,border,signature_date},agency_id:agency?.id||null,agency_version:agency?.version||null};
 },
 documentPath(){return this.base()+(this.preview.id?'/'+this.preview.id:'');},
 printPreview(){
  const t=this.t;
  this.frame(t('BP表打印预览','BP Print Preview'),'<section class="wms-section">'+
   '<div class="bp-proof-sheet" role="region" tabindex="0" aria-label="'+t('A4横向打印样张','A4 Landscape Preview')+'">'+this.proof.content+'</div>'+
   '<form id="customs-bp-proof" class="user-form"><p class="error" role="alert"></p>'+
   '<div class="business-toolbar wms-form-actions"><button type="button" class="button secondary" id="customs-bp-back-edit">'+
   t('返回编辑','Back to Editor')+'</button><button class="button primary">'+
   (this.preview.id?t('保存修订','Save Revision'):t('生成BP表','Generate BP Sheet'))+'</button></div></form></section>');
  const sheet=document.querySelector('.bp-proof-sheet .bp-sheet');
  document.fonts.ready.then(()=>{if(sheet?.isConnected)window.CustomsBPPrint?.fitLines(sheet);});
  $('customs-bp-back-edit').onclick=()=>{this.proof=null;this.editor();$('bp-number')?.focus();};
  const form=$('customs-bp-proof');
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   try{
    const saved=await API.request(this.documentPath(),{method:this.preview.id?'PATCH':'POST',body:this.proof.payload});
    if(!form.isConnected)return;
    this.preview=null;this.proof=null;this.clearSelection();ProductContext.dirty=false;this.saved(saved);
   }catch(error){
    if(error.message==='BP_NUMBER_IN_USE'&&form.isConnected){
     this.proof=null;this.editor();$('customs-bp-save-error').textContent=this.feedback(error);
     $('bp-number').setAttribute('aria-invalid','true');$('bp-number').focus();
     return;
    }
    throw Error(this.feedback(error));
   }
  });
 },
 saved(saved){
  const t=this.t;
  this.frame(saved.revision>1?t('BP表修订已保存','BP Sheet Revision Saved'):t('BP表已生成','BP Sheet Generated'),'<section class="wms-section">'+
   UI46Pages.factList([[t('BP编号','BP Number'),esc(saved.document_no)],[t('版本','Revision'),'r'+saved.revision]])+'<div class="business-toolbar">'+
   '<button type="button" id="customs-bp-return" class="button secondary">'+t('返回BP表列表','Back to BP Sheets')+'</button>'+
   this.excelLink(saved.id,saved.revision,'button secondary')+
   '<a class="button primary" target="_blank" rel="noopener" href="/api/v1'+this.base()+'/'+saved.id+'/print?print=1">'+
   t('打开打印窗口','Open Print Window')+'</a></div></section>');
  $('customs-bp-return').onclick=()=>Router.go('/customs/bp?view=documents');
 },
 translateEditor(){return this.proof?this.printPreview():this.editor();}
};
