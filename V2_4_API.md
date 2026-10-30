# V2.4 API与状态

沿用/api/v1、会话、Origin/CSRF、服务端角色范围。所有改变业务状态的写请求必须Idempotency-Key；状态动作携带version。数据库新增全局记账串行锁与库存版本，报表与盘点按统一版本读；历史起点以前不伪造数据。版本内日界按Africa/Lubumbashi。

## 盘点

GET/POST /stocktakes：创建{project_id,warehouse_id,yard_id?,location_id?,batch_id?,assigned_to?}，完整仓库客户范围；快照含锁定及已装车未离场。
GET /stocktakes/:id：快照、当前轮结果、历轮实盘与操作历史。
POST /:id/observations：{version,entries:[{bundle_no,actual_location_id,actual_weight,remark}],source?}，实盘不改库存。
POST /:id/submit|recount|approve|reject|reconcile：{version,note,bundle_no?}。OPEN→SUBMITTED→APPROVED/REJECTED，复盘保留原快照、增加轮次。独立审批；重复实盘或未核验新到货流转不能批准。批准盘差不等于调整。
GET /:id/template、POST /:id/import-preview，返回错误行及整批entries；实际提交再次验证。
GET/POST /:id/attachments及GET /:id/attachments/:attachment：私有PDF/PNG/JPEG≤256KiB，批准后冻结上传。

## 异常

GET/POST /exceptions，手工登记{project_id,warehouse_id,bundle_no?,category,description}；GET /exceptions/:id。
POST /exceptions/scan {project_id}：按服务器规则扫描长期锁定、装车逾期、检斤差异、位置及流水勾稽；未关闭相同来源去重。盘点批准的盘差自动创建关联异常。
POST /exceptions/:id/investigate|submit|resolve|reject|close {version,note,responsible_id?}，NEW→INVESTIGATING→PENDING→RESOLVED→CLOSED，处理批准须与提交人不同。
GET /exception-rules/:project；POST /exception-rules {project_id,version,locked_days,loaded_hours,weight_tolerance}（十进制文本，仅管理员），保留阈值历史。扫描需要完整项目客户范围；不在前端判定规则。
附件接口同盘点，已处理/关闭后冻结。

## 调整

GET/POST /adjustments：{project_id,exception_id,reason,lines:[{kind:GAIN|LOSS|WEIGHT|LOCATION,bundle_no,net_weight?,location_id?,batch_id?,customer_id?,production_date?}]}。原值、版本由数据库取，不接受客户端伪造；完整项目客户范围，关联异常必须未完成，最多100捆。
GET /adjustments/:id；POST /:id/submit|approve|reject {version,note}：DRAFT→PENDING→APPLIED/REJECTED。所有调整独立审批，高风险不得自审；已锁定/装车/正式出库捆包不得直接调整。
POST /:id/reverse {exception_id,reason} 新建DRAFT反向单，再提交并独立批准；原单保持不变。RESTORE仅通过盘亏反向单使用，正式OUTBOUND须走V2.3真实返场。
档案original_net_weight、原入库明细与原流水不可改写；当前bundles.net_weight是余额投影，由批准事务修改并写带符号调整流水。盘亏为ADJUSTED_OUT，查询状态“已调整移出”，不冒充车辆正式离场。
附件接口同盘点；批准时冻结附件摘要。

## 报表

GET /reports?type=daily|monthly|allocations|flows|samples|vehicles|locations|stocktakes|exceptions&from=YYYY-MM-DD&to=YYYY-MM-DD&as_of=带时区ISO（可选）。支持project_id/customer_id/warehouse_id/yard_id/location_id/batch_id/allocated_customer_id组合筛选。
统一summary含期初、入库、正式离场、返场、调整、范围流转、开账、期末和勾稽差额，重量均十进制文本（吨）。库存分布按截止时点，日报/月报按Africa/Lubumbashi日界；正式离场按V2.3生产最终confirmed_at对应的记账版本。
早于可靠历史起点的截止返回422；跨越起点返回partial和实际覆盖起点，不能声称完整历史日报。未来截止拒绝，单次最多367日/10000行。单据统计保留整单授权和完整捆包匹配筛选，盘点统计按授权捆包汇总。
POST /reports/export，body同查询；额外要求inventory:export和CSRF，Excel含数据性质、口径和截止版本。前端自动把预览截止时点带入导出，防止导出时新业务改变同份报表。

### V2.4.5 管理驾驶舱
新增 `/api/v1/dashboard` 和 `/api/v1/dashboard/details?metric=...`，均要求 dashboard:read；复用历史版本、精确十进制汇总及服务端项目/客户/仓库范围。七张指标卡与授权明细、当月趋势、库龄、客户分配及货位分布保留原查询入口。历史起点不足整月时明确标注；异常数字为已登记未关闭记录，规则扫描由授权人员发起，不宣称自动监控。实测 tests/v24-5.cjs：16项真实 PostgreSQL 检查通过，包括装车不减实物、正式离场统计、历史截止及客户权限。

## V2.4.6 验收补充与限制

盘盈日期由数据库检查不得未来；捆包生命周期追加盘点与调整元数据，不返回越权整单。盘点批准支持同捆重量与位置双维异常。GET /dashboard与/details支持to、as_of及报表同样UUID筛选；metric=physical/available/locked/loaded/inbound/outbound/exceptions。服务端汇总、范围与截止版本统一，所有详情须dashboard:read。

当前全项目记账锁优先保证顺序一致，限制吞吐。盘点要求完整仓库客户范围，调整/阈值扫描要求完整项目范围。规则扫描按需发起；没有后台定时告警。POST报表导出和实盘预览是读口径，不改变业务余额，不套用业务状态幂等保存；导出写审计。实际324项检查、真实停启/53表恢复及浏览器验证见VALIDATION与V2_4_COMPLETION。
