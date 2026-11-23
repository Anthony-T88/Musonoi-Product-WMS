'use strict';

document.getElementById('bp-print').addEventListener('click',()=>window.print());
if(document.body.hasAttribute('data-print-auto'))window.addEventListener('load',()=>window.print(),{once:true});
