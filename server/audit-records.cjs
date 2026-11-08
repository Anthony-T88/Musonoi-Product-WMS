'use strict';
const C=require('./control-common.cjs'),S=require('./management-security.cjs'),A=require('./audit-security.cjs');
module.exports=async({app,pool,permitted})=>{
 app.get('/api/v1/v27/backups',{preHandler:permitted('system:manage')},async()=>({items:(await pool.query('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 100')).rows,scheduleConfigured:null,scheduleNote:'Scheduling must be installed on the actual host; database records report executions, not deployment status.'}));
 app.get('/api/v1/v27/audit',{preHandler:permitted('audit:read')},req=>S.read(pool,req,'audit:read',async(c,authority)=>{
  const q=req.query,page=Number(q.page||1);if(!Number.isInteger(page)||page<1||page>100000)throw C.error(400,'分页参数无效');
  for(const key of ['action','entity','search'])if(q[key]!==undefined&&(typeof q[key]!=='string'||q[key].length>160))throw C.error(400,'日志查询条件无效');
  for(const key of ['from','to'])if(q[key]){const date=/^[1-9]\d{3}-\d{2}-\d{2}$/.test(q[key])?new Date(q[key]+'T00:00:00Z'):null;if(!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==q[key])throw C.error(400,'日志日期无效');}
  if(q.from&&q.to&&q.from>q.to)throw C.error(400,'开始日期不能晚于结束日期');
  if(q.outcome&&!['SUCCESS','COMMITTED','FAILED'].includes(q.outcome))throw C.error(400,'日志结果筛选无效');
  const values=[authority.id,S.isAdmin(authority),q.action||'',q.entity||'',q.search||'',q.from||null,q.to||null,q.outcome==='SUCCESS'?'COMMITTED':q.outcome||''];
  const where=`${A.visible('a','$2')} AND($3='' OR a.action=$3) AND($4='' OR a.entity_id=$4)
   AND($5='' OR strpos(lower(coalesce(a.entity_id,'')||' '||coalesce(a.actor_name_snapshot,u.display_name,'')||' '||a.action||' '||coalesce(a.entity_type,'')),lower($5))>0)
   AND($6::date IS NULL OR a.occurred_at>=($6::date::timestamp AT TIME ZONE 'Africa/Lubumbashi'))
   AND($7::date IS NULL OR a.occurred_at<(($7::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi'))
   AND($8='' OR coalesce(a.outcome,'COMMITTED')=$8)`;
  return {items:(await c.query(`SELECT a.*,coalesce(a.actor_name_snapshot,u.display_name) actor_name,coalesce(a.actor_role_snapshot,a.actor_role) actor_role,coalesce(a.actor_role_name_snapshot,r.name) actor_role_name,coalesce(a.actor_role_name_en_snapshot,r.name_en,r.name) actor_role_name_en FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN roles r ON r.code=coalesce(a.actor_role_snapshot,a.actor_role) WHERE ${where} ORDER BY a.id DESC LIMIT 50 OFFSET $9`,[...values,(page-1)*50])).rows,
   total:(await c.query(`SELECT count(*)::int n FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where}`,values)).rows[0].n,page,page_size:50};
 }));
 app.get('/api/v1/v27/audit/:id',{preHandler:permitted('audit:read')},req=>S.read(pool,req,'audit:read',async(c,authority)=>{
  if(!/^[1-9]\d{0,18}$/.test(req.params.id))throw C.error(400,'审计记录编号无效');
  const row=(await c.query('SELECT a.*,coalesce(a.actor_name_snapshot,u.display_name) actor_name,coalesce(a.actor_role_snapshot,a.actor_role) actor_role,coalesce(a.actor_role_name_snapshot,r.name) actor_role_name,coalesce(a.actor_role_name_en_snapshot,r.name_en,r.name) actor_role_name_en FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN roles r ON r.code=coalesce(a.actor_role_snapshot,a.actor_role) WHERE a.id=$3 AND '+A.visible('a','$2'),[authority.id,S.isAdmin(authority),req.params.id])).rows[0];
  if(!row)throw C.error(404,'审计记录不存在');return row;
 }));
};
