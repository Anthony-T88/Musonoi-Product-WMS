'use strict';
const gateSheet=document.querySelector('.sheet');
function fitGatePermit(){if(!gateSheet?.dataset.fitWidth)return;const table=gateSheet.querySelector('table');if(!table)return;const width=Number(gateSheet.dataset.fitWidth),height=Number(gateSheet.dataset.fitHeight);const contentHeight=Math.max(table.offsetHeight,Number(gateSheet.dataset.minimumHeight)||0);gateSheet.style.zoom=String(Math.min(1,width/table.offsetWidth,height/contentHeight));}
window.addEventListener('beforeprint',fitGatePermit);
document.fonts.ready.then(()=>{fitGatePermit();if(gateSheet)gateSheet.dataset.fitReady='1';});
document.getElementById('gate-print')?.addEventListener('click',()=>{fitGatePermit();window.print();});
