'use strict';
const root=document.getElementById('page-content'),host=document.getElementById('preview');
const {copper,cobalt,testOrigin}=window.PreviewRecords;
const q=new URLSearchParams(location.search);
const esc=value=>String(value??'—').replace(/[&<>"']/g,key=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[key]));
const facts=rows=>'<dl>'+rows.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>';
const section=(title,body)=>'<section class="section"><h2>'+esc(title)+'</h2>'+body+'</section>';
const table=(headings,rows)=>rows.length?'<div class="table-scroll"><table class="wms-table"><thead><tr>'+headings.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+
 '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="feedback">暂无已记录信息</p>';
const identity=(record,fields)=>'<section class="section identity"><header><h2>'+esc(record.code)+'</h2><span class="status">'+esc(record.status)+'</span></header>'+facts(fields)+'</section>';
const links=rows=>table(['类别','单据编号','业务日期','状态','操作'],rows.map(row=>[
 ...[row.kind,row.code,row.at,row.status].map(esc),row.href?'<a class="button secondary action" target="_blank" rel="noopener" href="'+esc(testOrigin+row.href)+'">查看单据</a>':'—'
]));
const history=rows=>table(['时间','记录','操作人','单据依据'],rows.map(row=>row.map(esc)));
const archive=groups=>'<details class="section"><summary>全部档案字段与来源</summary>'+groups.map(group=>section(group.title,facts(group.fields))).join('')+'</details>';
function picker(records,render){
 const input=document.getElementById('sample');
 for(const row of records)input.add(new Option(row.scenario+' · '+row.code,row.id));
 const select=()=>{const record=records.find(row=>row.id===input.value);if(record)render(record);};
 input.value=records.find(row=>row.id===q.get('record'))?.id||records[0]?.id||'';
 input.onchange=select;select();
}
function copperDetail(){
 picker(copper,row=>{
  host.innerHTML='<a href="'+esc(testOrigin+'/inventory')+'">返回库存明细</a>'+identity(row,[['当前货位',row.location],['备货批次',row.batch],['客户',row.customer]])+
   section('当前库存信息',facts([['捆包编号',row.code],['当前货位',row.location],['备货批次',row.batch],['客户',row.customer],['毛重（MT）',row.gross],['净重（MT）',row.net]]))+
   section('关联单据',links(row.docs))+section('业务记录与历史依据',history(row.history))+archive(row.archive);
 });
}
function cobaltList(){
 const form=document.getElementById('batch-filter');
 for(const field of form.elements)if(field.name)field.value=q.get(field.name)||field.value;
 const render=filters=>{
  const rows=cobalt.filter(row=>(!filters.get('state')||filters.get('state')===row.kind)&&row.code.toLowerCase().includes((filters.get('batch')||'').trim().toLowerCase()));
  rows.sort(filters.get('sort')==='bags'?(a,b)=>Number(b.bags)-Number(a.bags):((a,b)=>a.code.localeCompare(b.code)));
  const size=10,page=Math.min(Math.max(1,Number(filters.get('page'))||1),Math.max(1,Math.ceil(rows.length/size)));
  const link=(value)=>{const route=new URLSearchParams(filters);route.set('page',value);return '?'+route;};
  host.innerHTML=section('库存批次',table(['批次号','货位','吨包袋数','实物净重（MT）','库存状态','操作'],rows.slice((page-1)*size,page*size).map(row=>[
   esc(row.code),esc(row.location),'<span class="number">'+esc(row.bags)+'</span>',esc(row.net),esc(row.status),
   '<a class="button secondary" href="cobalt-detail.html?'+esc(new URLSearchParams({record:row.id,back:filters.toString()}))+'">详情</a>'
  ]))+'<div class="feedback">共 '+rows.length+' 条 · 第 '+page+' 页 '+(page>1?'<a href="'+esc(link(page-1))+'">上一页</a>':'')+
   (page*size<rows.length?' <a href="'+esc(link(page+1))+'">下一页</a>':'')+'</div>');
 };
 form.onsubmit=event=>{event.preventDefault();const filters=new URLSearchParams(new FormData(form));historyReplace(filters);render(filters);};
 function historyReplace(filters){window.history.replaceState(null,'','?'+filters);}
 render(q);
}
function cobaltDetail(){
 const back=q.get('back');
 if(back)document.getElementById('back').href='cobalt-list.html?'+new URLSearchParams(back);
 picker(cobalt,row=>{
  host.innerHTML=identity(row,[['当前货位',row.location],['吨包袋数',row.bags],['实物净重（MT）',row.net],['钴品位',row.grade],
   ['预计钴金属量（MT）',row.estimated],['ARECOMS 实际确认量（MT）',row.confirmed]])+
   section('逐袋明细','<form class="wms-filter-row" id="bag-filter"><label>袋号 / 铅封号<input type="search" name="bag"></label><button class="button primary">定位</button><button class="button secondary" type="reset">清除</button></form><div id="bags" aria-live="polite"></div>')+
   section('关联单据',links(row.docs))+section('业务记录',history(row.history))+archive(row.archive);
  const form=document.getElementById('bag-filter'),box=document.getElementById('bags');
  let page=1;
  const draw=()=>{
   const query=form.elements.bag.value.trim().toLowerCase();
   const matched=row.units.filter(unit=>[unit[0],unit[1]].some(value=>String(value||'').toLowerCase().includes(query)));
   const size=20;
   box.innerHTML=table(['袋号','铅封号','毛重（kg）','净重（kg）','取样状态','作业状态'],matched.slice((page-1)*size,page*size).map(unit=>unit.map(esc)))+
    '<div class="wms-filter-actions"><button data-page="-1"'+(page<=1?' disabled':'')+'>上一页</button><button data-page="1"'+(page*size>=matched.length?' disabled':'')+'>下一页</button><span>共 '+matched.length+' 袋</span></div>';
   for(const button of box.querySelectorAll('[data-page]'))button.onclick=()=>{page+=Number(button.dataset.page);draw();};
  };
  form.onsubmit=event=>{event.preventDefault();page=1;draw();};form.onreset=()=>{page=1;queueMicrotask(draw);};draw();
 });
}
({copper:copperDetail,'cobalt-list':cobaltList,'cobalt-detail':cobaltDetail})[root.dataset.preview]();
