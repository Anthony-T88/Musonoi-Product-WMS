'use strict';
((root)=>{
 const blocks={
  intro:['库存与发运','Inventory & Shipping',12],metrics:['库存与履约指标','Inventory & Fulfilment Metrics',12],
  net:['出入库净重统计','Inbound & Outbound Net Weight',6],vehicles:['出库车辆统计','Outbound Vehicles',6],
  stock:['库存状态结构','Inventory State',4],customers:['客户库存结构','Customer Inventory',4],
  attention:['本班关注与待办','Tasks & Exceptions',4],execution:['销售计划执行明细','Sales Plan Execution',12],
  flow:['车辆与装车计划流转','Vehicle & Loading Plan Flow',12],balance:['收发存与月度预检','Stock Balance & Monthly Precheck',12]
 };
 const keys=Object.keys(blocks);
 const widths=[3,4,6,8,9,12],spacing=[8,12,16,18,20,24,32],alignments=['left','center','right'];
 const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
 const blockId=id=>typeof id==='string'&&/^b-[0-9a-z]{1,12}$/.test(id);
 const validStyle=style=>record(style)&&Object.entries(style).every(([key,value])=>
  key==='width'?widths.includes(value):key==='padding'?spacing.includes(value):
  key==='alignment'?alignments.includes(value):key==='background'&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value));
 const validLayout=(d,validId,max)=>record(d)&&Object.keys(d).every(k=>['order','gap','blocks'].includes(k))&&
  Array.isArray(d.order)&&d.order.length<=max&&new Set(d.order).size===d.order.length&&d.order.every(validId)&&
  (d.gap===null||spacing.includes(d.gap))&&record(d.blocks)&&Object.keys(d.blocks).length<=max&&
  Object.entries(d.blocks).every(([id,style])=>validId(id)&&validStyle(style));
 const isValid=d=>validLayout(d,id=>keys.includes(id),keys.length)&&d.order.length===keys.length&&d.gap!==null;
 const defaults=()=>({order:[...keys],gap:18,blocks:{}});
 const model={blocks,keys,widths,spacing,alignments,isValid,defaults,
  isValidPage:d=>validLayout(d,blockId,250),pageDefaults:()=>({order:[],gap:null,blocks:{}})};
 if(typeof module!=='undefined'&&module.exports)module.exports=model;
 else root.OverviewDesignModel=model;
})(globalThis);
