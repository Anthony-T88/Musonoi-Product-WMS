'use strict';
const el=id=>document.getElementById(id);
const escape=value=>String(value??'—').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const facts=(rows,style='')=>'<dl class="'+style+'">'+rows.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl>';
const table=(headers,rows,numeric=[])=>rows.length?'<div class="scroll"><table><thead><tr>'+headers.map((label,i)=>
 '<th scope="col"'+(numeric.includes(i)?' data-number':'')+'>'+escape(label)+'</th>').join('')+'</tr></thead><tbody>'+
 rows.map(row=>'<tr>'+row.map((value,i)=>'<td'+(numeric.includes(i)?' data-number':'')+'>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p>暂无记录</p>';
let product='copper';
function render(){
 const data=window.loadingDetailSamples[product];
 el('document').innerHTML='<section><div class="identity"><strong>'+escape(data.code)+'</strong><span class="state">已正式出库</span><time>'+
  escape(data.at)+'</time></div>'+facts(data.summary)+facts(data.amounts,'counts')+'</section>'+
  '<section><details><summary>装载明细（'+data.items.length+' 条）</summary>'+table(data.columns,data.items,data.numeric)+'</details></section>'+
  '<section><details><summary>关联单据（'+data.links.length+' 条）</summary>'+table(['类别','编号'],data.links)+'</details></section>'+
  '<section><details><summary>审批与操作记录（'+data.events.length+' 条）</summary>'+table(['时间','操作','操作人','意见'],data.events)+'</details></section>';
 updateActions();
}
function updateActions(){
 const state=el('review-state').value;
 const entry=state==='pending'?[product==='copper'?'具备装车审核权限且非提交人的审核人':'具备装车审核权限的现场主管或管理员，且非提交人',['审核通过','退回']]:
  state==='reviewed'?['具备离场申报权限的操作员',['登记离场']]:['有权限的查看人员',['查看已生成单证','返回列表']];
 el('role').textContent=entry[0];
 el('action-preview').innerHTML=entry[1].map(label=>'<button type="button" disabled>'+escape(label)+'</button>').join(' ');
}
for(const button of document.querySelectorAll('[data-product]'))button.onclick=()=>{
 product=button.dataset.product;
 for(const item of document.querySelectorAll('[data-product]'))item.setAttribute('aria-pressed',String(item===button));
 render();
};
el('review-state').onchange=updateActions;
render();
