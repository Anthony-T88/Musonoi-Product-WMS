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
const problem=(code,message,details)=>Object.assign(B.error(400,message),{code,details});

function source(input){
 const name=typeof input?.file_name==='string'?input.file_name.trim():'',encoded=input?.file_base64;
 if(!name||name.length>180||!/^[^/\\]+\.xlsx?$/i.test(name))throw problem('FILE_TYPE_INVALID','请使用文件名有效的 XLS 或 XLSX 文件');
 if(typeof encoded!=='string'||encoded.length>700000||!/^[-+A-Za-z0-9/]+={0,2}$/.test(encoded))throw problem('FILE_ENCODING_INVALID','文件数据不完整或超过大小限制');
 const data=Buffer.from(encoded,'base64'),modern=/\.xlsx$/i.test(name);
 if(data.length>524288)throw problem('FILE_TOO_LARGE','单份文件不能超过 512 KB');
 if(data.length<8||data.toString('hex',0,modern?4:8)!==(modern?'504b0304':ole))throw problem('FILE_FORMAT_MISMATCH','文件内容与扩展名不匹配');
 if(modern){
  try{require('./receipt-import.cjs').boundedZip(data,{allowPrinterSettings:true});}
  catch(error){if(error.statusCode!==400)throw error;throw problem('WORKBOOK_ARCHIVE_INVALID',error.message);}
 }
 return {name,data,sha256:digest(data)};
}

function licenseReferences(book){
 const rows=['PL','INV'].map(name=>book.Sheets[name]).filter(Boolean);
 const entries=new Map();
 for(const sheet of rows){
  for(let row=3;row<29;row++){
   if(!/^(?:(?:EB|EXPORT) )?(?:LICEN[CS]E|PERMIT) (?:NO\.?|NUMBER)[:：]?$|^(?:出口)?许可证号[:：]?$/.test(normalize(sheet['D'+row]?.v)))continue;
   const value=String(sheet['E'+row]?.v??'').trim();
   if(value&&value.length<=160&&!/[\x00-\x1f]/.test(value))entries.set(key(value),value);
  }
 }
 const invoice=book.Sheets.INV,raw=String(invoice?.E3?.v??'').trim();
 const invoice_no=/^INVOICE (?:NO\.?|NUMBER)[:：]?$/.test(normalize(invoice?.D3?.v))&&raw.length<=160&&!/[\x00-\x1f]/.test(raw)?raw||null:null;
 return {license_no:entries.size===1?[...entries.values()][0]:null,invoice_no};
}

function parse(product,file){
 let book;
 try{book=XLSX.read(file.data,{type:'buffer',cellDates:true,cellFormula:false,bookVBA:true,sheetRows:5100});}
 catch{throw problem('WORKBOOK_UNREADABLE','无法读取工作簿');}
 if(book.vbaraw||book.SheetNames.length>16)throw problem('WORKBOOK_STRUCTURE_INVALID','不接受带宏或超过 16 个工作表的工作簿');
 const sheet=book.Sheets.PL;
 if(!sheet)throw problem('PACKING_SHEET_MISSING','缺少 PL 装箱单工作表');
 const cell=address=>sheet[address]?.v;
 const detected=({'BAG NO':'CO_HYDROXIDE','BUNDLE NO':'CU_CATHODE'})[normalize(cell('C29'))];
 const originalValue=address=>String(cell(address)??'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,80);
 const detail=(code,address,fields={})=>({code,cell:'PL!'+address,...fields});
 const header=(address,expected)=>detail('HEADER_MISMATCH',address,{expected,value:originalValue(address)});
 if(normalize(cell('A1'))!=='PACKING LIST')throw problem('HEADER_MISMATCH','装箱单标题不正确',[header('A1','PACKING LIST')]);
 if(!detected)throw problem('HEADER_MISMATCH','装箱单编号列表头不正确',[header('C29','BAG NO / BUNDLE NO')]);
 if(product&&product!==detected)throw problem('TEMPLATE_PRODUCT_MISMATCH','装箱单产品与所选产品不一致');
 const co=detected==='CO_HYDROXIDE';
 const rowStart=29;
 const headers=[['D3','PACKING LIST NO'],['D4','LOT NO'],['E29','SEAL NO'],['F29','NET WEIGHT (KG)'],['G29','GROSS WEIGHT (KG)']];
 if(!co)headers.push(['D29','SHEETS QTY']);
 const wrongHeaders=headers.filter(([address,expected])=>['D3','D4'].includes(address)?
  !normalize(cell(address)).startsWith(expected):normalize(cell(address))!==expected);
 if(wrongHeaders.length)throw problem('HEADER_MISMATCH','装箱单表头与模板不一致',wrongHeaders.map(([address,expected])=>header(address,expected)));
 const text=(address,max=160)=>{
  const item=sheet[address];
  if(!item||item.t==='e'||item.v==null)return null;
  const value=String(typeof item.v==='number'?item.w||item.v:item.v).trim();
  return value&&value.length<=max&&!/[\x00-\x1f]/.test(value)?value:null;
 };
 const errors=[],issue_details=[],rows=[],seen=new Map(),limit=Math.min(5050,XLSX.utils.decode_range(sheet['!ref']).e.r+1);
 const issue=(code,address,data)=>{errors.push(code);issue_details.push(detail(code,address,data));};
 let totalRow=null;
 for(let row=rowStart+1;row<=limit;row++){
  if(/^TOTAL\b/.test(normalize(cell('A'+row)))){totalRow=row;break;}
  if(!['A','C','D','E','F','G'].some(column=>cell(column+row)!=null&&cell(column+row)!==''))continue;
  const unit=text('C'+row),id=unitKey(unit),net=weight(cell('F'+row)),gross=weight(cell('G'+row));
  const qty=co?null:Number(cell('D'+row));
  const flags=[],details=[];
  if(!unit){flags.push('UNIT_MISSING');details.push(detail('UNIT_MISSING','C'+row,{value:originalValue('C'+row)}));}
  if(id&&seen.has(id)){
   flags.push('DUPLICATE_UNIT');
   details.push(detail('DUPLICATE_UNIT','C'+row,{other_cell:'PL!C'+seen.get(id)}));
  }else if(id)seen.set(id,row);
  if(!co&&(!Number.isSafeInteger(qty)||qty<=0||qty>100000)){
   flags.push('INVALID_SHEETS');details.push(detail('INVALID_SHEETS','D'+row,{value:originalValue('D'+row)}));
  }
  if(net===null||gross===null||Number(gross)<Number(net)){
   flags.push('INVALID_WEIGHT');
   if(net===null)details.push(detail('NET_WEIGHT_INVALID','F'+row,{value:originalValue('F'+row)}));
   if(gross===null)details.push(detail('GROSS_WEIGHT_INVALID','G'+row,{value:originalValue('G'+row)}));
   if(net!==null&&gross!==null)details.push(detail('GROSS_BELOW_NET','G'+row,{other_cell:'PL!F'+row,value:gross,expected:net}));
  }
  rows.push({source_row:row,unit_id:unit,unit_key:id,seal_no:text('E'+row),sheets_count:qty,net_kg:net,gross_kg:gross,flags,
   ...(details.length?{issue_details:details}:{})});
 }
 if(!totalRow)issue('TOTAL_ROW_MISSING','A30');
 if(!rows.length)issue('DETAILS_MISSING','C30');
 const seals=new Map();
 for(const row of rows){
  const seal=key(row.seal_no);
  if(!seal)continue;
  if(!seals.has(seal))seals.set(seal,[]);
  const firstRows=seals.get(seal);
  if(firstRows.length<2)firstRows.push(row.source_row);
 }
 for(const row of rows){
  const firstRows=seals.get(key(row.seal_no));
  if(firstRows?.length!==2)continue;
  row.flags.push('DUPLICATE_SEAL');
  const other=firstRows.find(number=>number!==row.source_row);
  (row.issue_details??=[]).push(detail('DUPLICATE_SEAL','E'+row.source_row,{other_cell:'PL!E'+other}));
 }
 const document_no=text('E3'),batch_no=text('E4'),customer=text('A22'),truck=text('E22');
 if(!document_no)issue('DOCUMENT_NO_MISSING','E3',{value:originalValue('E3')});
 if(!batch_no)issue('BATCH_NO_MISSING','E4',{value:originalValue('E4')});
 const totals={quantity:rows.length,net_kg:sum(rows,'net_kg'),gross_kg:sum(rows,'gross_kg')};
 for(const [column,name] of [['F','net_kg'],['G','gross_kg']]){
  const reported=totalRow&&weight(cell(column+totalRow));
  if(reported&&totals[name]!==null&&Math.abs(Number(reported)-Number(totals[name]))>0.011)
   issue('SOURCE_TOTAL_MISMATCH',column+totalRow,{field:name,value:reported,expected:totals[name]});
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
  shippingFields.push({cell:'PL!'+address,day:dateValue(cell(address)),empty:cell(address)==null||cell(address)==='',value:originalValue(address)});
 }
 const shipping=shippingFields[0];
 const shipping_issue=shippingFields.length>1?'SHIPPING_DATE_AMBIGUOUS':
  !shipping||shipping.empty?'SHIPPING_DATE_MISSING':!shipping.day?'SHIPPING_DATE_INVALID':null;
 const shipping_date=shipping_issue?null:shipping.day;
 if(shipping_issue)issue_details.push({code:shipping_issue,cell:shipping?.cell||'PL!E7',value:shipping?.value,
  ...(shippingFields.length>1?{cells:shippingFields.map(field=>field.cell)}:{})});
 return {product_code:detected,template:co?'CO-PL':'CU-PL',document_no,document_key:key(document_no),batch_no,customer,truck,
  shipping_issue,shipping_cell:shipping?.cell||'PL!E7',
  contract_no:text('E5'),...licenseReferences(book),trailer_one:text('E23'),trailer_two:text('E24'),shipping_date,actual_dates,source_sheet:'PL',rows,totals,
  errors:[...new Set(errors)],issue_details};
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
