'use strict';

const T=require('../dist/tonnes.js');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const revision=()=>encodeURIComponent(require('./release.cjs').frontendRevision);
const columns=[
 ['NO.',null,4],['LOT NO.','batch',11],['HORSE NO.','truck',8],['TRAILER 1','trailer_one',7],
 ['TRAILER 2','trailer_two',7],['CONTAINER NO.','container',9],['TRANSPORTER','transporter',10],
 ['DRIVER NAME','driver',11],['PASSPORT NO.','passport',8],['PACKAGE N°','quantity',7],
 ['Net Weight (MT)','net_mt',9],['Gross Weight (MT)','gross_mt',9]
];
const value=(row,key)=>{
 const field=row[key];
 if(field==null||field==='')return '';
 if(!key.endsWith('_mt'))return escape(field);
 return T.fixed(T.scaled(field,3),3).replace(/\B(?=(\d{3})+\.)/g,',');
};
function table(rows,total){
 const head=columns.map(([label])=>'<th scope="col">'+escape(label)+'</th>').join('');
 const body=rows.map((row,i)=>'<tr>'+columns.map(([,key])=>'<td>'+(key?value(row,key):i+1)+'</td>').join('')+'</tr>').join('');
 // Store no placeholder rows. The total is a normal row group so it prints only once.
 return '<table class="bp-table"><colgroup>'+columns.map(([,,width])=>'<col class="bp-width-'+width+'">').join('')+
  '</colgroup><thead><tr>'+head+'</tr></thead><tbody class="bp-vehicles">'+body+'</tbody>'+
  '<tbody class="bp-total"><tr><th scope="row" colspan="9">TOTAL</th>'+['quantity','net_mt','gross_mt'].map(k=>'<td>'+value(total,k)+'</td>').join('')+'</tr></tbody></table>';
}
function content(snapshot){
 const {number,header:h,rows,total}=snapshot;
 const identification=[[null,h.issuer],[null,h.address],['RCCM',h.rccm],['ID-NAT',h.id_nat],['NIF',h.nif],['Contact',h.contact]]
  .filter(([,field])=>field).map(([label,field])=>'<p>'+(label?label+': ':'')+escape(field)+'</p>').join('');
 const details=pairs=>'<dl>'+pairs.map(([label,key])=>'<div><dt>'+label+':</dt><dd>'+escape(h[key])+'</dd></div>').join('')+'</dl>';
 return '<article class="bp-sheet'+(rows.length<=10?' bp-short':'')+'" lang="fr"><h2>BULLETIN DE PESAGE / WEIGHTING SHEET : N°'+escape(number)+'</h2>'+
  '<div class="bp-issuer"><div>'+identification+'</div><img src="/customs-bp-logo.png?rev='+revision()+'" alt="Metorex · Ruashi Mining"></div>'+
  '<div class="bp-details">'+details([['Client','customer'],['Product','product'],['Transport mode','mode'],['Final Destination','destination'],['Exit Border','border']])+
  details([['Customs Agency','agency'],['License','license'],['Loading Point','loading_point'],['Loading Date','loading_date']])+'</div>'+
  table(rows,total)+'<footer class="bp-signature"><p>SIGNATURE</p><p>KOLWEZI, le '+escape(h.signature_date)+'</p></footer></article>';
}
function html(snapshot,auto=false){
 const rev=revision();
 return '<!doctype html><html class="bp-print-document" lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Bulletin de pesage '+escape(snapshot.number)+'</title><link rel="stylesheet" href="/customs-bp-print.css?rev='+rev+'"></head>'+
  '<body'+(auto?' data-print-auto':'')+'><button type="button" id="bp-print">Imprimer / Print</button>'+content(snapshot)+
  '<script src="/customs-bp-print.js?rev='+rev+'"></script></body></html>';
}

module.exports={html,content};
