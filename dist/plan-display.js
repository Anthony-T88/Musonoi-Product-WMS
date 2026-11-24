'use strict';
function displayCommercialNumber(value,historical=false){
 if(historical||typeof value!=='string')return value;
 const separated=value.match(/^SP-\d+-\d+(?:\s*[·:|–—]\s*|\s+)([A-Z0-9]+(?:[-/.][A-Z0-9]+)+)$/i);
 const attached=value.match(/^SP-\d+-\d+[-_/\s]*(RMM?[-/][A-Z0-9]+(?:[-/._][A-Z0-9]+)+)$/i);
 return separated?.[1]||attached?.[1]||value;
}
if(typeof module!=='undefined'&&module.exports)module.exports={documentNo:displayCommercialNumber};
else window.PlanDisplay={
 documentNo:displayCommercialNumber,
 format(v){return v===null||v===undefined||v===''?(I18n.language==='en'?'Unknown':'未知'):Number(v).toLocaleString(I18n.language==='en'?'en-US':'zh-CN',{maximumFractionDigits:0,minimumFractionDigits:0});},
 raw(input){const value=String(input?.dataset.planRaw??input?.value??'');return value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;},
 bind(input){if(!input||input.hasAttribute('data-plan-quantity-bound'))return;input.dataset.planQuantityBound='true';input.dataset.planRaw=input.value;input.type='text';input.inputMode='decimal';input.removeAttribute('pattern');const show=()=>{input.value=input.dataset.planRaw===''?'':this.format(input.dataset.planRaw);};input.addEventListener('focus',()=>{input.value=input.dataset.planRaw;input.select();});input.addEventListener('input',()=>input.dataset.planRaw=input.value);input.addEventListener('blur',show);show();},
 refresh(){if(location.pathname.startsWith('/sales-plans'))for(const input of document.querySelectorAll('input[name=target_weight],input[name=planned_physical_mt]'))this.bind(input);}
};
