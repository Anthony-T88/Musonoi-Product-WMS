'use strict';
Object.assign(TRANSLATIONS.en,{'装车计划管理':'Arrival Register & Loading Plan','装车计划查询':'Loading Plan Search','备货批次号':'Lot Number','到达时间':'Arrival Time','到达时间（卢本巴希）':'Arrival Time (Lubumbashi)','导出PDF地图':'Export Map PDF','正在生成PDF':'Generating PDF','采样捆包':'Sampling Bundle','记录内容':'Record Content','请确认删除记录':'Confirm Record Deletion','编辑记录':'Edit Record','仅影响今后选择，不修改已保存的装车计划及历史装箱单。':'Changes apply to future selections. Saved plans and historical packing lists are retained.','装车单号':'Loading Order No.','出库日期':'Stock Issue Date','待有效检斤':'Awaiting Valid Weighing','请选择有效的当地日期和时间':'Select a valid local date and time','卢本巴希时间':'Lubumbashi Time','导出失败':'Export Failed','保存检斤的毛重必须大于0.0025吨且不超过3吨':'Gross weight must be above 0.0025 MT and at most 3 MT','毛重必须大于0.0025吨且不超过3吨':'Gross weight must be above 0.0025 MT and at most 3 MT'});
I18n.pattern=new RegExp(Object.keys(TRANSLATIONS.en).sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
const completionTranslate=I18n.translate.bind(I18n);I18n.translate=function(value,ui){if(typeof value==='string'&&!this.protected.has(value.trim()))value=value.replace(/备货批次[（(]lot[）)]/gi,'备货批次号').replace(/装车计划单[（(]Loading Plan[）)]/g,'装车计划单');return completionTranslate(value,ui);};Router.names['loading-plans']='装车计划管理';
const completionPage=Router.page.bind(Router);Router.page=function(title,html){completionPage(title,html);if(/^捆包档案/.test(title)){const dl=$('page-content').querySelector(':scope>dl');if(dl){dl.className='bundle-profile';for(const dt of [...dl.querySelectorAll('dt')]){const dd=dt.nextElementSibling,card=document.createElement('div');dt.before(card);card.append(dt,dd);}}}};
// Distinct status colors remain stable when language or sorting changes.
const stateColors={WORKING:205,RECTIFY:15,PENDING:39,PREPARED:148,PARTIAL:180,FULFILLED:255,CANCELLED:0,DRAFT:220,REJECTED:350,LOADED:195,DEPARTED_PENDING:285,OUTBOUND:135,IN_PROGRESS:200,RETURNED:155,WAITING:40,NOT_REQUIRED:225,WEIGHED:270};
function completePage(){for(const pill of document.querySelectorAll('.status-pill[data-state-code]:not([data-state-domain="permit"])')){const code=pill.dataset.stateCode;if(pill.dataset.completedColor===code)continue;pill.dataset.completedColor=code;const hue=stateColors[code]??([...code].reduce((n,c)=>n+c.charCodeAt(0),0)*47%360);pill.style.background=`hsl(${hue} 70% 94%)`;pill.style.color=`hsl(${hue} 75% 27%)`;pill.style.borderColor=`hsl(${hue} 45% 72%)`;}
 for(const row of document.querySelectorAll('tr.sample-highlight')){const cell=row.cells[2];if(cell&&!cell.querySelector('.sample-indicator')){const badge=document.createElement('span');badge.className='sample-indicator';badge.textContent=I18n.translate('采样捆包');cell.prepend(badge);}}
 const walk=document.createTreeWalker(document.querySelector('.workspace'),NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){if(n.parentElement?.closest('script,style,textarea,pre,code,input'))continue;const value=n.nodeValue;if(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)){const next=value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,t=>BusinessTime.display(t));if(next!==value)n.nodeValue=next;}}
}
let completionQueued=false;new MutationObserver(()=>{if(completionQueued)return;completionQueued=true;requestAnimationFrame(()=>{completionQueued=false;completePage();});}).observe(document.querySelector('.workspace'),{subtree:true,childList:true});
// A small image-only PDF writer keeps Chinese fonts and map colors offline.
const MapPDF={bytes(s){return new TextEncoder().encode(s);},async build(canvases){const objects=[],add=data=>(objects.push(data),objects.length),join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};add(this.bytes('<< /Type /Catalog /Pages 2 0 R >>'));add(null);const kids=[];for(const canvas of canvases){const jpeg=Uint8Array.from(atob(canvas.toDataURL('image/jpeg',0.94).split(',')[1]),c=>c.charCodeAt(0)),image=add(join([this.bytes(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,this.bytes('\nendstream')])),commands=this.bytes('q 1190.55 0 0 841.89 0 0 cm /MapImage Do Q'),content=add(join([this.bytes(`<< /Length ${commands.length} >>\nstream\n`),commands,this.bytes('\nendstream')])),page=add(this.bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190.55 841.89] /Resources << /XObject << /MapImage ${image} 0 R >> >> /Contents ${content} 0 R >>`));kids.push(page);}objects[1]=this.bytes(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(n=>n+' 0 R').join(' ')}] >>`);const parts=[this.bytes('%PDF-1.4\n')],offsets=[0];let length=parts[0].length;objects.forEach((o,i)=>{offsets.push(length);const p=join([this.bytes(`${i+1} 0 obj\n`),o,this.bytes('\nendobj\n')]);parts.push(p);length+=p.length;});parts.push(this.bytes(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));return new Blob(parts,{type:'application/pdf'});},canvas(title){const c=document.createElement('canvas');c.width=3368;c.height=2382;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#17364f';x.font='bold 52px "Microsoft YaHei",sans-serif';x.fillText(title,70,85);x.font='26px "Microsoft YaHei",sans-serif';x.fillText('Africa/Lubumbashi · '+BusinessTime.display(new Date()),70,135);return c;},
async export(){
  if(this.busy)return;
  this.busy=true;
  try{
   const data=await API.request('/stock-map/pdf-data?'+StockMap.params());
   const canvas=this.canvas(I18n.translate('库存地图')),ctx=canvas.getContext('2d');
   await this.drawMap(ctx,data);
   const pages=[canvas];
   const locations=data.locations.filter(location=>location.map_usage!=='TEMPORARY'&&location.matched.bundle_count>0);
   const detailTitle=I18n.label('占用货位明细','Occupied Location Details');
   ctx.fillStyle='#17364f';
   ctx.font='bold 36px "Microsoft YaHei",sans-serif';
   ctx.fillText(detailTitle,2140,220);
   let y=280;
   for(const location of locations){
    const lines=this.detailLines(location);
    const wrapped=lines.flatMap(line=>this.wrap(ctx,line,1120));
    const height=wrapped.length*39+22;
    if(y+height>2200)break;
    for(const label of wrapped){
     ctx.font=label.font;
     ctx.fillText(label.text,2140+label.indent,y);
     y+=39;
    }
    y+=22;
   }
   let detail,detailY;
   const newPage=()=>{
    const page=this.canvas(detailTitle);
    pages.push(page);
    detail=page.getContext('2d');
    detailY=220;
   };
   for(const [index,location] of locations.entries()){
    if(!detail)newPage();
    const lines=this.detailLines(location).flatMap(line=>this.wrap(detail,line,3150));
    if(detailY+Math.min(lines.length,3)*59>2260)newPage();
    for(const label of lines){
     if(detailY>2260)newPage();
     detail.font=label.font;
     detail.fillStyle=index%2?'#f2f6fb':'#e7f0f8';
     detail.fillRect(60,detailY-40,3248,59);
     detail.fillStyle='#17364f';
     detail.fillText(label.text,85+label.indent,detailY);
     detailY+=59;
    }
    detailY+=17;
   }
   const blob=await this.build(pages),download=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=download;
   link.download='StockMap-'+BusinessTime.today()+'.pdf';
   link.click();
   setTimeout(()=>URL.revokeObjectURL(download),10000);
  }catch(error){
   notify(I18n.translate('导出失败')+'：'+error.message);
  }finally{
   this.busy=false;
  }
 },
 locationName(location,code){
  if(code==='P3'||code==='P3-LEFTOVER')return StockMapReview.copperLabel('P3');
  if(code==='P5'||code==='临时堆存区')return StockMapReview.copperLabel('P5');
  return location?StockMap.areaName(location):StockMap.displayCode(code);
 },
 detailLines(location){
  const lines=[{text:this.locationName(location,location.cell_code||location.code)+' · '+StockMap.batchAmount(location.matched),
   font:'bold 32px "Microsoft YaHei",sans-serif',indent:0}];
  const customers=new Map();
  for(const group of location.matched.customer_batch_groups||[]){
   const key=group.customer_id||group.customer_name||'';
   if(!customers.has(key))customers.set(key,{name:group.customer_name,groups:[]});
   customers.get(key).groups.push(group);
  }
  for(const {name,groups} of customers.values()){
   lines.push({text:name||I18n.translate('未分配',true),font:'bold 28px "Microsoft YaHei",sans-serif',indent:24});
   for(const group of groups)lines.push({text:(group.batch_no||'—')+' · '+StockMap.batchAmount(group),
    font:'28px "Microsoft YaHei",sans-serif',indent:54});
  }
  return lines;
 },
 wrap(ctx,label,width){
  ctx.font=label.font;
  const lines=[];
  let line='';
  for(const char of label.text){
   if(line&&ctx.measureText(line+char).width>width-label.indent){
    lines.push({...label,text:line});
    line='';
   }
   line+=char;
  }
  lines.push({...label,text:line});
  return lines;
 },
 async drawMap(ctx,data){
  const old=StockMap.data,region=StockMap.viewRegion,zoom=StockMap.zoom;
  let clone;
  try{
   StockMap.data=data;
   StockMap.viewRegion=null;
   StockMap.zoom=1;
   StockMap.draw();
   const source=$('stock-map-svg');
   if(!source){
    ctx.font='32px "Microsoft YaHei",sans-serif';
    ctx.fillText(I18n.label('场地图布局尚未核对','Site Map Layout Pending Verification'),85,240);
    return;
   }
   clone=source.cloneNode(true);
   const originals=[source,...source.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
   originals.forEach((el,index)=>{
    const style=getComputedStyle(el);
    for(const key of ['fill','stroke','stroke-width','stroke-dasharray','font-size','font-family','font-weight',
     'text-anchor','dominant-baseline','opacity'])copies[index].style.setProperty(key,style.getPropertyValue(key));
   });
   const cells=new Map(data.cells.map(cell=>[cell.code,cell]));
   const locations=new Map(data.locations.map(location=>[location.cell_code,location]));
   for(const tile of clone.querySelectorAll('[data-map-cell]')){
    const code=tile.dataset.mapCell,cell=cells.get(code),location=locations.get(code);
    if(!cell)continue;
    const label=this.locationName(location,code),groups=location?.matched.customer_batch_groups||[];
    const width=Number(cell.width),height=Number(cell.height),font=Math.min(24,height*.7);
    const batches=groups.map(group=>(group.batch_no||'—')+' '+StockMap.batchAmount(group));
    const details=batches.join(' · ');
    const usable=width-8,name=[label,details].filter(Boolean).join(' | ');
    ctx.font='bold '+font+'px "Microsoft YaHei",sans-serif';
    const compact=ctx.measureText(name).width>usable*1.65;
    const text=compact&&location?.matched.bundle_count?
     label+' · '+StockMap.batchAmount(location.matched):name;
    for(const node of tile.querySelectorAll('text'))node.remove();
    const node=document.createElementNS('http://www.w3.org/2000/svg','text');
    node.setAttribute('x',Number(cell.x)+width/2);
    node.setAttribute('y',Number(cell.y)+height/2);
    node.style.cssText='display:block;visibility:visible;fill:#17364f;font-family:Microsoft YaHei,sans-serif;'+
     'font-weight:700;font-size:'+font+'px;text-anchor:middle;dominant-baseline:middle';
    if(ctx.measureText(text).width>usable){
     node.setAttribute('textLength',Math.max(1,usable));
     node.setAttribute('lengthAdjust','spacingAndGlyphs');
    }
    node.textContent=text;
    tile.append(node);
   }
   clone.style.width=data.layout.width+'px';
   clone.style.height=data.layout.height+'px';
   clone.style.maxWidth='none';
   clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
   clone.setAttribute('viewBox','0 0 '+data.layout.width+' '+data.layout.height);
   clone.setAttribute('width',data.layout.width);
   clone.setAttribute('height',data.layout.height);
  }finally{
   StockMap.data=old;
   StockMap.viewRegion=region;
   StockMap.zoom=zoom;
   StockMap.draw();
  }
  const source=new XMLSerializer().serializeToString(clone);
  const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'}));
  try{
   const image=new Image();
   image.src=url;
   await image.decode();
   const scale=Math.min(2000/image.width,(ctx.canvas.height-250)/image.height);
   const width=image.width*scale,height=image.height*scale;
   ctx.drawImage(image,65+(2000-width)/2,190,width,height);
  }finally{
   URL.revokeObjectURL(url);
  }
 }
};
const completionMap=StockMap.open.bind(StockMap);StockMap.open=async function(){await completionMap();if(Business.can('inventory:export')){const b=document.createElement('button');b.className='button secondary stock-map-pdf';b.id='stock-map-pdf';b.textContent=I18n.translate('导出PDF地图');b.onclick=async()=>{b.disabled=true;try{await MapPDF.export();}finally{if(b.isConnected)b.disabled=false;}};document.querySelector('.v27-map-toolbar').append(b);}};
