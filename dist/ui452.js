'use strict';
// Additive, reversible presentation. The original forms, routes, permissions,
// summary cards, exports and classic styles remain the business implementation.
window.WorkspaceUI452={
 t:(zh,en)=>UIAppearance.text(zh,en),
 snapshots:new Map(),
 icons:{
  overview:'<path d="M3 11h5v10H3zM10 5h5v16h-5zM17 2h4v19h-4z"/>',
  inventory:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  'stock-map':'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  reports:'<path d="M4 3v18h17M8 16v-4m5 4V7m5 9V4"/>',
  customers:'<circle cx="9" cy="7" r="4"/><path d="M2 22v-4a7 7 0 0 1 14 0v4M16 4a4 4 0 0 1 0 8m3 3a6 6 0 0 1 3 5v2"/>',
  'sales-plans':'<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h4M2 7v13a3 3 0 0 0 3 3"/>',
  receipts:'<path d="M12 2v13m-5-5 5 5 5-5M3 12v9h18v-9"/>',
  preparation:'<path d="m12 3 9 5v11l-9 4-9-4V8l9-5Zm0 10v10M3 8l9 5 9-5M7 5l10 5"/>',
  'loading-plans':'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 2v4m10-4v4M3 10h18m-12 4 2 2 4-4"/>',
  outbounds:'<path d="M12 16V3m-5 5 5-5 5 5M3 12v9h18v-9"/>',
  'vehicle-departures':'<path d="M2 5h12v12H2zM14 9h5l3 4v4h-8"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  stocktaking:'<rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v4H9zM8 13l2 2 5-6M8 19h8"/>'
 },
 init(){
  const originalRefresh=Management.refresh.bind(Management);Management.refresh=async(...args)=>{await originalRefresh(...args);if(Dashboard.snapshot?.metrics&&document.getElementById('dashboard-content')?.children.length)this.renderCopper(Dashboard.snapshot);};
  const originalCobalt=ShippingOverview.overview.bind(ShippingOverview);ShippingOverview.overview=async(...args)=>{this.collectingCobalt=true;try{return await originalCobalt(...args);}finally{this.collectingCobalt=false;const data=this.snapshots.get('CO_HYDROXIDE');if(document.querySelector('.co-overview-page')&&data)this.renderCobalt(data);}};
  // Capture the same authorized response already used by the existing overview.
  // This makes the graphs and original cards one snapshot, with no extra request.
  const request=API.request.bind(API);API.request=async(path,...args)=>{const result=await request(path,...args);if(path.split('?')[0]==='/cobalt/overview'&&this.collectingCobalt)this.snapshots.set('CO_HYDROXIDE',result);return result;};
  const show=Router.performShow.bind(Router);Router.performShow=async(...args)=>{const result=await show(...args);this.enhance();return result;};
  const language=I18n.set.bind(I18n);I18n.set=(...args)=>{const result=language(...args);this.queue();if(this.snapshots.has('CU_CATHODE')&&window.ProductContext?.isCopper()&&location.pathname==='/overview')this.renderCopper(this.snapshots.get('CU_CATHODE'));return result;};
  window.addEventListener('ui-appearance-changed',()=>{this.enhance();this.redraw();});
  window.addEventListener('session-expired',()=>{this.snapshots.clear();document.querySelectorAll('.ui452-charts').forEach(e=>e.remove());UIAppearance.apply(UIAppearance.value,false);});
  window.addEventListener('resize',()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.redraw(),120);});
  document.addEventListener('pointerover',e=>this.tooltip(e.target.closest?.('[data-ui452-tip]')));
  document.addEventListener('focusin',e=>this.tooltip(e.target.closest?.('[data-ui452-tip]')));
  document.addEventListener('pointerout',e=>{if(e.target.closest?.('[data-ui452-tip]')&&!e.relatedTarget?.closest?.('[data-ui452-tip]'))this.tooltip(null);});
  document.addEventListener('focusout',e=>{if(e.target.closest?.('[data-ui452-tip]'))this.tooltip(null);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')this.tooltip(null);});
  this.observer=new MutationObserver(()=>this.queue());this.observer.observe(document.querySelector('.sidebar'),{childList:true,subtree:true});
  this.enhance();UIAppearance.apply(UIAppearance.value,false);
 },
 queue(){if(this.queued)return;this.queued=true;requestAnimationFrame(()=>{this.queued=false;this.enhance();});},

 enhance(){
  const sidebar=document.querySelector('.sidebar');if(!sidebar||!window.CurrentUser)return;

  for(const link of sidebar.querySelectorAll('[data-primary-route]')){const icon=link.querySelector('span[aria-hidden=true]');if(!icon)continue;if(UIAppearance.value==='modern'&&this.icons[link.dataset.primaryRoute]){if(icon.dataset.ui452Original===undefined){icon.dataset.ui452Original=icon.innerHTML;icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+this.icons[link.dataset.primaryRoute]+'</svg>';}}else if(icon.dataset.ui452Original!==undefined){icon.innerHTML=icon.dataset.ui452Original;delete icon.dataset.ui452Original;}}
  if(typeof AdaptiveLayout!=='undefined')AdaptiveLayout.queue();
 },
 mount(parent,after){let charts=parent.querySelector(':scope > .ui452-charts');if(!charts){charts=document.createElement('div');charts.className='ui452-charts';charts.dataset.noI18n='';charts.dataset.chartSource='canonical-overview';if(after)after.after(charts);else parent.prepend(charts);}return charts;},
 ring(title,entries,total,unit,note){const n=entries.reduce((s,e)=>s+e.value,0),valid=Number.isFinite(total)&&entries.every(e=>Number.isFinite(e.value)&&e.value>=0)&&n===total;const palette=['#337c52','#8ca797','#657d97','#af915e','#b8bfc1'];let position=0;const segments=valid&&total?entries.map((e,i)=>{const length=e.value/total*100,tip=e.label+' · '+e.value+' '+unit+' · '+(e.value/total*100).toFixed(1)+'%',part='<circle r="68" cx="100" cy="100" fill="none" stroke="'+palette[i%palette.length]+'" stroke-width="19" pathLength="100" stroke-dasharray="'+length+' '+(100-length)+'" stroke-dashoffset="'+(-position)+'" transform="rotate(-90 100 100)" tabindex="0" role="img" aria-label="'+esc(tip)+'" data-ui452-tip="'+esc(tip)+'"/>';position+=length;return part;}).join(''):'';
  return '<figure class="ui452-chart" data-chart-kind="composition"><h2>'+esc(title)+'</h2><p class="ui452-subtitle">'+esc(note)+'</p>'+(valid?'<div class="ui452-ring-layout"><svg class="ui452-ring-svg" viewBox="0 0 200 200" role="img" aria-label="'+esc(title)+'"><circle r="68" cx="100" cy="100" fill="none" stroke="#f0f2f1" stroke-width="19"/>'+segments+'<text x="100" y="99" text-anchor="middle" class="ui452-ring-total">'+total+'</text><text x="100" y="119" text-anchor="middle" class="ui452-ring-unit">'+esc(unit)+'</text></svg><div class="ui452-legend">'+entries.map((e,i)=>'<div class="ui452-legend-row"><i class="ui452-tone-'+i+'"></i><span>'+esc(e.label)+'</span><strong>'+e.value+'</strong></div>').join('')+'</div></div>':'<div class="ui452-empty">'+this.t('状态汇总暂不可用','State summary is not available')+'</div>')+'<p class="ui452-chart-note">'+esc(total===0?this.t('当前筛选范围暂无库存','No stock in the selected scope'):this.t('按数量统计，每件库存仅计入一种状态。','Count-based composition; each item is counted once.'))+'</p></figure>';
 },
 trend(data){const t=this.t;return '<figure class="ui452-chart" data-chart-kind="trend"><h2>'+t('正式出库净重趋势','Formal Outbound Net Trend')+'</h2><p class="ui452-subtitle" data-no-i18n>'+esc(data.from)+' — '+esc(data.to)+' · '+(data.granularity==='month'?t('按月','Monthly'):t('按日','Daily'))+' · MT · Africa/Lubumbashi</p><div class="ui452-plot"></div><details><summary>'+t('查看图表数据','View Chart Data')+'</summary><div class="ui452-chart-table"><table><thead><tr><th>'+t('期间','Period')+'</th><th>'+t('已知净重（MT）','Known Net (MT)')+'</th><th>'+t('车辆','Vehicles')+'</th><th>'+t('未知重量','Unknown Weights')+'</th></tr></thead><tbody>'+data.rows.map(r=>'<tr><td>'+esc(r.period)+'</td><td>'+this.number(r.net_weight)+'</td><td>'+r.vehicles+'</td><td>'+r.unknown_weights+'</td></tr>').join('')+'</tbody></table></div></details><p class="ui452-chart-note">'+t('按最终批准正式出库时间统计，与本页出库汇总同口径；未知重量不按0计入。','Uses final outbound approval, matching this page’s outbound summary. Unknown weight is not zero.')+'</p></figure>';},
 number(value){return value===null||value===undefined?this.t('未知','Unknown'):Tonnes.format(String(value),true);},
 renderCopper(data){this.snapshots.set('CU_CATHODE',data);if(window.OverviewAnalysis)return OverviewAnalysis.copper(data);const parent=document.getElementById('dashboard-content');if(!parent||!data.chart_trend)return;const m=data.metrics,entries=[['available','可用','Available'],['locked','备货锁定','Preparation Locked'],['assigned','已分配装车','Assigned to Loading'],['loaded','已装车待出库','Loaded, Awaiting Outbound']].map(([key,z,en])=>({label:this.t(z,en),value:Number(m[key].bundles)})),total=Number(m.physical.bundles),other=total-entries.reduce((s,e)=>s+e.value,0);if(other>0)entries.push({label:this.t('其他库存','Other Stock'),value:other});const charts=this.mount(parent,parent.querySelector('.v34-overview-section'));charts.innerHTML=this.trend(data.chart_trend)+this.ring(this.t('库存状态分布','Stock State Composition'),entries,total,this.t('捆','bundles'),this.t('当前筛选与截止时点 · 实物库存数量','Selected scope and cutoff · Physical inventory count'));this.drawTrend(charts.querySelector('[data-chart-kind=trend]'),data.chart_trend);},
 renderCobalt(data){if(window.OverviewAnalysis)return OverviewAnalysis.cobalt(data);const parent=document.querySelector('.co-overview-page');if(!parent||!data.chart_trend)return;const s=data.inventory,total=Number(s.bags),unknown=Number(s.unconfirmed_bags),entries=[{label:this.t('重量已确认','Weight Confirmed'),value:total-unknown},{label:this.t('重量未确认','Weight Unconfirmed'),value:unknown}];const charts=this.mount(parent,parent.querySelector('.v34-overview-section'));charts.innerHTML=this.trend(data.chart_trend)+this.ring(this.t('库存重量确认情况','Stock Weight Confirmation'),entries,total,this.t('袋','bags'),this.t('当前实时库存 · 按袋数统计','Current physical stock · Counted in bags'));this.drawTrend(charts.querySelector('[data-chart-kind=trend]'),data.chart_trend);},
 redraw(){if(UIAppearance.value!=='modern')return;const co=window.ProductContext&&!ProductContext.isCopper(),data=this.snapshots.get(co?'CO_HYDROXIDE':'CU_CATHODE');if(location.pathname!=='/overview'||!data)return;if(co)this.renderCobalt(data);else this.renderCopper(data);},
 drawTrend(figure,data){if(!figure)return;const host=figure.querySelector('.ui452-plot'),rows=data.rows;if(!rows.length){host.innerHTML='<div class="ui452-empty">'+this.t('当前期间暂无可验证数据','No verifiable data for this period')+'</div>';return;}const width=Math.max(260,Math.round(figure.clientWidth-40)||560),height=218,left=48,right=12,top=17,bottom=42,plotW=width-left-right,plotH=height-top-bottom,values=rows.map(r=>r.net_weight===null?null:Number(r.net_weight)),max=Math.max(0,...values.filter(v=>v!==null)),power=max?10**Math.floor(Math.log10(max)):1,ceiling=max?Math.ceil(max/power)*power:1,x=i=>left+(rows.length===1?plotW/2:plotW*i/(rows.length-1)),y=n=>top+plotH*(1-n/ceiling),tick=n=>new Intl.NumberFormat(I18n.language==='en'?'en':'zh-CN',{maximumFractionDigits:n>10?0:2,notation:n>=10000?'compact':'standard'}).format(n);let path='',segments=[];
 for(let i=0;i<rows.length;i++){if(values[i]===null){if(path)segments.push(path);path='';continue;}path+=(path?'L':'M')+x(i).toFixed(2)+','+y(values[i]).toFixed(2);}if(path)segments.push(path);
 const count=Math.max(2,Math.floor(plotW/75)),indices=[...new Set([0,...rows.map((_,i)=>i).filter(i=>i%Math.max(1,Math.ceil((rows.length-1)/(count-1)))===0),rows.length-1])];if(indices.length>2&&x(indices.at(-1))-x(indices.at(-2))<65)indices.splice(-2,1);
 let svg='<svg class="ui452-trend" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+this.t('正式出库净重趋势，单位MT；下方可展开精确数据。','Formal outbound net trend in MT. Expand the exact data below.')+'">';for(let i=0;i<=3;i++){const n=ceiling*i/3,yy=y(n);svg+='<line class="ui452-gridline" x1="'+left+'" x2="'+(width-right)+'" y1="'+yy+'" y2="'+yy+'"/><text x="'+(left-9)+'" y="'+(yy+4)+'" text-anchor="end">'+tick(n)+'</text>';}
 for(const p of segments)svg+='<path class="ui452-line" d="'+p+'"/>';
 for(let i=0;i<rows.length;i++){if(values[i]===null)continue;const r=rows[i],tip=r.period+' · '+this.number(r.net_weight)+' MT · '+r.vehicles+' '+this.t('辆','vehicles')+(r.unknown_weights?' · '+this.t('未知重量','Unknown weights')+' '+r.unknown_weights:'');svg+='<circle class="ui452-point" cx="'+x(i)+'" cy="'+y(values[i])+'" r="3.5" tabindex="0" role="img" data-ui452-tip="'+esc(tip)+'" aria-label="'+esc(tip)+'"/>';}
 for(const i of indices)svg+='<text x="'+x(i)+'" y="'+(height-12)+'" text-anchor="'+(i===0?'start':i===rows.length-1?'end':'middle')+'">'+esc(data.granularity==='month'?rows[i].period:rows[i].period.slice(5))+'</text>';
 svg+='</svg>';host.innerHTML=svg;if(!rows.some(r=>r.vehicles))host.insertAdjacentHTML('beforeend','<p class="ui452-chart-note">'+this.t('所选期间无正式出库记录','No formal outbound records in the selected period')+'</p>');figure.dataset.chartRows=JSON.stringify(rows);},
 tooltip(mark){document.querySelectorAll('.ui452-tooltip').forEach(e=>e.remove());if(!mark)return;const figure=mark.closest('.ui452-chart');if(!figure)return;const tip=document.createElement('div');tip.className='ui452-tooltip';tip.setAttribute('role','status');tip.textContent=mark.dataset.ui452Tip;figure.append(tip);}
};
WorkspaceUI452.init();
