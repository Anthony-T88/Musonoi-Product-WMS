// Copyright (c) 2026 唐雷 (Tang Lei). All rights reserved.
'use strict';
process.env.TZ='Africa/Lubumbashi';
const Fastify=require('fastify'),{Pool}=require('pg'),ExcelJS=require('exceljs'),fs=require('node:fs'),path=require('node:path');
const {config}=require('./config.cjs'),{hashPassword,verifyPassword,digest,token}=require('./security.cjs'),{transaction,where,order,listing,invalid,inventoryInput}=require('./inventory.cjs');
const AccountPolicy=require('./account-policy.cjs');
const ServiceErrors=require('./service-errors.cjs');
const UUID='^[0-9a-fA-F-]{36}$';
const problem=(status,message)=>Object.assign(Error(message),{statusCode:status});
async function build(options={}){
 const cfg=options.config||config();if(process.env.VERIFY_SOURCE_INTEGRITY==='1')require('./release-integrity.cjs').verify(cfg.root);const pool=options.pool||new Pool({connectionString:cfg.databaseUrl,connectionTimeoutMillis:2000,max:10,options:"-c timezone=Africa/Lubumbashi"});
 const poolError=e=>ServiceErrors.report(e,null,options.errorReporter);pool.on('error',poolError);
 const app=Fastify({logger:false,bodyLimit:1024*1024,trustProxy:false});
 await app.register(require('@fastify/cookie'));
 await app.register(require('@fastify/rate-limit'),{global:false});
 app.addHook('onClose',async()=>{if(!options.pool)await pool.end();pool.removeListener('error',poolError);});
 app.setErrorHandler(async(e,req,reply)=>{try{await require('./v265.cjs').enrichSealError(pool,req,e);}catch{}const business=require('./v27-errors.cjs')(e,req)||require('./v265.cjs').businessError(e,req);if(req.user&&req.method!=='GET'&&/^\/api\/v1\//.test(req.url)){try{await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data,request_id,outcome) VALUES($1,'operation_failed',$2,$3,$4,$5,'FAILED')",[req.user.id,req.routeOptions?.url?.split('/')[3]||'business',req.params?.id||null,{status:business?(e.statusCode||409):ServiceErrors.status(e),code:business?.code||e.code||'BUSINESS_VALIDATION_FAILED'},req.id]);}catch{}}if(business){reply.code(e.statusCode||409).send(business);return;}const status=ServiceErrors.status(e);if(status>=500){const errorId=ServiceErrors.report(e,req,options.errorReporter);reply.code(status).send({error:(status===503?'数据库或服务暂不可用，请检查本机服务；未使用演示数据替代。':'服务处理失败，请联系管理员；提交结果请查询确认。')+' 错误编号：'+errorId,errorId});}else reply.code(status).send({error:e.validation?'请求参数无效':e.message});});
 app.addHook('onSend',async(req,reply,payload)=>{reply.header('Permissions-Policy','camera=(self), microphone=(), geolocation=()').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('Cache-Control','no-store').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");if(req.user&&Buffer.isBuffer(payload)&&String(reply.getHeader('content-type')||'').includes('spreadsheetml')&&!/\/shipping\/[^/]+\/packing-list\.xlsx/.test(req.url))return require('./export-language.cjs').workbook(payload,req.user.language_code);return payload;});
 async function dbEnvironment(c=pool){const r=await c.query('SELECT environment FROM system_info WHERE singleton');if(r.rows[0]?.environment!==cfg.environment)throw Error('Database environment mismatch');}
 async function userInfo(c,user){return {...require('./employee-identity.cjs').enrich(user),permissions:(await c.query('SELECT permission_code FROM role_permissions WHERE role_code=$1',[user.role_code])).rows.map(r=>r.permission_code)};}
 async function auth(req){await dbEnvironment();const sid=req.cookies.musonoi_session;if(!sid)throw problem(401,'请先登录');const row=(await pool.query('SELECT u.id,u.username,u.display_name,u.role_code,u.language_code,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND u.deleted_at IS NULL',[digest(sid)])).rows[0];if(!row||!await AccountPolicy.allowed(pool,row))throw problem(401,'登录已失效，请重新登录');req.user=await userInfo(pool,row);}
 const permitted=code=>async req=>{await auth(req);if(!req.user.permissions.includes(code))throw problem(403,'当前账号没有此操作权限');};
 async function csrf(req){if(req.headers.origin!==cfg.origin)throw problem(403,'请求来源不受信任');if(!req.user||digest(String(req.headers['x-csrf-token']||''))!==req.user.csrf_hash)throw problem(403,'安全令牌无效，请重新登录');}
 app.get('/api/v1/config',async()=>({environment:cfg.environment,arrivalWorkflowV34:await require('./vehicle-arrivals.cjs').enabled(pool),managementV34:await require('./management.cjs').enabled(pool),inventoryDepthV33:await require('./inventory-depth.cjs').enabled(pool),inventoryControlV32:await require('./inventory-control.cjs').enabled(pool),dispatchCapacityV31:await require('./packing-templates.cjs').enabled(pool),salesDispatchV31:(await pool.query("SELECT to_regclass('public.sales_dispatch_imports') IS NOT NULL ok")).rows[0].ok,version:await require('./management.cjs').enabled(pool)?'3.5.0':await require('./inventory-depth.cjs').enabled(pool)?'3.3.0':await require('./inventory-control.cjs').enabled(pool)?'3.2.0':await require('./loading-plans.cjs').enabled(pool)?'3.1.0':'3.0.0',unifiedLoadingV31:await require('./unified-loading-plans.cjs').enabled(pool),loadingPlanAccessV31:true,invoiceHeaderV31:(await pool.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='loading_plan_groups' AND column_name='invoice_no') ok")).rows[0].ok,loadingPlanV31:await require('./loading-plans.cjs').enabled(pool),productionReceiptSelfReviewEnabled:cfg.environment==='test'&&(await AccountPolicy.policy(pool)).production_receipt_self_review,supplementV262:await require('./v262-supplement.cjs').enabled(pool),lotWorkV262:await require('./v262.cjs').enabled(pool),lotWorkV261:await require('./v261.cjs').enabled(pool),source:'PostgreSQL',businessWrites:true,modules:['masters','receipts','allocations','samples','weighings','loads','outbounds','moves','stocktakes','exceptions','adjustments','reports','dashboard','labels','language','operations','shipping','loading-plans']}));
 app.get('/api/v1/health',async()=>{await dbEnvironment();await pool.query('SELECT 1');return {database:'ok',environment:cfg.environment};});
 app.post('/api/v1/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}},schema:{body:{type:'object',additionalProperties:false,required:['username','password'],properties:{username:{type:'string',maxLength:80},password:{type:'string',maxLength:128}}}}},async(req,reply)=>{
 if(req.headers.origin!==cfg.origin)throw problem(403,'请求来源不受信任');await dbEnvironment();
 const u=(await pool.query('SELECT * FROM users WHERE username=$1',[req.body.username.toLowerCase()])).rows[0];
 const fallback='invalid-salt:'+Buffer.alloc(64).toString('hex');const ok=verifyPassword(req.body.password,u?.password_hash||fallback);if(!u||!ok||!u.active||u.deleted_at||!await AccountPolicy.allowed(pool,u))throw problem(401,'账号或密码错误');
 const sid=token(),csrfToken=token();await require('./account-transaction.cjs')(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(21002)');const current=(await c.query('SELECT password_hash,active,deleted_at FROM users WHERE id=$1 FOR UPDATE',[u.id])).rows[0];if(!current?.active||current.deleted_at||current.password_hash!==u.password_hash)throw problem(401,'账号或密码错误');await c.query('DELETE FROM sessions WHERE expires_at<=now()');if(req.cookies.musonoi_session)await c.query('DELETE FROM sessions WHERE token_hash=$1',[digest(req.cookies.musonoi_session)]);await c.query("INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(sid),u.id,digest(csrfToken)]);await c.query('UPDATE users SET last_login_at=now() WHERE id=$1',[u.id]);await c.query('INSERT INTO audit_logs(actor_id,action,request_id) VALUES($1,$2,$3)',[u.id,'login',req.id]);});
 reply.setCookie('musonoi_session',sid,{path:'/',httpOnly:true,sameSite:'strict',secure:cfg.secure,maxAge:28800});return {csrfToken};
 });
 app.get('/api/v1/me',{preHandler:auth},async req=>{const {csrf_hash,...u}=req.user;return u;});
 app.post('/api/v1/auth/csrf',{preHandler:auth},async req=>{if(req.headers.origin!==cfg.origin)throw problem(403,'请求来源不受信任');const value=token();await pool.query('UPDATE sessions SET csrf_hash=$1 WHERE token_hash=$2',[digest(value),digest(req.cookies.musonoi_session)]);return {csrfToken:value};});
 app.post('/api/v1/auth/logout',{preHandler:[auth,csrf]},async(req,reply)=>{await pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(req.cookies.musonoi_session)]);reply.clearCookie('musonoi_session',{path:'/'});return {ok:true};});
 app.get('/api/v1/inventory',{preHandler:permitted('inventory:read')},req=>transaction(pool,c=>listing(c,req.user.id,req.query)));
 app.get('/api/v1/inventory/weight-exceptions',{preHandler:permitted('inventory:read')},async req=>{const w=where(req.user.id,req.query);return {notice:'历史毛重未知，不推算。核实后须另行授权迁移或调整，不能覆盖已确认历史。',items:(await pool.query(`SELECT v.id,v.receipt_code,v.weight,v.original_weight,v.gross_weight,v.packaging_weight,v.weight_basis FROM inventory_view v WHERE ${w.text} AND v.weight_basis<>'GROSS_MINUS_PACKAGING' ORDER BY v.id LIMIT 10000`,w.values)).rows};});
 app.get('/api/v1/inventory/options',{preHandler:permitted('inventory:read')},async req=>{const w=where(req.user.id);const result=await pool.query(`SELECT DISTINCT location,batch,coalesce(to_jsonb(v)->>'current_customer',customer) AS customer,allocated_customer FROM inventory_view v WHERE ${w.text}`,w.values);return Object.fromEntries(['location','batch','customer','allocated_customer'].map(k=>[k,[...new Set(result.rows.map(r=>r[k]).filter(Boolean))].sort()]));});
 app.post('/api/v1/inventory/selection',{preHandler:[permitted('inventory:read'),csrf]},async req=>{const w=where(req.user.id,inventoryInput(req.body?.filters),req.body?.selected_ids||[]);return {ids:(await pool.query(`SELECT v.id FROM inventory_view v WHERE ${w.text}`,w.values)).rows.map(r=>r.id)};});
 app.get('/api/v1/bundles/:id',{preHandler:permitted('inventory:read')},async req=>{const w=where(req.user.id,{},[req.params.id]);const row=(await pool.query(`SELECT v.*,(SELECT physical_status FROM bundles b WHERE b.id=v.uuid) AS physical_status,(SELECT version FROM bundles b WHERE b.id=v.uuid) AS version FROM inventory_view v WHERE ${w.text}`,w.values)).rows[0];if(!row)throw problem(404,'捆包不存在或不在授权范围内');const loading=(await pool.query(`SELECT coalesce(p.packing_list_no,l.code) AS loading_document_no,CASE WHEN ${require('./export-shipping.cjs').posted} THEN coalesce(l.manager_at,(SELECT max(o.departed_at) FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED' AND o.reversal_status<>'CONFIRMED')) END AS outbound_date FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id LEFT JOIN loading_plan_matches m ON m.loading_id=l.id LEFT JOIN loading_plan_documents p ON p.id=m.document_id WHERE i.bundle_id=$1 AND NOT i.plan_removed AND (i.active OR (${require('./export-shipping.cjs').posted})) AND coalesce(l.workflow_state,'LEGACY') NOT IN('REJECTED','CANCELLED') ORDER BY l.created_at DESC LIMIT 1`,[row.uuid])).rows[0];return {...row,...loading};});
 app.post('/api/v1/inventory/exports',{preHandler:[permitted('inventory:export'),csrf],config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(req,reply)=>{
 const b=req.body||{};if(!['csv','xlsx'].includes(b.format))invalid('导出格式无效');if(b.selected_ids!==undefined&&!Array.isArray(b.selected_ids))invalid('选中捆包参数无效');
 const ids=b.selected_ids?.length?b.selected_ids:undefined,w=where(req.user.id,inventoryInput(b.filters),ids),sort=order(b.sort||{});
 const rows=await transaction(pool,async c=>{const result=await c.query(`SELECT v.* FROM inventory_view v WHERE ${w.text} ORDER BY ${sort} LIMIT 10001`,w.values);if(result.rows.length>10000)throw problem(413,'单次最多导出 10000 条，请缩小筛选范围');if(ids&&result.rows.length!==new Set(ids).size)throw problem(409,'选中记录已变化或超出授权范围，请重新查询');await c.query('INSERT INTO audit_logs(actor_id,action,entity_type,after_data,request_id) VALUES($1,$2,$3,$4,$5)',[req.user.id,'inventory_export','bundles',{count:result.rows.length,format:b.format,filters:b.filters||{}},req.id]);return result.rows;});
 const headers=['数据性质','捆包编号','生产批次','货位','捆包片数','净重（吨）','库存状态','取样状态','入库日期','当前分配客户','备货单号','销售计划号','入库单号','入库确认时间','生产日期','入库操作人','备注','出库单号','车辆','离场时间','出库客户','原始毛重（吨）','包装重量（吨）','重量规则版本','重量依据','合同号','铅封号'].map(h=>require('./weight-display.cjs').headings([h],req)[0]);
 const matrix=rows.map(r=>[r.data_kind==='DEMO'?'演示数据':'业务数据',r.id,r.batch,r.location,r.sheets_per_bundle??'未录入',require('../dist/tonnes.js').format(r.weight),r.business_status||r.status,require('../dist/core.js').samplingState(r),r.date,r.current_customer||r.customer,r.allocation_code||'',r.sales_plan_code||'',r.receipt_code||'',require('./business-time.cjs').display(r.confirmed_at),r.production_date||'',r.inbound_operator||'期初未知',r.remark||'',r.outbound_code||'',r.vehicle_no||'',require('./business-time.cjs').display(r.departed_at),r.dispatched_customer||'',require('../dist/tonnes.js').format(r.gross_weight),require('../dist/tonnes.js').format(r.packaging_weight),r.weight_rule_version||'',r.weight_basis,r.contract_no||'',r.seal_no??'未录入']);
 const filename=`musonoi_${cfg.environment}_${rows.length}.${b.format}`;reply.header('Content-Disposition',`attachment; filename="${filename}"`).header('X-Export-Count',rows.length);
 if(b.format==='csv'){const clean=x=>{let s=String(x);if(/^[\s\u0000-\u001f]*[=+@\-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return reply.type('text/csv; charset=utf-8').send('\ufeff'+[headers,...matrix].map(r=>r.map(clean).join(',')).join('\r\n'));}
 const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet(cfg.environment==='test'?'库存（隔离测试）':'库存');ws.addRow(headers);for(const row of matrix){const r=ws.addRow(row);r.getCell(6).value=row[5]==='未检斤'?'未检斤':Number(row[5]);r.getCell(6).numFmt='0.0000';}for(const col of [22,23])for(let i=2;i<=rows.length+1;i++){const cell=ws.getCell(i,col);if(cell.value!==''&&cell.value!=='未检斤'){cell.value=Number(cell.value);cell.numFmt='0.0000';}}ws.columns.forEach(c=>c.width=24);ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:`AA${matrix.length+1}`};return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await wb.xlsx.writeBuffer()));
 });
 app.get('/api/v1/audit',{preHandler:permitted('audit:read')},async req=>({items:(await pool.query('SELECT a.id,a.action,a.entity_type,a.entity_id,a.before_data,a.after_data,a.occurred_at,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE $1 OR a.actor_id=$2 ORDER BY a.id DESC LIMIT 100',[req.user.permissions.includes('audit:read'),req.user.id])).rows}));
 await require('./accounts.cjs').register({app,pool,permitted,csrf});
 await AccountPolicy.register({app,pool,permitted,csrf});
 await require('./contracts.cjs')({app,pool,cfg,permitted,csrf});
 await require('./masters.cjs')({app,pool,cfg,permitted,csrf});
 await require('./receipts.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./receipt-import.cjs')({app,pool,cfg,permitted,csrf});
 await require('./allocations.cjs')({app,pool,cfg,permitted,csrf});
 if(await require('./vehicle-arrivals.cjs').enabled(pool))await require('./vehicle-arrivals.cjs').register({app,pool,permitted,csrf});
 await require('./sales-dispatch.cjs').register({app,pool,permitted,csrf});
 await require('./packing-templates.cjs').register({app,pool,permitted,csrf});
 await require('./inventory-control.cjs').register({app,pool,permitted,csrf});
 await require('./inventory-depth.cjs').register({app,pool,permitted,csrf});
 if(await require('./management.cjs').enabled(pool))await require('./management.cjs').register({app,pool,permitted,csrf,auth});
 await require('./v265.cjs').register({app,pool,permitted,csrf});
 await require('./approval-summary.cjs')({app,pool,permitted});
 await require('./bundle-history.cjs')({app,pool,cfg,permitted});
 await require('./sampling.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./weighing.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./workflow-attachments.cjs')({app,pool,cfg,permitted,csrf});
 await require('./loading.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./outbound.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./moves.cjs')({app,pool,cfg,permitted,csrf});
 await require('./stocktakes.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./v27-stocktakes.cjs')({app,pool,permitted,csrf});
 await require('./v27-corrections.cjs')({app,pool,permitted,csrf});
 await require('./v27-reliability.cjs')({app,pool,permitted,csrf});
 await require('./v27-lifecycle.cjs')({app,pool,permitted});
 await require('./exceptions.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./adjustments.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./reports.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./dashboard.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./overview.cjs').register({app,pool,permitted});
 await require('./labels.cjs')({app,pool,cfg,permitted,csrf});
 await require('./stock-map.cjs')({app,pool,cfg,permitted,csrf});
 await require('./v27-map.cjs')({app,pool,permitted});
 if(await require('./unified-loading-plans.cjs').enabled(pool))await require('./unified-loading-plans.cjs').register({app,pool,permitted,csrf});
 if(await require('./loading-plans.cjs').enabled(pool))await require('./loading-plans.cjs').register({app,pool,permitted,csrf});
 await require('./export-shipping.cjs').register({app,pool,permitted,csrf});

 await require('./v262-supplement.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./v262.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./v261.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./v26.cjs').register({app,pool,cfg,permitted,csrf});
 await require('./preferences.cjs')({app,pool,cfg,auth,csrf});
 await require('./operations.cjs')({app,pool,cfg,auth});
 // Further business modules are registered incrementally.
 await app.register(require('@fastify/static'),{root:path.join(cfg.root,'dist'),index:false});
 for(const route of ['/sales-plans','/sales-plans/*','/loading-plans','/loading-plans/*','/export-shipments','/export-shipments/*','/reports','/stocktaking','/stocktaking/*','/exceptions','/exceptions/*','/audit','/stock-map','/stock-map/*','/overview','/overview/*','/inventory','/inventory/*','/customers','/customers/*','/receipts','/receipts/*','/preparation','/preparation/*','/outbounds','/outbounds/*','/workbench','/workbench/*'])app.get(route,async(req,reply)=>{const permission=AccountPolicy.pagePermission(req.url.split('?')[0]);if(req.cookies.musonoi_session&&permission)await permitted(permission)(req);return reply.sendFile('index.html');});
 for(const legacy of ['/samples','/samples/*','/sampling','/sampling/*'])app.get(legacy,async(req,reply)=>reply.redirect('/preparation/history-sampling'));
 app.get('/',async(req,reply)=>reply.sendFile('index.html'));app.get('/demo',async(req,reply)=>reply.redirect('/overview'));
 return app;
}
module.exports={build};
if(require.main===module)build().then(app=>app.listen({host:config().host,port:config().port})).then(address=>console.log('Musonoi V3.5: '+address)).catch(e=>{console.error(e.message);process.exitCode=1;});
