'use strict';
function requiresLease(req){return !['GET','HEAD','OPTIONS'].includes(req.method)&&!/^\/api\/v1\/(?:users(?:\/|$)|security\/(?:roles|policy)(?:\/|$)|me\/language(?:\/|$))/.test(req.url.split('?')[0]);}
async function acquire(req,pool){
 if(req.authorizationLease)return req.authorizationLease;
 const c=await pool.connect();try{await c.query('BEGIN READ ONLY');await c.query('SELECT pg_advisory_xact_lock_shared(21002)');req.authorizationLease=c;return c;}catch(e){await c.query('ROLLBACK').catch(()=>{});c.release();throw e;}
}
async function release(req){const c=req.authorizationLease;if(!c)return;req.authorizationLease=null;try{await c.query('ROLLBACK');}finally{c.release();}}
module.exports={requiresLease,acquire,release};
