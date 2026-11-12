# 穆松尼 WMS V4.7.5 本地 TEST 交付

- 基线为 V4.7.4-ui2，`feature/v4.7.4-workflows` 的 `2c0ce92`。本次开发分支为 `feature/v4.7.5`，页面修订 `4.7.5-ui1`。
- 数据库变更为迁移 [187_v475_stocktake_periods.sql](../../db/migrations/187_v475_stocktake_periods.sql)。验证使用本机隔离 TEST。第 9、10 项各有独立确认稿。

## 变更与验收证据

| 项目 | 实施内容 | 本地 TEST 证据 |
| --- | --- | --- |
| 1. 数量整数 | 复用 `CountValues` 规范总览、报告、数量列、打印预览及 Excel 中适用数量。保留空值、零值及重量精度。真实小数保留源值供核对 | 用例验证 `128.00`、`0.00`、空值和历史小数。对 V4.7.4 本地 TEST 和 V4.7.5 合成 TEST 各扫描 7 个持久化数量字段，未检出小数。[数量审计](../../.runtime/v475-evidence/count-audit.json) |
| 2. 铜钴库存地图 | 使用现有授权查询、真实货位及现场底图。定位、缩放、适应画布、刷新和图例统一。桌面悬浮详情，窄屏详情放在画布下方 | [铜默认](../../.runtime/v475-evidence/copper-map-default.png) · [铜选中](../../.runtime/v475-evidence/copper-map-selected.png) · [铜 390 px](../../.runtime/v475-evidence/copper-map-390.png) · [钴 R2 默认](../../.runtime/v475-evidence/cobalt-map-default.png) · [钴占用](../../.runtime/v475-evidence/cobalt-map-selected.png) · [钴 390 px](../../.runtime/v475-evidence/cobalt-map-390.png) |
| 3. 销售履约及列对齐 | 共享表格增加居中列配置，计划量、出库量和待发运量按数字列对齐。已确认开票履约按实际数值排序，进度条按 0–100% 绘制 | 浏览器覆盖 0%、部分、100%、125% 和无计划量。[销售履约与排序](../../.runtime/v475-evidence/sales-fulfilment-CU_CATHODE.png) |
| 4. 备货创建及操作 | 新建入口按当前产品提供可执行计划，选定后进入实际创建表单并带入计划。退回、重提、物流经理审批、查看已关联作业沿用原授权及事务校验 | 审批、退回、重提、权限、跨产品、重复及并发由隔离集成测试覆盖。浏览器验证 [铜选择页](../../.runtime/release-tests/v475-executable-preparation-CU_CATHODE.png) 和 [钴选择页](../../.runtime/release-tests/v475-executable-preparation-CO_HYDROXIDE.png) |
| 5. 发票号 | 选择许可证读取服务端编号预览。保存沿用许可证行锁、编号锁、历史检查和额度预占。已有编号继续保留 | 铜流程验证 `-01`、`-02`，历史 `-000099` 原样保留，两笔不同装车计划并发得到 `-100`、`-101`。钴原有发票号、延期后选择及出库核销已回归 |
| 6. 单据打印 | 移除独立打印机管理入口，配置按项目归入出门证办理。归档装箱单和商业发票预览可开独立浏览器打印窗口 | [出门证配置](../../.runtime/v475-evidence/gate-permit-print-settings.png) · [A5 横向出门证](../../.runtime/v475-evidence/gate-a5-landscape.pdf) · [铜装箱单打印](../../.runtime/v475-evidence/packing-list-print-CU_CATHODE.pdf) · [钴装箱单打印](../../.runtime/v475-evidence/packing-list-print-CO_HYDROXIDE.pdf)。保留打印记录和配置。现场实际出纸待核对 |
| 7. 注册待办 | 接入铜钴待办，账户管理自动打开待审批。角色和权限与实际注册审批接口一致。同一申请按 ID 去重 | 安全用例验证管理员、受限账户管理员及审批后数量。浏览器实测待办出现、点入待审批、驳回后刷新。[待办截图](../../.runtime/v475-evidence/registration-pending-badge.png) |
| 8. 库存盘点 | 铜钴共享筛选和列表，独立显示快照时间、业务时期及创建日期。铜保留历史类型，钴旧单无业务时期时留空 | 接口验证半年度、年度、新旧字段及组合筛选。浏览器检查切换类型清除期间。[铜盘点](../../.runtime/v475-evidence/stocktake-CU_CATHODE.png) · [钴盘点](../../.runtime/v475-evidence/stocktake-CO_HYDROXIDE.png) |

库存地图以本轮 Codex 交互确认稿为准。铜稿 `copper-stock-map.html` 的 SHA-256 前 12 位为 `3c67c15ad06a`，钴稿 `cobalt-stock-map.html` 的前 12 位为 `d3ac274bb16e`。现场位置按数据库的有效布局配置取数。钴 R2 空位和已配置占用货位使用各自的 TEST 样本。

隔离 TEST 完整回归通过 139 项，包含 30 项单元、27 项集成、35 项安全、46 项业务与可靠性及 1 组多场景浏览器回归。另以实际浏览器检查两张地图、备货入口、盘点、履约、注册待办和出门证及铜钴装箱单打印。所用业务记录为合成数据。[回归日志](../../.runtime/v475-acceptance-final.log) · [浏览器记录](../../.runtime/v475-evidence/browser-results.json)

现行账户模型每个账号保存一个角色。本次注册待办覆盖有多项权限的系统管理员及无审批权限的受限账户管理员，同一申请在铜钴各自的待办中均按单条处理。

## 迁移与回滚

迁移 187 为新盘点补充 `period_month`，钴盘点补充业务类型，铜盘点开放半年度类型。历史期间缺少可靠来源的记录继续显示「—」。保留已保存的快照、单据 UUID、库存数量、审批及权限。

如需回到 V4.7.4，可使用基线提交 `2c0ce92` 与迁移前的隔离 TEST 备份，在另一数据库核对。保留升级库及其新增盘点资料用于复核。

## 第 9、10 项确认稿

- [阴极铜库存明细详情](proposals/copper-detail.html)
- [氢氧化钴批次列表](proposals/cobalt-list.html) · [氢氧化钴批次详情](proposals/cobalt-detail.html)
- [字段映射与确认事项](proposals/FIELD-MAPPING.md)
