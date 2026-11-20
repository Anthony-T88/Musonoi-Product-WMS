'use strict';
const gateSheet=document.querySelector('.sheet');
const gateArea=document.querySelector('.print-area');
const gatePrint=document.getElementById('gate-print');

function fitGatePermit(){
 const width=gateSheet.scrollWidth;
 const height=gateSheet.scrollHeight;
 if(!width||!height)return;
 const scale=Math.min(1,(gateArea.clientWidth-2)/width,(gateArea.clientHeight-2)/height);
 gateSheet.style.setProperty('--gate-print-scale',String(scale));
}

window.addEventListener('beforeprint',fitGatePermit);
document.fonts.ready.then(()=>{
 fitGatePermit();
 gateSheet.dataset.fitReady='1';
 gatePrint.disabled=false;
});
gatePrint.addEventListener('click',()=>{
 fitGatePermit();
 window.print();
});
