'use strict';

const sheet=document.querySelector('.bp-sheet');

function fitForPrint(){
 // A4 landscape with 8 mm top and bottom margins, allowing for print rounding.
 const availableHeight=(210-16)*96/25.4-4;
 const shortSheet=sheet.classList.contains('bp-short');
 sheet.classList.add('bp-measuring');
 sheet.classList.toggle('bp-enlarged',shortSheet);
 let height=sheet.getBoundingClientRect().height;
 if(shortSheet&&height>availableHeight){
  sheet.classList.remove('bp-enlarged');
  height=sheet.getBoundingClientRect().height;
 }
 sheet.classList.remove('bp-measuring');
 const scale=Math.min(1,availableHeight/height);
 sheet.style.setProperty('--bp-print-scale',scale>=0.84?String(scale):'1');
}

document.getElementById('bp-print').addEventListener('click',()=>window.print());
window.addEventListener('beforeprint',fitForPrint);
window.addEventListener('load',()=>{
 fitForPrint();
 if(document.body.hasAttribute('data-print-auto'))window.print();
},{once:true});
