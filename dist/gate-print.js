'use strict';
const gateSheet=document.querySelector('.sheet');
const gateArea=document.querySelector('.print-area');
const gatePrint=document.getElementById('gate-print');
const gatePaperSize=document.getElementById('gate-paper-size')?.sheet;

function fitGatePermit(){
 const width=gateSheet.scrollWidth;
 const height=gateSheet.scrollHeight;
 if(!width||!height)return;
 // The browser viewport is unrelated to the selected physical form.
 const availableWidth=Number(gateArea.dataset.fitWidth)||gateArea.clientWidth-2;
 const availableHeight=Number(gateArea.dataset.fitHeight)||gateArea.clientHeight-2;
 const scale=Math.min(availableWidth/width,availableHeight/height);
 if(gatePaperSize)gateSheet.style.width=width+'px';
 gateSheet.style.setProperty('--gate-print-scale',String(scale));
 gateSheet.style.setProperty('--gate-sheet-width',width+'px');
}

window.addEventListener('beforeprint',fitGatePermit);
window.addEventListener('afterprint',()=>{if(gatePaperSize)gatePaperSize.disabled=false;fitGatePermit();});
document.fonts.ready.then(()=>{
 fitGatePermit();
 gateSheet.dataset.fitReady='1';
 gatePrint.disabled=false;
});
gatePrint.addEventListener('click',()=>{
 // A driver already makes this wider-than-tall form landscape. Avoid requesting a second rotation.
 if(gatePaperSize)gatePaperSize.disabled=true;
 fitGatePermit();
 window.print();
});
