'use strict';
// Lifecycle operations must read committed state AFTER waiting for the account lock.
// Inventory transactions retain their original repeatable-read behavior.
module.exports=async function accountTransaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');await c.query('SELECT pg_advisory_xact_lock(21002)');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
