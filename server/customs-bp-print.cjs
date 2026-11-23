'use strict';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const revision=()=>require('./release.cjs').frontendRevision;
const columns=['NO.','LOT NO.','HORSE NO.','TRAILER 1','TRAILER 2','CONTAINER NO.','TRANSPORTER','DRIVER NAME','PASSPORT NO.','PACKAGE N°','Net Weight (MT)','Gross Weight (MT)'];
const props=['batch','truck','trailer_one','trailer_two','container','transporter','driver','passport','quantity','net_mt','gross_mt'];

function table(rows,total){
 const head=columns.map(label=>'<th scope="col">'+escape(label)+'</th>').join('');
 const body=rows.map((r,i)=>'<tr><td>'+(i+1)+'</td>'+props.map(k=>'<td>'+escape(r[k]||'—')+'</td>').join('')+'</tr>').join('');
 return '<table class="bp-table"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody>'+
  '<tbody class="bp-total"><tr><th scope="row" colspan="9">TOTAL</th>'+['quantity','net_mt','gross_mt'].map(k=>'<td>'+escape(total[k])+'</td>').join('')+'</tr></tbody></table>';
}
function html(snapshot,auto=false){
 const {number,header:h,rows,total}=snapshot,rev=encodeURIComponent(revision());
 const identification=[[null,h.issuer],[null,h.address],['RCCM',h.rccm],['ID-NAT',h.id_nat],['NIF',h.nif],['Contact',h.contact]]
  .filter(([,value])=>value).map(([key,value])=>'<p>'+(key?key+': ':'')+escape(value)+'</p>').join('');
 const details=[['Client','customer'],['Product','product'],['Transport mode','mode'],['Final Destination','destination'],['Exit Border','border'],
  ['Customs Agency','agency'],['License','license'],['Loading Point','loading_point'],['Loading Date','loading_date']]
  .map(([label,key])=>'<div><dt>'+label+'</dt><dd>'+escape(h[key]||'—')+'</dd></div>').join('');
 return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Bulletin de pesage '+escape(number)+'</title><link rel="stylesheet" href="/customs-bp-print.css?rev='+rev+'"></head>'+
  '<body'+(auto?' data-print-auto':'')+'><button type="button" id="bp-print">Imprimer / Print</button><main>'+
  '<h1>BULLETIN DE PESAGE / WEIGHING SHEET · N°'+escape(number)+'</h1><section class="bp-issuer">'+identification+'</section>'+
  '<dl class="bp-details">'+details+'</dl>'+table(rows,total)+'<footer><p>SIGNATURE</p><p>KOLWEZI, le '+escape(h.signature_date||'—')+'</p></footer>'+
  '</main><script src="/customs-bp-print.js?rev='+rev+'"></script></body></html>';
}

module.exports={html};
