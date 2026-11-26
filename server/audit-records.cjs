'use strict';

const {createHash}=require('node:crypto');
const C=require('./control-common.cjs'),S=require('./management-security.cjs'),A=require('./audit-security.cjs');
const maxExport=2000;
const joined=' FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN roles r ON r.code=coalesce(a.actor_role_snapshot,a.actor_role)';
const identity='coalesce(a.actor_name_snapshot,u.display_name) actor_name,coalesce(a.actor_role_snapshot,a.actor_role) actor_role,'+
 'coalesce(a.actor_role_name_snapshot,r.name) actor_role_name,coalesce(a.actor_role_name_en_snapshot,r.name_en,r.name) actor_role_name_en';
const category=`CASE WHEN a.action ~ '^(login|logout|password)' THEN 'AUTH'
 WHEN a.action ~ '^(access_change_|general_manager_|user_|role_|registration_)' THEN 'ACCESS'
 WHEN a.action='audit_evidence_exported' THEN 'AUDIT'
 WHEN a.action='operation_failed' THEN 'FAILURE' ELSE 'BUSINESS' END`;

function queryFilters(q,authority){
 if(!q||typeof q!=='object'||Array.isArray(q))throw C.error(400,'日志查询条件无效');
 for(const key of ['action','entity','search']){
  if(q[key]!==undefined&&(typeof q[key]!=='string'||q[key].length>160))throw C.error(400,'日志查询条件无效');
 }
 for(const key of ['from','to']){
  if(q[key]===undefined||q[key]==='')continue;
  const date=typeof q[key]==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(q[key])?new Date(q[key]+'T00:00:00Z'):null;
  if(!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==q[key])throw C.error(400,'日志日期无效');
 }
 if(q.from&&q.to&&q.from>q.to)throw C.error(400,'开始日期不能晚于结束日期');
 if(q.outcome&&!['SUCCESS','COMMITTED','FAILED'].includes(q.outcome))throw C.error(400,'日志结果筛选无效');
 if(q.request_id!==undefined&&q.request_id!==''&&(typeof q.request_id!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(q.request_id)))throw C.error(400,'请求编号无效');
 if(q.category&&!['AUTH','ACCESS','AUDIT','FAILURE','BUSINESS'].includes(q.category))throw C.error(400,'日志分类无效');
 const values=[authority.id,S.isAdmin(authority),q.action||'',q.entity||'',q.search||'',q.from||null,q.to||null,
  q.outcome==='SUCCESS'?'COMMITTED':q.outcome||'',q.request_id||'',q.category||''];
 const where=`${A.visible('a','$2')} AND($3='' OR a.action=$3) AND($4='' OR a.entity_id=$4)
  AND($5='' OR strpos(lower(coalesce(a.entity_id,'')||' '||coalesce(a.actor_name_snapshot,u.display_name,'')||' '||a.action||' '||coalesce(a.entity_type,'')),lower($5))>0)
  AND($6::date IS NULL OR a.occurred_at>=($6::date::timestamp AT TIME ZONE 'Africa/Lubumbashi'))
  AND($7::date IS NULL OR a.occurred_at<(($7::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi'))
  AND($8='' OR coalesce(a.outcome,'COMMITTED')=$8)
  AND($9='' OR a.request_id=$9) AND($10='' OR (${category})=$10)`;
 return {where,values};
}
async function register({app,pool,permitted,csrf}){
 const audit=permitted('audit:read');
 app.get('/api/v1/v27/backups',{preHandler:permitted('system:manage')},async()=>({items:(await pool.query('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 100')).rows,scheduleConfigured:null,scheduleNote:'Scheduling must be installed on the actual host; database records report executions, not deployment status.'}));
 app.get('/api/v1/v27/audit',{preHandler:audit},req=>S.read(pool,req,'audit:read',async(c,authority)=>{
  const q=req.query,page=Number(q.page||1);
  if(!Number.isInteger(page)||page<1||page>100000)throw C.error(400,'分页参数无效');
  const {where,values}=queryFilters(q,authority);
  const {rows}=await c.query('SELECT a.*,'+identity+','+category+' category'+joined+' WHERE '+where+' ORDER BY a.id DESC LIMIT 50 OFFSET $11',
   [...values,(page-1)*50]);
  const {rows:[{n}]}=await c.query('SELECT count(*)::int n'+joined+' WHERE '+where,values);
  return {items:rows.map(A.record),total:n,page,page_size:50};
 }));
 app.get('/api/v1/v27/audit/:id',{preHandler:audit},req=>S.read(pool,req,'audit:read',async(c,authority)=>{
  if(!/^[1-9]\d{0,18}$/.test(req.params.id)||BigInt(req.params.id)>9223372036854775807n)throw C.error(400,'审计记录编号无效');
  const {rows:[row]}=await c.query('SELECT a.*,'+identity+','+category+' category'+joined+' WHERE a.id=$3 AND '+A.visible('a','$2'),
   [authority.id,S.isAdmin(authority),req.params.id]);
  if(!row)throw C.error(404,'审计记录不存在');
  return A.record(row);
 }));
 app.post('/api/v1/v27/audit/export',{preHandler:[audit,csrf],config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
  const rows=await S.read(pool,req,'audit:read',async(c,authority)=>{
   const {where,values}=queryFilters(req.body??{},authority);
   return (await c.query(
    'SELECT a.id,a.occurred_at,a.actor_id,a.action,a.entity_type,a.entity_id,a.request_id,a.outcome,'+identity+','+category+' category'+
    joined+' WHERE '+where+' ORDER BY a.id DESC LIMIT $11',[...values,maxExport+1])).rows;
  });
  if(rows.length>maxExport)throw C.error(409,'请缩小筛选范围，每次最多导出 2000 条日志');
  const artifact=Buffer.from(JSON.stringify({version:1,generated_at:new Date().toISOString(),request_id:req.id,records:rows}));
  const sha256=createHash('sha256').update(artifact).digest('hex');
  await require('./business-common.cjs').audit(pool,req,'audit_evidence_exported','audit_logs',null,null,{count:rows.length,sha256});
  return reply.type('application/json').header('Content-Disposition','attachment; filename="wms-audit.json"')
   .header('X-Content-SHA256',sha256).header('X-Export-Count',rows.length).send(artifact);
 });
}
module.exports=register;
