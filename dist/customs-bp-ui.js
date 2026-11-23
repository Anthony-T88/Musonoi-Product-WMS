'use strict';

window.CustomsBP={
 selected:new Set(),product:null,preview:null,
 t:(zh,en)=>I18n.language==='en'?en:zh,
 base(){return CustomsWorkspace.base()+'/bp';},
 feedback(error){
  const labels={
   BP_INVALID_FIELD:['请核对填写内容及长度。','Check the submitted fields and their lengths.'],
   BP_SELECTION_REQUIRED:['请勾选至少一个批次。','Select at least one batch.'],
   BP_SOURCE_CHANGED:['选中单据的审批或数据已变化，请重新选择并生成预览。','A selected document or approval changed. Select the batches again.'],
   BP_REQUIRED_DETAILS:['请补全批次号、车头号、公司、客户和产品。','Complete the batch, truck plate, issuer, customer and product.'],
   BP_INVALID_WEIGHT:['请填写有效的净重和毛重，净重不能大于毛重。','Enter valid weights. Net weight must not exceed gross weight.'],
   BP_INVALID_QUANTITY:['件数须为正整数。','Package count must be a positive whole number.'],
   BP_NUMBER_IN_USE:['该BP编号已使用，请换一个编号。','This BP number is already in use. Choose another number.']
  };
  return labels[error.message]?this.t(...labels[error.message]):error.message;
 },
 async page(){
  if(this.product!==ProductContext.code){this.product=ProductContext.code;this.selected.clear();this.preview=null;}
  const t=this.t,q=new URLSearchParams(location.search),d=await API.request(this.base()+'?'+q);
  if(location.pathname!=='/customs/bp')return;
  const headers=[['选择','Select'],['备货批次','Preparation Lot'],['客户','Customer'],['车头号','Truck Plate'],['车辆数','Vehicles'],['物流审批时间','Logistics Approval']];
  const rows=d.items.map((row,i)=>'<tr><td><input type="checkbox" data-bp-select="'+i+'" aria-label="'+esc(t('选择批次 ','Select batch ')+(row.batch||row.truck))+
   '" '+(row.source_ids.every(id=>this.selected.has(id))?'checked':'')+'></td><td>'+esc(row.batch||'—')+'</td><td>'+esc(row.customer)+
   '</td><td>'+esc(row.truck||'—')+'</td><td>'+row.source_ids.length+'</td><td>'+esc(BusinessTime.display(row.approved_at))+'</td></tr>');
  const documents=d.documents.map(row=>'<tr><td>'+esc(row.document_no)+'</td><td>'+row.vehicle_count+'</td><td>'+esc(BusinessTime.display(row.created_at))+
   '</td><td><a class="button secondary compact" href="/api/v1'+this.base()+'/'+row.id+'/print" target="_blank" rel="noopener">'+t('预览 / 打印','Preview / Print')+'</a></td></tr>');
  Router.page(t('清关单据管理','Customs Documents'),'<div class="wms-page" data-page-composed data-no-i18n>'+CustomsWorkspace.nav('bp')+
   CustomsWorkspace.filter(q,'/customs/bp',t('批次号 / 车牌 / 客户','Lot / Truck / Customer'))+
   '<section class="wms-section"><h2>'+t('可编制BP的批次','Batches Eligible for BP')+'</h2>'+
   ExportLicenses.table(headers,rows,'customs-bp-batches',true)+CobaltStockUI.pager(d.page,d.total,d.page_size)+
   '<div class="business-toolbar"><span id="customs-bp-selection" role="status"></span>'+
   '<button type="button" class="button primary" id="customs-bp-preview">'+t('编制BP表','Prepare BP Sheet')+'</button></div>'+
   '<p class="error" id="customs-bp-error" role="alert"></p></section>'+
   '<section class="wms-section"><h2>'+t('已生成BP表','Generated BP Sheets')+'</h2>'+
   ExportLicenses.table([['BP编号','BP Number'],['车辆数','Vehicles'],['生成时间','Generated At'],['操作','Actions']],documents,'customs-bp-documents',true,{actions:[3]})+'</section></div>');
  CustomsWorkspace.bindFilter('/customs/bp',d);
  const button=$('customs-bp-preview'),status=$('customs-bp-selection'),sync=()=>{
   const count=this.selected.size;
   status.textContent=count>200?t('每张BP最多选200辆车。','Select up to 200 vehicles per BP sheet.'):t('已选择 '+count+' 辆车','Selected '+count+' vehicles');
   button.disabled=!count||count>200;
  };
  for(const input of document.querySelectorAll('[data-bp-select]'))input.onchange=()=>{
   for(const id of d.items[Number(input.dataset.bpSelect)].source_ids)if(input.checked)this.selected.add(id);else this.selected.delete(id);
   sync();
  };
  button.onclick=async()=>{
   button.disabled=true;
   const ids=[...this.selected].sort();
   try{const data=await API.request(this.base()+'/preview',{method:'POST',body:{ids}});if(button.isConnected){this.preview={...data,ids};this.editor();}}
   catch(error){if(button.isConnected)$('customs-bp-error').textContent=this.feedback(error);}
   finally{if(button.isConnected)sync();}
  };
  sync();ProductContext.dirty=false;
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
 editor(){
  const t=this.t,d=this.preview,l=this.labels();if(!d)return;
  const input=(key,label,value,max,required=false,mode='text')=>'<input name="'+key+'" aria-label="'+esc(label)+'" value="'+
   esc(value||'')+'" maxlength="'+max+'" inputmode="'+mode+'"'+(required?' required':'')+'>';
  const values=[['number','BP编号','BP Number',80],...l.header].map(([k,z,e,max])=>'<label class="wms-field">'+t(z,e)+
   input(k,t(z,e),k==='number'?d.number:d.header[k],max,['issuer','customer','product'].includes(k))+
   (k==='number'?'<small>'+t('留空时自动编号','Leave blank for automatic numbering')+'</small>':'')+'</label>').join('');
  const rows=d.rows.map((row,index)=>'<tr><td>'+esc(row.code)+'</td>'+l.rows.map(([k,z,e,max])=>'<td>'+
   input('row-'+index+'-'+k,t(z,e)+' · '+row.code,row[k],max,['batch','truck','quantity','net_mt','gross_mt'].includes(k),
    k==='quantity'?'numeric':k.endsWith('_mt')?'decimal':'text')+'</td>').join('')+'</tr>');
  Router.page(t('编制BP表','Prepare BP Sheet'),'<div class="wms-page" data-page-composed data-no-i18n>'+
   '<form id="customs-bp-form" class="user-form" data-wms-validation><section class="wms-section"><h2>'+t('申报表头','Declaration Header')+
   '</h2><div class="form-grid wms-field-grid">'+values+'</div></section><section class="wms-section"><h2>'+t('车辆与重量明细','Vehicle and Weight Details')+
   '</h2><div class="customs-bp-table-scroll" role="region" tabindex="0" aria-label="'+t('车辆与重量明细','Vehicle and Weight Details')+'">'+
   ExportLicenses.table([['装车单号','Loading Order'],...l.rows.map(([,z,e])=>[z,e])],rows,'customs-bp-edit-rows',false)+'</div>'+
   '<p class="wms-feedback" id="customs-bp-totals" role="status"></p></section><p id="customs-bp-save-error" class="error" role="alert"></p>'+
   '<div class="business-toolbar wms-form-actions"><button type="button" class="button secondary" id="customs-bp-back">'+t('返回选择','Back to Selection')+
   '</button><button class="button primary">'+t('生成BP表','Generate BP Sheet')+'</button></div></form></div>');
  const form=$('customs-bp-form');
  const sync=()=>{
   const v=this.read(form,d,l);
   try{
    if(v.rows.some(r=>!/^\d+$/.test(r.quantity)||!r.net_mt||!r.gross_mt))throw Error();
    let units=0n,net=0n,gross=0n;
    for(const row of v.rows){units+=BigInt(row.quantity);net+=Tonnes.scaled(row.net_mt,6);gross+=Tonnes.scaled(row.gross_mt,6);}
    $('customs-bp-totals').textContent=t('合计','Total')+' · '+units+' '+t('件','packages')+' · '+t('净重','Net')+' '+Tonnes.fixed(net,6)+' MT · '+t('毛重','Gross')+' '+Tonnes.fixed(gross,6)+' MT';
   }catch{$('customs-bp-totals').textContent=t('请补全件数和重量后核对合计。','Complete the package counts and weights to see totals.');}
  };
  form.oninput=sync;sync();
  $('customs-bp-back').onclick=()=>{this.preview=null;this.page();};
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   try{
    const saved=await API.request(this.base(),{method:'POST',body:this.read(form,d,l)});
    this.preview=null;this.selected.clear();ProductContext.dirty=false;this.saved(saved);
   }catch(error){throw Error(this.feedback(error));}
  });
 },
 saved(saved){
  const t=this.t;
  Router.page(t('BP表已生成','BP Sheet Generated'),'<div class="wms-page" data-page-composed data-no-i18n><section class="wms-section">'+
   UI46Pages.factList([[t('BP编号','BP Number'),esc(saved.document_no)]])+'<div class="business-toolbar">'+
   '<button type="button" id="customs-bp-return" class="button secondary">'+t('返回BP表列表','Back to BP Sheets')+'</button>'+
   '<a class="button primary" target="_blank" rel="noopener" href="/api/v1'+this.base()+'/'+saved.id+'/print?print=1">'+
   t('打开打印窗口','Open Print Window')+'</a></div></section></div>');
  $('customs-bp-return').onclick=()=>this.page();
 },
 read(form,d,l){
  const data=new FormData(form);
  return {ids:d.ids,token:d.token,number:data.get('number'),header:Object.fromEntries(l.header.map(([k])=>[k,data.get(k)])),
   rows:d.rows.map((_,i)=>Object.fromEntries(l.rows.map(([k])=>[k,data.get('row-'+i+'-'+k)])))};
 },
 translateEditor(){
  const d=this.preview,v=this.read($('customs-bp-form'),d,this.labels());
  this.preview={...d,header:v.header,rows:d.rows.map((row,i)=>({...row,...v.rows[i]})),number:v.number};
  this.editor();
 }
};
