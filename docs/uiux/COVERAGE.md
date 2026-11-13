# 全站界面覆盖与验收

V4.8.0 复核了路由切换、批次号译名、铜钴总览、钴地图、权限页和历史报表。权限页仅展示角色与功能权限，账户授权继续约束数据读取。报表改版另见[确认稿](../v4.8.0/统计报表改版确认稿.md)。

| V4.7.9 受影响页面 | 共用组件和验证范围 |
| --- | --- |
| 铜钴库存地图 `/stock-map` | `StockMapReview`，桌面与 390 px、中英文、铜货位卡和钴全景。 |
| 铜钴信息总览 `/overview` | 共用筛选栏、图表悬浮数据和钴指标卡。 |
| 铜钴库存明细 `/inventory` | 原表的备注和真实入库日期。用历史入库日期缺失及日期有据的记录复验。 |
| 单据列表及操作页 | `DocumentDrafts` 接入既有表格。草稿保存、续填和权限用例覆盖备货、入库、装车、盘点、许可证及车辆登记。 |
| 共用页面标题 | `Router` 的「返回上一页」位于页首左侧，已有明确返回入口按页面原有目标办理。 |

V4.7.7 增量覆盖见[全站页面排查清单](../v4.7.7/页面排查清单.md)。新增系统管理员专用历史台账列表和单据详情路由。库存筛选、空侧栏与数据列对齐使用公共规则，地图和历史台账分别保留原业务权限边界。

V4.7.6 增量覆盖见[版本验收报告](../v4.7.6/验收报告.md)。新增钴批次档案路由 `/inventory/:id/archive`，保留原库存作业路由。铜捆包档案沿用 `/inventory/:id`。备货计划、账户新建弹窗、单证办理、出门证打印和草稿续填使用该版本的独立 TEST 证据。

## 实施与验证

- 改造前基线为 V4.7.4-ui1，提交 `cdbd9e6`。改造保留 V4.7.4 和数据库迁移 186，前端修订为 V4.7.4-ui2。基线和候选均在本地合成 TEST 验证。
- 公共主题为 [uiux-governance.css](../../dist/uiux-governance.css)。页面、表单和表格复用 [UI46Pages](../../dist/ui46-pages.js)。状态复用 [UI.status](../../dist/ui.js)，待办复用 [UnifiedNavigation](../../dist/navigation.js)，审批弹窗复用 [OperationConfirm](../../dist/confirm-ui.js)，整页反馈复用 [System46](../../dist/system46.js)，只读预览使用 [OperationWorkspace](../../dist/operation-workspace.js)。
- 先核对许可证列表、销售详情和备货计划办理，再推广到共享页面骨架、按钮、筛选、表格、状态、指标和反馈。共享选择器覆盖旧页面，页面专用字段及操作规则由业务组件保留。已修复备货计划退回意见未传入提交处理的问题。
- 改造前扫描 860 次，截图 498 张。候选扫描 124 个路由场景，注册路由 140 条（按产品），完成 1412 次检查，截图 694 张。实际页面 1382 次，权限与退役入口 30 次。采用中英文、铜钴和代表性授权账号。
- 1280×800、1440×900、390×844 检查管理员可访问的页面及注册弹窗，核心页还检查 1366×768、1920×1080。业务账号按矩阵验证各自权限和状态。各行列出的角色为实际检查样本。
- 同一代码提交 `635c159` 通过源码校验、静态门禁、137 项发布回归、快速和完整布局门禁。快速检查 134 次。键盘、审批、预览和导出操作 31 项。
- 许可证筛选在铜钴和中英文下实测。1280 和 1440 像素时字段与查询重置按钮等高、同排，筛选和表格两端对齐。390 像素时按组换行，操作保持可达。页内切换语言后页面正常重绘，有未保存资料时可取消切换并保留已填值。
- 扫描源文件与权限矩阵见 [路由及角色登记](../../tests/release/uiux-routes.cjs)、[必测矩阵](../../tests/release/uiux-matrix.cjs) 和 [锁定路由](../../tests/release/uiux-inventory.json)。

## 改造前后截图

| 页面 | 1440 像素改前 | 1440 像素改后 | 1280 像素 | 390 像素 |
| --- | --- | --- | --- | --- |
| 铜许可证列表 | [查看](../../.runtime/design-before/export-licenses_CU_CATHODE_zh-CN_admin_1440.png) | [查看](../../.runtime/design-polish/export-licenses_CU_CATHODE_zh-CN_admin_1440.png) | [查看](../../.runtime/design-polish/export-licenses_CU_CATHODE_zh-CN_admin_1280.png) | [查看](../../.runtime/design-polish/export-licenses_CU_CATHODE_zh-CN_admin_390.png) |
| 钴许可证列表（英文） | [查看](../../.runtime/design-before/export-licenses_CO_HYDROXIDE_en_admin_1440.png) | [查看](../../.runtime/design-polish/export-licenses_CO_HYDROXIDE_en_admin_1440.png) | [查看](../../.runtime/design-polish/export-licenses_CO_HYDROXIDE_en_admin_1280.png) | [查看](../../.runtime/design-polish/export-licenses_CO_HYDROXIDE_en_admin_390.png) |
| 铜销售计划详情 | [查看](../../.runtime/design-before/cu-sales-detail_CU_CATHODE_zh-CN_admin_1440.png) | [查看](../../.runtime/design-verified/full/cu-sales-detail_CU_CATHODE_zh-CN_admin_1440.png) | [查看](../../.runtime/design-verified/full/cu-sales-detail_CU_CATHODE_zh-CN_admin_1280.png) | [查看](../../.runtime/design-verified/full/cu-sales-detail_CU_CATHODE_zh-CN_admin_390.png) |
| 钴销售计划详情（英文） | [查看](../../.runtime/design-before/co-sales-detail_CO_HYDROXIDE_en_admin_1440.png) | [查看](../../.runtime/design-verified/full/co-sales-detail_CO_HYDROXIDE_en_admin_1440.png) | [查看](../../.runtime/design-verified/full/co-sales-detail_CO_HYDROXIDE_en_admin_1280.png) | [查看](../../.runtime/design-verified/full/co-sales-detail_CO_HYDROXIDE_en_admin_390.png) |
| 铜备货计划办理 | [查看](../../.runtime/design-before/cu-work-plan-detail_CU_CATHODE_zh-CN_admin_1440.png) | [查看](../../.runtime/design-polish/cu-work-plan-detail_CU_CATHODE_zh-CN_admin_1440.png) | [查看](../../.runtime/design-polish/cu-work-plan-detail_CU_CATHODE_zh-CN_admin_1280.png) | [查看](../../.runtime/design-polish/cu-work-plan-detail_CU_CATHODE_zh-CN_admin_390.png) |
| 钴备货计划办理（英文） | [查看](../../.runtime/design-before/co-work-plan-detail_CO_HYDROXIDE_en_admin_1440.png) | [查看](../../.runtime/design-polish/co-work-plan-detail_CO_HYDROXIDE_en_admin_1440.png) | [查看](../../.runtime/design-polish/co-work-plan-detail_CO_HYDROXIDE_en_admin_1280.png) | [查看](../../.runtime/design-polish/co-work-plan-detail_CO_HYDROXIDE_en_admin_390.png) |

截图使用合成业务数据，比较界面结构与交互。地图画布方案仍按铜钴分别确认。

## 逐路由记录

| 场景 | 路由 | 产品 | 角色样本 | 组件 | 实际页面 / 拒绝 / 待处理 | 专用布局 |
| --- | --- | --- | --- | --- | --- | --- |
| login | `/` | 公共 | 访客 | 公共主题 | 10 / 0 / 0 | — |
| register-dialog | `/` | 公共 | 访客 | 弹窗 | 6 / 0 / 0 | — |
| overview | `/overview` | 铜、钴 | 管理员、销售员、物流经理、现场操作员、现场主管、生产经理、生产操作员、客户范围管理员 | 筛选、表单、表格、指标 | 48 / 0 / 0 | — |
| todo | `/overview` | 铜、钴 | 管理员、销售员、物流经理 | 筛选、表格 | 20 / 0 / 0 | — |
| overview-detail | `/overview/details` | 铜、钴 | 管理员 | 骨架、表格、筛选 | 12 / 0 / 0 | — |
| warnings | `/overview/warning-settings` | 铜 | 管理员 | 公共主题 | 6 / 0 / 0 | — |
| inventory | `/inventory` | 铜、钴 | 管理员、生产操作员、客户范围管理员 | 筛选、表格、状态、指标、反馈 | 28 / 0 / 0 | — |
| cu-bag | `/inventory/:id` | 铜 | 管理员 | 表格 | 6 / 0 / 0 | — |
| cu-bag-history | `/inventory/:id/history` | 铜 | 管理员 | 表格 | 6 / 0 / 0 | — |
| co-stock-detail | `/inventory/:id` | 钴 | 管理员 | 筛选、表格 | 10 / 0 / 0 | — |
| co-stock-history-alias | `/inventory/:id/history` | 钴 | 管理员 | 筛选、表格 | 6 / 0 / 0 | — |
| map | `/stock-map` | 铜、钴 | 管理员 | 筛选 | 20 / 0 / 0 | 地图画布按方案确认 |
| map-move | `/stock-map/relocate` | 铜 | 管理员 | 表单、表格 | 6 / 0 / 0 | 地图画布按方案确认 |
| customers | `/customers` | 铜、钴 | 管理员、销售员、客户范围管理员 | 公共主题 | 28 / 0 / 0 | — |
| co-customer-edit | `/customers` | 钴 | 管理员 | 公共主题 | 6 / 0 / 0 | — |
| co-contract-edit | `/customers` | 钴 | 管理员 | 公共主题 | 6 / 0 / 0 | — |
| master | `/customers/master-data` | 铜 | 管理员 | 骨架、筛选、表格 | 6 / 0 / 0 | — |
| master-customers-new | `/customers/master-data/customers/new` | 铜 | 管理员 | 弹窗 | 6 / 0 / 0 | — |
| master-customers-edit | `/customers/master-data/customers/:id` | 铜 | 管理员 | 弹窗 | 6 / 0 / 0 | — |
| master-batches-new | `/customers/master-data/batches/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-batches-edit | `/customers/master-data/batches/:id` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-warehouses-new | `/customers/master-data/warehouses/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-warehouses-edit | `/customers/master-data/warehouses/:id` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-yards-new | `/customers/master-data/yards/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-yards-edit | `/customers/master-data/yards/:id` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-locations-new | `/customers/master-data/locations/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| master-locations-edit | `/customers/master-data/locations/:id` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| cu-contract-new | `/customers/contracts/new` | 铜 | 管理员 | 公共主题 | 6 / 0 / 0 | — |
| cu-contract-detail | `/customers/contracts/:id` | 铜 | 管理员 | 表格 | 6 / 0 / 0 | — |
| cu-contract-edit | `/customers/contracts/:id/edit` | 铜 | 管理员 | 公共主题 | 6 / 0 / 0 | — |
| sales | `/sales-plans` | 铜、钴 | 管理员、销售员、客户范围管理员、销售经理、商务经理 | 骨架、筛选、表格、指标 | 36 / 0 / 0 | — |
| export-licenses | `/export-licenses` | 铜、钴 | 管理员、销售员、现场操作员、生产操作员、商务经理 | 骨架、筛选、表单、表格、状态、指标、反馈 | 32 / 4 / 0 | — |
| export-licenses-filtered | `/export-licenses` | 铜、钴 | 管理员 | 骨架、筛选、表单、表格、状态、指标 | 20 / 0 / 0 | — |
| legacy-export-licenses | `/export-licenses` | 铜、钴 | 管理员 | 骨架、筛选、表格 | 12 / 0 / 0 | — |
| export-license-new | `/export-licenses/new` | 铜、钴 | 管理员 | 骨架、表单 | 20 / 0 / 0 | — |
| cu-export-license | `/export-licenses/:id` | 铜 | 管理员 | 骨架、表单、表格、状态 | 10 / 0 / 0 | — |
| co-export-license | `/export-licenses/:id` | 钴 | 管理员 | 骨架、表单、表格、状态 | 10 / 0 / 0 | — |
| cu-export-license-edit | `/export-licenses/:id/edit` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| co-export-license-edit | `/export-licenses/:id/edit` | 钴 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| sales-new | `/sales-plans/new` | 铜、钴 | 管理员、销售员 | 骨架、表单 | 16 / 0 / 0 | — |
| cu-sales-detail | `/sales-plans/:id` | 铜 | 管理员 | 骨架、表单、表格、状态、指标 | 10 / 0 / 0 | 共用单据页眉 |
| cu-sales-edit | `/sales-plans/:id/edit` | 铜 | 管理员 | 骨架、表单、表格、状态、指标 | 6 / 0 / 0 | — |
| cu-dispatch | `/sales-plans/:id/dispatch` | 铜 | 管理员、物流经理 | 骨架、表单、指标 | 12 / 0 / 0 | — |
| co-sales-detail | `/sales-plans/:id` | 钴 | 管理员 | 骨架、表单、表格、状态、指标 | 10 / 0 / 0 | 共用单据页眉 |
| co-sales-edit | `/sales-plans/:id/edit` | 钴 | 管理员 | 骨架、表单、表格、状态、指标 | 6 / 0 / 0 | — |
| co-dispatch | `/sales-plans/:id/dispatch` | 钴 | 管理员、物流经理 | 骨架、表单、表格、指标 | 12 / 0 / 0 | — |
| cu-sales-shipping | `/sales-plans/:id/shipping` | 铜 | 管理员 | 骨架、表格、指标、反馈 | 6 / 0 / 0 | — |
| legacy-sales-new | `/preparation/plans/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| legacy-sales-edit | `/preparation/plans/:id/edit` | 铜 | 管理员 | 骨架、表单、表格、状态、指标 | 6 / 0 / 0 | — |
| legacy-sales-shipping | `/preparation/plans/:id/shipping` | 铜 | 管理员 | 骨架、表格、指标、反馈 | 6 / 0 / 0 | — |
| receipts | `/receipts` | 铜、钴 | 管理员、现场操作员、现场主管、生产经理 | 筛选、表格、状态、指标、预览、骨架、反馈 | 28 / 4 / 0 | 列表与只读预览 |
| receipt-new | `/receipts/new` | 铜、钴 | 管理员、现场操作员 | 骨架、表单、表格、反馈、筛选、状态 | 22 / 2 / 0 | — |
| cu-receipt | `/receipts/:id` | 铜 | 管理员 | 骨架、表格、指标 | 6 / 0 / 0 | — |
| cu-receipt-edit | `/receipts/:id/edit` | 铜 | 管理员 | 骨架、表单、表格 | 6 / 0 / 0 | — |
| cu-receipt-import | `/receipts/import` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| co-prep | `/receipts/:id` | 钴 | 管理员 | 表格、指标 | 10 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-prep-work | `/receipts/:id` | 钴 | 管理员、现场操作员、现场主管 | 表格、指标 | 14 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-prep-draft | `/receipts/:id` | 钴 | 管理员 | 表格 | 6 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-prep-alias | `/receipts/:id/work` | 钴 | 管理员 | 表格、指标 | 6 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| preparation | `/preparation` | 铜、钴 | 管理员、现场操作员、现场主管 | 筛选、表格、状态、指标、预览 | 28 / 0 / 0 | 列表与只读预览 |
| preparation-new | `/preparation/new` | 铜、钴 | 管理员 | 骨架、筛选、表格、状态 | 12 / 0 / 0 | — |
| preparation-plans | `/preparation/work-plans` | 铜、钴 | 管理员、物流经理、现场操作员、出口主管 | 骨架、筛选、表格、状态 | 32 / 0 / 0 | — |
| cu-work-plan-detail | `/preparation/work-plans/:id` | 铜 | 管理员 | 骨架、状态 | 10 / 0 / 0 | 共用单据页眉 |
| co-work-plan-detail | `/preparation/work-plans/:id` | 钴 | 管理员 | 骨架、状态 | 10 / 0 / 0 | 共用单据页眉 |
| cu-preparation-from-plan | `/preparation/new` | 铜 | 管理员 | 骨架、表单、表格 | 10 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-preparation-from-plan | `/receipts/new` | 钴 | 管理员 | 骨架、表单 | 10 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| cu-lot | `/preparation/:id` | 铜 | 管理员 | 骨架、表格、反馈 | 10 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-preparation-alias | `/preparation/:id` | 钴 | 管理员 | 表格、指标 | 6 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-work-alias | `/preparation/:id/work` | 钴 | 管理员 | 表格、指标 | 6 / 0 / 0 | — |
| cu-sampling | `/preparation/history-sampling` | 铜 | 管理员 | 骨架、反馈 | 0 / 2 / 0 | 历史入口与拒绝检查 |
| cu-sampling-detail | `/preparation/history-sampling/:id` | 铜 | 管理员 | 骨架、反馈 | 0 / 2 / 0 | 历史入口与拒绝检查 |
| cu-weighings | `/outbounds/weighings` | 铜 | 管理员 | 骨架、反馈 | 0 / 2 / 0 | 历史入口与拒绝检查 |
| cu-weigh-new | `/outbounds/weighings/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| cu-weigh | `/outbounds/weighings/:id` | 铜 | 管理员 | 骨架、反馈 | 0 / 2 / 0 | 历史入口与拒绝检查 |
| arrivals | `/loading-plans` | 铜、钴 | 管理员、物流经理、现场操作员 | 骨架、筛选、表单、表格、指标 | 28 / 0 / 0 | — |
| cu-arrival | `/loading-plans` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| co-arrival | `/loading-plans` | 钴 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| loading-search | `/loading-plans/query` | 铜、钴 | 管理员 | 骨架、筛选、表单、表格、状态、指标 | 20 / 0 / 0 | — |
| loading-new | `/loading-plans/new` | 铜、钴 | 管理员 | 骨架、表单 | 12 / 0 / 0 | — |
| cu-plan-group | `/loading-plans/:id` | 铜 | 管理员 | 骨架 | 6 / 0 / 0 | — |
| cu-plan-group-edit | `/loading-plans/:id/edit` | 铜 | 管理员 | 骨架、表格 | 6 / 0 / 0 | — |
| cu-plan-group-cancel | `/loading-plans/:id/cancel` | 铜 | 管理员 | 骨架 | 6 / 0 / 0 | — |
| cu-plan-order-new | `/loading-plans/:id/orders/new` | 铜 | 管理员 | 骨架、表格 | 6 / 0 / 0 | — |
| cu-loading-plan | `/loading-plans/orders/:id` | 铜 | 管理员 | 骨架、表格 | 10 / 0 / 0 | — |
| cu-loading-plan-edit | `/loading-plans/orders/:id/edit` | 铜 | 管理员 | 骨架、表格、反馈 | 6 / 0 / 0 | — |
| cu-loading-plan-cancel | `/loading-plans/orders/:id/cancel` | 铜 | 管理员 | 骨架、表格 | 6 / 0 / 0 | — |
| co-loading-plan | `/loading-plans/orders/:id` | 钴 | 管理员 | 骨架、表格 | 10 / 0 / 0 | — |
| co-loading-edit | `/loading-plans/:id/edit` | 钴 | 管理员 | 骨架、表单、表格、指标 | 6 / 0 / 0 | — |
| co-loading-execution | `/loading-plans/execution/:id` | 钴 | 管理员 | 骨架、表单、表格、指标、反馈 | 6 / 0 / 0 | — |
| outbounds | `/outbounds` | 铜、钴 | 管理员、物流经理、生产经理 | 筛选、表格、状态、指标、预览 | 28 / 0 / 0 | 列表与只读预览 |
| outbound-vehicles | `/outbounds` | 铜、钴 | 管理员、销售员、销售经理 | 表格 | 28 / 0 / 0 | — |
| printers | `/outbounds` | 铜、钴 | 管理员 | 骨架、表单、反馈 | 12 / 0 / 0 | — |
| templates | `/outbounds/templates` | 铜、钴 | 管理员 | 骨架、表单 | 12 / 0 / 0 | 单证、打印和预览 |
| weight-settings | `/outbounds/weight-settings` | 铜、钴 | 管理员 | 骨架、表单 | 12 / 0 / 0 | — |
| cu-loads | `/outbounds/loads` | 铜 | 管理员 | 骨架、筛选、表格、状态 | 6 / 0 / 0 | — |
| cu-load-new | `/outbounds/loads/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| cu-load-detail | `/outbounds/loads/:id` | 铜 | 管理员 | 骨架、表格、状态 | 10 / 0 / 0 | — |
| cu-load-matching | `/outbounds/loads/:id/matching` | 铜 | 管理员 | 骨架、表格、反馈 | 6 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| cu-outbound-detail | `/outbounds/:id` | 铜 | 管理员 | 骨架 | 6 / 0 / 0 | — |
| co-outbound-detail | `/outbounds/:id` | 钴 | 管理员 | 骨架、表单、表格、指标、反馈 | 10 / 0 / 0 | — |
| cu-corrections | `/outbounds/corrections` | 铜 | 管理员 | 筛选、表格、状态、指标、预览 | 6 / 0 / 0 | — |
| cu-correction-detail | `/outbounds/corrections/:id` | 铜 | 管理员 | 骨架、表格、状态 | 6 / 0 / 0 | — |
| cu-packing-legacy | `/outbounds/packing-list/:id` | 铜 | 管理员 | 骨架、表格 | 6 / 0 / 0 | 单证、打印和预览 |
| co-packing | `/outbounds/:id/packing-list` | 钴 | 管理员 | 骨架、表单、表格、指标 | 10 / 0 / 0 | 单证、打印和预览 |
| shipping | `/export-shipments` | 铜、钴 | 管理员 | 筛选、表格、状态、指标、预览 | 20 / 0 / 0 | — |
| cu-invoice | `/export-shipments/:id` | 铜 | 管理员 | 骨架、表格 | 10 / 0 / 0 | 单证、打印和预览 |
| metal | `/cobalt-metal` | 钴 | 管理员、物流经理、生产经理 | 骨架、筛选、表格、指标 | 14 / 0 / 0 | — |
| metal-outbound | `/cobalt-metal` | 钴 | 管理员 | 骨架、筛选、表格、指标 | 10 / 0 / 0 | — |
| metal-confirmations | `/cobalt-metal` | 钴 | 管理员 | 骨架、筛选、表格、指标 | 10 / 0 / 0 | — |
| stocktakes | `/stocktaking` | 铜、钴 | 管理员、现场主管、生产经理 | 骨架、筛选、表单、表格、状态、反馈 | 24 / 4 / 0 | — |
| stocktake-new | `/stocktaking/new` | 铜、钴 | 管理员 | 骨架、表单 | 12 / 0 / 0 | — |
| cu-stocktake | `/stocktaking/:id` | 铜 | 管理员 | 骨架、表格、状态、反馈 | 6 / 0 / 0 | — |
| co-stocktake | `/stocktaking/:id` | 钴 | 管理员 | 骨架、表单、表格、指标 | 6 / 0 / 0 | — |
| adjustment | `/stocktaking/adjustments/:id` | 铜 | 管理员 | 骨架、表格、反馈 | 6 / 0 / 0 | — |
| reports | `/reports` | 铜、钴 | 管理员、物流经理 | 筛选、表格 | 24 / 0 / 0 | — |
| reports-outbound | `/reports` | 铜、钴 | 管理员 | 筛选、表格 | 12 / 0 / 0 | — |
| reports-inventory | `/reports` | 铜、钴 | 管理员 | 筛选、表格 | 12 / 0 / 0 | — |
| reports-monthly | `/reports` | 铜、钴 | 管理员 | 筛选、表格 | 12 / 0 / 0 | — |
| workbench | `/workbench` | 铜、钴 | 管理员 | 骨架 | 12 / 0 / 0 | — |
| accounts | `/workbench/accounts` | 铜、钴 | 管理员 | 骨架、筛选、表格 | 20 / 0 / 0 | — |
| permissions | `/workbench/permissions` | 铜、钴 | 管理员、生产操作员、限权角色管理 | 骨架、表格、反馈 | 24 / 4 / 0 | 权限矩阵 |
| diagnostics | `/workbench/diagnostics` | 铜、钴 | 管理员 | 骨架、表格 | 12 / 0 / 0 | — |
| former-design-entry | `/workbench/design` | 铜、钴 | 管理员 | 骨架 | 12 / 0 / 0 | — |
| audit | `/audit` | 铜、钴 | 管理员、生产操作员 | 骨架、筛选、表格、反馈 | 20 / 4 / 0 | — |

## 可复验证据

- [改造前覆盖](../../.runtime/design-before/coverage.json) · [候选覆盖](../../.runtime/design-verified/full/coverage.json)
- [验收退出码](../../.runtime/design-verified/exits.json) · [业务、浏览器及布局日志](../../.runtime/design-verified.log) · [最终快速扫描](../../.runtime/design-quick-final/coverage.json) · [快速门禁](../../.runtime/design-quick-layout-final.log)
- 首轮操作验收出现英文权限页新增角色弹窗等待超时。明确新增按钮类型后在第二套隔离样本中通过键盘开启、关闭与焦点归还检查。长数字显示及备货记录间距调整后重跑快速视觉门禁。
- [操作结果](../../.runtime/design-workflows-final/workflows.json) · [筛选对齐实测](../../.runtime/design-pilot-proof.log)
- [铜备货计划字段校验](../../.runtime/release-tests/wms-preparation-validation-CU_CATHODE.png) · [钴备货计划字段校验](../../.runtime/release-tests/wms-preparation-validation-CO_HYDROXIDE.png)
- [铜入库只读预览](../../.runtime/design-workflows-final/preview-CU_CATHODE-zh-CN.png) · [钴窄屏入库预览](../../.runtime/design-workflows-final/preview-CO_HYDROXIDE-en.png)
- [运行说明](VISUAL.md) · [提交门禁](QUALITY.md) · [设计规范](DESIGN.md)

图表、地图画布及单证输出保留业务专用布局。验证使用登记的业务状态及代表角色，涵盖该版本必测矩阵。

## V4.7.5 验收补充

| 页面 | 场景 |
| --- | --- |
| `/stock-map` | 铜钴实际货位定位、空位、占用、暂存、画布缩放、窄屏堆叠详情与长值 |
| `/workbench/historical-movements` | 管理员上传铜钴混合装箱单、逐张预览、重传、确认及查看记录，普通账号直接访问拒绝 |
| `/inventory/historical/:id` | 铜捆包与钴备货批次档案、发运日期、逐件重量和关联单据 |
| `/receipts/historical`、`/loading-plans/historical`、`/outbounds/historical` | 旧列表地址转入原业务列表。既有详情地址继续按原模块权限访问。 |
| `/overview`、`/inventory`、`/receipts`、`/loading-plans/query`、`/outbounds` | V4.7.8-ui3 铜钴历史数据进入现有图表、指标和单据表格。列表沿用原筛选、排序、分页和只读详情。 |
| `/sales-plans` | 两产品履约进度、数值排序及一致列对齐 |
| `/preparation/new`、`/receipts/new` | 选取可执行备货计划、直接带入计划和权限拒绝 |
| `/outbounds?view=departures` | 出门证内打印配置与独立打印，历史打印入口转到出厂列表 |
| `/workbench/accounts?registrations=pending` | 注册申请审批待办、单角标和审批后刷新 |
| `/stocktaking` | 两产品编号、类型、时期、创建日期与状态组合筛选 |
