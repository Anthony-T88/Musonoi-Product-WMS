'use strict';
function requiresLease(req){return !['GET','HEAD','OPTIONS'].includes(req.method)&&!/^\/api\/v1\/(?:users(?:\/|$)|security\/(?:roles|policy)(?:\/|$)|me\/language(?:\/|$))/.test(req.url.split('?')[0]);}
function cancelled(req){if(req.authorizationCancelled||req.raw?.aborted)throw Object.assign(Error('Request cancelled'),{statusCode:408,code:'AUTHORIZATION_CANCELLED'});}
function healthy(req){if(req.authorizationLeaseError)throw Object.assign(Error('Authorization connection lost'),{statusCode:503,code:'AUTHORIZATION_CONNECTION_LOST'});}
async function lockBusiness(c,req){healthy(req);if(!req.authorizationLease)await c.query('SELECT pg_advisory_xact_lock_shared(21002)');}
async function acquire(req,pool){
 if(req.authorizationLease)return req.authorizationLease;
 cancelled(req);const c=await pool.connect(),onError=e=>{req.authorizationLeaseError||=e;};c.on?.('error',onError);
 try{cancelled(req);await c.query('BEGIN READ ONLY');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='6s'");await c.query('SELECT pg_advisory_xact_lock_shared(21002)');cancelled(req);healthy(req);req.authorizationLease=c;req.authorizationLeaseHandler=onError;return c;}
 catch(e){let broken=req.authorizationLeaseError;try{await c.query('ROLLBACK');}catch(error){broken=error;}c.release(broken);if(!broken)c.removeListener?.('error',onError);throw e;}
}
async function release(req){const c=req.authorizationLease;if(!c)return;req.authorizationLease=null;let broken=req.authorizationLeaseError;try{if(!broken)await c.query('ROLLBACK');}catch(error){broken=error;}finally{c.release(broken);if(!broken&&req.authorizationLeaseHandler)c.removeListener?.('error',req.authorizationLeaseHandler);req.authorizationLeaseHandler=null;}if(broken)throw broken;}
module.exports={requiresLease,acquire,release,healthy,lockBusiness};
