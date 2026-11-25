'use strict';

const path=require('node:path'),Excel=require('exceljs');
const {longDate}=require('../dist/business-time.js');
const {columns,companyFields,declarationFields,sheetTitle}=require('./customs-bp-print.cjs');
const widths=[5,19,12,11,11,14,24,25,15,11,15,15];
const numeric=new Set(['quantity','net_mt','gross_mt']);
const numberFormat=key=>key==='quantity'?'#,##0':'#,##0.000';

function merge(sheet,row,start,end,value){
 sheet.mergeCells(row,start,row,end);
 const cell=sheet.getCell(row,start);
 cell.value=value;
 cell.alignment={vertical:'middle',shrinkToFit:true};
 return cell;
}

function lines(value,width){
 return String(value??'').split(/\r?\n/).reduce((count,line)=>count+Math.max(1,Math.ceil(line.length/width)),0);
}

function fitCell(cell,width,horizontal='left'){
 // Let Excel scale moderately long text. Give longer values more rows of space.
 const wrap=lines(cell.value,Math.floor(width*1.45))>1;
 cell.alignment={horizontal,vertical:'middle',wrapText:wrap,shrinkToFit:!wrap};
 return wrap?lines(cell.value,width):1;
}

async function workbook(snapshot){
 const {header,rows,total}=snapshot,book=new Excel.Workbook();
 const sheet=book.addWorksheet('Bulletin de pesage',{
  views:[{showGridLines:false}],
  pageSetup:{paperSize:9,orientation:'landscape',horizontalCentered:true,fitToPage:true,fitToWidth:1,fitToHeight:rows.length<=10?1:0,
   margins:{left:0.24,right:0.24,top:0.31,bottom:0.31,header:0.2,footer:0.2}}
 });
 widths.forEach((width,index)=>{sheet.getColumn(index+1).width=width;});
 const title=merge(sheet,1,1,columns.length,sheetTitle(snapshot));
 title.font={name:'Arial',size:15,bold:true};
 sheet.getRow(1).height=Math.max(28,fitCell(title,134,'center')*18);

 for(const [index,[label,key]] of companyFields.entries()){
  const text=header[key]?String(header[key]):'';
  const row=index+2,cell=merge(sheet,row,1,8,text&&label?label+': '+text:text||null);
  cell.font={name:'Arial',size:10,bold:index===0};
  sheet.getRow(row).height=Math.max(18,fitCell(cell,106)*13);
 }
 const logo=book.addImage({filename:path.join(__dirname,'../dist/customs-bp-logo.png'),extension:'png'});
 sheet.addImage(logo,{tl:{col:9.7,row:1.2},ext:{width:131,height:117},editAs:'oneCell'});
 sheet.getRow(8).height=8;
 for(const [group,fields] of declarationFields.entries()){
  for(const [index,[label,key]] of fields.entries()){
   const row=9+index,start=group===0?1:7;
   const name=merge(sheet,row,start,start+1,label);
   name.font={name:'Arial',size:10,bold:true};
   const value=merge(sheet,row,start+2,start+5,header[key]||null);
   value.font={name:'Arial',size:10};
   const height=fitCell(value,47)*13;
   if(key==='loading_date'&&/^\d{4}-\d{2}-\d{2}$/.test(value.value)&&Number.isFinite(Date.parse(value.value))){
    value.value=new Date(value.value+'T00:00:00Z');value.numFmt='[$-809]d mmmm yyyy';
   }
   sheet.getRow(row).height=Math.max(sheet.getRow(row).height||0,20,height);
  }
 }

 const heading=15,ink='FF202020';
 const line={style:'thin',color:{argb:'FFB0B0B0'}},boldLine={style:'thin',color:{argb:ink}};
 const tableRow=(index,values,isHeader=false)=>{
  const row=sheet.getRow(index);
  row.values=values;
  row.height=isHeader?24:22;
  row.eachCell({includeEmpty:true},(cell,col)=>{
   cell.font={name:'Arial',size:10,bold:isHeader,color:{argb:ink}};
   const horizontal=isHeader||col===1?'center':numeric.has(columns[col-1][1])?'right':'left';
   row.height=Math.max(row.height,fitCell(cell,widths[col-1]-2,horizontal)*13);
   cell.border={top:isHeader?boldLine:undefined,bottom:line,left:line,right:line};
   if(isHeader)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFECECEC'}};
   else if(numeric.has(columns[col-1][1]))cell.numFmt=numberFormat(columns[col-1][1]);
   else if(col>1)cell.numFmt='@';
  });
 };
 tableRow(heading,columns.map(([label])=>label),true);
 for(const [index,row] of rows.entries()){
  tableRow(heading+1+index,columns.map(([,key])=>{
   if(!key)return index+1;
   if(row[key]==null||row[key]==='')return null;
   return numeric.has(key)?Number(row[key]):String(row[key]);
  }));
 }
 const closing=heading+1+rows.length;
 tableRow(closing,['TOTAL',...Array(8).fill(null),...['quantity','net_mt','gross_mt'].map(key=>
  total[key]==null||total[key]===''?null:Number(total[key]))]);
 sheet.mergeCells(closing,1,closing,9);
 for(const col of [1,10,11,12]){
  const cell=sheet.getCell(closing,col);
  cell.font={name:'Arial',size:10,bold:true};
  cell.border={top:boldLine,bottom:boldLine,left:line,right:line};
 }
 merge(sheet,closing+2,8,12,'SIGNATURE').font={name:'Arial',size:10,bold:true};
 merge(sheet,closing+3,8,12,'KOLWEZI, le '+longDate(header.signature_date)).font={name:'Arial',size:10};
 sheet.getRow(closing+3).height=18;
 sheet.pageSetup.printArea='A1:L'+(closing+3);
 sheet.pageSetup.printTitlesRow=heading+':'+heading;
 return Buffer.from(await book.xlsx.writeBuffer());
}

function send(reply,document,bytes){
 const number=String(document.document_no).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'-');
 const name='BP_'+number+'_r'+document.revision+'.xlsx';
 const encoded=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return reply.header('Cache-Control','private, no-store')
  .header('Content-Disposition','attachment; filename="'+name.replace(/[^\x20-\x7e]/g,'_')+'"; filename*=UTF-8\'\''+encoded)
  .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(bytes);
}

module.exports={workbook,send};
