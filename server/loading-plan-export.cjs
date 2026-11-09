'use strict';
const Excel=require('exceljs'),B=require('./business-common.cjs');
async function send(req,reply,data,co){
 if(data.items.length>10000)throw B.error(400,'导出超过10000条，请缩小筛选范围');
 const en=req.body?.language==='en',labels=[['装车计划单号','Loading Plan No.'],['发运月份','Shipment Month'],['客户','Customer'],['合同号','Contract No.'],['车牌号','Truck'],['发票号','Invoice No.'],['装箱单号','Packing List No.'],['备货批次','Preparation Batch'],['状态','Status']].map(x=>x[en?1:0]);
 const book=new Excel.Workbook(),sheet=book.addWorksheet(en?'Loading Plans':'装车计划');
 sheet.columns=labels.map((header,i)=>({header,key:String(i),width:[26,16,35,28,24,30,32,34,22][i]}));
 for(const r of data.items)sheet.addRow([r.code||r.document_no||'',r.shipment_month||r.dispatch_shipment_month||r.preparation_month||'',r.customer_name||'',r.contract_no||'',r.vehicle_no||'',r.invoice_no||'',r.packing_list_no||'',r.preparation_batch_no||r.shipment_batch_no||'',en?({DRAFT:'Draft',WAITING:'Awaiting Match',MATCHED:'Matched',LOADING:'Loading',PENDING_OUTBOUND:'Awaiting Final Outbound',COMPLETED:'Completed',OUTBOUND:'Posted Outbound',CANCELLED:'Cancelled'}[r.state||r.status]||r.status):({DRAFT:'草稿',WAITING:'待匹配',MATCHED:'已匹配',LOADING:'装车中',PENDING_OUTBOUND:'待正式出库',COMPLETED:'已完成',OUTBOUND:'已正式出库',CANCELLED:'已取消'}[r.state||r.status]||r.status)]);
 sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'I'+Math.max(1,sheet.rowCount)};sheet.eachRow((row,i)=>{row.alignment={horizontal:'center',vertical:'middle',wrapText:true};if(i===1){row.font={bold:true,color:{argb:'FFFFFFFF'}};row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF316D4B'}};}row.height=i===1?28:36;});
 const bytes=await book.xlsx.writeBuffer();return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition','attachment; filename="Loading-Plans-'+(co?'CO':'CU')+'.xlsx"').send(bytes);
}
function filters(body){const keys=['shipment_month','customer_id','status','search','sort','direction','language','arrival_date','planned_load_date'];if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||Object.values(body).some(v=>typeof v!=='string'))throw B.error(400,'装车计划筛选无效');const q={...body};delete q.language;return q;}
module.exports={send,filters};
