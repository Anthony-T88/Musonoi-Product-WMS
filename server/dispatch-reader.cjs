'use strict';
const X=require('xlsx'),B=require('./business-common.cjs');
const clean=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,'');
function capacityRank(t){
 if(/capacity|tonnage|payload|loadability|loadweight|weighttoload|chargeutile|capacite|载重|吨位|载量|限重|装载量/.test(t))return 3;
 const stem=t.replace(/kilograms?|kgs?|mt|tonnes?|tons?|千克|公斤|吨/g,'');
 if(/^(?:重量|weight|poids){1,2}t?$/.test(stem)||/^(?:tonnes?|tons?|吨)$/.test(t))return 2;
 if(/^(?:quantity|qty|数量)(?:mt|t|tonnes?|tons?|吨)$/.test(t))return 1;
 return 0;
}

const plateSuffix='(?:no|number|num|reg(?:istration)?(?:no|number)?|(?:number|licen[cs]e)?plate(?:no|number)?|registrationplate(?:no|number)?)';
const namedHeadings=[
 // Explicit destinations outrank alternative unloading points when both are present.
 ['destination',3,/^(?:finaldestination|destinationfinale?|最终目的地)$/],
 ['destination',2,/^(?:destination(?:address|town|city|site|location)?|deliverydestination|(?:adresse|ville|lieu)dedestination|目的地(?:址|地址|名称)?|到达地(?:点)?)$/],
 ['destination',1,/^(?:(?:place|point|site|location|port)(?:of)?(?:offload(?:ed|ing)?|unload(?:ed|ing)?|discharge|delivery)|(?:offload(?:ed|ing)?|unload(?:ed|ing)?|discharge|delivery|dropoff)(?:place|point|site|location|port|address)|deliverto|shipto|(?:lieu|site|point|port|adresse)(?:de|du)?(?:dechargement|depotage|livraison)|卸货(?:地|地点|点|场|港)|目的港|(?:送货|交货|交付|到货|收货)(?:地|地点|点|地址))$/],
 ['transporter',2,/^(?:(?:transporter|transporteur|transportcompany|transportationcompany|truckingcompany|carrier|haulier)(?:s?name|nom)?|(?:name|nom)(?:of|du|dela|de)?(?:transporter|transporteur|transportcompany|carrier|haulier)|(?:compagnie|societe|entreprise)detransport|(?:运输商|运输公司|承运商|承运人|运输单位)(?:名称)?)$/],
 ['transporter',1,/^(?:(?:freight)?forwarder(?:name|nom)?|logisticsprovider(?:name)?|(?:transitaire|货代)(?:name|nom|名称)?)$/],
 ['truck',3,new RegExp('^(?:truck|tractor(?:unit|truck)?|horse|primemover)'+plateSuffix+'$')],
 ['truck',3,/^(?:(?:n|no|numero)?(?:camion|tracteur)(?:no|numero|immatriculation|matricule)|(?:n|no|numero|immatriculation|matricule|plaquedimmatriculation)(?:du|de)?(?:camion|tracteur)|(?:numero|no|n)dimmatriculation(?:du|de)?(?:camion|tracteur)|(?:车头|牵引车|主车)(?:号(?:码)?|车?牌(?:号|号码|照)?))$/],
 ['truck',2,/^(?:truck|tractor(?:unit|truck)?|horse|primemover|camion|tracteur|车头|牵引车|主车)$/],
 ['truck',1,new RegExp('^(?:vehicle'+plateSuffix+'|reg(?:istration)?(?:no|number)|numberplate|licen[cs]eplate(?:no|number)?|immatriculation(?:duvehicule)?|plaquedimmatriculation|车辆(?:号|号码|车?牌(?:号|照)?|登记号)|车牌(?:号|号码)?|牌照号?)$')]
];
function namedHeading(normalized){
 const match=namedHeadings.find(([, , pattern])=>pattern.test(normalized));
 return match?{kind:match[0],rank:match[1]}:null;
}
function heading(value){
 const normalized=clean(value);
 if(!normalized)return null;
 const named=namedHeading(normalized);
 if(named)return named;
 // Bilingual headings can repeat the same field with a slash or a line break.
 const parts=String(value).split(/[\/／\r\n]+/);
 if(parts.length>1){
  const matches=parts.map(clean).filter(Boolean).map(namedHeading),first=matches[0];
  if(first&&matches.every(part=>part?.kind===first.kind)){
   return {kind:first.kind,rank:Math.max(...matches.map(part=>part.rank))};
  }
 }
 const rank=capacityRank(normalized);
 return rank?{kind:'capacity',rank}:null;
}
const kind=value=>heading(value)?.kind??null;
function isCancelled(s){return /\b(?:cancel(?:led|ed|lation)?|withdrawn|annul(?:e|ee|led)?)\b|已?取消|作废|撤销/i.test(String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(?:not\s+cancel(?:led|ed)?|non\s+annul(?:e|ee)?)\b|cancel(?:led|ed|lation)?\s*[:：]?\s*(?:no|false|0)\b|未取消|未撤销|没有取消|取消\s*[:：]?\s*否/gi,''));}
const plate=s=>String(s??'').trim().replace(/\s+/g,' ');
function cancelledPlate(s){return plate(s).replace(/^\s*(?:cancel(?:led|ed)?|withdrawn)\s*[:;-]?\s+/i,'').replace(/\s*[([（]?\b(?:cancel(?:led|ed)?|withdrawn|annul(?:e|ee)?)\b.*$/i,'').replace(/\s*(已?取消|作废|撤销).*$/,'').trim();}
function plausible(s){return /[0-9]/.test(s)&&/[a-z]/i.test(s)&&s.length>=3&&s.length<=80&&!/total|合计|备注/i.test(s);}
function text(ws,r,c){const x=ws[X.utils.encode_cell({r,c})];return x?.w??x?.v??'';}
function mergedCell(ws,r,c){const direct=ws[X.utils.encode_cell({r,c})];if(direct)return direct;const m=(ws['!merges']||[]).find(m=>m.s.r<=r&&r<=m.e.r&&m.s.c<=c&&c<=m.e.c);return m?ws[X.utils.encode_cell(m.s)]:null;}
const units=/^(?:mt|kg|kgs|t|tonnes?|tons?|千克|公斤|吨)$/;
const continuation=/^(?:no|number|num|reg(?:istration)?(?:no|number)?|plate(?:no|number)?|name|nom|company|address|offload(?:ed|ing)?|unload(?:ed|ing)?|discharge|dechargement|livraison|号|号码|名称|地址|地|地点)$/;
function readHeader(ws,r,c){
 let label=String(text(ws,r,c));
 if(!label){
  if(!r||!ws['!merges']?.length)return null;
  const merged=mergedCell(ws,r,c);
  // Only carry vertically merged headings across header rows.
  if(!merged||merged!==mergedCell(ws,r-1,c))return null;
  label=String(merged.w??merged.v??'');
 }
 let detected=heading(label);
 const word=clean(label),isUnit=units.test(word);
 if(r>0&&(isUnit||continuation.test(word))){
  const above=mergedCell(ws,r-1,c);
  const prefix=String(above?.w??above?.v??'');
  const combined=prefix&&heading(prefix+' '+label);
  if(combined&&(!detected||combined.kind===detected.kind&&combined.rank>=detected.rank||isUnit&&combined.kind==='capacity')){
   label=prefix+' '+label;
   detected=combined;
  }
 }
 if(detected?.kind==='capacity'){
  const below=String(text(ws,r+1,c));
  if(units.test(clean(below)))label+=' '+below;
 }
 return detected?{...detected,column:c+1,label}:null;
}
function readColumns(ws,r,endColumn){
 const fields={truck:[],capacity:[],transporter:[],destination:[]};
 for(let c=0;c<=Math.min(255,endColumn);c++){
  const detected=readHeader(ws,r,c);
  if(detected)fields[detected.kind].push(detected);
 }
 return fields;
}
function bestColumn(columns,used,allowTie=false){
 let best,tied=false;
 for(const column of columns){
  if(used?.has(column.column))continue;
  if(!best||column.rank>best.rank){best=column;tied=false;}
  else if(column.rank===best.rank)tied=true;
 }
 return tied&&!allowTie?null:best;
}
function autoCandidates(wb){
 const candidates=[];
 for(const sheet of wb.SheetNames){
  const ws=wb.Sheets[sheet],end=X.utils.decode_range(ws['!fullref']||ws['!ref']||'A1').e;
  for(let r=0;r<=Math.min(59,end.r);r++){
   const fields=readColumns(ws,r,end.c);
   if(!fields.truck.length)continue;
   const trucks=[];
   for(const truck of fields.truck){
    let valid=0,nonempty=0;
    for(let rr=r+1;rr<=Math.min(r+30,end.r);rr++){
     const value=plate(text(ws,rr,truck.column-1));
     if(!value)continue;
     nonempty++;
     if(plausible(value))valid++;
    }
    if(valid)trucks.push({...truck,valid,nonempty});
   }
   if(!trucks.length)continue;
   const rank=Math.max(...trucks.map(truck=>truck.rank));
   const capacity=bestColumn(fields.capacity,null,true);
   const transporter=bestColumn(fields.transporter),destination=bestColumn(fields.destination);
   for(const truck of trucks){
    if(truck.rank!==rank)continue;
    candidates.push({
     sheet,header_row:r+1,truck_column:truck.column,capacity_column:capacity?.column??null,
     transporter_column:transporter?.column??null,destination_column:destination?.column??null,
     capacity_kg:/kg|千克|公斤/i.test(capacity?.label||''),
     score:truck.valid*10+truck.valid/truck.nonempty+(capacity?1:0)+(transporter?0.25:0)+(destination?0.25:0)
    });
   }
  }
 }
 return candidates.sort((a,b)=>b.score-a.score||a.header_row-b.header_row);
}
function mappedColumns(wb,mapping){
 const {sheet,header_row,truck_column}=mapping,capacity_column=mapping.capacity_column||null;
 const validColumn=column=>Number.isInteger(column)&&column>=1&&column<=256;
 if(!wb.SheetNames.includes(sheet)||!Number.isInteger(header_row)||header_row<1||header_row>60||!validColumn(truck_column)||
  capacity_column!==null&&(!validColumn(capacity_column)||capacity_column===truck_column)){
  throw B.error(400,'请选择有效的工作表、表头行和车辆列');
 }
 const selected={sheet,header_row,truck_column,capacity_column,capacity_kg:!!mapping.capacity_kg};
 const ws=wb.Sheets[sheet],end=X.utils.decode_range(ws['!ref']||'A1').e.c,used=new Set([truck_column,capacity_column]);
 const fields=readColumns(ws,header_row-1,end);
 for(const field of ['transporter','destination']){
  const key=field+'_column',input=mapping[key];
  const column=input===undefined?bestColumn(fields[field],used)?.column:input;
  if(column!=null&&(!validColumn(column)||used.has(column)))throw B.error(400,'请选择不同的运输商、目的地和车辆列');
  selected[key]=column??null;
  used.add(column);
 }
 return selected;
}
function read(wb,mapping,capacity){
 const sheets=wb.SheetNames;
 let selected;
 if(mapping)selected=mappedColumns(wb,mapping);
 else{
  const candidates=autoCandidates(wb);
  selected=candidates[0];
  const second=selected&&candidates.find(comparison=>comparison.sheet!==selected.sheet||comparison.truck_column!==selected.truck_column);
  if(!selected||second&&second.score>=selected.score*.95)return {needs_mapping:true,sheets,items:[],candidates:candidates.slice(0,5)};
 }
 const ws=wb.Sheets[selected.sheet],range=X.utils.decode_range(ws['!fullref']||ws['!ref']||'A1');if(range.e.r>5060)throw B.error(400,'单次最多导入5000辆车');const items=[],cancelled=[],warnings=[];
 const value=(r,c)=>{const x=ws[X.utils.encode_cell({r,c:c-1})];if(x?.f)throw B.error(400,'第'+(r+1)+'行车牌含公式，请先粘贴为文本');const s=plate(x?.w??x?.v);if(s.length>80||/[\x00-\x1f]/.test(s))throw B.error(400,'第'+(r+1)+'行车牌格式无效');return s;};
 const route=(r,field,max)=>{const col=selected[field+'_column'];if(!col)return '';const x=mergedCell(ws,r,col-1);
  const label=field==='transporter'?'运输商':'目的地';if(x?.f)throw B.error(400,'第'+(r+1)+'行'+label+'含公式，请先粘贴为文本');
  const s=String(x?.v??'').trim();if(s.length>max||/[\x00-\x1f]/.test(s))throw B.error(400,'第'+(r+1)+'行'+label+'格式无效');return s;};
 for(let r=selected.header_row;r<=range.e.r;r++){const row=Array.from({length:Math.min(range.e.c+1,256)},(_,c)=>text(ws,r,c)).join(' '),raw=plate(text(ws,r,selected.truck_column-1));if(isCancelled(row)||isCancelled(selected.sheet)){cancelled.push({source_row:r+1,truck_no:cancelledPlate(raw),reason:'派车单标记取消'});continue;}if(kind(raw)==='truck'&&!plausible(raw)||/^(total|grand total|合计|总计|备注|说明)\b/i.test(raw))continue;const truck_no=value(r,selected.truck_column),trailer_no='';if(!truck_no)continue;if(!plausible(truck_no)){warnings.push({source_row:r+1,message:'无法确认车牌格式，请核对',truck_no});}
 const cap=selected.capacity_column?mergedCell(ws,r,selected.capacity_column-1):null;if(cap?.f)throw B.error(400,'第'+(r+1)+'行载重含公式，请先粘贴为数值');items.push({source_row:r+1,truck_no,trailer_no,transporter:route(r,'transporter',160),destination:route(r,'destination',1000),capacity_tonnes:capacity(typeof cap?.v==='number'&&/(kg|kgs|mt|t|tonnes?|tons?|公斤|千克|吨)\s*$/i.test(String(cap.w||''))?String(cap.v)+' '+String(cap.w).match(/(kg|kgs|mt|t|tonnes?|tons?|公斤|千克|吨)\s*$/i)[1]:cap?.v,selected.capacity_kg)});if(items.length+cancelled.length>5000)throw B.error(400,'单次最多导入5000辆车');}
 const cancelledKeys=new Set(cancelled.map(r=>r.truck_no.toUpperCase().replace(/[\s-]+/g,'')));for(let i=items.length-1;i>=0;i--)if(cancelledKeys.has(items[i].truck_no.toUpperCase().replace(/[\s-]+/g,''))){cancelled.push({...items[i],reason:'同一派车单中该车辆另有取消标记'});items.splice(i,1);}
 if(!items.length&&!cancelled.length)throw B.error(400,'未找到车辆数据');return {sheets,mapping:selected,items,row_count:items.length,cancelled,cancelled_count:cancelled.length,warnings,recognition:'根据表头含义和实际车牌数据自动识别',capacity_recognized:!!selected.capacity_column};
}
module.exports={read,isCancelled,kind};
