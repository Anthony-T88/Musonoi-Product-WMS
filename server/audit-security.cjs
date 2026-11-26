'use strict';
// No ownership is inferred from an actor's current assignments or an entity's current state.
function visible(a,parameter){
 return `(${parameter}::boolean OR (a.scope_context->>'kind'='SCOPED'
 AND jsonb_typeof(a.scope_context->'scopes')='array' AND jsonb_array_length(a.scope_context->'scopes')>0
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.scope_context->'scopes') event_scope
 WHERE NOT EXISTS(SELECT 1 FROM user_scopes mine WHERE mine.user_id=$1
 AND mine.project_id::text=event_scope->>'project_id'
 AND(mine.warehouse_id IS NULL OR mine.warehouse_id::text=event_scope->>'warehouse_id')
 AND(mine.customer_id IS NULL OR mine.customer_id::text=event_scope->>'customer_id')))))`;
}
function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>{
  const field=key.toLowerCase().replaceAll(/[^a-z0-9]/g,'');
  const hidden=/^(?:current|new|old|confirm)?password(?:hash|confirmation)?$/.test(field)||
   /^(?:.*passport.*|.*token(?:hash)?|csrf.*|cookie|authorization|.*secret.*|databaseurl|.*privatekey|keyhex|.*base64|contactphone|contactemail|bankaccount(?:no)?|issuingbankaccount|offshorebankaccount)$/.test(field);
  return [key,hidden?'[redacted]':redact(item)];
 }));
}
function record(row){return {...row,before_data:redact(row.before_data),after_data:redact(row.after_data)};}
module.exports={visible,record};
