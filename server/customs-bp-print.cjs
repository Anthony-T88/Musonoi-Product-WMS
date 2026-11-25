'use strict';

const T=require('../dist/tonnes.js');
const {longDate}=require('../dist/business-time.js');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const revision=()=>encodeURIComponent(require('./release.cjs').frontendRevision);
const columns=[
 ['NO.',null,2],['LOT NO.','batch',11],['HORSE NO.','truck',6],['TRAILER 1','trailer_one',6],
 ['TRAILER 2','trailer_two',6],['CONTAINER NO.','container',8],['TRANSPORTER','transporter',15],
 ['DRIVER NAME','driver',17],['PASSPORT NO.','passport',8],['PACKAGE N°','quantity',6],
 ['Net Weight (MT)','net_mt',7],['Gross Weight (MT)','gross_mt',8]
];
const companyFields=[[null,'issuer'],[null,'address'],['RCCM','rccm'],['ID-NAT','id_nat'],['NIF','nif'],['Contact','contact']];
const declarationFields=[
 [['Client','customer'],['Product','product'],['Transport mode','mode'],['Final Destination','destination'],['Exit Border','border']],
 [['Customs Agency','agency'],['License','license'],['Loading Point','loading_point'],['Loading Date','loading_date']]
];
const sheetTitle=snapshot=>(snapshot.template_title||'BULLETIN DE PESAGE / WEIGHTING SHEET')+' : N°'+snapshot.number;
const line=value=>'<span class="bp-line">'+escape(value)+'</span>';
const value=(row,key)=>{
 const field=row[key];
 if(field==null||field==='')return '';
 if(!key.endsWith('_mt'))return field;
 return T.fixed(T.scaled(field,3),3).replace(/\B(?=(\d{3})+\.)/g,',');
};
function table(rows,total,signatureDate){
 const head=columns.map(([label])=>'<th scope="col">'+line(label)+'</th>').join('');
 const vehicles=rows.map((row,i)=>'<tr class="bp-vehicle">'+columns.map(([,key])=>'<td>'+line(key?value(row,key):i+1)+'</td>').join('')+'</tr>');
 const totals='<tr class="bp-total"><th scope="row" colspan="9">TOTAL</th>'+
  ['quantity','net_mt','gross_mt'].map(k=>'<td>'+line(value(total,k))+'</td>').join('')+'</tr>';
 const signature='<tr class="bp-signoff"><td colspan="'+columns.length+'"><footer class="bp-signature"><p>SIGNATURE</p><p>KOLWEZI, le '+
  escape(longDate(signatureDate))+'</p></footer></td></tr>';
 // Keep the last vehicle with the totals and signatures on multi-page sheets.
 const preceding=vehicles.slice(0,-1);
 return '<table class="bp-table"><colgroup>'+columns.map(([,,width])=>'<col class="bp-width-'+width+'">').join('')+
  '</colgroup><thead><tr>'+head+'</tr></thead>'+(preceding.length?'<tbody>'+preceding.join('')+'</tbody>':'')+
  '<tbody class="bp-closing">'+(vehicles.at(-1)||'')+totals+signature+'</tbody></table>';
}
function content(snapshot){
 const {header:h,rows,total}=snapshot;
 const identification=companyFields.map(([label,key])=>[label,h[key]])
  .filter(([,field])=>field).map(([label,field])=>'<p>'+line((label?label+': ':'')+field)+'</p>').join('');
 const details=pairs=>'<dl>'+pairs.map(([label,key])=>'<div><dt>'+line(label+':')+'</dt><dd>'+
  line(key==='loading_date'?longDate(h[key]):h[key])+'</dd></div>').join('')+'</dl>';
 return '<article class="bp-sheet'+(rows.length<=10?' bp-short':'')+'" lang="fr"><h2>'+line(sheetTitle(snapshot))+'</h2>'+
  '<div class="bp-issuer"><div>'+identification+'</div><img src="/customs-bp-logo.png?rev='+revision()+'" alt="Metorex · Ruashi Mining"></div>'+
  '<div class="bp-details">'+declarationFields.map(details).join('')+'</div>'+
  table(rows,total,h.signature_date)+'</article>';
}
function html(snapshot,auto=false){
 const rev=revision();
 return '<!doctype html><html class="bp-print-document" lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Bulletin de pesage '+escape(snapshot.number)+'</title><link rel="stylesheet" href="/customs-bp-print.css?rev='+rev+'">'+
  '<link rel="stylesheet" media="print" href="/customs-bp-paper.css?rev='+rev+'"></head>'+
  '<body'+(auto?' data-print-auto':'')+'><button type="button" id="bp-print">Imprimer / Print</button>'+content(snapshot)+
  '<script src="/customs-bp-print.js?rev='+rev+'"></script></body></html>';
}

module.exports={html,content,columns,companyFields,declarationFields,sheetTitle};
