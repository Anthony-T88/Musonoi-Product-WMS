'use strict';
// Supplement only actor IDs already visible in an authorized business document.
// A person's current account role must never stand in for a historical role.
const actorKey=/(?:_by$|^(?:actor|operator|requester|reviewer|creator|authorizer|verifier|applier)_id$)/;
module.exports=({app,pool})=>app.addHook('onSend',async(req,reply,payload)=>{
 if(req.method!=='GET'||!req.user||reply.statusCode!==200||!String(reply.getHeader('content-type')).includes('application/json')||typeof payload!=='string')return payload;
 const data=JSON.parse(payload);if(!data||typeof data!=='object'||Array.isArray(data))return payload;
 await require('./approval-presentation.cjs').enrich(pool,req,data);
 if(!/^\/api\/v1\/(?:receipts|plans|loads|allocations|v26|v261|v262|v27|v32|v33|v34|stocktakes|adjustments|sales-workflow|shipping|gate-permits|loading-plans|cobalt)\//.test(req.url)||!/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(req.url))return JSON.stringify(data);
 const ids=new Set();function visit(value,depth=0){if(!value||typeof value!=='object'||depth>12)return;for(const[key,v]of Object.entries(value)){if(actorKey.test(key)&&typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v))ids.add(v);else if(v&&typeof v==='object')visit(v,depth+1);}}visit(data);if(!ids.size||ids.size>200)return JSON.stringify(data);
 const people=(await pool.query('SELECT id,display_name FROM users WHERE id=ANY($1::uuid[])',[[...ids]])).rows;
 data._activity_people=Object.fromEntries(people.map(p=>[p.id,{...p,display_name_en:require('./employee-identity.cjs').englishName(p.display_name),role_basis:'HISTORICAL_UNKNOWN'}]));return JSON.stringify(data);
});
