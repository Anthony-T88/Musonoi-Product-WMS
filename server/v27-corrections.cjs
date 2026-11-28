'use strict';
const C=require('./control-common.cjs'),{access:loadAccess}=require('./loading.cjs');
const rechecks=require('./copper-return-rechecks.cjs');
async function access(c,req,id){const d=(await c.query('SELECT * FROM outbound_corrections WHERE id=$1',[C.uuid(id)])).rows[0];if(!d)throw C.error(404,'更正记录不存在');await loadAccess(c,req,d.loading_id);return d;}
module.exports=async({app,pool,permitted,csrf})=>{
 app.get('/api/v1/v27/corrections',{preHandler:permitted('load:read')},req=>C.read(pool,async c=>{const ids=(await c.query('SELECT id FROM outbound_corrections ORDER BY requested_at DESC LIMIT 200')).rows,items=[];for(const {id} of ids)try{items.push(await access(c,req,id));}catch(e){if(e.statusCode!==403)throw e;}return {items};}));
 app.get('/api/v1/v27/corrections/:id',{preHandler:permitted('load:read')},req=>C.read(pool,async c=>{
  const d=await access(c,req,req.params.id);
  const {rows:steps}=await c.query('SELECT s.*,u.display_name actor_name FROM outbound_correction_steps s JOIN users u ON u.id=s.actor_id WHERE correction_id=$1 ORDER BY s.id',[d.id]);
  const preparation_recovery=d.kind==='RETURN_OUTBOUND'&&d.status==='APPLIED'?
   (await c.query('SELECT copper_return_preparation_state($1) recovery',[d.id])).rows[0].recovery:null;
  const preparation_recheck=await rechecks.read(c,req,d,preparation_recovery);
  return {...d,steps,preparation_recovery,preparation_recheck};
 }));
 app.post('/api/v1/v27/corrections',{preHandler:[permitted('load:write'),csrf]},req=>C.mutate(pool,req,async c=>{const b=req.body||{};await loadAccess(c,req,C.uuid(b.loading_id));return(await c.query('SELECT * FROM v27_correction_create($1,$2,$3,$4,$5,$6)',[req.user.id,b.loading_id,C.version(b.version),b.kind,C.text(b.reason,'更正依据',2000),b.details||{}])).rows[0];}));
 for(const action of ['authorize','reject','verify-return','apply'])app.post('/api/v1/v27/corrections/:id/'+action,{preHandler:[permitted(action==='verify-return'?'load:review':'outbound:approve'),csrf]},req=>C.mutate(pool,req,async c=>{await access(c,req,req.params.id);return(await c.query('SELECT * FROM v27_correction_action($1,$2,$3,$4,$5)',[req.user.id,req.params.id,C.version(req.body?.version),action,C.text(req.body?.reason,'核查依据',2000)])).rows[0];}));
 app.post('/api/v1/v27/corrections/:id/restore-preparation',{preHandler:[permitted('outbound:approve'),csrf]},req=>C.mutate(pool,req,async c=>{
  const d=await access(c,req,req.params.id);
  const {rows:[{recovery}]}=await c.query('SELECT copper_restore_return_with_plan($1,$2,$3,$4) recovery',
   [req.user.id,d.id,C.version(req.body?.version),C.text(req.body?.reason,'恢复依据',2000)]);
  return recovery;
 }));
 rechecks.register(app,pool,permitted,csrf,access);
};
