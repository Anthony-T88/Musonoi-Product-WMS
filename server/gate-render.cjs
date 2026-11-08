'use strict';
const fs=require('fs'),path=require('path'),Zip=require('jszip'),PL=require('./packing-list.cjs'),Excel=require('exceljs');
const escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const coord=a=>{const m=a.match(/([A-Z]+)(\d+)/);return {row:Number(m[2]),col:[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)};};

// Read the archived workbook itself: historical revisions retain their own layout.
async function preview(buffer,sheetName='Sheet1 (2)'){
 const book=new Excel.Workbook();await book.xlsx.load(buffer);
 const sheet=book.getWorksheet(sheetName);if(!sheet)throw Object.assign(Error('GATE_TEMPLATE_SHEET_MISSING'),{statusCode:404});
 const color=c=>c?.argb?'#'+c.argb.slice(-6):null,mergedBorders=new Map();
 const lastRow=Number(sheet.pageSetup.printArea?.match(/:\$?G\$?(\d+)/)?.[1]||14);
 for(const merge of sheet.model.merges){
  const [first,last]=merge.split(':'),a=coord(first),b=coord(last),edges={};
  for(const side of ['left','right'])for(let r=a.row;r<=b.row;r++){const edge=sheet.getCell(r,side==='left'?a.col:b.col)?.border?.[side];if(edge?.style)edges[side]=edge;}
  for(const side of ['top','bottom'])for(let c=a.col;c<=b.col;c++){const edge=sheet.getCell(side==='top'?a.row:b.row,c)?.border?.[side];if(edge?.style)edges[side]=edge;}
  mergedBorders.set(first,edges);
 }
 const rows=[];
 for(let n=1;n<=lastRow;n++){
  const row=sheet.getRow(n),cells=[];
  for(let i=1;i<=7;i++){
   const c=row.getCell(i),v=c.type===Excel.ValueType.Formula?c.result:c.value,borders={...c.border,...mergedBorders.get(c.address)};
   const plain=v&&typeof v==='object'&&!(v instanceof Date)?v.richText?.map(r=>r.text).join('')??v.text??v.result??'':v;
   let text=plain instanceof Date?plain.toLocaleDateString('en-GB',{day:'2-digit',month:/mmmm/i.test(c.numFmt||'')?'long':'short',year:'numeric',timeZone:'UTC'}):plain??'';
   if(typeof v==='number'){
    const fmt=c.numFmt||'',fraction=fmt.match(/\.([0#]+)/)?.[1]||'';
    text=v.toLocaleString('en-US',{minimumFractionDigits:(fraction.match(/0/g)||[]).length,maximumFractionDigits:fraction.length||(/0/.test(fmt)?0:4)})+(fmt.includes('" kg"')?' kg':'');
   }
   cells.push({address:c.address,text,font:{name:c.font?.name||'Times New Roman',size:c.font?.size||11,bold:c.font?.bold,italic:c.font?.italic,color:color(c.font?.color)},fill:c.fill?.type==='pattern'&&c.fill.pattern==='solid'?color(c.fill.fgColor):null,runs:v?.richText?.map(run=>({text:run.text,font:run.font||{}})),alignment:c.alignment,border:Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:borders[k]?.style,color:color(borders[k]?.color)}]))});
  }
  rows.push({number:n,height:row.height||sheet.properties.defaultRowHeight||15,cells});
 }
 return {columns:Array.from({length:7},(_,i)=>sheet.getColumn(i+1).width||8.43),rows,merges:sheet.model.merges,paper_size:'A4',orientation:sheet.pageSetup.orientation||'portrait',
  images:sheet.getImages().map(x=>{const i=book.getImage(x.imageId),anchor=a=>({row:a.nativeRow,col:a.nativeCol,x:(a.nativeColOff||0)/9525,y:(a.nativeRowOff||0)/9525});return {extension:i.extension,base64:i.buffer.toString('base64'),tl:anchor(x.range.tl),br:x.range.br?anchor(x.range.br):null,ext:x.range.ext?{width:x.range.ext.width,height:x.range.ext.height}:null};})};
}

async function render(snapshot){
 const info=JSON.parse(fs.readFileSync(path.join(__dirname,'../templates/gate-permits/SOURCE.json'),'utf8')).templates.find(t=>t.product_code===snapshot.product_code);
 if(!info?.fields)throw Error('GATE_TEMPLATE_MAPPING_MISSING');
 const original=fs.readFileSync(path.join(__dirname,'../templates/gate-permits',info.file));
 if(PL.digest(original)!==info.template_sha256)throw Object.assign(Error('GATE_TEMPLATE_CHANGED'),{statusCode:409});
 const z=await Zip.loadAsync(original);let sheet=await z.file('xl/worksheets/sheet1.xml').async('string');
 const values={business_date:(Date.parse(snapshot.business_date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000,document_no:snapshot.document_no,truck_no:snapshot.truck_no,driver_name:snapshot.driver_name,packing_list_no:snapshot.packing_list_no,quantity:snapshot.quantity,sheets:snapshot.sheets,net_kg:snapshot.net_kg+' KG',remark:snapshot.remark||'',total_quantity:snapshot.quantity,total_sheets:snapshot.sheets,total_net_kg:snapshot.net_kg+' KG',applicant:snapshot.applicant};
 for(const [field,address]of Object.entries(info.fields))if(address)sheet=PL.cell(sheet,address,values[field]);
 z.file('xl/worksheets/sheet1.xml',sheet);
 const buffer=await z.generateAsync({type:'nodebuffer'}),layout=await preview(buffer);
 return {buffer,layout,template_sha256:info.template_sha256,file_sha256:PL.digest(buffer)};
}

function html(layout,title,paper=layout.paper_size||'A4',orientation=layout.orientation||'portrait'){
 const sizes={A4:[210,297],A5:[148,210],Letter:[215.9,279.4]};
 if(!sizes[paper])paper='A4';if(!['portrait','landscape'].includes(orientation))orientation='portrait';
 const size=sizes[paper],widths=layout.columns.map(w=>w*7.1),width=widths.reduce((a,b)=>a+b,0),rows=layout.rows,height=rows.reduce((n,r)=>n+r.height*4/3,0);
 const pageWidth=orientation==='landscape'?size[1]:size[0],pageHeight=orientation==='landscape'?size[0]:size[1];
 const scale=Math.min(1,((pageWidth-24)*96/25.4-4)/width,((pageHeight-24)*96/25.4-4)/height),merges=new Map(),skip=new Set();
 for(const m of layout.merges){const [aa,bb]=m.split(':'),a=coord(aa),b=coord(bb);merges.set(aa,{rows:b.row-a.row+1,cols:b.col-a.col+1});for(let r=a.row;r<=b.row;r++)for(let c=a.col;c<=b.col;c++)if(r!==a.row||c!==a.col)skip.add(r+':'+c);}
 const border=b=>!b?.style?'none':(['medium','thick','double'].includes(b.style)?'2px':'1px')+' '+(b.style==='double'?'double':b.style==='dashed'?'dashed':'solid')+' '+(b.color||'#000000');
 const table='<table><colgroup>'+widths.map(w=>'<col style="width:'+w+'px">').join('')+'</colgroup><tbody>'+rows.map(r=>'<tr style="height:'+r.height+'pt">'+r.cells.map((c,i)=>{
  if(skip.has(r.number+':'+(i+1)))return '';
  const m=merges.get(c.address),f=c.font,a=c.alignment||{},style=`font-family:${escape(f.name)},Microsoft YaHei,Arial,sans-serif;font-size:${f.size}pt;font-weight:${f.bold?'bold':'normal'};font-style:${f.italic?'italic':'normal'};text-align:${a.horizontal||'left'};vertical-align:${a.vertical==='middle'||a.vertical==='center'?'middle':a.vertical||'bottom'};white-space:pre-wrap;overflow-wrap:anywhere;background:${c.fill||'#fff'};color:${f.color||'#000000'};border-top:${border(c.border.top)};border-bottom:${border(c.border.bottom)};border-left:${border(c.border.left)};border-right:${border(c.border.right)};`;
  return '<td data-cell="'+c.address+'" '+(m?'rowspan="'+m.rows+'" colspan="'+m.cols+'"':'')+' style="'+style+'">'+(c.runs?c.runs.map(run=>{const rf=run.font,fc=rf.color?.argb?'#'+rf.color.argb.slice(-6):(f.color||'#000000');return '<span style="font-family:'+escape(rf.name||f.name)+',Microsoft YaHei,serif;font-size:'+(rf.size||f.size)+'pt;font-weight:'+(rf.bold?'bold':'normal')+';text-decoration:'+(rf.underline?'underline':'none')+';color:'+fc+'">'+escape(run.text)+'</span>';}).join(''):escape(c.text))+'</td>';
 }).join('')+'</tr>').join('')+'</tbody></table>';
 const position=(v,arr)=>arr.slice(0,Math.floor(v)).reduce((a,b)=>a+b,0)+(arr[Math.floor(v)]||0)*(v%1),rh=rows.map(r=>r.height*4/3);
 const images=(layout.images||[]).map(i=>{const x=position(i.tl.col,widths)+(i.tl.x||0),y=position(i.tl.row,rh)+(i.tl.y||0),w=i.br?position(i.br.col,widths)+(i.br.x||0)-x:i.ext?.width||80,h=i.br?position(i.br.row,rh)+(i.br.y||0)-y:i.ext?.height||70;return '<img alt="Company logo" src="data:image/'+escape(i.extension)+';base64,'+i.base64+'" style="position:absolute;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;object-fit:contain">';}).join('');
 return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+escape(title)+'</title><style>@page{size:'+paper+' '+orientation+';margin:12mm}*{box-sizing:border-box}body{margin:0;background:#edf2ef}.print-tools{font:14px Arial,"Microsoft YaHei",sans-serif;padding:14px 20px;background:#f8faf9;border-bottom:1px solid #d6e2da;display:flex;align-items:center;gap:16px}.print-tools button{background:#276c60;color:white;padding:10px 22px;border:0;border-radius:5px;cursor:pointer;white-space:nowrap}.print-tools span{line-height:1.6;color:#425a4e}.sheet{position:relative;background:white;width:'+width+'px;min-height:'+height+'px;zoom:'+scale+';margin:24px auto}table{border-collapse:collapse;table-layout:fixed;width:'+width+'px}td{padding:2px;line-height:normal} @media print{body{background:white}.print-tools{display:none}.sheet{margin:0;break-inside:avoid}td{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="print-tools"><button id="gate-print">打印 / Print</button><span>请在系统窗口选择已配置的打印机。关闭窗口不代表打印成功。<br>Select the configured printer in the system dialog.</span></div><main class="sheet" data-fit-width="'+((pageWidth-24)*96/25.4-8)+'" data-fit-height="'+((pageHeight-24)*96/25.4-8)+'" data-minimum-height="'+height+'">'+table+images+'</main><script src="/gate-print.js"></script></body></html>';
}
module.exports={render,html,escape,preview};
