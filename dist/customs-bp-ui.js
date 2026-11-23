'use strict';

window.CustomsBP={
 selected:new Set(),selectedCustomer:null,product:null,preview:null,proof:null,editing:null,
 t:(zh,en)=>I18n.language==='en'?en:zh,
 base(){return CustomsWorkspace.base()+'/bp';},
 feedback(error){
  const labels={
   BP_INVALID_FIELD:['请核对填写内容及长度。','Check the submitted fields and their lengths.'],
   BP_SELECTION_REQUIRED:['请勾选至少一个批次。','Select at least one batch.'],
   BP_CUSTOMER_MISMATCH:['同一张BP表只能选择同一客户的批次。','Choose batches for a single customer per BP sheet.'],
   BP_NOT_FOUND:['BP表不存在或超出查看范围。','This BP sheet is unavailable in your scope.'],
   BP_SOURCE_CHANGED:['选中单据的审批或数据已变化，请重新选择并生成预览。','A selected document or approval changed. Select the batches again.'],
   BP_REQUIRED_DETAILS:['请补全批次号、车头号、公司、客户和产品。','Complete the batch, truck plate, issuer, customer and product.'],
   BP_INVALID_WEIGHT:['请填写有效的净重和毛重，净重不能大于毛重。','Enter valid weights. Net weight must not exceed gross weight.'],
   BP_INVALID_QUANTITY:['件数须为正整数。','Package count must be a positive whole number.'],
   BP_NUMBER_IN_USE:['该BP编号已使用，请换一个编号。','This BP number is already in use. Choose another number.']
  };
  return labels[error.message]?this.t(...labels[error.message]):error.message;
 },
 filter(q,customers){
  const t=this.t,field=(name,zh,en,type,limit='')=>'<label>'+t(zh,en)+'<input type="'+type+'" name="'+name+
   '" value="'+esc(q.get(name)||'')+'"'+(limit?' maxlength="'+limit+'"':'')+'></label>';
  const options='<option value="">'+t('全部客户','All Customers')+'</option>'+customers.map(({id,name})=>
   '<option value="'+esc(id)+'"'+(id===q.get('customer_id')?' selected':'')+'>'+esc(name)+'</option>').join('');
  return '<form id="customs-bp-filter" class="filters wms-filter-row wms-compact-filters">'+
   field('document_no','BP编号','BP Number','search',80)+field('batch_no','批次号','Lot No.','search',160)+
   '<label>'+t('客户','Customer')+'<select name="customer_id">'+options+'</select></label>'+
   field('generated_date','生成日期','Generated Date','date')+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+
   '</button><a class="button secondary" data-wms-reset href="/customs/bp">'+t('重置','Reset')+'</a></div></form>';
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
  for(const prefix of ['','document_'])q.set(prefix+'page_size',
   RowsPerPage.read('bp-'+prefix+'page',RowsPerPage.standard,q.get(prefix+'page_size')));
  const d=await API.request(base+'?'+q);
  if(location.href!==url||this.base()!==base)return;
  const headers=[['选择','Select'],['备货批次','Preparation Lot'],['客户','Customer'],['车头号','Truck Plate'],['车辆数','Vehicles'],['物流审批时间','Logistics Approval']];
  const rows=d.items.map((row,i)=>'<tr><td><input type="checkbox" data-bp-select="'+i+'" aria-label="'+esc(t('选择批次 ','Select batch ')+(row.batch||row.truck))+
   '"></td><td>'+esc(row.batch||'—')+'</td><td>'+esc(row.customer)+
   '</td><td>'+esc(row.truck||'—')+'</td><td>'+row.source_ids.length+'</td><td>'+esc(BusinessTime.display(row.approved_at))+'</td></tr>');
  Router.page(t('清关单据管理','Customs Documents'),'<div class="wms-page" data-page-composed data-no-i18n>'+CustomsWorkspace.nav('bp')+
   this.filter(q,d.customer_options)+
   '<section class="wms-section"><h2>'+t('可编制BP的批次','Batches Eligible for BP')+'</h2>'+
   ExportLicenses.table(headers,rows,'customs-bp-batches',true)+this.pagination('batches',q,d)+
   '<div class="business-toolbar"><span id="customs-bp-selection" role="status"></span>'+
   '<button type="button" class="button secondary" id="customs-bp-clear">'+t('清除已选','Clear Selection')+'</button>'+
   '<button type="button" class="button primary" id="customs-bp-preview">'+t('编制BP表','Prepare BP Sheet')+'</button></div>'+
   '<p class="error" id="customs-bp-error" role="alert"></p></section>'+
   '<section class="wms-section"><h2>'+t('已生成BP表','Generated BP Sheets')+'</h2>'+this.documents(d.documents)+
   this.pagination('documents',q,d)+'</section></div>');
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
  this.bindSelection(d.items);
  ProductContext.dirty=false;
 },
 documents(documents){
  const t=this.t,headers=[['BP编号','BP Number'],['车辆数','Vehicles'],['客户','Customer'],['生成时间','Generated At'],['操作','Actions']];
  const rows=documents.flatMap(row=>{
   const id=esc(row.id),panel='customs-bp-batch-'+id,number=esc(row.document_no);
   return ['<tr><td>'+number+'</td><td>'+row.vehicle_count+'</td><td>'+esc(row.customer||'—')+'</td><td>'+esc(BusinessTime.display(row.created_at))+
    '</td><td><div class="bp-archive-actions"><button type="button" class="button secondary compact" data-bp-expand="'+id+'" data-bp-number="'+number+
    '" aria-expanded="false" aria-controls="'+panel+'" aria-label="'+t('展开批次','Expand Batches')+' '+number+'">'+t('展开批次','Expand Batches')+
    '</button><a class="button secondary compact" href="/api/v1'+this.base()+'/'+id+'/print" target="_blank" rel="noopener">'+t('预览 / 打印','Preview / Print')+'</a></div></td></tr>',
    '<tr class="bp-batch-expansion" id="'+panel+'" hidden><td colspan="5"><div class="bp-batch-panel" aria-live="polite"></div></td></tr>'];
  });
  return ExportLicenses.table(headers,rows,'customs-bp-documents',true,{numeric:[1],actions:[4]});
 },
 async expand(button){
  const t=this.t,panel=$(button.getAttribute('aria-controls')),inside=panel.querySelector('.bp-batch-panel'),open=panel.hidden;
  panel.hidden=!open;
  const caption=open?t('收起批次','Collapse Batches'):t('展开批次','Expand Batches');
  button.textContent=caption;
  button.setAttribute('aria-label',caption+' '+button.dataset.bpNumber);
  button.setAttribute('aria-expanded',String(open));
  if(!open||inside.dataset.loaded||inside.getAttribute('aria-busy')==='true')return;
  inside.setAttribute('aria-busy','true');
  inside.textContent=t('正在读取批次…','Loading batches…');
  try{
   const {items}=await API.request(this.base()+'/'+button.dataset.bpExpand+'/batches');
   if(!inside.isConnected)return;
   const rows=items.map(row=>'<tr>'+[row.batch,row.truck,row.code].map(value=>'<td>'+esc(value||'—')+'</td>').join('')+'</tr>');
   inside.innerHTML=ExportLicenses.table([['批次号','Lot No.'],['车头号','Truck Plate'],['装车单号','Loading Order']],
    rows,panel.id+'-details',true);
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
    this.selectedCustomer?this.selectedCustomer.name+' · '+t('已选择 '+count+' 辆车，仅可继续勾选同一客户','Selected '+count+' vehicle(s). Add batches for this customer only.'):
     t('每张BP表可选择同一客户的一个或多个批次','Select one or more batches for a single customer');
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
 labels(){
  return {
   header:[['issuer','公司名称','Issuer',180],['address','公司地址','Company Address',360],['rccm','RCCM','RCCM',120],
    ['id_nat','ID-NAT','ID-NAT',120],['nif','NIF','NIF',120],['contact','联系信息','Contact',360],['customer','客户','Client',1000],
    ['product','产品','Product',120],['mode','运输方式','Transport Mode',60],['destination','最终目的地','Final Destination',1000],
    ['border','出境口岸','Exit Border',120],['agency','清关代理','Customs Agency',1000],['license','许可证','License',1000],
    ['loading_point','装车地点','Loading Point',360],['loading_date','装车日期','Loading Date',160],['signature_date','签署日期','Signature Date',80]],
   rows:[['batch','批次号','Lot No.',160],['truck','车头号','Truck Plate',80],['trailer_one','挂车1','Trailer 1',80],['trailer_two','挂车2','Trailer 2',80],
    ['container','集装箱','Container',80],['transporter','运输商','Transporter',160],['driver','司机','Driver',160],['passport','护照号','Passport',80],
    ['quantity','件数','Packages',8],['net_mt','净重（吨）','Net Weight (MT)',32],['gross_mt','毛重（吨）','Gross Weight (MT)',32]]
  };
 },
 open(){
  if(this.product===ProductContext.code&&this.preview)return this.translateEditor();
  return this.page();
 },
 frame(title,content){
  Router.page(title,'<div class="wms-page customs-bp-review" data-page-composed data-no-i18n>'+CustomsWorkspace.nav('bp')+content+'</div>');
 },
 required(section){
  return section==='header'?['issuer','customer','product']:['batch','truck','quantity','net_mt','gross_mt'];
 },
 issues(){
  const d=this.preview;
  const header=this.required('header').filter(key=>!d.header[key]);
  const rows=d.rows.flatMap((row,index)=>{
   const fields=this.required('rows').filter(key=>!row[key]);
   return fields.length?[{index,fields}]:[];
  });
  return {header,rows};
 },
 displayWeight(value){
  return value?Tonnes.fixed(Tonnes.scaled(value,3),3)+' MT':'—';
 },
 total(key){
  const values=this.preview.rows.map(row=>row[key]);
  if(values.some(v=>!v))return this.t('待补齐','Pending');
  if(key==='quantity')return values.reduce((sum,v)=>sum+BigInt(v),0n)+' '+this.t('件','pcs');
  const weight=values.reduce((sum,v)=>sum+Tonnes.scaled(v,6),0n);
  return this.displayWeight(Tonnes.fixed(weight,6));
 },
 editor(){
  const t=this.t,d=this.preview,l=this.labels(),issues=this.issues();
  const summary=['customer','product','loading_date','destination','license'];
  const productLabel={'CATHODE DE CUIVRE':t('阴极铜','Copper Cathodes'),'HYDROXYDE DE COBALT':t('氢氧化钴','Cobalt Hydroxide')};
  const summaryValue=key=>key==='product'&&Object.hasOwn(productLabel,d.header.product)?productLabel[d.header.product]:d.header[key];
  const heading=[[t('车辆','Vehicles'),d.rows.length],[t('件数','Packages'),this.total('quantity')],
   [t('总净重','Total Net'),this.total('net_mt')],[t('总毛重','Total Gross'),this.total('gross_mt')]];
  const columns=[['批次号','Lot No.'],['车头号','Truck Plate'],['运输商','Transporter'],['件数','Packages'],
   ['净重','Net Weight'],['毛重','Gross Weight'],['操作','Actions']];
  const edit=(index,caption)=>'<button type="button" class="button secondary compact" data-bp-edit="'+index+
   '" aria-label="'+esc(caption+' '+(d.rows[index].batch||d.rows[index].code))+'">'+caption+'</button>';
  const rows=d.rows.map((row,i)=>'<tr>'+[row.batch,row.truck,row.transporter,row.quantity,this.displayWeight(row.net_mt),this.displayWeight(row.gross_mt)]
   .map(v=>'<td>'+esc(v||'—')+'</td>').join('')+'<td>'+edit(i,t('编辑','Edit'))+'</td></tr>');
  const fieldNames=(keys,labels)=>labels.filter(([key])=>keys.includes(key)).map(([,z,e])=>t(z,e)).join(t('、',', '));
  const issueRows=issues.rows.map(({index,fields})=>'<li><span>'+esc((d.rows[index].batch||d.rows[index].code)+' · '+
   t('待补齐 ','Missing ')+fieldNames(fields,l.rows))+'</span><button type="button" class="button secondary compact" data-bp-missing="'+
   index+'">'+t('补充','Complete')+'</button></li>');
  if(issues.header.length)issueRows.unshift('<li><span>'+esc(t('表头待补齐 ','Header missing ')+fieldNames(issues.header,l.header))+
   '</span><button type="button" class="button secondary compact" id="bp-missing-header">'+t('补充','Complete')+'</button></li>');
  this.frame(t('编制BP表','Prepare BP Sheet'),
   '<form id="customs-bp-form" class="user-form" data-wms-validation>'+
   '<section class="wms-section"><div class="bp-review-heading"><h2>'+t('申报信息','Declaration Details')+'</h2>'+
   '<button type="button" id="bp-edit-header" class="button secondary compact">'+t('编辑表头','Edit Header')+'</button></div>'+
   '<div class="bp-review-overview"><label class="wms-field">'+t('BP编号','BP Number')+
   '<input id="bp-number" name="number" maxlength="80" value="'+esc(d.number)+'" aria-describedby="bp-number-hint customs-bp-save-error" required>'+
   '<small id="bp-number-hint"></small></label>'+UI46Pages.factList(l.header.filter(([key])=>summary.includes(key))
    .sort((a,b)=>summary.indexOf(a[0])-summary.indexOf(b[0])).map(([key,z,e])=>[t(z,e),esc(summaryValue(key)||'—')]))+'</div></section>'+
   '<section class="wms-section"><div class="bp-review-heading"><h2>'+t('车辆明细','Vehicles')+'</h2><span>'+
   esc(t('已选 '+d.rows.length+' 辆车',d.rows.length+(d.rows.length===1?' vehicle':' vehicles')))+'</span></div>'+
   ExportLicenses.table(columns,rows,'customs-bp-review-rows',true,{numeric:[3,4,5],actions:[6]})+
   (issueRows.length?'<ul class="bp-review-missing">'+issueRows.join('')+'</ul>':'')+'</section>'+
   '<section class="wms-section bp-review-footer">'+UI46Pages.factList(heading.map(([name,value])=>[name,esc(value)]))+
   '<div class="business-toolbar wms-form-actions"><button type="button" id="customs-bp-back" class="button secondary">'+
   t('返回批次','Back to Lots')+'</button><button class="button primary">'+t('预览BP表','Preview BP Sheet')+'</button></div>'+
   '<p id="customs-bp-save-error" class="error" role="alert"></p></section></form>');
  const form=$('customs-bp-form'),input=$('bp-number'),hint=$('bp-number-hint');
  const syncNumber=()=>{hint.textContent=input.value.trim()===d.suggestion?
   t('系统建议 · 生成时确认','Suggested · confirmed on generation'):t('手工编号','Manual number');};
  input.oninput=()=>{d.number=input.value;syncNumber();form.querySelector('[role=alert]').textContent='';};
  syncNumber();
  $('bp-edit-header').onclick=()=>this.edit('header');
  if($('bp-missing-header'))$('bp-missing-header').onclick=()=>this.edit('header',null,issues.header);
  for(const button of form.querySelectorAll('[data-bp-edit]'))button.onclick=()=>this.edit('rows',Number(button.dataset.bpEdit));
  for(const button of form.querySelectorAll('[data-bp-missing]'))button.onclick=()=>{
   const index=Number(button.dataset.bpMissing);
   this.edit('rows',index,issues.rows.find(item=>item.index===index).fields);
  };
  $('customs-bp-back').onclick=()=>{this.preview=null;this.proof=null;this.page();};
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   if(issues.header.length)return this.edit('header',null,issues.header);
   if(issues.rows.length){const {index,fields}=issues.rows[0];return this.edit('rows',index,fields);}
   try{
    const payload=this.payload();
    const outline=await API.request(this.base()+'/print/preview',{method:'POST',body:payload});
    if(!form.isConnected)return;
    if(JSON.stringify(payload)!==JSON.stringify(this.payload()))throw Error(t('资料已修改，请重新预览。','Details changed. Open the preview again.'));
    if(d.number.trim()===d.suggestion)d.number=d.suggestion=outline.number;
    this.proof={...outline,payload};this.printPreview();
   }catch(error){
    if(error.message==='BP_NUMBER_IN_USE'){input.setAttribute('aria-invalid','true');input.focus();}
    throw Error(this.feedback(error));
   }
  });
 },
 edit(section,index=null,subset=null){
  const d=this.preview,t=this.t,record=section==='header'?d.header:d.rows[index],required=this.required(section);
  const fields=this.labels()[section].filter(([key])=>!subset||subset.includes(key));
  const weight=key=>key.endsWith('_mt');
  const input=([key,z,e,max])=>'<label class="wms-field">'+t(z,e)+'<input name="'+key+'" maxlength="'+max+
   '" value="'+esc(record[key]||'')+'"'+(required.includes(key)?' required':'')+
   (key==='quantity'?' inputmode="numeric" pattern="[1-9][0-9]{0,7}"':weight(key)?' inputmode="decimal" pattern="[0-9]{1,9}(\\.[0-9]{1,6})?"':'')+'></label>';
  const title=section==='header'?t('编辑表头','Edit Header'):t('编辑车辆资料','Edit Vehicle')+' · '+(record.batch||record.code);
  this.editing={section,index,subset};
  dialog(title,'<form class="user-form" id="customs-bp-edit-fields" data-no-i18n data-wms-validation>'+
   '<div class="form-grid wms-field-grid">'+fields.map(input).join('')+'</div><p class="error" role="alert"></p>'+
   '<div class="business-toolbar wms-form-actions"><button type="button" id="bp-edit-cancel" class="button secondary">'+t('取消','Cancel')+
   '</button><button class="button primary">'+t('应用修改','Apply Changes')+'</button></div></form>');
  const form=$('customs-bp-edit-fields');
  $('bp-edit-cancel').onclick=()=>$('dialog').close();
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   const values={...record,...Object.fromEntries([...new FormData(form)].map(([key,v])=>[key,v.trim()]))};
   if(section==='rows'){
    const net=values.net_mt?Tonnes.scaled(values.net_mt,6):null,gross=values.gross_mt?Tonnes.scaled(values.gross_mt,6):null;
    if((net!==null&&net<=0n)||(gross!==null&&gross<=0n)||(net!==null&&gross!==null&&net>gross))throw Error(this.feedback(Error('BP_INVALID_WEIGHT')));
   }
   if(required.some(key=>fields.some(([field])=>field===key)&&!values[key]))throw Error(this.feedback(Error('BP_REQUIRED_DETAILS')));
   Object.assign(record,values);this.editing=null;
   $('dialog').close();ProductContext.dirty=true;this.editor();
   const target=section==='header'?$('bp-edit-header'):document.querySelector('[data-bp-edit="'+index+'"]');
   target?.focus();
  });
  form.querySelector('input')?.focus();
 },
 payload(){
  const d=this.preview;
  return {ids:d.ids,token:d.token,number:d.number.trim()===d.suggestion?'':d.number,header:{...d.header},
   rows:d.rows.map(({id,code,...fields})=>fields)};
 },
 printPreview(){
  const t=this.t;
  this.frame(t('BP表打印预览','BP Print Preview'),'<section class="wms-section">'+
   '<div class="bp-proof-sheet" role="region" tabindex="0" aria-label="'+t('A4横向打印样张','A4 Landscape Preview')+'">'+this.proof.content+'</div>'+
   '<form id="customs-bp-proof" class="user-form"><p class="error" role="alert"></p>'+
   '<div class="business-toolbar wms-form-actions"><button type="button" class="button secondary" id="customs-bp-back-edit">'+
   t('返回编辑','Back to Editor')+'</button><button class="button primary">'+t('生成BP表','Generate BP Sheet')+'</button></div></form></section>');
  $('customs-bp-back-edit').onclick=()=>{this.proof=null;this.editor();$('bp-number')?.focus();};
  const form=$('customs-bp-proof');
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   try{
    const saved=await API.request(this.base(),{method:'POST',body:this.proof.payload});
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
  this.frame(t('BP表已生成','BP Sheet Generated'),'<section class="wms-section">'+
   UI46Pages.factList([[t('BP编号','BP Number'),esc(saved.document_no)]])+'<div class="business-toolbar">'+
   '<button type="button" id="customs-bp-return" class="button secondary">'+t('返回BP表列表','Back to BP Sheets')+'</button>'+
   '<a class="button primary" target="_blank" rel="noopener" href="/api/v1'+this.base()+'/'+saved.id+'/print?print=1">'+
   t('打开打印窗口','Open Print Window')+'</a></div></section>');
  $('customs-bp-return').onclick=()=>this.page();
 },
 translateEditor(){
  if(this.proof)return this.printPreview();
  const form=$('customs-bp-edit-fields'),active=form&&$('dialog').open?this.editing:null;
  const values=active?new FormData(form):null;
  this.editor();
  if(active){
   this.edit(active.section,active.index,active.subset);
   for(const [key,value] of values)$('customs-bp-edit-fields').elements[key].value=value;
  }
 }
};
