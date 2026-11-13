'use strict';
window.OverviewAnalysis={
 types:{},current:null,sequence:0,
 t:(z,e)=>I18n.language==='en'?e:z,
 can:p=>CurrentUser.permissions.includes(p),
 number(value,digits=4){if(value==null)return this.t('未知','Unknown');const n=Number(value);return Number.isFinite(n)?n.toLocaleString(I18n.language==='en'?'en-US':'zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}):this.t('未知','Unknown');},
 mt:kg=>kg==null?null:Tonnes.fixed(Tonnes.scaled(String(kg),9)/1000n,9),
 sum(rows,key){if(!rows.length||rows.some(r=>r[key]==null))return null;return Tonnes.fixed(rows.reduce((n,r)=>n+Tonnes.scaled(String(r[key]),9),0n),9);},
 panel(z,e,note,body,extra=''){return '<section class="oa-panel '+extra+'"><header><h2>'+this.t(z,e)+'</h2>'+(note?'<p>'+note+'</p>':'')+'</header>'+body+'</section>';},
 empty(z,e){return '<p class="oa-empty">'+this.t(z,e)+'</p>';},
 structure(row,unit,weight=true,showZero=false){
  const t=this.t,parts=[];
  if(row.batches||showZero)parts.push(CountValues.display(row.batches)+' '+t('批次',Number(row.batches)===1?'lot':'lots'));
  const quantity=row.quantity??row.bundles??null;
  parts.push(CountValues.display(quantity)+' '+unit);
  const net=row.known_net_mt??row.net_weight??(showZero&&quantity!==null&&Number(quantity)===0?0:null);
  if(weight&&(net!=null||showZero))parts.push(this.number(net)+' '+t('吨','MT'));
  return parts.join(' / ');
 },
 batchCard(label,row,weight=false){
  const t=this.t,quantity=this.structure(row,this.t(row.quantity!==undefined?'包':'捆包',row.quantity!==undefined?'bags':'bundles'),weight,true);
  return '<article class="oa-kpi"><span>'+label+'</span><div class="oa-batch-value"><strong data-no-i18n>'+quantity+'</strong></div>'+(weight&&(row.unknown_weights||row.unknown)?'<p>'+t('待确认重量数量 ','Items awaiting confirmed weight ')+(row.unknown_weights||row.unknown)+'</p>':'')+'</article>';
 },
 card(label,value,unit,note,featured=false){return '<article class="oa-kpi'+(featured?' is-featured':'')+'"><span>'+label+'</span><div><strong data-no-i18n>'+esc(value)+'</strong><small>'+unit+'</small></div><p>'+note+'</p></article>';},
 rate(target,posted){return target!=null&&Number(target)>0&&posted!=null?Number(posted)/Number(target)*100:null;},
 outboundNet(data,co){
  const imported=data.historical_imports?.rows.filter(row=>row.direction==='OUTBOUND')||[];
  const posted=co?this.mt(data.shipping.actual_net_kg):data.outbound.net_weight;
  return imported.length?Tonnes.fixed(Tonnes.scaled(posted??'0',9)+imported.reduce((sum,row)=>sum+Tonnes.scaled(row.net_mt,9),0n),9):posted;
 },
 model(data,co){const a=data.analysis||{},flows=data.chart_trend.rows,plans=a.execution?.map(r=>co?{id:r.id,code:r.code,customer:r.customer_name,target:r.planned_physical_mt,outbound:this.mt(r.actual_net_kg),invoiced:this.mt(r.invoiced_net_kg),prepared:null,assigned:null,unknown:null,planned_vehicles:r.planned_vehicles,dispatched:r.dispatched_vehicles,loaded:r.loaded_vehicles}: {id:r.id,code:r.document_no,customer:r.customer_name,target:r.planned_net_weight,outbound:r.outbound_net_weight,invoiced:r.invoiced_net_weight,prepared:r.prepared_net_weight,assigned:r.assigned_net_weight,unknown:r.unknown_weights})||[],target=this.sum(plans,'target'),posted=this.sum(plans,'invoiced');return {raw:data,co,unit:this.t(co?'包':'捆',co?'bags':'bundles'),physical:co?data.inventory.bags:data.metrics.physical.bundles,known:co?this.mt(data.inventory.actual_net_kg):data.metrics.physical.known_net_weight,unknown:co?data.inventory.unconfirmed_bags:data.metrics.physical.unknown_weights,outbound:this.outboundNet(data,co),outboundUnknown:co?flows.reduce((n,r)=>n+Number(r.unknown_weights||0),0):data.outbound.unknown_weights,vehicles:flows.reduce((n,r)=>n+r.vehicles,0),customers:a.current_customers||[],states:a.states||[],plans,executionAllowed:a.execution!==null&&a.execution!==undefined,target,posted,rate:this.rate(target,posted),tasks:data.todos||[],alerts:data.alerts||[],trend:data.chart_trend};},
 historyNotice(window,unavailable=false){
  if(!window?.history_started_at)return '';
  const time=BusinessTime.display(window.history_started_at),t=this.t;
  return t('库存记录可追溯至 ','Inventory records start on ')+time+t('（卢本巴希时间）。',' (Lubumbashi time).')+
    (unavailable?t('所选期间没有可追溯的数据，请选择此时点或之后的日期。','The selected period has no traceable data. Choose this date or a later one.'):
    window.history_unavailable?t('所选截止日的库存无法追溯。趋势按所选期间的已确认单据显示。','Inventory is unavailable at the selected cutoff. Trends use confirmed documents in the selected period.'):
    window.partial?t('库存快照从该时点起可查，单据趋势按所选期间统计。','Inventory snapshots are available from this time. Document trends use the selected period.'):'');
 },
 historyError(error){return error.code==='HISTORY_BEFORE_START'?this.historyNotice(error.details,true):error.message;},
 copper(data){const parent=document.getElementById('dashboard-content');if(parent)this.render(parent,data,false);},
 cobaltCards(analysis,history){
  if(!analysis?.stock_cards)return null;
  const cards=analysis.stock_cards;
  const imported=history?.rows.filter(row=>row.direction==='OUTBOUND')||[];
  const outbound={...cards.outbound};
  for(const row of imported){
   outbound.quantity=Number(outbound.quantity||0)+row.units;
   outbound.batches=Number(outbound.batches||0)+row.documents;
   outbound.known_net_mt=Tonnes.fixed(Tonnes.scaled(outbound.known_net_mt||'0',9)+Tonnes.scaled(row.net_mt,9),9);
  }
  return {...cards,outbound,loading:analysis.states?.find(row=>row.key==='assigned')||cards.loading,
   loaded:cards.loaded||analysis.states?.find(row=>row.key==='loaded')||{quantity:0,batches:0}};
 },
 cobalt(data){const parent=document.querySelector('.co-overview-page');if(parent)this.render(parent,data,true);},
 render(parent,data,co){if(!data.chart_trend)return;const filter=co?parent.querySelector('.overview-filter-box'):null,model=this.model(data,co),root=document.createElement('div');root.className='oa467';root.dataset.noI18n='';root.dataset.overviewAnalysis='true';root.dataset.product=co?'CO_HYDROXIDE':'CU_CATHODE';const generation=++this.sequence;this.current={root,data,co,generation};
 const t=this.t,prepared=co?null:data.metrics.prepared_pending_outbound,unavailable=!!data.window.history_unavailable,cards=co?this.cobaltCards(data.analysis,data.historical_imports):null;
 root.innerHTML=(data.window?.history_started_at?'<p class="'+(data.window.partial?'oa-warning':'oa-scope')+'">'+esc(this.historyNotice(data.window))+'</p>':'')+
 (co&&data.metal?CobaltMetal.overview(data.metal,cards):'<div class="oa-kpis'+(co?'':' oa-kpis-copper')+'">'+(co?(cards?
 this.batchCard(t('备货作业中吨包','Bags in Preparation'),cards.preparing)+
 this.batchCard(t('已备货待出库库存','Prepared Stock Awaiting Outbound'),cards.prepared,true)+
 this.batchCard(t('装车中库存','Stock in Loading'),cards.loading,true)+
 this.batchCard(t('已出库重量','Outbound Weight'),cards.outbound,true):''):
 (unavailable?'':this.card(t('可用捆包库存','Available Bundle Stock'),CountValues.display(data.metrics.available.bundles),t('捆','bundles'),'')+
 this.batchCard(t('备货作业中捆包','Bundles in Preparation'),data.metrics.preparing)+
 this.batchCard(t('已备货待出库库存','Prepared Stock Awaiting Outbound'),prepared,true)+
 this.batchCard(t('装车中库存','Stock in Loading'),data.metrics.loading,true))+
 (co?'':this.card(t('已出库重量','Outbound Weight'),this.number(model.outbound),t('吨','MT'),CountValues.display(model.vehicles)+' '+t('辆','vehicles'))))+
 (co?'':this.card(t('销售计划履约','Sales Fulfilment'),model.rate==null?'—':this.number(model.rate,1),'%',''))+'</div>')+
 '<div class="oa-grid oa-charts">'+['net','vehicles','receipts','stock'].map(key=>co&&data.metal&&key==='receipts'?this.panel('月度发运金属量统计','Monthly Shipment Metal','',CobaltMetal.chart(data.metal.months),'oa-chart oa-metal-chart'):this.chart(model,key)).join('')+'</div><div class="oa-grid oa-three">'+(unavailable?'':this.stock(model)+this.customers(model))+this.attention(model)+'</div>'+this.execution(model)+this.flow(model)+(this.can('report:read')?this.panel('收发存与月度预检','Stock Balance & Monthly Precheck',t('产品＋仓库＋自然月 · 只读，不锁账','Product + warehouse + calendar month · Read-only'),'<div data-oa-balance>'+t('正在读取整仓月度预检…','Loading warehouse monthly precheck…')+'</div>','oa-balance-panel'):'');
 parent.replaceChildren(...(filter?[filter]:[]),root);this.bindCharts(root,model);window.ExportLicenses?.mountOverview(root);if(this.can('report:read'))this.loadBalance(this.current,model);
 },
 chartDefinition(model,key){
  const t=this.t,quantity=model.unit,unknown=t('重量待确认数量','Unconfirmed Weight Count');
  const net=[
   {key:'inbound_net_weight',name:t('入库净重','Inbound Net'),css:'oa-inbound'},
   {key:'net_weight',name:t('出库净重','Outbound Net'),css:'oa-outbound'}
  ];
  const definitions={
   net:{title:t('出入库净重统计','Inbound & Outbound Net Weight'),unit:'MT',series:net,columns:[
    ['inbound_net_weight',t('入库净重（吨）','Inbound Net (MT)'),true],['net_weight',t('出库净重（吨）','Outbound Net (MT)'),true],
    ['inbound_unknown_weights',t('入库重量待确认','Unconfirmed Inbound Weights')],['unknown_weights',t('出库重量待确认','Unconfirmed Outbound Weights')]]},
   vehicles:{title:t('出库车辆统计','Outbound Vehicles'),unit:t('辆','vehicles'),count:true,series:[
    {key:'vehicles',name:t('出库车辆','Outbound Vehicles'),css:'oa-outbound'}],columns:[['vehicles',t('出库车辆','Outbound Vehicles')]]},
   receipts:{title:t(model.co?'入库吨包统计':'入库捆包统计',model.co?'Inbound Bags':'Inbound Bundles'),unit:quantity,count:true,series:[
    {key:'inbound_units',name:t(model.co?'入库吨包':'入库捆包',model.co?'Inbound Bags':'Inbound Bundles'),css:'oa-inbound'}],
    columns:[['inbound_units',t('入库数量','Received Quantity')],['inbound_unknown_weights',unknown]]},
   unprepared:{title:t('未完成备货的捆包数','Bundles Awaiting Preparation Completion'),unit:quantity,
    series:[{key:'stock_unprepared_bundles',name:t('未完成备货的捆包数','Bundles Awaiting Preparation Completion'),css:'oa-inbound'}],
    columns:[['stock_unprepared_bundles',t('未完成备货的捆包数','Bundles Awaiting Preparation Completion')]]},
   prepared:{title:t('已备货的在库净重','Prepared Stock Net Weight'),unit:'MT',
    series:[{key:'stock_prepared_net_mt',name:t('已备货的在库净重','Prepared Stock Net Weight'),css:'oa-inbound'}],
    columns:[['stock_prepared_net_mt',t('已备货的在库净重（吨）','Prepared Stock Net Weight (MT)'),true]]}
  };
  if(key==='stock'){
   const {unprepared,prepared}=definitions;
   return {
    title:t('库存趋势统计','Stock Trend'),unit:unprepared.unit,count:true,secondaryUnit:t('吨','MT'),
    series:[...unprepared.series,...prepared.series.map(item=>({...item,css:'oa-outbound',secondary:true}))],
    columns:[...unprepared.columns,...prepared.columns]
   };
  }
  return definitions[key];
 },
 chart(model,key){
  if(key==='stock'&&model.co)return this.panel('库存趋势统计','Stock Trend','',this.chart(model,'prepared'),'oa-stock-trends');
  const t=this.t,{title,unit,secondaryUnit,columns,series}=this.chartDefinition(model,key),rows=model.trend.rows,type=this.chartType(model.co,key);
  const sum=name=>rows.reduce((n,r)=>n+Number(r[name]||0),0),stock=key==='stock'||key==='prepared';
  const last=stock&&rows.at(-1);
  const netTotal=rows.some(r=>r.inbound_units)&&!rows.some(r=>r.inbound_units&&r.inbound_net_weight!=null)?null:sum('inbound_net_weight');
  const figures={
   net:t('入库','Inbound')+' '+this.number(netTotal)+' MT · '+t('出库','Outbound')+' '+this.number(model.outbound)+' MT',
   vehicles:t('合计','Total')+' '+CountValues.display(model.vehicles)+' '+unit,
   receipts:t('合计','Total')+' '+CountValues.display(sum('inbound_units'))+' '+unit
  };
  const notes={
   net:t('入库按原单实际入库日期，净重只汇总已知部分。','Receipts use recorded receipt dates. Net weights sum confirmed values.'),
   receipts:t('按实际入库日期统计已确认单据，包含净重待确认的数量。','Counts confirmed receipts by recorded receipt date, including items awaiting weight confirmation.'),
   prepared:model.trend.stock_scope_supported===false?t('当前筛选范围没有可核实的历史库存。','Verified historical stock is unavailable for this scope.'):t('按日末或月末库存快照统计，未到期的期间截至所选时点。记录或重量依据缺失时显示空缺。','Uses day-end or month-end snapshots, capped at the selected cutoff. Missing records or weight evidence appear blank.')
  };
  const units=secondaryUnit?t('左轴','Left axis')+' · '+unit+'　'+t('右轴','Right axis')+' · '+secondaryUnit:t('单位','Unit')+' · '+unit;
  const controls='<div class="oa-chart-controls"><span>'+units+'</span><div role="group" aria-label="'+title+'">'+[['bar',t('柱状图','Bar')],['line',t('折线图','Line')]].map(([value,label])=>'<button type="button" class="button secondary compact" data-oa-type="'+value+'" data-oa-key="'+key+'" aria-pressed="'+(value===type)+'">'+label+'</button>').join('')+'</div></div>';
  const legend='<div class="oa-legend">'+series.map(s=>'<span class="'+(s.css==='oa-outbound'?'is-outbound':'is-inbound')+'">'+s.name+'</span>').join('')+'</div>';
  const table='<details><summary>'+t('查看图表数据','View Chart Data')+'</summary><div class="oa-table-scroll"><table><thead><tr><th>'+t('期间','Period')+'</th>'+columns.map(([,label])=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.period)+'</td>'+columns.map(([field,,decimal])=>'<td class="oa-numeric">'+(r[field]==null?'—':decimal?this.number(r[field]):esc(CountValues.display(r[field])))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>';
  const latest=last?series.map(item=>{
   const reading=last[item.key];
   const display=reading==null?'—':item.secondary||unit==='MT'?this.number(reading):CountValues.display(reading);
   return display+' '+(item.secondary?secondaryUnit:unit);
  }).join(' / '):null;
  const summary=stock?last?last.period+' · '+latest:t('暂无可追溯库存','No Traceable Stock'):figures[key];
  return this.panel(title,title,esc(model.trend.from)+' — '+esc(model.trend.to)+' · '+(model.trend.granularity==='month'?t('按月','Monthly'):t('按日','Daily')),
   controls+legend+'<div class="oa-plot-scroll" tabindex="0" aria-label="'+title+'"><div class="oa-plot" data-oa-plot="'+key+'" role="group" aria-label="'+title+'"></div></div><div class="oa-chart-footer"><strong>'+esc(summary)+'</strong></div>'+table+((notes[key]||secondaryUnit)?'<p class="oa-note">'+(notes[key]||notes.prepared)+'</p>':''),'oa-chart'+(secondaryUnit?' oa-stock-trends':''));
 },
 chartType(co,key){
  const storageKey='wms-overview-analysis:'+CurrentUser.id+':'+(co?'co':'cu')+':'+key,fallback=['net','stock','prepared'].includes(key)?'line':'bar';
  try{const saved=localStorage.getItem(storageKey);return this.types[storageKey]||(['bar','line'].includes(saved)?saved:fallback);}catch{return this.types[storageKey]||fallback;}
 },
 bindCharts(root,model){
  const plots=[...root.querySelectorAll('[data-oa-plot]')],draw=()=>{if(root.isConnected)for(const plot of plots)this.draw(root,model,plot.dataset.oaPlot);};
  for(const plot of plots)plot.style.minWidth=this.plotWidth(model)+'px';
  for(const b of root.querySelectorAll('[data-oa-type]'))b.onclick=()=>{
   const key='wms-overview-analysis:'+CurrentUser.id+':'+(model.co?'co':'cu')+':'+b.dataset.oaKey;
   this.types[key]=b.dataset.oaType;try{localStorage.setItem(key,b.dataset.oaType);}catch{}this.draw(root,model,b.dataset.oaKey);
  };
  this.observer?.disconnect();
  if(typeof ResizeObserver==='function'){
   this.observer=new ResizeObserver(()=>{if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;draw();});});
   for(const plot of plots)this.observer.observe(plot);
  }
  requestAnimationFrame(draw);
 },
 draw(root,model,key){
  const definition=this.chartDefinition(model,key),{series}=definition,type=this.chartType(model.co,key),rows=model.trend.rows;
  for(const b of root.querySelectorAll('[data-oa-key="'+key+'"]'))b.setAttribute('aria-pressed',String(b.dataset.oaType===type));
  const hasRecords=key==='net'?rows.some(r=>r.vehicles||r.inbound_units||r.historical_outbound_units):rows.some(r=>series.some(s=>r[s.key]!=null));
  this.plot(root.querySelector('[data-oa-plot="'+key+'"]'),model,definition,type,hasRecords);
 },
 plotWidth(model){return Math.max(200,82+model.trend.rows.length*22);},
 plot(host,model,{series,unit,secondaryUnit,count=false},type,hasRecords){
  if(!host||!host.parentElement.clientWidth)return;
  const rows=model.trend.rows,width=host.clientWidth,height=280,L=62,R=secondaryUnit?62:20,T=24,B=88;
  const w=width-L-R,h=height-T-B,right=width-R;
  host.dataset.chartType=type;host.dataset.rows=JSON.stringify(rows);
  if(!rows.length){host.innerHTML=this.empty('所选期间暂无记录','No records in this period');return;}
  const data=series.map(item=>({...item,values:rows.map(row=>{
   const value=row[item.key];
   return value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
  })}));
  const maxFor=secondary=>Math.max(0,...data.filter(item=>Boolean(item.secondary)===secondary).flatMap(item=>item.values));
  const x=i=>L+(i+.5)*w/rows.length;
  const makeAxis=(max,integer,divisions)=>{
   const target=Math.max(integer?1:0,(max||1)/divisions);
   const power=10**Math.floor(Math.log10(target));
   const step=[1,2,5,10].find(n=>n*power>=target)*power;
   const ticks=secondaryUnit?divisions:Math.max(1,Math.ceil(max/step));
   const digits=Math.min(4,Math.max(0,-Math.floor(Math.log10(step))));
   return {ticks,step,y:value=>T+h-value/(ticks*step)*h,
    label:value=>integer?CountValues.display(value):this.number(value,digits)};
  };
  const leftAxis=makeAxis(maxFor(false),count,secondaryUnit?4:3);
  const rightAxis=secondaryUnit?makeAxis(maxFor(true),false,4):null;
  const units=secondaryUnit?unit+' / '+secondaryUnit:unit;
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(series.map(item=>item.name).join(' / ')+' · '+units)+'">';
  const axisText=(text,x,y,align,side='')=>'<text class="oa-axis '+side+'" x="'+x+'" y="'+y+'" text-anchor="'+align+'">'+esc(text)+'</text>';
  for(let i=0;i<=leftAxis.ticks;i++){
   const tick=i*leftAxis.step,y=leftAxis.y(tick);
   svg+='<line class="oa-gridline" x1="'+L+'" y1="'+y+'" x2="'+right+'" y2="'+y+'"/>';
   svg+=axisText(leftAxis.label(tick),L-9,y+4,'end','oa-y-left');
   if(rightAxis)svg+=axisText(rightAxis.label(i*rightAxis.step),right+9,y+4,'start','oa-y-right');
  }
  const labelY=height-B+12;
  rows.forEach((row,i)=>{
   const xx=x(i);
   svg+='<text class="oa-axis oa-date-tick" x="'+xx+'" y="'+labelY+'" transform="rotate(-54 '+xx+' '+labelY+')" text-anchor="end">'+esc(row.period)+'</text>';
  });
  const barWidth=Math.min(24,w/rows.length*.7/series.length);
  data.forEach((item,j)=>{
   const {y}=item.secondary?rightAxis:leftAxis,seriesUnit=item.secondary?secondaryUnit:unit;
   const tip=(value,i)=>'<title>'+esc(rows[i].period+' · '+item.name+' · '+
    (count&&!item.secondary?CountValues.display(rows[i][item.key]):this.number(value,4))+' '+seriesUnit)+'</title>';
   if(type==='bar'){
    svg+=item.values.map((value,i)=>{
     if(value==null)return '';
     const barHeight=y(0)-y(value);
     return '<rect class="oa-bar '+item.css+'" x="'+(x(i)+(j-(series.length-1)/2)*barWidth-barWidth/2)+'" y="'+
      (barHeight?y(value):y(0)-1)+'" width="'+Math.max(1,barWidth-1)+'" height="'+Math.max(1,barHeight)+'">'+tip(value,i)+'</rect>';
    }).join('');
   }else{
    let connected=false;
    const path=item.values.map((value,i)=>{
     if(value==null){connected=false;return '';}
     const segment=(connected?'L':'M')+x(i)+','+y(value);connected=true;return segment;
    }).join(' ');
    svg+='<path class="oa-line '+item.css+'" d="'+path+'"/>';
    svg+=item.values.map((value,i)=>value==null?'':j===0?
     '<circle class="oa-dot '+item.css+'" cx="'+x(i)+'" cy="'+y(value)+'" r="3.5">'+tip(value,i)+'</circle>':
     '<rect class="oa-dot '+item.css+'" x="'+(x(i)-3)+'" y="'+(y(value)-3)+'" width="6" height="6">'+tip(value,i)+'</rect>').join('');
   }
  });
  const unitLabel=(label,x)=>'<text class="oa-axis" transform="translate('+x+' '+(T+h/2)+') rotate(-90)" text-anchor="middle">'+esc(label)+'</text>';
  svg+=axisText(this.t('日期','Date'),L+w/2,height-3,'middle')+unitLabel(unit,13);
  if(rightAxis)svg+=unitLabel(secondaryUnit,width-13);
  host.innerHTML=svg+'</svg>'+(!hasRecords?'<p class="oa-plot-empty">'+this.t('所选期间暂无记录','No records in this period')+'</p>':'');
  const tooltip=document.createElement('div');tooltip.className='oa-hover-tip';tooltip.hidden=true;tooltip.setAttribute('role','tooltip');host.append(tooltip);
  const show=index=>{
   const row=rows[index];
   const values=data.map(item=>item.name+' · '+(item.values[index]===null?'—':
    (count&&!item.secondary?CountValues.display(row[item.key]):this.number(item.values[index]))+' '+(item.secondary?secondaryUnit:unit)));
   tooltip.textContent=[row.period,...values].join('\n');tooltip.hidden=false;
   tooltip.style.left=Math.max(0,Math.min(width-tooltip.offsetWidth,x(index)+8))+'px';
  };
  host.onpointermove=e=>{
   const bounds=host.querySelector('svg').getBoundingClientRect(),px=(e.clientX-bounds.left)*width/bounds.width;
   const py=(e.clientY-bounds.top)*height/bounds.height;
   if(px<L||px>right||py<T||py>T+h){tooltip.hidden=true;return;}
   show(Math.min(rows.length-1,Math.floor((px-L)/w*rows.length)));
  };
  host.onpointerleave=()=>{tooltip.hidden=true;};
 },
 stock(m){const t=this.t,labels={available:t('可用库存','Available'),locked:t('备货锁定','Preparation Locked'),preparing:t('备货作业中','Preparing'),review:t('待完工审核','Completion Review'),prepared:t('备货完成待匹配','Prepared, Unmatched'),assigned:t('已分配装车','Assigned to Loading'),loaded:t('已装车待出库','Loaded, Not Outbound')};return this.panel('库存状态结构','Inventory State',t('批次 / 数量 / 已知净重','Lots / Quantity / Known Net Weight'),'<div class="oa-state-list">'+m.states.map(s=>'<div><div class="oa-pair"><span>'+labels[s.key]+'</span><strong>'+this.structure(s,m.unit)+'</strong></div><progress max="'+Math.max(1,m.states.reduce((sum,row)=>sum+row.quantity,0))+'" value="'+s.quantity+'" aria-label="'+labels[s.key]+'"></progress></div>').join('')+'</div><div class="oa-quality"><div class="oa-pair"><span>'+t('实际重量确认覆盖','Actual Weight Coverage')+'</span><strong>'+(m.physical?this.number((m.physical-m.unknown)/m.physical*100,1)+'%':'—')+'</strong></div><p>'+m.unknown+' '+m.unit+' '+t('重量待确认','awaiting weight confirmation')+'</p></div>');},
 customers(m){const t=this.t;return this.panel('客户库存结构','Customer Inventory',t('批次 / 数量 / 已知净重','Lots / Quantity / Known Net Weight'),m.customers.length?m.customers.map(c=>'<div class="oa-customer"><div class="oa-pair"><span data-no-i18n>'+esc(c.name||t('未关联客户','Unassigned Customer'))+'</span><strong>'+this.structure(c,m.unit)+'</strong></div><progress max="'+Math.max(1,m.physical)+'" value="'+c.quantity+'" aria-label="'+esc(c.name||t('未关联客户','Unassigned Customer'))+'"></progress>'+(c.unknown?'<p class="oa-warning-text">'+c.unknown+' '+m.unit+' '+t('重量待确认','weight unconfirmed')+'</p>':'')+'</div>').join(''):this.empty('当前无客户库存','No current customer inventory'));},
 attention(m){const t=this.t,tasks=m.tasks.slice(0,4),alert=m.alerts.slice(0,3),href=m.co?'/overview?management=todos&tab=handover':Management.link('todos');return this.panel('本班关注与待办','Tasks & Exceptions',t('当前账号授权范围','Current account scope'),'<div class="oa-attention-counts"><div><strong>'+m.tasks.length+'</strong><span>'+t('本人待办','My Tasks')+'</span></div><div><strong>'+m.alerts.length+'</strong><span>'+t('异常提醒','Alerts')+'</span></div></div>'+ (m.unknown?'<p class="oa-warning">'+m.unknown+' '+m.unit+' '+t('重量待确认，未知净重不补零。','have unconfirmed weight. Unknown net is not zero.')+'</p>':'')+'<div class="oa-task-list">'+tasks.map(row=>'<a href="'+esc(row.href)+'"><span>'+esc(I18n.translate(ManagementLabels.names[row.kind]||row.kind,true))+'</span><strong data-no-i18n>'+esc(row.document_no||row.code||'—')+'</strong></a>').join('')+(!tasks.length?this.empty('当前无可执行待办','No actionable tasks'):'')+'</div><details><summary>'+t('异常与交接事项','Exceptions & Handover')+'</summary>'+alert.map(row=>'<a class="oa-alert-link" href="'+esc(row.href||href)+'">'+esc(row.document_no||row.entity||I18n.translate(ManagementLabels.names[row.type]||row.type||'',true)||t('查看异常','View Exception'))+'</a>').join('')+'<a href="/overview?management=todos&tab=handover">'+t('进入交接异常清单','Open Handover Exceptions')+'</a></details><a class="oa-more" href="'+esc(href)+'">'+t('查看本人全部待办','View All My Tasks')+' →</a>');},
 execution(m){const t=this.t;if(!m.executionAllowed)return '';const headers=m.co?[t('销售计划 / 客户','Plan / Customer'),t('计划实物（吨）','Planned Physical MT'),t('计划车辆','Planned Vehicles'),t('已派车','Dispatched'),t('已审核装车','Loading Approved'),t('正式出库（吨）','Formal Outbound MT'),t('确认开票（吨）','Invoice-confirmed MT'),t('履约进度','Fulfilment')]:[t('销售计划 / 客户','Plan / Customer'),t('计划量（吨）','Target MT'),t('累计备货（吨）','Cumulative Prepared MT'),t('准备装车（吨）','Ready for Loading (MT)'),t('正式出库（吨）','Formal Outbound MT'),t('确认开票（吨）','Invoice-confirmed MT'),t('履约进度','Fulfilment')];return this.panel('销售计划执行明细','Sales Plan Execution',t('有效计划月份的累计执行；与本期出库流量分别列示','Cumulative execution for selected plan months; separate from period outbound'),m.plans.length?'<div class="oa-table-scroll"><table><thead><tr>'+headers.map((h,i)=>'<th scope="col"'+(i?' class="oa-numeric"':'')+'>'+h+'</th>').join('')+'</tr></thead><tbody>'+m.plans.map(p=>{const rate=Number(p.target)>0&&p.invoiced!=null?Number(p.invoiced)/Number(p.target)*100:null;return '<tr><td><a data-no-i18n href="/sales-plans/'+encodeURIComponent(p.id)+'">'+esc(p.code)+'</a><small data-no-i18n>'+esc(p.customer)+'</small></td>'+ (m.co?[this.number(p.target),p.planned_vehicles,p.dispatched,p.loaded,this.number(p.outbound),this.number(p.invoiced)]:[this.number(p.target),this.number(p.prepared),this.number(p.assigned),this.number(p.outbound),this.number(p.invoiced)]).map(v=>'<td class="oa-numeric" data-no-i18n>'+v+'</td>').join('')+'<td class="oa-numeric">'+(rate==null?'—':'<progress max="100" value="'+rate+'" aria-label="'+t('履约进度','Fulfilment')+'"></progress><small>'+this.number(rate,1)+'%</small>')+'</td></tr>';}).join('')+'</tbody></table></div>':this.empty('所选计划月份暂无有效销售计划','No approved plans for selected plan months'),'oa-execution');},
 flow(m){const t=this.t;let entries;if(m.co){entries=[[t('计划车辆','Planned Vehicles'),m.raw.plans.planned_vehicles],[t('已派车','Dispatched'),m.raw.plans.dispatched_vehicles],[t('已到场','Arrived'),m.plans.reduce((n,p)=>n+Number(m.raw.analysis.execution.find(r=>r.id===p.id).arrived_vehicles),0)],[t('已匹配','Matched'),m.plans.reduce((n,p)=>n+Number(m.raw.analysis.execution.find(r=>r.id===p.id).matched_vehicles),0)],[t('已正式出库','Formal Outbound'),m.plans.reduce((n,p)=>n+Number(m.raw.analysis.execution.find(r=>r.id===p.id).outbound_vehicles),0)]];if(!m.executionAllowed)entries=entries.slice(0,2);}else entries=Object.entries(m.raw.loading_plans).map(([key,value])=>[I18n.translate(ManagementLabels.names[key]||key,true),value]);return this.panel(m.co?'销售执行车辆流转':'当前装车计划流转',m.co?'Sales Execution Vehicles':'Current Loading Plans',m.co?t('各节点为累计数量，不相加','Cumulative stages; do not add together'):t('全部有效任务，每张计划仅计入一个当前阶段','All active plans; one current stage per plan'),'<div class="oa-flow">'+entries.map(([label,value])=>'<div><strong>'+value+'</strong><span>'+label+'</span></div>').join('')+'</div>');},
 async loadBalance(state,m,warehouse){const box=state.root.querySelector('[data-oa-balance]');if(!box)return;const balanceSequence=state.balanceSequence=(state.balanceSequence||0)+1;const q=m.co?Object.fromEntries(new URLSearchParams(location.search)):Dashboard.filters;if(['customer_id','contract_no','location_id','batch_id'].some(key=>q[key])){box.innerHTML=this.empty('月度预检按整仓统计；请进入报表单独选择仓库。','Monthly precheck uses whole warehouses. Select a warehouse in Reports.')+'<a href="/reports?section=stock&view=preclose">'+this.t('打开只读月度预检','Open Read-only Monthly Precheck')+'</a>';return;}const anchor=(m.co?q.month&&q.month+'-01':q.from)||m.trend.from,query={period:'month',anchor};if(q.project_id)query.project_id=q.project_id;if(warehouse||q.warehouse_id)query.warehouse_id=warehouse||q.warehouse_id;
 try{const d=await API.request((m.co?'/cobalt':'')+'/reports/stock-balance?'+new URLSearchParams(query));if(this.current!==state||!state.root.isConnected||state.balanceSequence!==balanceSequence)return;const s=d.summary,t=this.t;box.innerHTML='<div class="oa-balance-tools"><label>'+t('整仓预检仓库','Whole-warehouse Precheck')+'<select data-oa-warehouse>'+d.warehouses.filter(w=>!q.project_id||w.project_id===q.project_id).map(w=>'<option value="'+w.id+'"'+(w.id===d.warehouse.id?' selected':'')+'>'+esc(w.name)+'</option>').join('')+'</select></label><span data-no-i18n>'+d.period.from+' — '+d.period.to+'</span></div><div class="oa-balances">'+[[t('期初净重','Opening Net'),s.opening_net_mt],[t('收入净重','Inbound Net'),s.inbound_net_mt],[t('期末净重','Closing Net'),s.closing_net_mt],[t('已知勾稽差额','Known Reconciliation'),s.reconciliation_net_mt]].map(([label,value])=>'<div><span>'+label+' · MT</span><strong>'+this.number(value)+'</strong></div>').join('')+'</div><p class="oa-note">'+t('期末已知部分','Known closing portion')+' '+this.number(s.closing_known_net_mt)+' MT · '+t('零差额不代表未知重量已核实。','Zero difference does not confirm unknown weights.')+'</p><div class="oa-checks">'+d.precheck.checks.map(c=>'<span class="'+(c.passed?'is-pass':'is-pending')+'">'+t(({period_ended:'期间结束',history_complete:'历史完整',weights_confirmed:'重量已确认',known_reconciliation:'已知净重勾稽'})[c.code],({period_ended:'Period Ended',history_complete:'History Complete',weights_confirmed:'Weights Confirmed',known_reconciliation:'Known Reconciliation'})[c.code])+' · '+t(c.passed?'通过':'待核查',c.passed?'Passed':'Review')+'</span>').join('')+'</div><a class="oa-more" href="/reports?'+new URLSearchParams({section:'stock',view:'preclose',anchor,warehouse_id:d.warehouse.id})+'">'+t('查看完整只读预检','View Full Read-only Precheck')+' →</a>';box.querySelector('select').onchange=e=>this.loadBalance(state,m,e.target.value);
 }catch(e){if(this.current!==state||!state.root.isConnected||state.balanceSequence!==balanceSequence)return;box.textContent=e.statusCode===403?this.t('当前授权范围不支持整仓预检。','Whole-warehouse precheck is outside this account scope.'):this.t('月度预检暂不可用：','Monthly precheck unavailable: ')+e.message;}},
 init(){const set=I18n.set.bind(I18n);I18n.set=(...args)=>{const result=set(...args),current=this.current;if(current?.root.isConnected&&current.co&&location.pathname==='/overview'&&!new URLSearchParams(location.search).has('management'))this.render(current.root.parentElement,current.data,true);return result;};window.addEventListener('session-expired',()=>{this.observer?.disconnect();this.current=null;this.types={};document.querySelectorAll('.oa467').forEach(root=>root.remove());});}
};
OverviewAnalysis.init();
