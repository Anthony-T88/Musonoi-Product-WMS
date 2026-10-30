/* Pure demo domain and export functions; no database or remote requests. */
(function(root){
  'use strict';
  const data=typeof module!=='undefined'?require('./demo-data.js').data:(root.DemoInventory?.data||[]);
  function query(rows,f={},key='date',direction='desc'){
    const term=(f.search||'').trim().toLocaleLowerCase();
    if(f.start&&f.end&&f.start>f.end)return [];
    return rows.filter(r=>(!term||[r.id,r.batch,r.customer,r.location].some(v=>v.toLocaleLowerCase().includes(term)))&&['location','batch','customer','status','sample'].every(k=>!f[k]||r[k]===f[k])&&(!f.start||r.date>=f.start)&&(!f.end||r.date<=f.end)).sort((a,b)=>{
      const x=a[key],y=b[key];const cmp=typeof x==='number'?x-y:String(x).localeCompare(String(y),'zh-CN',{numeric:true});return (cmp||a.id.localeCompare(b.id))*(direction==='asc'?1:-1);
    });
  }
  function totals(rows){const stock=rows.filter(r=>r.status!=='已出库');return {count:rows.length,weight:Math.round(stock.reduce((s,r)=>s+r.weight,0)*1000)/1000,available:stock.filter(r=>r.status==='在库').length,pending:stock.filter(r=>r.sample!=='已取样').length,reserved:stock.filter(r=>r.status==='已预留').length,outbound:rows.filter(r=>r.status==='已出库').length};}
  const headers=['数据性质','捆包编号','生产批次','货位','所属客户','净重（吨）','库存状态','取样状态','入库日期'];
  function matrix(rows){return [headers,...rows.map(r=>['演示数据',r.id,r.batch,r.location,r.customer,r.weight,r.status,r.sample,r.date])];}
  function csv(rows){return '\ufeff'+matrix(rows).map(row=>row.map(v=>{let s=String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
  const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
  function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
  // ZIP STORE: standard OOXML package, UTF-8 XML, numeric weights.
  function zip(files){const enc=new TextEncoder(),locals=[],central=[];let offset=0;const header=(size,write)=>{const b=new Uint8Array(size);write(new DataView(b.buffer));return b;};
    for(const [name,content] of Object.entries(files)){const n=enc.encode(name),b=enc.encode(content),sum=crc(b);const h=header(30,v=>{v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x5d5c,true);v.setUint32(14,sum,true);v.setUint32(18,b.length,true);v.setUint32(22,b.length,true);v.setUint16(26,n.length,true);});locals.push(h,n,b);const c=header(46,v=>{v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,0x5d5c,true);v.setUint32(16,sum,true);v.setUint32(20,b.length,true);v.setUint32(24,b.length,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);});central.push(c,n);offset+=h.length+n.length+b.length;}
    const centralSize=central.reduce((s,b)=>s+b.length,0),end=header(22,v=>{v.setUint32(0,0x06054b50,true);v.setUint16(8,Object.keys(files).length,true);v.setUint16(10,Object.keys(files).length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);});
    const result=new Uint8Array(offset+centralSize+22);let pos=0;for(const b of [...locals,...central,end]){result.set(b,pos);pos+=b.length;}return result;
  }
  function xlsx(rows){
    const sheet=matrix(rows).map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>{const ref=String.fromCharCode(65+j)+(i+1);return typeof v==='number'?`<c r="${ref}" s="2"><v>${v}</v></c>`:`<c r="${ref}" t="inlineStr" s="${i===0?1:0}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;}).join('')}</row>`).join('');
    return zip({
      '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="穆松尼库存（演示）" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml':`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="5" width="26" customWidth="1"/><col min="6" max="9" width="17" customWidth="1"/></cols><sheetData>${sheet}</sheetData><autoFilter ref="A1:I${rows.length+1}"/></worksheet>`
    });
  }
  const api={data,query,totals,csv,xlsx,matrix};root.Inventory=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
