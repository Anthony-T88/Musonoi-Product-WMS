(function(root){
 'use strict';
 const isCount=key=>/(?:^|_)(?:bundles|bags|vehicles|bundle_count|bag_count|vehicle_count)$/.test(key)||
  ['stock_units','stock_unknown_units','inbound_units','inbound_unknown_weights','unknown_weights','sheets_per_bundle'].includes(key);
 function display(value){
  if(value===null||value===undefined||value==='')return '—';
  // Preserve anomalous fractional source counts for reconciliation.
  return String(value).replace(/^(-?\d+)\.0+$/,'$1');
 }
 function spreadsheet(value){
  const text=display(value);
  if(!/^-?\d+$/.test(text))return value;
  const number=Number(text);
  return Number.isSafeInteger(number)?number:text;
 }
 const api={isCount,display,spreadsheet};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CountValues=api;
})(globalThis);
