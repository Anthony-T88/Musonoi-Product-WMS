'use strict';
const E=require('exceljs'),B=require('./business-common.cjs');
const aliases={bundle_no:['捆包编号','捆包号','Bundle No.','Bundle Number'],sheets_per_bundle:['捆包片数','片数','Sheets per Bundle','Sheet Count'],production_date:['生产日期','Production Date'],inbound_at:['入库时间','入库日期','入库时间（含时区）','Inbound Time','Inbound Date','Inbound Time (with Time Zone)'],remark:['备注','Remarks','Remark']};
const key=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
const names=Object.fromEntries(Object.entries(aliases).flatMap(([k,vs])=>vs.map(v=>[key(v),k]))),required=['bundle_no','sheets_per_bundle','production_date','inbound_at'];
const blank=v=>v==null||typeof v==='string'&&!v.trim();
function calendar(y,m,d){const stamp=Date.UTC(+y,+m-1,+d),dt=new Date(stamp);if(dt.getUTCFullYear()!==+y||dt.getUTCMonth()!==+m-1||dt.getUTCDate()!==+d)throw Error('日期无效');return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function dateValue(v,inbound,date1904){
 if(v instanceof Date||typeof v==='number'){
  const dt=v instanceof Date?v:new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Math.round(v*86400000));
  if(!Number.isFinite(dt.getTime())||dt.getUTCFullYear()<1900||dt.getUTCFullYear()>9999)throw Error('Excel日期无效');
  return inbound?new Date(dt.getTime()-7200000).toISOString():dt.toISOString().slice(0,10);
 }
 const text=String(v??'').trim();
 if(inbound&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(text)){
  const d=text.slice(0,10).split('-');calendar(...d);if(!Number.isFinite(Date.parse(text)))throw Error('入库时间无效');return new Date(text).toISOString();
 }
 const m=text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
 if(!m)throw Error(inbound?'入库时间须为Excel日期、YYYY/MM/DD HH:mm或带时区的ISO时间':'生产日期须为Excel日期或YYYY/MM/DD');
 const date=calendar(m[1],m[2],m[3]),h=+(m[4]||0),min=+(m[5]||0),s=+(m[6]||0);
 if(h>23||min>59||s>59)throw Error('时间无效');
 return inbound?new Date(`${date}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}+02:00`).toISOString():date;
}
async function parse(buffer){
 require('./receipt-import.cjs').boundedZip(buffer);const wb=new E.Workbook();try{await wb.xlsx.load(buffer);}catch{throw B.error(400,'无法读取Excel，请使用未加密的.xlsx文件');}
 const candidates=[];
 for(const ws of wb.worksheets)for(let r=1;r<=Math.min(20,ws.rowCount);r++){
  const map={},duplicates=[];ws.getRow(r).eachCell((c,col)=>{const field=names[key(c.text)];if(field){if(map[field])duplicates.push(field);map[field]=col;}});
  if(required.every(k=>map[k])&&!candidates.some(c=>c.ws===ws&&JSON.stringify(c.map)===JSON.stringify(map)))candidates.push({ws,row:r,map,duplicates});
 }
 if(candidates.length!==1)throw B.error(400,candidates.length?'识别到多个入库明细表，请仅保留一个待导入明细表':'未识别到入库表头，须包含捆包编号、捆包片数、生产日期、入库时间');
 const {ws,row,map,duplicates}=candidates[0];if(duplicates.length)throw B.error(400,'入库表头存在重复字段，请核对');
 if(ws.rowCount>10000||ws.columnCount>100)throw B.error(400,'Excel有效范围过大，请删除多余行列');
 const lines=[];
 for(let n=row+1;n<=ws.rowCount;n++){
  const cells=ws.getRow(n);if(!cells.hasValues)continue;
  const input=Object.fromEntries(Object.entries(map).map(([k,col])=>[k,cells.getCell(col).value]));
  if(Object.values(input).every(blank))continue;
  if(required.every(k=>names[key(cells.getCell(map[k]).text)]===k))continue;
  try{
   cells.eachCell(c=>{if(c.value&&typeof c.value==='object'&&!(c.value instanceof Date))throw Error('禁止公式、超链接或复杂单元格，请粘贴纯值');if(!map.remark||c.col!==map.remark){if(!Object.values(map).includes(c.col)&&!blank(c.value))throw Error('存在未识别的非空数据列，请核对表头');}});
   for(const k of required)if(blank(input[k]))throw Error(aliases[k][0]+'不能为空');
   lines.push({bundle_no:require('../dist/bundle-number.js').normalize(input.bundle_no),sheets_per_bundle:require('./v262.cjs').sheets(typeof input.sheets_per_bundle==='string'?input.sheets_per_bundle.trim():input.sheets_per_bundle),production_date:dateValue(input.production_date,false,wb.properties.date1904),inbound_at:dateValue(input.inbound_at,true,wb.properties.date1904),remark:String(input.remark??'').trim()});
   if(lines.length>500)throw Error('每批最多500捆，请拆分文件');
  }catch(e){throw B.error(400,`Excel第${n}行：${e.message}`);}
 }
 if(!lines.length)throw B.error(400,'没有可导入的捆包记录');
 return {lines,mapping:{sheet:ws.name,header_row:row,columns:map},total_rows:lines.length};
}
module.exports={parse,dateValue};
