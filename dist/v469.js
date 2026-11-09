'use strict';
window.V469={
 init(){
  if(this.installed)return;this.installed=true;CobaltPreparation469.init();
  const plot=OverviewAnalysis.plot.bind(OverviewAnalysis);OverviewAnalysis.plot=(host,model,series,type,unit,records)=>{const result=plot(host,model,series,type,unit,records);if(host?.parentElement.clientWidth)this.tooltip(host,model,series,unit);return result;};
 },
 tooltip(host,model,series,unit){
  const svg=host.querySelector('svg'),rows=model.trend.rows;if(!svg||!rows.length)return;host.classList.add('oa469-tooltip-host');
  const tip=document.createElement('div');tip.className='oa469-tooltip';tip.hidden=true;tip.setAttribute('role','tooltip');host.append(tip);
  const ns='http://www.w3.org/2000/svg',layer=document.createElementNS(ns,'g'),box=svg.viewBox.baseVal,L=62,R=20,T=24,B=88,w=box.width-L-R,h=box.height-T-B;layer.setAttribute('class','oa469-hit-areas');
  for(let i=0;i<rows.length;i++){const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',L+i*w/rows.length);rect.setAttribute('y',T);rect.setAttribute('width',Math.max(1,w/rows.length));rect.setAttribute('height',h);rect.setAttribute('fill','transparent');rect.dataset.oa469Index=i;layer.append(rect);}svg.append(layer);
  let selected=0;const t=(z,e)=>I18n.language==='en'?e:z,number=v=>v==null?'—':OverviewAnalysis.number(v,4),show=(i,event)=>{const r=rows[i];selected=i;const pairs=series.map(s=>[s.name,number(r[s.key])+' '+unit]);tip.innerHTML='<strong>'+esc(r.period)+'</strong><div class="oa469-tooltip-values">'+pairs.map(([k,v])=>'<div class="oa469-tooltip-row"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>').join('')+'</div>';tip.hidden=false;const bounds=host.getBoundingClientRect(),x=event?event.clientX-bounds.left:(L+(i+.5)*w/rows.length)/box.width*bounds.width,y=event?event.clientY-bounds.top:30;const scroller=host.parentElement,visible=scroller.clientWidth;if(!event&&(x<scroller.scrollLeft||x>scroller.scrollLeft+visible))scroller.scrollLeft=Math.max(0,x-visible/2);tip.style.left=Math.max(scroller.scrollLeft+4,Math.min(x+12,scroller.scrollLeft+visible-tip.offsetWidth-4))+'px';tip.style.top=Math.max(4,Math.min(y+12,bounds.height-tip.offsetHeight-4))+'px';};
  layer.onpointermove=e=>{const n=e.target.closest('[data-oa469-index]');if(n)show(Number(n.dataset.oa469Index),e);};layer.onpointerdown=e=>{const n=e.target.closest('[data-oa469-index]');if(n)show(Number(n.dataset.oa469Index),e);};host.onpointerleave=()=>tip.hidden=true;
  svg.setAttribute('tabindex','0');svg.onkeydown=e=>{if(e.key==='Escape'){tip.hidden=true;return;}if(['ArrowLeft','ArrowRight','Enter',' '].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')selected=Math.max(0,selected-1);if(e.key==='ArrowRight')selected=Math.min(rows.length-1,selected+1);show(selected);}};svg.onblur=()=>tip.hidden=true;
 }
};
