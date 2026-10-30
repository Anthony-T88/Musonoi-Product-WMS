const assert=require('node:assert/strict');
const fs=require('node:fs');
const I=require('./dist/core.js');
assert.equal(I.data.length,128);assert.equal(new Set(I.data.map(r=>r.id)).size,128);
assert.equal(I.query(I.data,{search:'MSN-CU-260001'}).length,1);
const f={location:'A-01-01',status:'在库',sample:'已取样',start:'2026-10-01',end:'2026-10-28'};
const found=I.query(I.data,f);assert.ok(found.length);assert.ok(found.every(r=>r.location===f.location&&r.status===f.status&&r.sample===f.sample));
assert.equal(I.query(I.data,{start:'2026-10-28',end:'2026-10-01'}).length,0);
const day=I.data[0].date;assert.ok(I.query(I.data,{start:day,end:day}).every(r=>r.date===day));
assert.equal(I.query(I.data,{search:'不存在'}).length,0);
for(const dir of ['asc','desc']){const rows=I.query(I.data,{},'weight',dir);assert.ok(rows.every((r,i)=>!i||(dir==='asc'?rows[i-1].weight<=r.weight:rows[i-1].weight>=r.weight)));}
const all=I.totals(I.data),stock=I.data.filter(r=>r.status!=='已出库');assert.equal(all.weight,Math.round(stock.reduce((s,r)=>s+r.weight,0)*1000)/1000);assert.equal(all.available+all.reserved+all.outbound,128);assert.equal(all.pending,stock.filter(r=>r.sample!=='已取样').length);
assert.equal(I.csv(found).split('\r\n').length,found.length+1);assert.ok(I.csv(found).startsWith('\ufeff'));assert.ok(I.csv([{...I.data[0],customer:'=SUM(1,2)'}]).includes("'=SUM"));
fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/inventory.xlsx',I.xlsx(found));fs.writeFileSync('test-output/inventory.csv',I.csv(found));fs.writeFileSync('test-output/expected.json',JSON.stringify({rows:found.length,weights:found.map(r=>r.weight)}));
console.log('PASS: 128 demo records, unique IDs, combined filters, date boundaries, empty state, numeric sorting, inventory totals, CSV escaping, and XLSX fixture.');
