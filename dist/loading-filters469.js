'use strict';
window.LoadingFiltersR9={
 t:(z,e)=>I18n.language==='en'?e:z,
 fields(form,customers,co,query){const t=this.t,q=new URLSearchParams(location.search),state=form.elements[co&&!query?'arrival_state':'status']?.closest('label');if(!state)return;const current=state.querySelector('select').name;
  let grid=form.querySelector('.form-grid');if(!grid){grid=document.createElement('div');grid.className='form-grid';form.prepend(grid);}const oldMonth=form.elements.shipment_month?.closest('label'),oldCustomer=form.elements.customer_id?.closest('label');
  const month=oldMonth||document.createElement('label');if(!oldMonth)month.innerHTML=t('发运月份','Shipment Month')+'<input name="shipment_month" type="month" value="'+esc(q.get('shipment_month')||'')+'">';
  const date=document.createElement('label'),dateKey=query?'planned_load_date':'arrival_date';
  date.innerHTML=t(query?'计划装车日期':'到达时间',query?'Planned Loading Date':'Arrival Date')+'<input type="date" name="'+dateKey+'" value="'+esc(q.get(dateKey)||'')+'">';
  const customer=oldCustomer||document.createElement('label');customer.innerHTML=t('客户','Customer')+'<select name="customer_id"><option value="">'+t('全部客户','All Customers')+'</option>'+customers.map(c=>'<option value="'+c.id+'" '+(q.get('customer_id')===c.id?'selected':'')+'>'+esc(c.name||c.customer_name)+'</option>').join('')+'</select>';
  for(const label of [...form.querySelectorAll('label')])if(![month,customer,state].includes(label))label.remove();grid.replaceChildren(month,customer,date,state);
  if(query){const search=document.createElement('label');search.innerHTML=t('单号、批次号或合同号','Document, Batch or Contract No.')+'<input type="search" name="search" maxlength="160" placeholder="'+t('装箱单号 / 发票号 / 批次号 / 合同号','Packing List / Invoice / Batch / Contract')+'" value="'+esc(q.get('search')||'')+'">';grid.prepend(search);form.classList.add('r9-plan-query');}state.querySelector('select').name=current;
  form.classList.add('r9-document-filter');form.dataset.v34Reset='true';form.dataset.r9FilterReady='true';return {q,grid};
 },
 actions(form,co,query){const t=this.t;let bar=form.querySelector('.business-toolbar');if(!bar){bar=document.createElement('div');bar.className='business-toolbar';form.append(bar);}bar.classList.add('r9-filter-actions');let submit=form.querySelector('button:not([type]),button[type=submit]');if(!submit){submit=document.createElement('button');submit.className='button secondary';bar.append(submit);}submit.textContent=t('查询','Search');bar.prepend(submit);
  const oldExport=form.querySelector('#yard-export,#co-arrival-export');let exportButton=oldExport;if(!exportButton&&Business.can('inventory:export')){exportButton=document.createElement('button');exportButton.type='button';exportButton.className='button secondary';exportButton.id='r9-loading-export';}if(exportButton){exportButton.textContent=t('导出Excel','Export Excel');bar.append(exportButton);exportButton.onclick=async()=>{const values=Object.fromEntries(new FormData(form));if(!query)return co?CobaltSalesUI.exportArrivals(new URLSearchParams(values)):LoadingYard.export(new URLSearchParams(values));exportButton.disabled=true;try{const q=new URLSearchParams(location.search),r=await API.request(co?'/cobalt/loading/plans/export':'/v34/lists/loading/export',{method:'POST',body:{...values,...(q.get('sort')?{sort:q.get('sort'),direction:q.get('direction')||'desc'}:{}),language:I18n.language},binary:true}),url=URL.createObjectURL(r.blob),a=document.createElement('a');a.href=url;a.download=r.filename||'Loading-Plans.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){notify(e.message);}finally{if(exportButton.isConnected)exportButton.disabled=false;}};}
  for(const n of [...form.querySelectorAll('a[href],button[type=button]')])if(n!==exportButton&&!n.matches('#yard-export,#co-arrival-export'))n.remove();const reset=document.createElement('a');reset.className='button secondary';reset.href=query?'/loading-plans/query':'/loading-plans';reset.textContent=t('重置筛选','Reset');bar.append(reset);form.append(bar);
 },
 query(form,data,co){
  this.fields(form,data.customer_options||[],co,true);this.actions(form,co,true);
  const totals=document.createElement('div');totals.className='yard-counts r9-loading-totals';
  const states=co?['DRAFT','MATCHED','OUTBOUND']:['DRAFT','WAITING','MATCHED','LOADING','PENDING_OUTBOUND','COMPLETED','CANCELLED'];
  const cards=[[this.t('合计','Total'),data.scope_total??data.total],...states.map(key=>[co?CobaltLoadingUI.state(key):I18n.translate(ManagementLabels.names[key]||key,true),data.state_counts?.[key]||0])];
  totals.innerHTML=cards.map(([label,count])=>'<article><span>'+esc(label)+'</span><strong>'+count+'</strong></article>').join('');
  form.before(totals);
 },
 arrivals(form,customers,co){this.fields(form,customers,co,false);this.actions(form,co,false);}
};
