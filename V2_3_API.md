# V2.3 API 与阶段记录

所有业务接口位于 `/api/v1`，使用既有 HttpOnly 会话、服务端角色/范围控制；POST 要求 Origin、X-CSRF-Token、Idempotency-Key，状态变化要求 version。错误为400/403/404/409；数据库故障503且不回退演示。

## V2.3.1 取样检验

- GET/POST `/samples`：列出授权最近200张批次；登记 `{project_id,customer_id,sample_date,agency,bundle_ids:[捆包编号]}`。
- GET `/samples/:id`；POST `/samples/:id/PASSED|FAILED|cancel`，内容 `{version,result}`。
- GET/POST `/samples/:id/attachments`：上传 `{filename,base64}`，仅PDF/PNG/JPEG，256KiB；GET `/samples/:id/attachments/:attachment` 强制下载，逐单授权。
- 一个取样单即一个取样批次、可含1–500捆；REGISTERED→PASSED/FAILED/CANCELLED，复检新建批次，结果不可覆盖。取样事件实物增量为0。
- 增量迁移007，附加生产/商务/安保角色与细分权限，不重复建立客户或捆包主数据。

## V2.3.2 检斤

迁移008。GET/POST `/weighings`，POST内容 `{project_id,customer_id,kind:BUNDLE|VEHICLE,vehicle_no,loading_id?,gross_weight,tare_weight,scale_no,weighed_at,bundle_ids}`。重量均为吨的十进制文本。GET `/weighings/:id`；POST `/:id/void` `{version,reason}`；附件接口同samples。单捆只允许一个捆；数据库生成净重和差异，原重不改。

## V2.3.3 装车

迁移009/009b/009c。GET/POST `/loads`：`{project_id,customer_id,vehicle_no,carrier,loading_point,loaded_at,bundle_ids}`，只选客户有效整捆锁；草稿即占用车辆捆包但不减库存。GET `/loads/:id`；POST `/:id/complete|cancel|unload` `{version,reason?}`；GET `/:id/packing-list` 下载XLSX。DRAFT→LOADED，取消或整车退装→CANCELLED并释放车辆占用，保留客户锁和历史。车辆检斤通过loading_id关联，必须已装车完成且客户/车辆匹配。

## V2.3.4 正式出库

迁移010/010b；GET/POST `/outbounds`，创建 `{loading_id,weighing_id}`，必须最新有效本车磅单且捆包完全匹配。GET `/outbounds/:id` 包含节点记录。

POST `/:id/variance-approve|packing|commerce|gate|depart|reject|cancel|reverse-request|reverse-approve|return-verify|reverse-confirm`：通用 `{version,remark}`；packing还需packing_checked，commerce需documents_checked及conditions_checked；gate需vehicle_checked、actual_departure及observed_at；depart需actual_departure；return-verify需actual_return及observed_at；reverse-confirm需actual_return。布尔值均须明确为true，离场观察时间不得早于商务通过，返场时间不得早于原离场；两者均不得晚于当前时间加1分钟。

CREATED→PACKING_CONFIRMED→COMMERCIAL_APPROVED→GATE_VERIFIED→DEPARTED。前三级可主管取消或当前节点驳回为CANCELLED；安保已观察实际离场后不得当作厂内取消。生产/商务/安保必须不同人员，生产最终确认不能由商务/安保代办。差异非零须独立主管variance-approve，不修改原重。

仅depart事务扣捆包原重、消耗有效客户锁、释放车辆占用、标记出库、写流水/审计；备货全部消耗为FULFILLED，部分消耗仍可解除剩余锁。出库冲销：REQUESTED→AUTHORIZED（不同主管）→RETURN_VERIFIED（安保观察实物退回）→CONFIRMED（生产确认）；最后一步恢复库存、原单保留为REVERSED，不自动恢复客户锁或车辆占用。已确认记录无删除接口。

## V2.3.5 移库与追溯

迁移011。GET/POST `/moves`，创建即原子确认，内容 `{project_id,customer_id,target_location_id,reason,bundle_ids}`；GET `/moves/:id` 返回原/目标货位。位置、版本及权限重新校验，有效装车占用时拒绝，流水实物增量为零。

既有 GET `/bundles/:编号/history` 新增lifecycle：入库/锁定沿用events/reservations，另含取样、检斤、装车、审批/离场、冲销和移库元数据。逐捆查询权限保持统一，不返回其他捆或整车检斤合计。明细与导出新增出库单、车辆、离场时间和出库客户；客户出库后仍可查自己的出库记录，冲销恢复可用后不保留旧客户的库存访问权。

## V2.3.6 验收与保护

迁移012补充位置并发完整性。测试运行器tests/v23-all.cjs先准备独立回归库，再执行原V2.1、六阶段V2.2、六阶段V2.3及跨客户/部分出库测试，219项明确检查；另有原型、空库重建。真实结果在test-output/v23-results.json。故障注入只对新克隆测试库生效。

新增角色创建沿用POST /users，role_code可为production、commerce、security；旧五角色保留。取样结果尚未配置自动出库门槛，商务须人工核验检验/单证及离场条件；正式应用需确认样检证书、容差与合规规则。本机版本未接真实政府/地磅/门禁系统。
