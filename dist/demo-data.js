/* Explicit offline demo/test fixture only. Never production seed. */
(function(root){
'use strict';
  const customers=['华远金属（演示）','中联铜业（演示）','嘉盛贸易（演示）','项目自有（演示）'];
  const locations=['A-01-01','A-01-02','A-02-01','A-02-02','B-01-01','B-01-02'];
  const data=Array.from({length:128},(_,i)=>{
    const day=1+(i*5+3)%28;
    return {id:`MSN-CU-26${String(i+1).padStart(4,'0')}`,batch:`MSN-2610-${String(1+Math.floor(i/16)).padStart(2,'0')}`,location:locations[(i*5)%6],customer:customers[(Math.floor(i/7)+i)%4],weight:Math.round((2.1+((i*37)%340)/1000)*1000)/1000,status:i%11===0?'已出库':i%5===0?'已预留':'在库',sample:i%4===0?'未取样':i%7===0?'取样中':'已取样',date:`2026-10-${String(day).padStart(2,'0')}`,grade:'A级阴极铜（演示）',purity:'99.99%（演示值）'};
  });
const api={data};root.DemoInventory=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
