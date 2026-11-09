'use strict';
// Use the supplied invoice layout and freeze the pricing in each revision.
const Zip=require('jszip'),E=require('exceljs'),T=require('../dist/tonnes.js');
const freightPrice='50.00';
function unitPrice(value){
 if(value===undefined)return null;
 if(typeof value!=='string'||!/^\d{1,9}(?:\.\d{1,2})?$/.test(value)||T.scaled(value,2)<=0n)throw require('./control-common.cjs').error(400,'商业发票单价须大于零，最多两位小数');
 return T.fixed(T.scaled(value,2),2);
}
function amountCents(weight,price){return (T.scaled(weight,6)*T.scaled(price,2)+500000n)/1000000n;}

async function attach(packingBuffer,snapshot,templateBuffer){const PL=require('./packing-list.cjs'),source=await Zip.loadAsync(templateBuffer),zip=await Zip.loadAsync(packingBuffer),wb=new E.Workbook();await wb.xlsx.load(templateBuffer);const invoice=wb.getWorksheet('INV'),packing=wb.getWorksheet('PL');if(!invoice)throw Error('发票模板缺少INV页');let body=await source.file('xl/worksheets/sheet1.xml').async('string');const shared=await source.file('xl/sharedStrings.xml').async('string'),strings=shared.match(/<si\b[^>]*>[\s\S]*?<\/si>/g)||[];
body=body.replace(/<c\b[^>]*\bt="s"[^>]*>[\s\S]*?<\/c>/g,c=>{const i=Number(c.match(/<v>(\d+)<\/v>/)?.[1]);if(!strings[i])throw Error('发票模板字符串无效');return c.replace(/\bt="s"/,'t="inlineStr"').replace(/<v>\d+<\/v>/,'<is>'+strings[i].replace(/^<si\b[^>]*>|<\/si>$/g,'')+'</is>');});
const f=snapshot.transport,total=30+snapshot.items.length,date=snapshot.document_date||snapshot.outbound_date,serial=(Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000,net=Number(snapshot.total_net_weight),gross=Number(snapshot.total_gross_weight),fields={E3:snapshot.loading_plan?.invoice_no||'',E4:f.shipment_batch_no||snapshot.lots.join(' / '),E5:snapshot.contracts.join(' / '),E6:f.eb_license||'',E7:serial,E14:f.forwarder||'',E15:f.destination||'',A22:snapshot.customer_name,A24:f.buyer_information||'',E22:f.vehicle_no||snapshot.vehicle_no,E23:f.trailer_one||'',E24:f.trailer_two||'',E25:f.driver_name||'',E26:f.passport_no||'',E27:f.container_no||''};
for(const key of ['A13','A14','A16','A17','A18','A19','E8','E9'])fields[key]=packing.getCell(key).text;
for(const [key,value] of Object.entries(fields))body=PL.cell(body,key,value);
const price=snapshot.commercial_invoice?.unit_price_usd,freight=snapshot.commercial_invoice?.freight_price_usd||freightPrice,
 goods=price?amountCents(snapshot.total_net_weight,price):0n,transport=amountCents(snapshot.total_gross_weight,freight);
 body=PL.cell(body,'F30',price?Number(price):'');
 body=PL.cell(body,'F31',Number(freight));
 body=PL.cell(body,'G30',price?Number(goods)/100:'',price?'ROUND(D30*F30,2)':undefined);
 body=PL.cell(body,'G31',Number(transport)/100,'ROUND(E31*F31,2)');
 body=PL.cell(body,'G33',Number(goods+transport)/100,'SUM(G30:G32)');
body=PL.cell(body,'D30',net,'PL!F'+total+'/1000');body=PL.cell(body,'E30',gross,'PL!G'+total+'/1000');body=PL.cell(body,'D31',net,'D30');body=PL.cell(body,'E31',gross,'E30');body=PL.cell(body,'D33',net,'SUM(D30)');body=PL.cell(body,'E33',gross,'SUM(E30)');
// Preserve template styles and add a four-decimal MT style only for weight cells.
let styles=await zip.file('xl/styles.xml').async('string'),format=Math.max(163,...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])))+1;styles=styles.replace(/<numFmts count="(\d+)">/,(_,n)=>'<numFmts count="'+(Number(n)+1)+'"><numFmt numFmtId="'+format+'" formatCode="#,##0.0000"/>');const xfs=styles.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g),mapped=new Map();body=body.replace(/<c\b[^>]*\br="([DE](?:30|31|33))"[^>]*>/g,tag=>{const id=Number(tag.match(/\bs="(\d+)"/)?.[1]||0);if(!mapped.has(id)){mapped.set(id,xfs.length);xfs.push(xfs[id].replace(/numFmtId="\d+"/,'numFmtId="'+format+'"'));}return tag.replace(/\bs="\d+"/,'s="'+mapped.get(id)+'"');});styles=styles.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/,'<cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs>');zip.file('xl/styles.xml',styles);zip.file('xl/worksheets/sheet1.xml',body);
if(source.file('xl/worksheets/_rels/sheet1.xml.rels'))zip.file('xl/worksheets/_rels/sheet1.xml.rels',await source.file('xl/worksheets/_rels/sheet1.xml.rels').async('string'));
const originalBook=await source.file('xl/workbook.xml').async('string'),invTag=originalBook.match(/<sheet\b[^>]*\bname="INV"[^>]*\/>/)?.[0];if(!invTag)throw Error('发票页关联无效');let book=await zip.file('xl/workbook.xml').async('string');book=book.replace(/(<sheets>)/,'$1'+invTag).replace(/localSheetId="0"/g,'localSheetId="1"').replace('</definedNames>','<definedName name="_xlnm.Print_Area" localSheetId="0">INV!$A$1:$G$52</definedName></definedNames>').replace(/activeTab="\d+"/,'activeTab="0"');zip.file('xl/workbook.xml',book);
const originalRels=await source.file('xl/_rels/workbook.xml.rels').async('string'),id=invTag.match(/r:id="([^"]+)"/)[1],invRel=[...originalRels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m=>m[0]).find(s=>s.includes('Id="'+id+'"'));let rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');zip.file('xl/_rels/workbook.xml.rels',rels.replace('</Relationships>',invRel+'</Relationships>'));
let types=await zip.file('[Content_Types].xml').async('string');types=types.replace('</Types>','<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');zip.file('[Content_Types].xml',types);
return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
module.exports={attach,unitPrice,freightPrice};
