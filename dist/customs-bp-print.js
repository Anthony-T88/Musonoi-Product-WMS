'use strict';

const sheet=document.querySelector('.bp-sheet');

function fitForPrint(){
 sheet.classList.add('bp-measuring');
 const height=sheet.getBoundingClientRect().height;
 sheet.classList.remove('bp-measuring');
 // A4 landscape with 12 mm margins. Allow for print rounding on the last row.
 const availableHeight=(210-24)*96/25.4-4;
 const scale=Math.min(1,availableHeight/height);
 sheet.style.setProperty('--bp-print-scale',scale>=0.84?String(scale):'1');
}

document.getElementById('bp-print').addEventListener('click',()=>window.print());
window.addEventListener('beforeprint',fitForPrint);
window.addEventListener('load',()=>{
 fitForPrint();
 if(document.body.hasAttribute('data-print-auto'))window.print();
},{once:true});
