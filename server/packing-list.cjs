'use strict';
// Patch the converted original package instead of rebuilding its styles/drawings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Zip=require('jszip'),Excel=require('exceljs');
const template=path.join(__dirname,'../templates/packing-list/template.xlsx');
const xml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const kg=v=>Number(require('../dist/tonnes.js').scaled(v,6))/1000;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function cell(source,address,value,formula){
 const old=source.match(new RegExp('<c\\b[^>]*\\br="'+address+'"[^>]*?(?:/>|>[\\s\\S]*?</c>)'))?.[0];
 if(!old)throw Error('Template cell missing: '+address);
 const style=old.match(/\bs="(\d+)"/)?.[1],attrs=' r="'+address+'"'+(style?' s="'+style+'"':'');
 const body=formula?'<f>'+xml(formula)+'</f><v>'+xml(value)+'</v>':typeof value==='number'?'<v>'+value+'</v>':'<is><t xml:space="preserve">'+xml(value)+'</t></is>';
 return source.replace(old,'<c'+attrs+(formula||typeof value==='number'?'':' t="inlineStr"')+'>'+body+'</c>');
}
function shiftRefs(text,delta){return text.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g,(s,col,row)=>Number(row)>=46?col+(Number(row)+delta):s);}
async function render(snapshot,templateBuffer){
 const source=templateBuffer||fs.readFileSync(template),zip=await Zip.loadAsync(source),book=new Excel.Workbook();await book.xlsx.load(source);
 const sheet=book.getWorksheet('PL');let body=await zip.file('xl/worksheets/sheet2.xml').async('string');
 // Resolve original cross-sheet corporate text before emitting the PL alone.
 sheet.eachRow(row=>row.eachCell(c=>{if(c.type===Excel.ValueType.Formula&&String(c.value.formula||'').includes('INV!')){
  const value=c.value.result;body=cell(body,c.address,value instanceof Date?(value.getTime()-Date.UTC(1899,11,30))/86400000:value??'');
 }}));
 const f=snapshot.transport,header={E3:snapshot.document_no,E4:f.shipment_batch_no||snapshot.lots.join(' / '),E5:snapshot.contracts.join(' / '),E6:f.eb_license||'',E7:(Date.parse((snapshot.document_date||snapshot.outbound_date||snapshot.outbound_at.slice(0,10))+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000,E14:f.forwarder||'',E15:f.destination||'',A22:snapshot.customer_name,A24:f.buyer_information||'',E22:f.vehicle_no||snapshot.vehicle_no,E23:f.trailer_one||'',E24:f.trailer_two||'',E25:f.driver_name||'',E26:f.passport_no||'',E27:[f.container_no,f.container_seal_no&&'Seal: '+f.container_seal_no].filter(Boolean).join(' / ')};
 for(const [address,value] of Object.entries(header))body=cell(body,address,value);
 const rows=[...body.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)],count=snapshot.items.length,delta=count-16;
 const rowById=new Map(rows.map(m=>[Number(m[1]),m[0]]));const details=[];
 for(let i=0;i<count;i++){
  const target=30+i,original=i<16?30+i:45;
  let row=rowById.get(original).replace(/\br="([A-Z]*)(\d+)"/g,(_,col)=>'r="'+col+target+'"');
  const item=snapshot.items[i],values=item?[i+1,sheet.getCell('B30').text||'Copper Cathode',item.bundle_no,item.sheets_per_bundle??'',item.seal_no??'',kg(item.net_weight),kg(item.gross_weight)]:['','','','','','',''];
  for(let j=0;j<7;j++)row=cell(row,String.fromCharCode(65+j)+target,values[j]);details.push(row);
 }
 body=body.replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData>'+rows.filter(m=>Number(m[1])<30).map(m=>m[0]).join('')+details.join('')+rows.filter(m=>Number(m[1])>=46).map(m=>shiftRefs(m[0],delta).replace(/(<row\b[^>]*\br=")(\d+)/,(_,p,n)=>p+(Number(n)+delta))).join('')+'</sheetData>');
 const total=46+delta,end=29+count;
 body=cell(body,'C'+total,snapshot.bundle_count);
 body=snapshot.items.some(i=>i.sheets_per_bundle==null)?cell(body,'D'+total,''):cell(body,'D'+total,snapshot.items.reduce((n,i)=>n+i.sheets_per_bundle,0),'SUM(D30:D'+end+')');
 body=cell(body,'F'+total,kg(snapshot.total_net_weight),'SUM(F30:F'+end+')');
 body=cell(body,'G'+total,kg(snapshot.total_gross_weight),'SUM(G30:G'+end+')');
 body=body.replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/,m=>shiftRefs(m,delta)).replace(/<dimension ref="[^"]*"\/>/,'<dimension ref="A1:J'+(55+delta)+'"/>').replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/,m=>m.replace(/\bid="(\d+)"/g,(_,n)=>'id="'+(Number(n)>=46?Number(n)+delta:n)+'"'));
 // Preserve exact kilogram values; round only their Excel display to whole kilograms.
 let styles=await zip.file('xl/styles.xml').async('string');styles=styles.replace(/<fill>[\s\S]*?<\/fill>/g,fill=>/<fgColor[^>]*(?:rgb="(?:FF)?FF0000"|indexed="10")/.test(fill)?'<fill><patternFill patternType="none"/></fill>':fill);const numIds=[...styles.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])),numId=Math.max(163,...numIds)+1;
 const fmt='<numFmt numFmtId="'+numId+'" formatCode="#,##0"/>';
 if(/<numFmts\b/.test(styles))styles=styles.replace(/<numFmts count="(\d+)">/,(_,n)=>'<numFmts count="'+(Number(n)+1)+'">'+fmt);else styles=styles.replace('<fonts','<numFmts count="1">'+fmt+'</numFmts><fonts');
 const xfs=styles.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g),newStyles=new Map();
 body=body.replace(/<c\b[^>]*\br="([FG])(\d+)"[^>]*>/g,(s,col,r)=>{if(Number(r)<30||Number(r)>total)return s;const id=Number(s.match(/\bs="(\d+)"/)?.[1]||0);if(!newStyles.has(id)){let xf=xfs[id].replace(/numFmtId="\d+"/,'numFmtId="'+numId+'"');newStyles.set(id,xfs.length);xfs.push(xf);}return s.replace(/\bs="\d+"/,'s="'+newStyles.get(id)+'"');});
 // Long document/bundle/seal numbers must print in full without changing fonts
 // or column widths. Extend row heights only where their actual text requires it.
 const heights=new Map(),height=n=>heights.get(n)||(n>=30&&n<total?sheet.getRow(Math.min(n,45)).height:sheet.getRow(n-delta*(n>=total)).height)||15;
 const lines=(value,width,size)=>String(value??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/Math.max(1,Math.floor(width/(size*4/3*.55))))),0);
 const headerBlocks={E3:[5,7,3,3],E4:[5,7,4,4],E5:[5,7,5,5],E6:[5,7,6,6],E14:[5,7,14,14],E15:[5,7,15,18],A22:[1,2,22,23],A24:[1,2,24,27],E22:[5,7,22,22],E23:[5,7,23,23],E24:[5,7,24,24],E25:[5,7,25,25],E26:[5,7,26,26],E27:[5,7,27,27]};
 const sourceAddresses={};if(templateBuffer){const staticAddresses=['A1','A13','A14','A16','A17','A18','A19','E8','E9','D3','D4','D5','D6','D7','D8','D9','D13','D14','D15','A21','D21','D22','D23','D24','D25','D26','D27','A29','B29','C29','D29','E29','F29','G29','A46','A48','A49','A51','E51','A54','E54'];for(const original of staticAddresses){const cell=sheet.getCell(original),r=cell.row,shift=r>=46?delta:0,address=cell.col?original.replace(/\d+$/,String(r+shift)):original,merge=sheet.model.merges.find(m=>m.split(':')[0]===original),last=merge?sheet.getCell(merge.split(':')[1]):cell;headerBlocks[address]=[cell.col,last.col,r+shift,last.row+shift];header[address]=cell.text;sourceAddresses[address]=original;}}
 for(const [address,[first,last,top,bottom]] of Object.entries(headerBlocks)){if(address==='D8')continue;
  const width=Array.from({length:last-first+1},(_,i)=>(sheet.getColumn(first+i).width||8.43)*7+5).reduce((a,b)=>a+b,0)-8,size=sheet.getCell(sourceAddresses[address]||address).font.size||11,need=lines(header[address],width,size)*size*1.35+3,current=Array.from({length:bottom-top+1},(_,i)=>height(top+i)).reduce((a,b)=>a+b,0);
  if(need>current)heights.set(bottom,height(bottom)+need-current);
 }
 for(let i=0;i<snapshot.items.length;i++){const n=30+i,item=snapshot.items[i],size=sheet.getCell('C30').font.size||11;for(const [col,text] of [['C',item.bundle_no],['E',item.seal_no],...(templateBuffer?[['B',sheet.getCell('B30').text]]:[])]){const width=(sheet.getColumn(col).width||8.43)*7-4,need=lines(text,width,size)*size*1.35+3;if(need>height(n))heights.set(n,need);}}
 const wrapStyles=new Map();body=body.replace(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>/g,(s,col,row)=>{if(!headerBlocks[col+row]&&!(Number(row)>=30&&Number(row)<total&&(templateBuffer?['B','C','E']:['C','E']).includes(col)))return s;const id=Number(s.match(/\bs="(\d+)"/)?.[1]||0);if(!wrapStyles.has(id)){let xf=xfs[id];if(/<alignment\b/.test(xf))xf=xf.replace(/<alignment\b[^>]*\/>/,a=>a.replace(/\s+wrapText="\d+"/,'').replace('/>',' wrapText="1"/>'));else xf=xf.endsWith('/>')?xf.slice(0,-2)+'><alignment wrapText="1"/></xf>':xf.replace('</xf>','<alignment wrapText="1"/></xf>');wrapStyles.set(id,xfs.length);xfs.push(xf);}return s.replace(/\bs="\d+"/,'s="'+wrapStyles.get(id)+'"');});
 for(const [n,h] of heights)body=body.replace(new RegExp('<row\\b[^>]*\\br="'+n+'"[^>]*>'),s=>/\bht="/.test(s)?s.replace(/\bht="[^"]*"/,'ht="'+h.toFixed(2)+'"'):s.replace('>',' ht="'+h.toFixed(2)+'" customHeight="1">'));
 // Country label stays on one line without widening the template columns.
 body=cell(body,'D8',sheet.getCell('D8').text.replace(/\r?\n/g,' ').replace(/\bContry\b/i,'Country'));
 body=body.replace(/<c\b[^>]*\br="D8"[^>]*>/,tag=>{const id=Number(tag.match(/\bs="(\d+)"/)?.[1]||0);let xf=xfs[id];if(/<alignment\b/.test(xf))xf=xf.replace(/<alignment\b[^>]*\/>/,a=>a.replace(/\s+(wrapText|shrinkToFit)="[^"]*"/g,'').replace('/>',' wrapText="0" shrinkToFit="1"/>'));else xf=xf.endsWith('/>')?xf.slice(0,-2)+'><alignment wrapText="0" shrinkToFit="1"/></xf>':xf.replace('</xf>','<alignment wrapText="0" shrinkToFit="1"/></xf>');const next=xfs.length;xfs.push(xf);return tag.replace(/\bs="\d+"/,'s="'+next+'"');});
 styles=styles.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/,'<cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs>');zip.file('xl/styles.xml',styles);
 // Discard INV and Destination pages, not the source template. No sample invoice is issued.
 let workbook=await zip.file('xl/workbook.xml').async('string');workbook=workbook.replace(/<sheets>[\s\S]*?<\/sheets>/,'<sheets><sheet name="PL" sheetId="11" r:id="rId2"/></sheets>').replace(/activeTab="\d+"/,'activeTab="0"').replace(/<definedNames>[\s\S]*?<\/definedNames>/,'<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">PL!$A$1:$G$'+(55+delta)+'</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">PL!$29:$29</definedName></definedNames>');zip.file('xl/workbook.xml',workbook);
 let rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');rels=rels.replace(/<Relationship\b[^>]*\bTarget="(?:worksheets\/sheet[13]\.xml|calcChain\.xml)"[^>]*\/>/g,'');zip.file('xl/_rels/workbook.xml.rels',rels);
 let types=await zip.file('[Content_Types].xml').async('string');types=types.replace(/<Override\b[^>]*PartName="\/xl\/(?:worksheets\/sheet[13]\.xml|calcChain\.xml)"[^>]*\/>/g,'');zip.file('[Content_Types].xml',types);
 for(const name of ['xl/worksheets/sheet1.xml','xl/worksheets/sheet3.xml','xl/worksheets/_rels/sheet1.xml.rels','xl/worksheets/_rels/sheet3.xml.rels','xl/calcChain.xml'])zip.remove(name);
 // Keep only strings actually referenced by this PL.
 const shared=await zip.file('xl/sharedStrings.xml').async('string'),strings=shared.match(/<si\b[^>]*>[\s\S]*?<\/si>/g)||[],used=new Map();let references=0;
 body=body.replace(/<c\b[^>]*t="s"[^>]*>[\s\S]*?<\/c>/g,s=>s.replace(/<v>(\d+)<\/v>/,(_,n)=>{references++;if(!used.has(Number(n)))used.set(Number(n),used.size);return '<v>'+used.get(Number(n))+'</v>';}));
 zip.file('xl/sharedStrings.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="'+references+'" uniqueCount="'+used.size+'">'+[...used.keys()].map(i=>strings[i]).join('')+'</sst>');
 zip.file('xl/worksheets/sheet2.xml',body);let buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});if(snapshot.include_invoice)buffer=await require('./commercial-invoice.cjs').attach(buffer,snapshot,source);
 return {buffer,template_sha256:digest(source),file_sha256:digest(buffer)};
}
async function preview(buffer,sheetName='PL'){
 const book=new Excel.Workbook();await book.xlsx.load(buffer);const sheet=book.getWorksheet(sheetName);if(!sheet)throw Object.assign(Error('该历史版本未包含发票页，请重新生成加入发票'),{statusCode:404});const color=c=>c?.argb?'#'+c.argb.slice(-6):null;
 const mergedBorders=new Map(),coord=a=>{const m=a.match(/([A-Z]+)(\d+)/);return {row:Number(m[2]),col:[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)};};
 for(const merge of sheet.model.merges){const [first,last]=merge.split(':'),a=coord(first),b=coord(last),edges={};
  for(const side of ['left','right'])for(let r=a.row;r<=b.row;r++){const edge=sheet.getCell(r,side==='left'?a.col:b.col).border[side];if(edge?.style)edges[side]=edge;}
  for(const side of ['top','bottom'])for(let c=a.col;c<=b.col;c++){const edge=sheet.getCell(side==='top'?a.row:b.row,c).border[side];if(edge?.style)edges[side]=edge;}
  mergedBorders.set(first,edges);
 }
 const rows=[];sheet.eachRow({includeEmpty:true},row=>{const cells=[];for(let i=1;i<=7;i++){const c=row.getCell(i),v=c.type===Excel.ValueType.Formula?c.result:c.value,borders={...c.border,...mergedBorders.get(c.address)};
  const plain=v&&typeof v==='object'&&!(v instanceof Date)?v.richText?.map(r=>r.text).join('')??v.text??v.result??'':v;
  let text=plain instanceof Date?v.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):plain??'';
  if(typeof v==='number'){const wholeKg=row.number>=30&&i>=6&&c.numFmt==='#,##0';text=v.toLocaleString('en-US',{minimumFractionDigits:wholeKg?0:row.number>=30&&i>=6?1:0,maximumFractionDigits:wholeKg?0:4});}
  cells.push({address:c.address,text,font:{name:c.font.name||'Times New Roman',size:c.font.size||11,bold:c.font.bold,italic:c.font.italic,color:color(c.font.color)},fill:c.fill.type==='pattern'&&c.fill.pattern==='solid'?color(c.fill.fgColor):null,alignment:c.alignment,border:Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:borders[k]?.style,color:color(borders[k]?.color)}]))});
 }rows.push({number:row.number,height:row.height||sheet.properties.defaultRowHeight||15,cells});});
 const setup=sheet.pageSetup||{},paper={1:'Letter',8:'A3',9:'A4',11:'A5'}[setup.paperSize]||'A4';
 const print={paper,orientation:setup.orientation==='landscape'?'landscape':'portrait',margins:setup.margins||null,
  fitHeight:setup.fitToPage&&setup.fitToHeight===1};
 return {columns:Array.from({length:7},(_,i)=>sheet.getColumn(i+1).width||8.43),rows,merges:sheet.model.merges,print,
 images:sheet.getImages().map(x=>{const i=book.getImage(x.imageId);return {extension:i.extension,base64:i.buffer.toString('base64'),tl:{row:x.range.tl.row,col:x.range.tl.col},br:x.range.br?{row:x.range.br.row,col:x.range.br.col}:null};})};
}
module.exports={render,preview,digest,template,cell};
