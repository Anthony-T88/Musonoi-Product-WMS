'use strict';

(function(){
 const minFont=7*4/3; // 7 pt at normal print scale.
 function fitLines(sheet){
  const lines=[...sheet.querySelectorAll('.bp-line')];
  for(const line of lines){
   line.style.removeProperty('font-size');
   line.classList.add('bp-single-line');
  }
  const range=document.createRange();
  const sizes=lines.map(line=>{
   range.selectNodeContents(line);
   const textWidth=range.getBoundingClientRect().width;
   const available=line.getBoundingClientRect().width;
   if(textWidth<=available)return null;
   return parseFloat(getComputedStyle(line).fontSize)*Math.max(0,available-0.5)/textWidth;
  });
  lines.forEach((line,index)=>{
   const size=sizes[index];
   if(size===null)return;
   line.style.fontSize=Math.max(minFont,Math.floor(size*100)/100)+'px';
   line.classList.toggle('bp-single-line',size>=minFont);
  });
 }
 window.CustomsBPPrint={fitLines};

 const sheet=document.querySelector('.bp-print-document .bp-sheet');
 if(!sheet)return;
 function fitForPrint(){
  // A4 landscape with 8 mm top and bottom margins, allowing for print rounding.
  const availableHeight=(210-16)*96/25.4-4;
  const shortSheet=sheet.classList.contains('bp-short');
  sheet.classList.add('bp-measuring');
  sheet.classList.toggle('bp-enlarged',shortSheet);
  fitLines(sheet);
  let height=sheet.getBoundingClientRect().height;
  if(shortSheet&&height>availableHeight){
   sheet.classList.remove('bp-enlarged');
   fitLines(sheet);
   height=sheet.getBoundingClientRect().height;
  }
  sheet.classList.remove('bp-measuring');
  const scale=Math.min(1,availableHeight/height);
  sheet.style.setProperty('--bp-print-scale',scale>=0.84?String(scale):'1');
 }

 document.getElementById('bp-print').addEventListener('click',()=>window.print());
 window.addEventListener('beforeprint',fitForPrint);
 window.addEventListener('afterprint',()=>fitLines(sheet));
 window.addEventListener('load',async()=>{
  await document.fonts.ready;
  fitForPrint();
  fitLines(sheet);
  if(document.body.hasAttribute('data-print-auto'))window.print();
 },{once:true});
})();
