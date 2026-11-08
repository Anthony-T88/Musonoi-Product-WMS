'use strict';
const T=require('../dist/tonnes.js');
function precheck(d){const s=d.summary,unknown=['opening','inbound','outbound','closing'].map(k=>s[k+'_unknown_units']),difference=s.reconciliation_net_mt,ended=Date.parse(d.as_of)>=Date.parse(d.period.to+'T00:00:00+02:00')+86400000;
 const checks=[{code:'period_ended',passed:ended,value:d.period.to},{code:'history_complete',passed:s.coverage==='COMPLETE',value:s.coverage},{code:'weights_confirmed',passed:unknown.every(n=>n!=null&&Number(n)===0),value:Object.fromEntries(['opening','inbound','outbound','closing'].map((k,i)=>[k,unknown[i]]))},{code:'known_reconciliation',passed:difference!=null&&T.scaled(difference,6)===0n,value:difference}];
 return{read_only:true,locked:false,scope:'STOCK_BALANCE_ONLY',state:checks.every(c=>c.passed)?'READ_ONLY_READY':'REQUIRES_REVIEW',checks};}
module.exports={precheck};
