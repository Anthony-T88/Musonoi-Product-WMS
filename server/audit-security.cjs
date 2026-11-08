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
module.exports={visible};
