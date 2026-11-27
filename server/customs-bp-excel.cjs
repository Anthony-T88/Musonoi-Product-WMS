'use strict';

const fs=require('node:fs'),path=require('node:path'),Excel=require('exceljs');
const {longDate}=require('../dist/business-time.js');
const {columns,companyFields,declarationFields,sheetTitle}=require('./customs-bp-print.cjs');

const mm=value=>value*72/25.4;
const pixels=value=>Math.floor(value*96/25.4);
const paperWidth=284.5,paperHeight=mm(194)-3;
const logoPath=path.join(__dirname,'../dist/customs-bp-logo.png');
const numeric=new Set(['quantity','net_mt','gross_mt']);
const ink='FF242424',line={style:'thin',color:{argb:ink}};
const border={top:line,bottom:line,left:line,right:line};
const headingRow=15;

function layout(enlarged){
 const labelWidth=enlarged?34:30;
 const half=(paperWidth-6)/2,second=half+6;
 const issuerWidth=paperWidth-51;
 const vehicleEdges=[0];
 for(const [,,share] of columns)vehicleEdges.push(vehicleEdges.at(-1)+paperWidth*share/100);
 const edges=[...new Set([...vehicleEdges,4,paperWidth-4,half,second,labelWidth+1,second+labelWidth+1,
  issuerWidth,paperWidth-46].map(pixels))].sort((a,b)=>a-b);
 const region=(start,end)=>({
  first:edges.indexOf(pixels(start))+1,
  last:edges.indexOf(pixels(end)),
  width:(pixels(end)-pixels(start))*0.75
 });
 return {
  edges,body:columns.map((_,index)=>region(vehicleEdges[index],vehicleEdges[index+1])),
  full:region(0,paperWidth),issuer:region(0,issuerWidth),
  declarations:[[region(0,labelWidth+1),region(labelWidth+1,half)],
   [region(second,second+labelWidth+1),region(second+labelWidth+1,paperWidth)]],
  sign:[region(4,half),region(second,paperWidth-4)],
  imageLeft:region(paperWidth-46,paperWidth).first-1
 };
}

// Approximate Times New Roman in points. Leave room for fallback fonts and indentation.
function characterWidth(glyph){
 if(/\p{Mark}/u.test(glyph))return 0;
 if(/[^ \x21-\x7e]/.test(glyph))return 1;
 if(/[ilIjtfr1.,:;' !|]/.test(glyph))return 0.32;
 if(/[MWmw@%]/.test(glyph))return 0.86;
 if(/[A-Z]/.test(glyph))return 0.69;
 return 0.52;
}
const emWidth=value=>[...value].reduce((sum,glyph)=>sum+characterWidth(glyph),0);
function wrappedLines(value,maxEm){
 let lines=0;
 for(const paragraph of value.split(/\r?\n/)){
  let remaining=maxEm;
  lines++;
  for(const word of paragraph.match(/\S+\s*/g)||[]){
   const width=emWidth(word.trimEnd());
   if(width>remaining&&remaining<maxEm){lines++;remaining=maxEm;}
   if(width>remaining){
    const extra=Math.ceil(width/maxEm)-1;
    lines+=extra;remaining=maxEm-width%maxEm;
   }else remaining-=width;
   remaining-=emWidth(word.slice(word.trimEnd().length));
  }
 }
 return lines;
}

function put(sheet,row,area,value,{size,bold=false,horizontal='left',padding=2,display=value}){
 if(area.first!==area.last)sheet.mergeCells(row,area.first,row,area.last);
 const cell=sheet.getCell(row,area.first),text=String(display??''),width=Math.max(1,area.width-padding);
 const em=text?emWidth(text):0,oneLine=!/[\r\n]/.test(text)&&em*7<=width;
 const fitted=oneLine?Math.min(size,Math.floor(width/Math.max(1,em)*10)/10):7;
 cell.value=value;
 cell.font={name:'Times New Roman',size:fitted,bold,color:{argb:ink}};
 cell.alignment={horizontal,vertical:'middle',shrinkToFit:oneLine,wrapText:!oneLine};
 const height=(oneLine?1:wrappedLines(text,width/fitted))*fitted*1.24;
 return {cell,height};
}

function addLogo(book,sheet,grid,issuerHeight){
 const bytes=fs.readFileSync(logoPath),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 const scale=Math.min(pixels(46)/width,pixels(34)/height);
 const size={width:width*scale,height:height*scale};
 const emu=9525;
 const id=book.addImage({buffer:bytes,extension:'png'});
 sheet.addImage(id,{tl:{nativeCol:grid.imageLeft,nativeColOff:Math.round((pixels(46)-size.width)*emu),
  nativeRow:1,nativeRowOff:Math.round((issuerHeight/0.75-size.height)/2*emu)},ext:size,editAs:'oneCell'});
}

function draw(snapshot,enlarged){
 const {header,rows,total}=snapshot,book=new Excel.Workbook(),grid=layout(enlarged);
 const bodySize=enlarged?11.5:10,tableSize=enlarged?10.25:9,short=rows.length<=10;
 const sheet=book.addWorksheet('Bulletin de pesage',{
  views:[{showGridLines:false}],
  pageSetup:{paperSize:9,orientation:'landscape',horizontalCentered:true,fitToWidth:1,
   margins:{left:6/25.4,right:6/25.4,top:8/25.4,bottom:8/25.4,header:0,footer:0}}
 });
 grid.edges.slice(1).forEach((edge,index)=>{sheet.getColumn(index+1).width=(edge-grid.edges[index])/7;});
 const title=put(sheet,1,grid.full,sheetTitle(snapshot),{size:enlarged?17:15,bold:true,horizontal:'center'});
 sheet.getRow(1).height=title.height+mm(2);
 const issuerCells=companyFields.map(([label,key],index)=>{
  const text=header[key]?(label?label+': ':'')+header[key]:null;
  const height=put(sheet,index+2,grid.issuer,text,{size:index===0?(enlarged?13:12):bodySize,bold:index===0}).height;
  sheet.getRow(index+2).height=height;
  return height;
 });
 const issuerContent=issuerCells.reduce((sum,height)=>sum+height,0);
 const issuerHeight=Math.max(mm(34),issuerContent),issuerGap=(issuerHeight-issuerContent)/2;
 if(issuerGap>0){
  sheet.getRow(2).height+=issuerGap;
  sheet.getCell('A2').alignment={...sheet.getCell('A2').alignment,vertical:'bottom'};
  const last=companyFields.length+1;
  sheet.getRow(last).height+=issuerGap;
  sheet.getCell(last,1).alignment={...sheet.getCell(last,1).alignment,vertical:'top'};
 }
 addLogo(book,sheet,grid,issuerHeight);
 sheet.getRow(8).height=mm(2);
 for(const [group,fields] of declarationFields.entries()){
  for(const [index,[label,key]] of fields.entries()){
   const row=9+index,[labelArea,valueArea]=grid.declarations[group],raw=header[key]||null;
   const date=key==='loading_date'&&/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(raw+'T00:00:00Z'):null;
   const typedDate=date&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===raw?date:null;
   const keyCell=put(sheet,row,labelArea,label+':',{size:bodySize,bold:true});
   const valueCell=put(sheet,row,valueArea,typedDate||raw,{size:bodySize,display:typedDate?longDate(raw):raw});
   if(typedDate)valueCell.cell.numFmt='[$-809]d mmmm yyyy';
   sheet.getRow(row).height=Math.max(sheet.getRow(row).height||0,keyCell.height+mm(.6),valueCell.height+mm(.6));
  }
 }
 sheet.getRow(14).height=mm(3);
 const drawLine=(row,values,role)=>{
  const headerRow=role==='header',totalRow=role==='total';
  const areas=totalRow?[{...grid.body[0],last:grid.body[8].last},...grid.body.slice(9)]:grid.body;
  const size=headerRow&&enlarged?9.5:tableSize,bold=headerRow||totalRow;
  const spacing=mm(short&&!bold?1.2:2.1);
  let height=0;
  for(const [index,value] of values.entries()){
   const key=columns[totalRow?index+8:index]?.[1],isNumber=!headerRow&&numeric.has(key);
   const display=isNumber&&value!=null?Intl.NumberFormat('en-GB',{
    minimumFractionDigits:key==='quantity'?0:3,maximumFractionDigits:key==='quantity'?0:3
   }).format(value):value;
   const area=totalRow&&index===0?{...areas[0],width:grid.body.slice(0,9).reduce((sum,column)=>sum+column.width,0)}:areas[index];
   const cellData=put(sheet,row,area,value,{size,bold,horizontal:'center',padding:mm(.9)+1.5,display});
   height=Math.max(height,cellData.height);
   cellData.cell.border=border;
   if(isNumber)cellData.cell.numFmt=key==='quantity'?'#,##0':'#,##0.000';
   else if(!headerRow&&!totalRow&&index>0)cellData.cell.numFmt='@';
  }
  sheet.getRow(row).height=height+spacing;
 };
 drawLine(headingRow,columns.map(([label])=>label),'header');
 rows.forEach((vehicle,index)=>drawLine(headingRow+1+index,columns.map(([,key])=>{
  if(!key)return index+1;
  return vehicle[key]==null||vehicle[key]===''?null:numeric.has(key)?Number(vehicle[key]):String(vehicle[key]);
 })));
 const closing=headingRow+1+rows.length;
 drawLine(closing,['TOTAL',...['quantity','net_mt','gross_mt'].map(key=>
  total[key]==null||total[key]===''?null:Number(total[key]))],'total');
 const gap=sheet.getRow(closing+1);gap.height=mm(short?3:5);
 const signatureRow=closing+2,signatureSize=enlarged?11:10;
 const signature=put(sheet,signatureRow,grid.sign[0],'SIGNATURE',{size:signatureSize,bold:true});
 const dated=put(sheet,signatureRow,grid.sign[1],'KOLWEZI, le '+longDate(header.signature_date),
  {size:signatureSize,bold:true,horizontal:'right'});
 sheet.getRow(signatureRow).height=Math.max(signature.height,dated.height);
 const end=sheet.getCell(signatureRow,grid.full.last).address;
 sheet.pageSetup.printArea='A1:'+end;
 sheet.pageSetup.printTitlesRow=headingRow+':'+headingRow;
 return {sheet,book,signatureRow};
}

function pageBreaks(sheet,last,rows){
 const drawingEnd=headingRow+rows;
 const sum=(from,to)=>Array.from({length:to-from+1},(_,offset)=>sheet.getRow(from+offset).height).reduce((a,b)=>a+b,0);
 const usedOnNewPage=sheet.getRow(headingRow).height,threshold=paperHeight/0.98;
 let used=sum(1,headingRow);
 for(let row=headingRow+1;row<=Math.max(headingRow+1,drawingEnd);row++){
  const height=sum(row,row>=drawingEnd?last:row);
  if(used+height>threshold){
   sheet.getRow(row-1).addPageBreak();
   used=usedOnNewPage;
  }
  used+=height;
 }
}

async function workbook(snapshot){
 const short=snapshot.rows.length<=10;
 const height=sheet=>sheet.getRows(1,sheet.rowCount).reduce((sum,row)=>sum+row.height,0);
 let document=draw(snapshot,short);
 if(short&&height(document.sheet)>paperHeight)document=draw(snapshot,false);
 const {sheet,book,signatureRow}=document;
 if(short&&height(sheet)*0.84<=paperHeight){
  Object.assign(sheet.pageSetup,{fitToPage:true,fitToHeight:1});
 }else{
  // With automatic width/height fitting Excel ignores manual row breaks.
  // The sheet already uses the A4 printable width, so preserve the closing block at a fixed scale.
  Object.assign(sheet.pageSetup,{fitToPage:false,fitToHeight:0,scale:98});
  pageBreaks(sheet,signatureRow,snapshot.rows.length);
 }
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
