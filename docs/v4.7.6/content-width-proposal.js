'use strict';
const select=document.querySelector('.proposal-stage'),aside=select.querySelector('aside');
const entries=[window.loadingDetailSamples.copper,window.loadingDetailSamples.cobalt];
const rows=document.getElementById('plans'),record=document.getElementById('preview-record');
let selected=0;
function layout(state){
 aside.hidden=state==='empty'||state==='closed';
 select.classList.toggle('narrow',state==='narrow');
 for(const button of document.querySelectorAll('[data-layout]'))button.setAttribute('aria-pressed',String(button.dataset.layout===state));
 record.replaceChildren();
 for(const [label,value] of [['装车计划',entries[selected].plan],['车辆',entries[selected].vehicle],['装车单',entries[selected].code]]){
  const item=document.createElement('div'),key=document.createElement('dt'),field=document.createElement('dd');
  key.textContent=label;field.textContent=value??'—';item.append(key,field);record.append(item);
 }
}
for(const [i,entry] of entries.entries()){
 const row=rows.insertRow();
 for(const value of [entry.plan,entry.vehicle,'已正式出库'])row.insertCell().textContent=value??'—';
 const action=document.createElement('button');action.type='button';action.textContent='预览';
 action.onclick=()=>{selected=i;layout(select.classList.contains('narrow')?'narrow':'open');};
 row.insertCell().append(action);
}
for(const button of document.querySelectorAll('[data-layout]'))button.onclick=()=>layout(button.dataset.layout);
document.getElementById('close-preview').onclick=()=>layout('closed');
layout('empty');
