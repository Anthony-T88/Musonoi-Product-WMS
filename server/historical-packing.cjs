'use strict';
const crypto=require('node:crypto');
const XLSX=require('xlsx');
const B=require('./business-common.cjs');
const T=require('../dist/tonnes.js');
const ole='d0cf11e0a1b11ae1';
const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase();
const key=value=>normalize(value).normalize('NFKC');
const unitKey=value=>key(value).replace(/^MUS-(\d{4})-(\d{1,3})-(\d+)$/,(_,year,lot,serial)=>
 'MUS-'+year+'-'+lot.padStart(3,'0')+'-'+(serial.replace(/^0+/,'')||'0'));
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const problem=message=>B.error(400,message);

function source(input){
 const name=B.text(input?.file_name,'文件名',180),encoded=input?.file_base64;
 if(!/^[^/\\]+\.xlsx?$/i.test(name)||typeof encoded!=='string'||encoded.length>700000||!/^[-+A-Za-z0-9/]+={0,2}$/.test(encoded))throw problem('请选择 512 KB 以内的 XLS 或 XLSX 文件');
 const data=Buffer.from(encoded,'base64'),modern=/\.xlsx$/i.test(name);
 if(data.length<8||data.length>524288||data.toString('hex',0,modern?4:8)!==(modern?'504b0304':ole))throw problem('文件内容与 Excel 格式不匹配');
 if(modern)require('./receipt-import.cjs').boundedZip(data,{allowPrinterSettings:true});
 return {name,data,sha256:digest(data)};
}

function parse(product,file){
 let book;
 try{book=XLSX.read(file.data,{type:'buffer',cellDates:true,cellFormula:false,bookVBA:true,sheetRows:5100});}
 catch{throw problem('无法读取工作簿');}
 if(book.vbaraw||book.SheetNames.length>16)throw problem('不接受带宏或过多工作表的工作簿');
 const sheet=book.Sheets.PL;
 if(!sheet||normalize(sheet.A1?.v)!=='PACKING LIST')throw problem('缺少可识别的 PL 装箱单工作表');
 const cell=address=>sheet[address]?.v;
 const detected=({'BAG NO':'CO_HYDROXIDE','BUNDLE NO':'CU_CATHODE'})[normalize(cell('C29'))];
 if(!detected||product&&product!==detected)throw problem('装箱单表头、产品或重量单位与支持模板不符');
 const co=detected==='CO_HYDROXIDE';
 const rowStart=29;
 const heading=co?'BAG NO':'BUNDLE NO';
 if(!normalize(cell('D3')).startsWith('PACKING LIST NO')||!normalize(cell('D4')).startsWith('LOT NO')||
    normalize(cell('C29'))!==heading||normalize(cell('E29'))!=='SEAL NO'||
    normalize(cell('F29'))!=='NET WEIGHT (KG)'||normalize(cell('G29'))!=='GROSS WEIGHT (KG)'||
    (!co&&normalize(cell('D29'))!=='SHEETS QTY'))throw problem('装箱单表头、产品或重量单位与支持模板不符');
 const text=(address,max=160)=>{
  const item=sheet[address];
  if(!item||item.t==='e'||item.v==null)return null;
  const value=String(typeof item.v==='number'?item.w||item.v:item.v).trim();
  return value&&value.length<=max&&!/[\x00-\x1f]/.test(value)?value:null;
 };
 const errors=[],rows=[],seen=new Set(),limit=Math.min(5050,XLSX.utils.decode_range(sheet['!ref']).e.r+1);
 let totalRow=null;
 for(let row=rowStart+1;row<=limit;row++){
  if(/^TOTAL\b/.test(normalize(cell('A'+row)))){totalRow=row;break;}
  if(!['A','C','D','E','F','G'].some(column=>cell(column+row)!=null&&cell(column+row)!==''))continue;
  const unit=text('C'+row),id=unitKey(unit),net=weight(cell('F'+row)),gross=weight(cell('G'+row));
  const qty=co?null:Number(cell('D'+row));
  const flags=[];
  if(!unit)flags.push('UNIT_MISSING');
  if(seen.has(id)&&id)flags.push('DUPLICATE_UNIT');
  if(id)seen.add(id);
  if(!co&&(!Number.isSafeInteger(qty)||qty<=0||qty>100000))flags.push('INVALID_SHEETS');
  if(net===null||gross===null||Number(gross)<Number(net))flags.push('INVALID_WEIGHT');
  rows.push({source_row:row,unit_id:unit,unit_key:id,seal_no:text('E'+row),sheets_count:qty,net_kg:net,gross_kg:gross,flags});
 }
 if(!totalRow)errors.push('TOTAL_ROW_MISSING');
 if(!rows.length)errors.push('DETAILS_MISSING');
 const document_no=text('E3'),batch_no=text('E4'),customer=text('A22'),truck=text('E22');
 if(!document_no)errors.push('DOCUMENT_NO_MISSING');
 if(!batch_no)errors.push('BATCH_NO_MISSING');
 const totals={quantity:rows.length,net_kg:sum(rows,'net_kg'),gross_kg:sum(rows,'gross_kg')};
 for(const [column,name] of [['F','net_kg'],['G','gross_kg']]){
  const reported=totalRow&&weight(cell(column+totalRow));
  if(reported&&totals[name]!==null&&Math.abs(Number(reported)-Number(totals[name]))>0.011)errors.push('SOURCE_TOTAL_MISMATCH');
 }
 const dateValue=value=>{
  const day=value instanceof Date&&Number.isFinite(+value)?value.toISOString().slice(0,10):typeof value==='string'?value.trim():null;
  try{return B.date(day);}catch{return null;}
 };
 const actual_dates={};
 for(let row=3;row<29;row++){
  const label=normalize(cell('D'+row)).replace(/:$/,'');
  const type=({'ACTUAL INBOUND DATE':'INBOUND','ACTUAL RECEIPT DATE':'INBOUND','实际入库日期':'INBOUND',
   'ACTUAL OUTBOUND DATE':'OUTBOUND','ACTUAL DISPATCH DATE':'OUTBOUND','实际出库日期':'OUTBOUND'})[label];
  if(!type)continue;
  const day=dateValue(cell('E'+row));
  if(day)actual_dates[type]={day,cell:'PL!E'+row};
 }
 const shippingFields=[];
 for(let row=3;row<29;row++){
  if(!/^(SHIPPING DATE|SHIPMENT DATE|发运日期)[:：]?$/.test(normalize(cell('D'+row))))continue;
  const address='E'+row;
  shippingFields.push({cell:'PL!'+address,day:dateValue(cell(address)),empty:cell(address)==null||cell(address)===''});
 }
 const shipping=shippingFields[0];
 const shipping_issue=shippingFields.length>1?'SHIPPING_DATE_AMBIGUOUS':
  !shipping||shipping.empty?'SHIPPING_DATE_MISSING':!shipping.day?'SHIPPING_DATE_INVALID':null;
 const shipping_date=shipping_issue?null:shipping.day;
 return {product_code:detected,template:co?'CO-PL':'CU-PL',document_no,document_key:key(document_no),batch_no,customer,truck,
  shipping_issue,shipping_cell:shipping?.cell||'PL!E7',
  contract_no:text('E5'),trailer_one:text('E23'),trailer_two:text('E24'),shipping_date,actual_dates,source_sheet:'PL',rows,totals,errors:[...new Set(errors)]};
}

function weight(value){
 const number=String(value??'').trim();
 if(!/^\d{1,9}(?:\.\d{1,12})?$/.test(number)||Number(number)<=0)return null;
 return T.fixed(T.scaled(number,6),6);
}
function sum(rows,field){
 return rows.length&&rows.every(row=>row[field]!==null)?T.fixed(rows.reduce((sum,row)=>sum+T.scaled(row[field],6),0n),6):null;
}
module.exports={source,parse,digest,key,unitKey};
