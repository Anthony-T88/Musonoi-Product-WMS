# V3.5 接口说明

基础前缀 /api/v1，使用HttpOnly会话及CSRF验证，写操作保留事务、版本和幂等校验。授权在服务端执行。

- /receipts：入库草稿、提交、确认及驳回；取样和最终检斤仍由既有备货接口执行。
- /v34/lists/plans：销售清单，新增shipment_month、planned_net_weight、outbound_net_weight，复用既有发运统计。preparation_month仍为权威月份字段。
- /shipping/plans/:id：销售履约；outbound_no显示对应装箱单号，内部loading_code保留。
- /stock-map/pdf-data：同一实时地图查询，要求inventory:export及数据范围；无独立库存表。
- /loading-plans/arrivals：实际到达时间与登记运输信息；计划选择沿用现有授权。
- /customers/:id/transport-book：读取、保存、修改及停用记录簿，保持版本和客户范围校验。
- /inventory/exports、/reports/export、/v34/reports/export：Excel固定字段随当前用户language_code转换，业务标识和值不翻译。
- /receipts/template、/v26/receipts/template、/v33/stocktakes/:id/template：中英文模板均可导回，服务端重新校验。
- /shipping/:id/packing-list.xlsx：正式单证历史字节不变；重新生成应用最新模板修复。
- /v27/audit：系统审计；捆包history/timeline及单据作业记录展示业务追溯，原始代码及证据不改写。

历史API命名空间继续兼容；内部主键、数据库字段和既有数量扣减流程不重构。权限及状态要求继续按原接口执行。
