'use strict';
const StockMapReview={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 copperLabel(code){
  const t=this.t;
  return ({P1:t('P1库区','P1 Zone'),P2:t('P2库区','P2 Zone'),P4:t('P3库区','P3 Zone'),
   P3:t('剩余捆包堆存区','Left Over Bundles Stock Area'),P5:t('新生产捆包堆存区','New Production Bundles Stock Area')})[code]||code;
 },
 copperMetrics(root){
  const t=this.t,d=StockMap.data,o=d.occupancy,metrics=root.querySelector('#stock-map-metrics');
  const active=d.locations.filter(l=>l.active&&l.map_usage==='FORMAL');
  const occupied=l=>l.current.bundle_count>0||['PLANNED','OCCUPIED','PENDING_REALLOCATION'].includes(l.allocation_state);
  const cards=[[t('已占用货位数','Occupied Locations'),d.full_customer_scope?active.filter(occupied).length:null],
   [t('未占用货位数','Unoccupied Locations'),o.empty_locations],...['P1','P2','P4'].map((key,index)=>[
    t('P'+(index+1)+'库区占用货位数','Occupied Locations in P'+(index+1)),d.full_customer_scope?active.filter(l=>l.region_code===key&&occupied(l)).length:null])];
  metrics.innerHTML=cards.map(([label,n])=>'<article class="map-metric panel"><span>'+label+'</span><strong>'+CountValues.display(n)+'</strong></article>').join('');
  metrics.dataset.noI18n='';metrics.classList.add('v479-copper-metrics');root.prepend(metrics);
 },
 bind(root,cobalt){
  if(!root||root.classList.contains('wms-map-reviewed'))return;
  root.classList.add('wms-map-reviewed');
  const t=this.t,stage=root.querySelector(cobalt?'.map465-stage':'.v27-map-stage'),toolbar=stage?.querySelector(cobalt?'.co-map-toolbar':'.v27-map-toolbar');
  if(!toolbar)return;
  const advanced=document.createElement('details');advanced.className='wms-map-advanced';
  advanced.innerHTML='<summary>'+t('更多筛选与操作','More Filters and Actions')+'</summary>';
  const controls=document.createElement('section');controls.className='wms-map-controls panel';controls.dataset.noI18n='';
  controls.innerHTML='<form class="wms-map-search"><label>'+t('定位货位','Find Location')+'<input type="search" name="location_query" maxlength="80" placeholder="'+
   t(cobalt?'货位号 / 备货批次号 / 袋号':'货位号 / 备货批次号 / 客户',cobalt?'Location / preparation batch / bag':'Location / preparation batch / customer')+
   '"></label><div class="wms-filter-actions"><button class="button primary">'+t('定位','Locate')+'</button><button class="button secondary" type="button" data-map-clear>'+t('清除','Clear')+'</button></div></form>'+
   '<div class="wms-map-actions"></div><div class="wms-map-zones" role="group" aria-label="'+t('按库区查看','Browse Zones')+'"></div>'+
   '<p class="wms-feedback" role="status"></p><div class="wms-map-matches" hidden></div>';
  root.prepend(controls);if(cobalt)controls.after(advanced);
  const form=controls.querySelector('form'),input=form.elements.location_query,feedback=controls.querySelector('[role="status"]'),results=controls.querySelector('.wms-map-matches');
  const move=(selector,target)=>{const node=root.querySelector(selector);if(node)target.append(node);};
  const actions=controls.querySelector('.wms-map-actions'),zones=controls.querySelector('.wms-map-zones');
  for(const id of cobalt?['co-map-out','co-map-in','co-map-fit']:['v271-map-out','v271-map-in','v27-map-fit'])move('#'+id,actions);
  const fit=actions.lastElementChild;
  if(fit)fit.textContent=t('适应画布','Fit Map');
  const refresh=document.createElement('button');refresh.type='button';refresh.className='button secondary';refresh.textContent=t('刷新','Refresh');
  refresh.onclick=()=>Router.go(location.pathname+location.search,true);actions.append(refresh);
  if(cobalt){
   for(const selector of ['.co-stock-page > form','.co-stock-filter','.map465-stats','.map465-actions'])move(selector,advanced);
   advanced.append(toolbar);
  }else{
   this.copperMetrics(root);
   root.querySelectorAll('.map-filter-box,.v27-map-filter').forEach(node=>node.remove());
  }
  const filters=advanced.querySelector(cobalt?'#co-stock-filter':'#stock-map-filter');
  if(filters){
   filters.classList.add('wms-filter-row','wms-map-filter-row');
   filters.classList.remove('filters','co-stock-filter','ui46-filter','p46-filter');
   const fields=filters.querySelector('.map-filter-grid')||document.createElement('div');
   fields.classList.add('wms-map-filter-fields');
   for(const field of [...filters.querySelectorAll(':scope > label')])fields.append(field);
   if(!fields.isConnected)filters.prepend(fields);
   const oldButtons=filters.querySelector('.business-toolbar');
   const buttons=oldButtons||document.createElement('div');
   buttons.classList.remove('business-toolbar');
   buttons.classList.add('wms-filter-actions');
   const collectButtons=()=>{for(const button of [...filters.querySelectorAll(':scope > button')])buttons.append(button);};
   collectButtons();
   if(!buttons.isConnected)filters.append(buttons);
   new MutationObserver(collectButtons).observe(filters,{childList:true});
  }
  const regions=cobalt?[...root.querySelectorAll('[data-site-zone]')]:
   ['P1','P2','P4','P5','P3'].map(code=>root.querySelector('[data-map-region="'+code+'"]')).filter(Boolean);
  const all=document.createElement('button');all.type='button';all.className='button secondary compact';all.textContent=t('全场','Entire Site');
  all.onclick=()=>fit?.click();zones.append(all);
  for(const region of regions){
   const code=region.dataset.siteZone||region.dataset.mapRegion;
   const siteZone=CobaltMap465.data?.site_plan?.zones.find(item=>item.code===code);
   region.textContent=cobalt?(siteZone?CobaltMapSite.label(code+' · '+siteZone.name):code+' '+t('库区','Zone')):this.copperLabel(code);
   zones.append(region);
  }
  const detail=root.querySelector(cobalt?'#co-map-detail':'#stock-map-detail');
  const legend=root.querySelector(cobalt?'.map465-legend':'.map-legend');
  const canvas=root.querySelector(cobalt?'#co-map-canvas':'#stock-map-canvas');
  if(legend&&canvas){
   canvas.after(legend);
   const customers=root.querySelector('#stock-map-customer-legend');if(!cobalt&&customers)legend.append(customers);
  }
  let sequence=0;
  const show=async(row)=>{
   results.hidden=true;
   feedback.textContent=t('已定位 ','Located ')+(cobalt?row.code:StockMap.areaName(row));
   if(cobalt){if(CobaltMap465.data.site_plan)CobaltMapSite.focusLocation?.(row);else CobaltStockUI.focusMapLocation?.(row);await CobaltMap465.select(row.id);}
   else{
    const cell=StockMap.data.cells.find(c=>c.code===row.cell_code);
    if(cell&&$('stock-map-svg')){
     const bounds=MapView.bounds(),scale=Math.min(8,bounds.w/(Number(cell.width)*1.2),bounds.h/(Number(cell.height)*1.35));
     MapView.scale(scale);MapView.view.x=Number(cell.x)+(Number(cell.width)-MapView.view.w)/2;
     MapView.view.y=Number(cell.y)+(Number(cell.height)-MapView.view.h)/2;MapView.apply();MapView.readable();
    }
    await StockMap.select(row.id);
   }
   if(innerWidth<=700)detail?.scrollIntoView({block:'nearest'});
  };
  form.onsubmit=async event=>{
   event.preventDefault();const token=++sequence,query=input.value.trim().toLowerCase();results.hidden=true;
   if(!query){feedback.textContent=t('请输入定位条件。','Enter a location, batch or search term.');return;}
   try{
    const rows=cobalt?CobaltMap465.data.locations:StockMap.data.locations;
    const locationCode=(cobalt?query:query.replace(/^p3-(\d+)$/,'p4-$1')).replace(/^(p\d+-|co-[abc]-)([1-9])$/,(_,prefix,serial)=>prefix+'0'+serial);
    const exact=rows.find(row=>[row.code,row.cell_code].some(value=>[query,locationCode].includes(value?.toLowerCase())));
    let hits=exact?[exact]:rows.filter(row=>(cobalt?[row.code,row.preparation_batch_no]:
     [row.code,row.cell_code,StockMap.areaName(row),row.claim_lot_no,...(row.current.lots||[]),...row.current.customers.map(c=>c.name)])
     .some(value=>value?.toLowerCase().includes(query)));
    if(cobalt&&!hits.length){
     const filters=new URLSearchParams(location.search);
     for(const key of [...filters.keys()])if(!['project_id','warehouse_id','zone_id'].includes(key))filters.delete(key);
     filters.set('bag',input.value.trim());
     const found=await API.request('/cobalt/stock/map?'+filters);
     const ids=new Set(found.locations.filter(row=>row.matched_bags>0).map(row=>row.id));
     hits=rows.filter(row=>ids.has(row.id));
    }
    if(token!==sequence||!root.isConnected)return;
    if(hits.length===1)await show(hits[0]);
    else{
     feedback.textContent=hits.length?t('选择匹配的货位','Select a matching location'):t('未找到匹配货位','No matching location');
     results.replaceChildren(...hits.map(row=>{
      const button=document.createElement('button');button.type='button';button.className='button secondary compact';
      button.textContent=cobalt?row.code:StockMap.areaName(row);button.onclick=()=>show(row).catch(err=>{feedback.textContent=err.message;});return button;
     }));results.hidden=!hits.length;
    }
   }catch(err){if(token===sequence&&root.isConnected)feedback.textContent=err.message;}
  };
  controls.querySelector('[data-map-clear]').onclick=()=>{
   ++sequence;form.reset();results.hidden=true;feedback.textContent='';
   if(cobalt&&detail)CobaltMap465.closeDetail(detail,false);
   if(!cobalt){StockMap.detailSequence++;MapView.selected=null;}
   if(detail)detail.hidden=true;
   root.querySelectorAll('.map465-selected,[data-map-focused]').forEach(node=>{node.classList.remove('map465-selected');node.removeAttribute('data-map-focused');});
   fit?.click();input.focus();
  };
 }
};
const reviewedCopperMap=StockMap.open.bind(StockMap);
StockMap.open=async function(){await reviewedCopperMap();if(location.pathname==='/stock-map'&&ProductContext.isCopper())StockMapReview.bind(document.querySelector('.map-app'),false);};
const reviewedCopperSelection=StockMap.select.bind(StockMap);
StockMap.select=async function(id,page,batch){
 const trigger=document.activeElement;
 await reviewedCopperSelection(id,page,batch);
 const detail=$('stock-map-detail'),row=this.data?.locations.find(location=>location.id===id);
 if(!detail||!row||MapView.selected!==id)return;
 for(const cell of document.querySelectorAll('[data-map-cell]'))cell.toggleAttribute('data-map-focused',cell.dataset.mapCell===row.cell_code);
 const close=detail.querySelector('.v271-detail-close');
 if(!close)return;
 const dismiss=close.onclick;
 close.onclick=()=>{dismiss?.();for(const cell of document.querySelectorAll('[data-map-focused]'))cell.removeAttribute('data-map-focused');if(trigger?.isConnected)trigger.focus({preventScroll:true});};
 detail.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close.click();}};
 if(!page||page===1)close.focus({preventScroll:true});
};
