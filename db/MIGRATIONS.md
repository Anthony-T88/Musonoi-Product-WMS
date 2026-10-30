# V2.6.1 增量迁移说明

在V2.6.0的49个文件之后新增042—050，共58个迁移。001—041已应用文件未编辑。当前工作TEST库已升级；生产环境未执行迁移。

| 文件 | 内容 |
|---|---|
|042_v261_lot_work|Lot流程版本、规划货位、取消依据、逐捆取样/检斤状态、不可改历史；作业期间锁定重量可NULL；旧入口边界|
|043_v261_work_actions|创建即锁定、分阶段作业、完成条件、独立主管审核、核实后取消事务函数|
|044_v261_projection|当前/规划库存投影、时间快照、新编号规则、规划延迟一致性校验|
|045_v261_cancel_history|取消检查正确读取取样/检斤历史，避免与函数参数同名冲突|
|046_v261_cancel_physical_facts|真实移动事实也必须经过取消核实|
|047_v261_catalog_locations|将既有165格编码补齐到穆松尼主仓位置主数据，不改旧A/B货位与库存，不编造容量|
|048_v261_customer_guard|创建Lot时再次锁定并检查计划客户有效性|
|049_v261_creation_boundary|升级库停用旧版新建备货快捷路径，防止绕过新Lot作业；原历史与出库保留|
|050_v261_authorized_correction|主管授权未装车的已备货Lot进入整改，保留锁定、货位和历史，再次审核|

新增lot_work_items、lot_work_history；复用allocations/allocation_items/reservations和原装车、出库实体。原inventory_view作为inventory_v26_compat保留基础，新当前视图明确展示规划、取样和最终检斤。历史快照不回写。

新Lot只有一个planned_location_id；当前正式位置在主管审核确认后统一变更。规划冲突同时看实物和其他有效Lot，使用原事务门、货位行锁及延迟约束。新流程锁定唯一索引、装车唯一索引、出库幂等不变。

当前主库仍名为musonoi_v26_development_test，避免重建/替换数据库。升级前的63表完整备份和已验证恢复库保留；本轮清理为单独显式维护程序，不是自动迁移的一部分，不在启动时运行。

隔离验证：musonoi_v26_regression_test固定至041，musonoi_v261_regression_test应用最新迁移；回归基于历史测试夹具，不克隆当前真实作业数据生成测试库存。生产部署需另行备份、验收和授权。

## V2.6.0 增量迁移历史

在V2.5.5的39个迁移文件后新增032—041，共49个迁移。只在本机新建V2.6 TEST克隆应用；原地图、UX数据库及预览库未升级。没有修改001—031已应用文件。

| 迁移 | 主要内容 |
|---|---|
|032_v26_workflow|生产流程标识、重量NULL兼容、Lot、审核/离场字段、workflow_reviews、物流经理权限、旧接口边界|
|033_v26_actions|备货检斤/锁定、独立主管审核、Lot分车、实际离场、经理出库事务函数|
|034_v26_inventory|库存业务状态/当前客户/在场标记、时间快照、驳回后的真实货位冲突报告|
|035_v26_production|固定生产客户和临时区、数据库编号/批次校验、实际货位登记|
|036_v26_operator_permissions|授权操作员备货及装车权限，不授审批权|
|037_v26_dispatch_projection|正式出库Lot汇总中的PL/pgSQL别名修正|
|038_v26_workflow_guards|已知重量聚合、旧装车/锁定入口不能绕过新流程、经理主数据读取|
|039_v26_corrections|装车纠正版关联、历史保留、未知重量约束、生产流程版本不可回退|
|040_v26_temporal_lot|备货状态时间快照、离场待审批禁止移库/改重/取样|
|041_v26_scoped_operations|保留仓库范围操作权限，拒绝空装车数组|

`bundles.net_weight/original_net_weight`和`receipt_lines.net_weight`允许新生产流程未知值；原历史值不改。numeric保留原至少6位小数存储兼容性，备货输入及快照按4位，扣包0.0025t。未知入库流水physical_delta为NULL，不伪造0重量；首次实际检斤以有依据的重量流水纳入已知重量账。

继续复用reservations的one_active_reservation、loading_items的one_active_vehicle_bundle及inventory_events的唯一出库事件。新流程函数固定search_path、撤销PUBLIC执行权并按角色/范围逐捆检查；普通应用账号无法直接改审批字段。

历史兼容验证逐表比较62张原表的全部原列和原行，128条捆包完整保留；新增表workflow_reviews后共63张业务/系统表。旧格式编号和历史毛重未知只报告，不自动修改。迁移重跑校验通过。

实际迁移命令：`node scripts/prepare-v26.cjs`创建并升级专用TEST克隆；不用于生产部署。生产环境尚未执行，正式部署前必须先备份、确认历史例外及角色授权。禁止编辑已经应用的迁移SQL。

## V2.5-UX 历史说明

在原29项迁移之后增加022—026，共34项。仅对新建的 musonoi_ux_regression_test 和 musonoi_ux_development_test 应用；原 V2.5 数据库保持29项。

| 迁移 | 变更 |
| --- | --- |
| 022_ux_contracts.sql | customer_contracts；sales_plans.contract_id；客户合同历史和新分配/锁定有效性触发器 |
| 023_ux_gross_net.sql | receipt_lines/bundles 的毛重、包装、规则；原始净重依据约束、确认入库元数据传递、库存/新历史快照投影 |
| 024_ux_weight_completeness.sql | 明确要求计量依据三字段同时为空或同时非空，堵住 NULL CHECK 三值逻辑缺口 |
| 025_ux_dispatch_contract.sql | 正式离场释放锁定后仍通过原单据链返回捆包合同号 |

| 026_ux_legacy_pending_weight.sql | 旧毛重未知的待审核单不能直接确认入库，先驳回核实后重新提交；历史档案不变 |

没有删除/覆盖业务表、回写既有库存净重或伪造历史毛重。gross_weight/packaging_weight/weight_rule_version 对旧档案保持 NULL；历史计划 contract_id 保持 NULL。历史已确认行不改；历史草稿如需继续提交，应核实毛重后编辑。不能盲目以旧净重加2.5kg迁移。

应用：node scripts/prepare-ux.cjs（只负责本机独立克隆）；单个已授权测试目标可 node scripts/db.cjs migrate musonoi_..._test。迁移整批事务与 checksum 检查继续生效。禁止修改已应用的 SQL 文件。

新业务依赖新结构；回退代码不能假设自动撤销迁移。生产回退需基于升级前备份还原到新库、核对期间增量后切换，不能 DROP 新表或覆盖已确认记录。未来正式上线必须在生产备份副本先迁移、验算历史库存、核实合同与毛重异常，再经授权切换。

本次 pg_dump/新库恢复57表及函数/触发器/约束一致；证据 test-output/ux-restore-results.json。受控重启校验见 ux-persistence-results.json。

---

# V2.5 增量迁移与隔离

在既有001–019共27个文件之后新增020_labels.sql及021_user_language.sql，最终29个迁移、56张表。旧文件及确认业务记录均未改写，仍按SHA256/事务/迁移锁校验。

| 文件 | 内容 |
| --- | --- |
| 020_labels.sql | label_jobs、label_job_items关联原bundles，label_events保留预览/打印请求/导出；不可变历史及label:print权限 |
| 021_user_language.sql | users.language_code，默认zh-CN，支持zh-CN/en；不修改业务状态代码 |

默认只迁移musonoi_inventory_v25_test，回归库musonoi_v25_regression_test；原V2.4开发/回归库保留。原库存写接口、事务、版本、幂等和审计复用，扫码没有新建绕过审批的库存写通道。操作回执查询当前账号既有idempotency_requests，不新建离线库存账。

```powershell
node scripts/db.cjs migrate musonoi_inventory_v25_test
node tests/v25-all.cjs
```

新表权限仅服务端账号，标签访问仍逐请求验证角色、创建者和当前捆包范围。二维码不含密码/权限/重量/客户。数据库密钥只在Git忽略的.env/runtime，前端不得访问数据库管理凭证。

本机56表新库恢复的数量/哈希、函数、触发器、约束一致；恢复总是新库，不DROP旧业务数据。回退需保存V2.5数据库和.env，再使用release/v2.4源码与独立恢复的旧备份；不能把旧程序直接指向升级库。生产迁移和部署未执行，具体见V2_5_RUNBOOK.md。

---
以下为原版本迁移历史，当前默认以V2.5为准。

# V2.4 增量迁移、版本记账与恢复

旧001–012文件保留不变，V2.3稳定库保留；当前默认仅TEST开发库musonoi_inventory_v24_test，回归基线musonoi_v24_regression_test。迁移按文件SHA256、事务及21001迁移锁执行，应用已存在角色不会覆盖密码。当前共27个迁移文件。

| 新增文件 | 内容 |
| --- | --- |
| 013_inventory_history.sql / 013b_trigger_records.sql | 串行记账版本、不可变库存与单据历史、开账来源、范围函数、各业务记账时点及触发器 |
| 014_stocktakes.sql / 014b_count_attachments.sql | 独立盘点快照、轮次实盘、流转核验、冻结报告、独立审批及私有附件 |
| 015_exceptions.sql / 015b_scan_alias.sql | 阈值及历史、七类异常、去重、职责/处理历史及扫描 |
| 016_adjustments.sql / 016b_adjustment_alias.sql | 独立授权调整/新反向单、原始净重保护、余额投影、调整流水和版本冲突 |
| 017_reporting_epoch.sql | 可信开账版本，拒绝伪造早于起点历史 |
| 018_control_validation.sql | 盘盈生产日期不可未来的数据库校验 |
| 019_count_exception_dimensions.sql | 同捆重量/位置同时不符分别保留异常维度 |

核心关系、权限及数据库函数见V2_4_API与完成报告。所有库存写事务先取24000记账锁，再取业务行锁；快照/报表在同锁下读取一致的截止版本，避免提交顺序与历史倒置。重量numeric(14,6)，单位吨，API十进制文本。origins+新记账流水与当前实物余额勾稽；旧无完整流水时期从升级基线开始，不反推虚构入出库。

历史表/原确认入库行/旧流水不可改删；批准库存调整仅改当前余额投影，同时写调整流水和审计。original_net_weight留原档案；ADJUSTED_OUT与正式OUTBOUND不同。反向纠错新建并重新审批，不提供DROP式降级或覆写历史。

```powershell
node scripts/db.cjs migrate musonoi_inventory_v24_test
node tests/v24-all.cjs
```

本机已执行最终迁移、重复迁移及空库重建；324项检查、真实停启及53表新库恢复通过，恢复另比较数据库函数/触发器/约束。备份/恢复只在TEST，restore-test始终新库并校验SHA256。无生产迁移授权，不可直接把这些测试命令改成生产库运行。

回退：保存V2.4库和配置，使用release/v2.3/v2.3-stable源码及升级前备份恢复到另一个库；保留V2.4库，不把旧程序直接指向已升级的新库。具体操作见V2_4_RUNBOOK.md。

---
以下为旧版本迁移历史，当前默认以V2.4为准。

# V2.3 增量迁移与业务约束

保留001–006及原V2.2数据库。V2.3开发库musonoi_inventory_v23_test，回归库musonoi_v23_regression_test，所有本次迁移和测试均为本机TEST。

| 文件 | 内容 |
| --- | --- |
| 007_sampling.sql | 新增production/commerce/security角色、细分权限、取样单/行/附件、取样事务函数及新流水类型 |
| 008_weighing.sql | 检斤/原重快照、生成净重和差异、作废留痕与零实物增量流水 |
| 009_loading.sql | 车辆装车/有效占捆、部分唯一索引、客户锁关联、装车/取消/退装事务 |
| 009b / 009c | 触发器调用检查函数及受限数据库行锁授权修复，不放开应用直接修改状态 |
| 010_outbound.sql | 出库单/节点记录、独立审批、实际离场原子扣库、出库冲销/实物退回、消耗备货与FULFILLED |
| 010b_workflow_guards.sql | 仓库范围授权、节点驳回、禁止已登记取样/检斤追加明细、未来时间证据检查 |
| 011_moves_trace.sql | 原子移库/原位置与版本、扩展库存视图的出库客户/来源/车辆/离场时间 |
| 012_position_integrity.sql | 返场/移库/入库与位置上级停用竞态保护、确认移库明细禁止追加 |

默认 `node scripts/db.cjs migrate` 现在针对V2.3隔离开发库；只允许test及受限库名。迁移沿用SHA256校验、advisory lock、同事务应用；不修改旧迁移，不提供DROP式降级。新环境按V2_3_RUNBOOK初始化，现有电脑不要再次provision或seed。

新增关系：sampling_batches→sampling_items→bundles；weighings→weighing_items→bundles；loading_orders→loading_items→reservations→allocations；outbound_orders→loading_orders/weighings，outbound_steps为不可变审批历史；stock_moves→stock_move_items→bundles。workflow_attachments按sample/weigh关联单据，服务端逐单授权。所有客户/项目/账户/位置复用原主数据。

重量numeric(14,6)，API十进制文本；净重/差异SQL生成。库存原重不可直接更改；装车、取样、检斤及移库的实物增量为0，OUTBOUND为负原重、REVERSAL为正原重。每捆每出库单的出库/冲销流水唯一。有效车辆占捆唯一，正式出库事务同时消耗客户锁与车辆占用。

业务写入统一幂等键、版本、事务和审计；敏感函数固定search_path并取消PUBLIC执行，函数重复验证角色和数据范围。应用无装车/出库状态直接UPDATE或捆包数量写权；触发器阻止历史改删、登记后追加明细及非法位置。

备份默认源已改为V2.3库。restore-test始终新建隔离库、先验SHA256；tests/restore.cjs验证全部表行数及全部表内容哈希，含附件和审批记录，并复核捆包总重。恢复不覆盖源库。还原V2.2必须配套稳定源码及其备份到新库，不得直接用旧代码操作V2.3结构。

原V2.2历史说明如下；旧默认目标和业务范围仅对应当时版本。

---

# V2.2 数据库关系、迁移与回退

当前本机：PostgreSQL 16.14，独立集群 127.0.0.1:55432。所有本次验收数据库均为 TEST；原 V2.1 `musonoi_inventory_test` 保留。当前网页连接 `musonoi_inventory_v22_test`，回归基线 `musonoi_v22_regression_test`。

## 迁移顺序与执行方式

| 文件 | 内容 |
| --- | --- |
| 001_foundation.sql | V2.1 原始项目/用户/范围/捆包/视图/审计，未改写 |
| 002_master_data.sql | 基础资料 active/version、yards、权限、幂等表、占用保护 |
| 003_receipts.sql | 入库单/行、生产日期和来源、库存流水、独立审核确认函数、待审位置占用保护 |
| 004_allocations.sql | 销售计划、备货单/选捆、有效锁；既有演示预留转 LEGACY 期初锁；更新库存视图 |
| 004b_bundle_row_lock.sql | 仅授予应用 bundles.version 更新权满足 SELECT FOR UPDATE，不授予重量/状态写权 |
| 005_inventory_history.sql | 单据、锁、计划与捆包不可变约束，流水一致性，分配客户和来源视图 |
| 006_master_relations.sql | 堆场与仓库复合关联约束、资料编码标准化约束 |

```powershell
node scripts/db.cjs migrate
# 仅对明确的隔离测试目标，也可以指定：
node scripts/db.cjs migrate musonoi_v22_regression_test
```

默认目标是 V2.2 开发测试库，脚本要求 APP_ENV=test 且库名符合限制。`schema_migrations` 记录文件名、SHA256、应用时间；advisory lock 防止同时迁移，全部待应用 SQL 和授权更新在同一事务执行。已应用文件 checksum 不符就失败，禁止改旧迁移；后续新增独立文件。重复运行无重复建表/播种。

迁移不是生产部署工具：生产连接、停机窗口、数据检查和授权应另行实施。当前不对现存业务数据执行清库、DROP、批量重建或覆盖恢复。

## 主要关系与精度

- `projects → warehouses → yards / locations`；货位所属仓库必须与堆场一致，位置/批次/客户均带项目约束。
- `users → user_scopes`；`roles → role_permissions → permissions`。会话由 sessions 保存，角色与范围服务端读取。
- `receipts → receipt_lines → bundles`；捆包来源 receipt_line 唯一，捆包编号全局唯一。确认单据保留创建/审核人、版本、生产/入库/确认时间。
- `sales_plans → allocations → allocation_items → bundles`；正式锁定记录在 `reservations`，解除记录 released_at/by/reason；一个捆仅允许一条未解除记录。
- `inventory_events` 关联捆包、入库单/备货单与人员，INBOUND 有正实物增量，LOCK/UNLOCK 的实物增量必须零。业务及 `audit_logs` 同事务写入。
- `idempotency_requests` 主键为操作者/路由/键，保存请求摘要、成功响应和时间，事务失败不写成功缓存。
- `inventory_view` 统一货权/分配客户、有效状态、来源单/时间；旧 reserved_for_customer_id 不再决定当前有效预留。
- 重量 `numeric(14,6)`，单位吨。累计重量及计划额度比较在 SQL 进行，API 十进制字符串，避免 JS 浮点累计作为业务依据。

生产日期为 DATE，Node pg 将 DATE 保留字符串，避免浏览器或服务器时区导致日期偏移。事件为 TIMESTAMPTZ；入库业务日期采用 Africa/Lubumbashi，生产日期不能晚于该业务日期。正式启用前确认此业务口径。

## 事务和数据库保护

所有新增业务写入经 `business-common.mutate`，使用事务、幂等 advisory lock 和版本校验。确认函数由数据库所有者 SECURITY DEFINER 执行，固定 search_path；只授应用执行权限，重新校验活跃审核角色、范围和创建人分离。正式捆包 INSERT 只在该函数完成。

锁定按备货单、销售计划、排序捆包加锁；唯一有效锁索引最终防止跨请求重复占用；计划行串行化防止不同捆并发超额。释放和审计、零增量流水在同一事务。服务端拒绝无权限操作，数据库同时阻止非法状态、历史改写、非零锁定实物增量、无效位置和目标额度。

应用非超级用户，没有整表捆包增删改或历史删改权限，只有 version 单列更新权用于行锁，并有版本变化保护。数据库所有者仍可管理数据库，应视为运维特权，不提供给前端或普通用户。当前授权冲销/调整流程未实现；不可通过所有者直接改历史替代业务纠错。

## 数据初始化和历史兼容

升级已有 V2.1 隔离库时，004 把既有 23 捆预留转为 LEGACY 记录，保留实物和分配，无法确认的历史操作者/时间留空。不是正式生产数据迁移。

空库执行所有迁移后，`seed-test` 只允许空 TEST 库写入128条虚构快照；`opening-snapshot.cjs` 在同一播种事务中生成相同的期初锁。没有禁用数据库触发器，没有自动把样本填入业务库。新回归库播种凭据使用独立文件，避免覆盖开发账号密码。

## 备份恢复与回退

升级前保存源码、稳定标签及数据库自定义格式 dump、SHA256。`local-db.ps1 backup` 不改源库；`restore-test` 只恢复到新命名隔离库并核对文件哈希，绝不覆盖现存库。`tests/restore.cjs` 对所有业务表行数及捆包内容/重量进行对账。

源码阶段提交可以回退；数据结构和已发生库存业务不能靠 git revert 自动回退。不提供 DROP 表或反向删除业务历史的 down 脚本。回退需恢复对应版本备份到新库，连接匹配版本源码、核对后再切换；V2.1 源码与 V2.2 库混用不属于已验收方案。

备份恢复演练在同机新库进行，非跨主机灾备。未来应补充备份加密、异机恢复、WAL/PITR、保留期限与告警。不得将本机随机凭据、dump、真实业务导出或 `.env` 纳入 Git。

## V2.4.1新增迁移

013/013b库存与单据历史版本、全局记账锁、真实历史起点；014/014b盘点快照/观察/复盘/对账/审批/附件。已应用文件不修改。

V2.4.2新增015/015b：异常规则与版本历史、异常五状态、规则扫描、盘点批准差异自动关联、责任与处理记录。

V2.4.3新增016/016b：库存调整/明细/审批记录、不可变原始档案净重、授权余额投影更正、ADJUSTED_OUT与正式OUTBOUND分开、调整流水和反向单。原已确认入库行及旧流水不改写。

V2.4.4新增017：可靠报表基线版本与不可改写起点；报表基于013历史及事件版本，出库确认时点与记账版本时间一致。

### V2.4.5 管理驾驶舱
新增 `/api/v1/dashboard` 和 `/api/v1/dashboard/details?metric=...`，均要求 dashboard:read；复用历史版本、精确十进制汇总及服务端项目/客户/仓库范围。七张指标卡与授权明细、当月趋势、库龄、客户分配及货位分布保留原查询入口。历史起点不足整月时明确标注；异常数字为已登记未关闭记录，规则扫描由授权人员发起，不宣称自动监控。实测 tests/v24-5.cjs：16项真实 PostgreSQL 检查通过，包括装车不减实物、正式离场统计、历史截止及客户权限。


## V2.5 Stock Map增量迁移027—031

基线UX为34个迁移文件，本专项新增5个，合计39个。已应用文件不编辑；本机只升级隔离地图库。数据库事务、权限及幂等复用原实现，新增的库存客户/容量约束在提交时检查最终实存。

| 文件 | 内容 |
| --- | --- |
| 027_stock_map_metadata.sql | stock_map_regions/cells/features/source、locations可空地图关联和容量字段、storage_location_locks互斥修订（非库存余额） |
| 028_storage_customer_rules.sql | 全局记账门锁24000、货位行锁/修订、DEFERRABLE最终客户/容量校验；有效备货客户优先否则货权客户 |
| 029_stock_map_binding_uniqueness.sql | 唯一解析图格索引，阻止精确P编号与显式别名重复绑定 |
| 030_stock_map_site_geometry.sql | 现场PDF165格/12辅助块的几何、SHA256和待现场核验标记，无库存/客户/容量导入 |
| 031_empty_reporting_epoch.sql | 仅初始化旧空库迁移可能缺失的报表起点，已有起点完全保留 |

容量为最大捆数和最大**净重t**，null代表未知；不是0，不填虚构数值。地图位置配置只改主数据元信息，必须版本、幂等和审计验证。已经混放的历史数据不会在迁移中被重排或改客户，新增加/改锁/释放/退装等导致不合法最终实存的事务将失败。合法移出原混放源位允许逐步整改。

原图 `Map Copper Cathodes.pdf` 不加入源码Git；几何审阅件 `db/stock-map-layout.json` 不含图中库存量/批次/客户。离线复核可运行 `python scripts/digitize-stock-map.py "Map Copper Cathodes.pdf"`（需pdfplumber）；该脚本用于数字化审阅，**不得把重新生成的已应用030文件再次覆盖部署**。布局改版应新增迁移或受控版本导入。

```powershell
# 本机既有UX基线和凭据下，创建新的隔离克隆并向克隆迁移
node scripts/prepare-map.cjs
# 可选独立可视测试业务夹具，经既有业务API入库/锁定/取样/装车
node scripts/prepare-map-preview.cjs
# 为旧业务回归建立合法货位的独立测试夹具
node scripts/prepare-map-compliant.cjs
node tests/map-all.cjs
```

合规夹具仅在新建TEST库构造：先迁至006、插入原128条虚构档案（一捆一REG货位，测试锁定明确设为两天前），再应用后续迁移，保证历史起点与不可变记录完整。旧混放128条库不修改。禁止在028之后通过直接seed插入历史混放数据。常规空库迁移不自动生成任何库存或账号。

实际恢复验收 `tests/map-recovery.cjs`：从关闭应用连接的地图流程测试库pg_dump，到全新TEST库pg_restore，逐表JSON摘要和函数定义相等，重复migrate不改变数据，另验证真正空库的39项迁移和报表起点。不停止/重启共享PG服务，不宣称已做断电或跨主机灾备。

正式部署前先在副本检查授权范围、历史混放、毛重缺失、图格编码映射与实际容量；将冲突清单交业务确认。先完整备份并验证恢复，部署须另行授权。本次没有生产迁移。回退应使用稳定代码和对应原库/核验备份，不随意删约束、删流水或覆盖已确认历史。

## V2.6.1 五账号 RBAC 增量

051_fixed_five_rbac.sql 与 052_loading_edit.sql 已应用于本机 TEST。保留历史身份，集中设置五角色上限、提交人和审计角色；TEST入库自审默认关闭。重置前完整备份已经恢复验证，业务内容未变。详细结果及恢复路径见 V2.6.1_ACCOUNTS.md。

053_receipt_nullable_submitter.sql 已应用于本机 TEST：修复历史空提交人在确认入库及审计中产生 NULL 自审标记的问题，保留未知提交人。当前共 61 条迁移，校验无漂移。备份恢复、数据保留及五角色验证见 V2.6.1_RECEIPT_FIX.md。

## V2.6.2 增量（2026-10-30）

054–059已在恢复副本验证并应用本机TEST，当前67条迁移、无漂移。054增加NULL兼容片数/铅封、装车快照、不可变元数据历史/余捆释放历史及货位独占声明；055事务批量检斤与有效铅封、货位持有及授权片数更正；056装车审核释放和当前客户投影；057审计和货位必持有校验；058仅继承最近前一Lot有效数据；059历史已审核Lot授权铅封补录及新装车铅封边界。

### V2.6.2补充060–062（当前70条迁移）

060新增创建人撤回及未审批Lot撤销，旧取消接口也受相同边界约束；保留全部业务及历史。061增加位置用途、P5公共父关联、位置策略历史和唯一P5可视区域，原165格不删除；新Lot仅可选已定位且启用的P1–P4正式位置。062禁止在未知/停用实际位置自动撤销。遇P5有效规划Lot、源图哈希或34格边界核实失败会整批拒绝迁移，不静默换位置。

本机已应用并验证：66张业务/安全/历史表原字段摘要不变、172货位档案及原165格保留，26捆、3张入库、2个Lot、5个有效账号及已知片数/重量均不变。新地图配置增量单独审计。升级前备份114644384，恢复及历史库存验证使用104925007备份的独立副本，详见`V2.6.2_SUPPLEMENT_RELEASE.md`。普通启动不迁移、Seed或重置账号。

升级前 `node scripts/validate-v262-upgrade.cjs preflight` 检查冲突；发现冲突需按报告另行处理，不自动移动、删除或改写历史。停应用、完整备份后使用原 `migrate('musonoi_v26_development_test')` 事务增量执行；普通启动不迁移。原67张表原字段摘要已核对一致，保留21捆、2张入库和2个Lot。最终备份及真实恢复记录、验证口径见 `V2.6.2_RELEASE.md`；不得在工作库运行回归夹具。
