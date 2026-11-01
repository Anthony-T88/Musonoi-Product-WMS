'use strict';
const fs=require('fs'),assert=require('assert/strict'),Excel=require('exceljs'),Zip=require('jszip'),PL=require('../server/packing-list.cjs'),T=require('../dist/tonnes.js');
const checks=[],ok=(v,n)=>{assert(v,n);checks.push(n);},fixed=n=>(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0');
(async()=>{const source=new Excel.Workbook();await source.xlsx.readFile(PL.template);const original=source.getWorksheet('PL');
for(const n of [1,16,17,32,100,500]){
 const items=Array.from({length:n},(_,i)=>{const g=2035000n+BigInt(i%10)*100n;return {bundle_no:'BUNDLE-'+String(i+1).padStart(3,'0'),sheets_per_bundle:48,seal_no:'000-SEAL-'+i,gross_weight:fixed(g),net_weight:fixed(g-2500n)};});
 const sum=key=>fixed(items.reduce((a,i)=>a+T.scaled(i[key],6),0n)),snapshot={document_no:'OUT-TEMPLATE-PL',outbound_at:'2026-10-31T23:30:00.000Z',outbound_date:'2026-11-01',customer_name:'Actual Customer <&>',vehicle_no:'TRUCK-TEST',transport:{buyer_information:'Actual customer address',driver_name:'Test Driver'},contracts:['CONTRACT-001'],lots:['RMM-CU-2026-11'],items,bundle_count:n,total_gross_weight:sum('gross_weight'),total_net_weight:sum('net_weight')};
 const rendered=await PL.render(snapshot);fs.writeFileSync('test-output/v35/template/packing-'+n+'.xlsx',rendered.buffer);const w=new Excel.Workbook();await w.xlsx.load(rendered.buffer);const s=w.getWorksheet('PL'),total=30+n;
 ok(w.worksheets.length===1,n+' one actual packing list');ok(s.getCell('C30').value===items[0].bundle_no&&s.getCell('C'+(29+n)).value===items[n-1].bundle_no,n+' first and last bundles retained');
 ok(s.getCell('C'+total).value===n,n+' bundle total');ok(s.getCell('F'+total).result===Number(T.scaled(snapshot.total_net_weight,6))/1000,n+' exact net total');ok(s.getCell('G'+total).result===Number(T.scaled(snapshot.total_gross_weight,6))/1000,n+' exact gross total');
 ok(s.getCell('F'+total).formula==='SUM(F30:F'+(29+n)+')',n+' dynamic total formula');ok(s.getCell('F30').value===2032.5,n+' no repeated packaging deduction');ok(s.getCell('E30').value==='000-SEAL-0',n+' seals remain text');
 ok(s.pageSetup.printArea==='A1:G'+(39+n),n+' print area grows with detail');for(const k of ['orientation','paperSize','printTitlesRow','fitToWidth','fitToHeight'])ok(s.pageSetup[k]===original.pageSetup[k],n+' original print '+k);
 ok(JSON.stringify(s.pageSetup.margins)===JSON.stringify(original.pageSetup.margins),n+' original margins');ok(JSON.stringify(s.columns.slice(0,7).map(c=>c.width))===JSON.stringify(original.columns.slice(0,7).map(c=>c.width)),n+' original column widths');
 ok(JSON.stringify(s.getCell('A1').font)===JSON.stringify(original.getCell('A1').font),n+' original title font');ok(JSON.stringify(s.getCell('A30').border)===JSON.stringify(original.getCell('A30').border),n+' original detail borders');ok(s.model.merges.length===original.model.merges.length,n+' original merge structure');
 ok(s.getCell('E7').value.toISOString().startsWith('2026-11-01'),n+' shipment uses business calendar date');ok(s.getCell('A22').value===snapshot.customer_name,n+' literal XML-escaped customer');
 const layout=await PL.preview(rendered.buffer);ok(layout.rows.every(r=>r.cells.every(c=>typeof c.text!=='object'))&&layout.rows.some(r=>r.cells.some(c=>String(c.text).includes('Country of Origin'))),n+' preview resolves original rich text');
 ok(layout.rows[8].cells[4].border.bottom.style==='medium'&&layout.rows[8].cells[4].border.right.style==='medium',n+' preview reconstructs merged outer borders');
 const logo=s.getImages()[0],oldLogo=original.getImages()[0];ok(w.getImage(logo.imageId).buffer.equals(source.getImage(oldLogo.imageId).buffer),n+' original logo bytes');
 const zip=await Zip.loadAsync(rendered.buffer),xml=await zip.file('xl/worksheets/sheet2.xml').async('string');ok(!/INV!|#REF!/.test(xml),n+' no broken invoice references');ok(!zip.file('xl/worksheets/sheet1.xml'),n+' no sample invoice issued');
 if(n===500)ok(s.getCell('A'+(54+n-16)).value==='Logistics Export Supervisor','500 rows preserve signature footer');
}
fs.writeFileSync('test-output/v35/template/template.json',JSON.stringify({status:'PASS',checks:checks.length,details:checks},null,2));console.log(JSON.stringify({status:'PASS',checks:checks.length}));})().catch(e=>{console.error(e.stack);process.exitCode=1;});
