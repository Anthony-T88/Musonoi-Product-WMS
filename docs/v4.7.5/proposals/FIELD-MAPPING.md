# V4.7.5 库存详情确认稿

第 9 项和第 10 项可分别确认。方案数据取自本地合成 TEST 的已存在记录。业务单据链接指向对应的 TEST 路由，需在系统中切换到相应产品并登录。各稿可离线查看。

## 第 9 项 阴极铜库存明细详情

[打开阴极铜详情稿](copper-detail.html)。切换「在库捆包」和「已出库捆包」，可核对首页数据、关联单据、时间线和折叠档案。

| 原字段或记录 | 新版区块 | 数据来源与显示规则 |
| --- | --- | --- |
| 实物编号、产品 | 页首、当前库存信息、标识档案 | `inventory_view.id` 对应捆包编号，`uuid` 供关联使用 |
| 库存状态、当前货位 | 页首、当前库存信息、库存档案 | `business_status`、`physical_status`、`location`。位置和状态独立展示 |
| Lot 批次、客户、合同及分配 | 当前库存信息、业务关联档案 | `lot_no`、`current_customer`，授权范围内的预留记录与销售关联。多个历史批次按业务日期列出 |
| 生产日期、入库时间、捆包数、片数、铅封 | 标识档案 | `production_date`、`inbound_at`、`sheets_per_bundle`、`seal_no`。每条档案对应一捆 |
| 毛重、净重、检斤确认、重量来源 | 当前库存信息、重量档案 | `gross_weight`、`weight`、`final_weighed`，以及检斤记录。未知、待检斤、零值各用既有含义 |
| 入库、备货、取样、检斤、装车、正式出库、盘点、更正 | 关联单据、历史依据 | `/bundles/:id/lifecycle` 和 `/bundles/:id/history` 返回的实际关联。具备权限时提供单据链接 |
| 操作时间、状态变化、位置变更、人员及单据依据 | 业务记录与历史依据 | 以历史接口的 `timeline`、`events`、`lifecycle` 及 `audits` 为准。保留系统已记录的历史值 |
| 原有更正、标签及导出 | 对应业务操作区 | 现有入口按权限保留，确认稿仅展示查阅路径 |

请确认首屏字段，以及取样、检斤、更正归入历史依据的摆放方式。

## 第 10 项 氢氧化钴库存批次独立详情

[打开批次列表稿](cobalt-list.html)或[查看批次详情稿](cobalt-detail.html)。列表可筛选在库、已正式出库，详情返回可恢复列表参数。详情可通过袋号或铅封号查找记录。

| 页面区块 | 实际字段与来源 | 显示规则 |
| --- | --- | --- |
| 列表和页首摘要 | `/cobalt/stock`、`/cobalt/stock/batches/:id` 的 `preparation_batch_no`、`lifecycle_state`、`location_codes`、`bags`、`effective_net_mt` | 在库按有效货位，已正式出库的当前货位留空。袋数整数，实物净重四位 |
| 钴品位与金属量 | `co_work_batches.cobalt_grade_pct`、袋级有效净重、`co_metal_outbound.confirmed_metal_mt` | 预计量与实际确认量分列，均为五位。预计量按现有估算公式，确认量取正式确认 |
| 逐袋明细 | `bag_no`、`seal_no`、`actual_gross_kg`、`actual_net_kg`、`sampled`、`status` | 已有状态按袋展示，搜索以袋号和铅封号为条件 |
| 关联单据 | `preparation_plans.co_preparation_id`、入库备货单、装车关联中的销售计划、装车计划和正式出库装车单 | 客户来自实际业务关联。装箱单编号来自相应单证记录。权限与现有单据入口一致 |
| 业务记录 | `/cobalt/stock/history`、`co_work_events`、`co_events`、装车执行记录及正式出库记录 | 采用源事件时间、动作、人员和单据依据。缺失历史记录时留空 |
| 完整批次档案 | 备货批次与库存接口、袋级检斤、审批及现有业务关联 | 保留可追溯字段及来源，按批次标识、库存重量和业务关联分组 |

请确认独立详情的区块顺序，以及客户随销售和装车关联展示的位置。
