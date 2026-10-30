# 穆松尼项目产品仓储管理系统 · Product WMS

当前为V2.6.2补充优化，版本号不变：[打开本机TEST](http://127.0.0.1:4176/overview)。新增备货撤回/撤销、入库只读字段及审批提醒、统一品牌、P5公共临时区和全局UI优化。保留五账号、密码、角色和全部业务历史。

[本轮补充交付报告](V2.6.2_SUPPLEMENT_RELEASE.md) · [当前交接](V2.6.2_HANDOFF.md) · [接口补充](V2.6.2_API.md) · [迁移说明](db/MIGRATIONS.md)

当前工作库70条迁移；原26捆、3张入库、2个Lot保留，66张业务/安全/历史表原字段摘要一致。实际位置、原165格及172条货位档案保留，P5通过父关联汇总为公共区域，不制造移库。303项API/数据库及迁移检查、83项浏览器检查通过。启动仍为`pnpm start`，不自动Seed、清理或重置账号。

## V2.6.2初版交付历史

# V2.6.2 连续检斤、片数与铅封、Lot货位独占

当前版本 **2.6.2**。本地 TEST：[http://127.0.0.1:4176/overview](http://127.0.0.1:4176/overview)，`pnpm start` 启动 `scripts/start-v262.cjs`，不自动迁移、Seed、清理或重置账号。

新增不跳页的单捆/批量检斤、四位吨位、新入库片数、铅封与发运快照、单Lot货位独占，以及装车审核后释放未被其他有效车单占用的余捆。保留实际货位和全部历史，沿用五角色与TEST生产入库自审配置。初版升级时的21捆、2张入库单、2个Lot未删除或重建；当前数量见顶部补充交付。

[V2.6.2交付报告](V2.6.2_RELEASE.md) · [接口与口径](V2.6.2_API.md) · [当前交接](V2.6.2_HANDOFF.md) · [数据库迁移](db/MIGRATIONS.md)

历史缺片数/铅封保持“未录入”，不得用模拟值补齐。旧已审核Lot若缺铅封，新建装车前由管理员核实补录；详见交付报告。回归仅使用隔离副本，禁止在当前工作库运行测试夹具或恢复覆盖。

## V2.6.1 交付历史

新流程为：创建Lot立即锁定 → 分阶段取样/检斤 → 全部完成后提交主管审核 → 统一确认规划货位 → 沿用装车、离场和经理出库审批。七个一级业务菜单，取样整合在备货内；新编号支持01、100、3250及更长序号。

[V2.6.1交付报告](V2.6.1_RELEASE.md) · [接口与状态](V2.6.1_API.md) · [清理与备份](V2.6.1_CLEANUP.md) · [迁移说明](db/MIGRATIONS.md) · [验证记录](VALIDATION.md)

以下为V2.6.1历史交付记录；当前启动命令及运行状态以本文V2.6.2说明为准。此前已备份并清理明确原始模拟库存；不明确的业务计划/合同及必要客户保留，后续录入业务数据不再清理。

专项：`pnpm db:prepare-v261`准备稳定的隔离回归基线，`pnpm test:v261`执行专项验收。准备回归不会把模拟库存写回当前工作库。旧V2.6.0基线单独保留。

## V2.6.0 交付历史

在 V2.5.5 原项目增量升级，保留 HTML/CSS/JavaScript + Fastify + PostgreSQL 和历史数据。新生产入库无重量，客户 Musonoi / 临时堆存区固定；备货时逐捆检斤、Lot 审核、分车装载，实际离场后由物流经理审批正式出库。

交付说明见 [V2.6.0 开发报告](V2.6.0_RELEASE.md)、[接口与状态](V2.6.0_API.md)、[实施检查清单](V2.6.0_PLAN.md)。

本地隔离准备：`pnpm db:prepare-v26`；启动：`pnpm start`（专用 `musonoi_v26_development_test`，不覆盖 `.env` 及旧预览数据库）。本次保留4174原服务，V2.6预览使用 [http://127.0.0.1:4176/overview](http://127.0.0.1:4176/overview)。账号沿用本地测试账号，不在文档中提供密码。

专项回归：`pnpm test:v26`；原有回归：`pnpm test:map`。迁移仅可对核实的目标增量应用，生产部署未执行。

## V2.5.5 库存地图专项历史说明

在现有V2.5-UX基础上增加独立 `/stock-map` 页面、现场PDF数字化SVG、实时数据库汇总、货位详情、筛选和跨模块定位；本版本正式命名为2.5.5。完整说明见 [地图开发报告](Stock_Map_Development_Report.md)、[地图API](Stock_Map_API.md)、[验收记录](VALIDATION.md) 和 [迁移文档](db/MIGRATIONS.md)。

**仅本机隔离TEST，未发布生产。原V2.5/UX库没有被本专项迁移。现场图仅提取165个货位和定位元素，未导入其中业务库存。**

```powershell
./scripts/local-db.ps1 -Action start
node scripts/prepare-map.cjs
# 可选：另建明确虚构的MAP-PREVIEW库存，显示各种颜色；原128捆不改
node scripts/prepare-map-preview.cjs
node scripts/start-map.cjs
# 或 npm start / pnpm start / pnpm start:map
```

[打开库存地图](http://127.0.0.1:4174/stock-map)。相同端口只能运行一个预览；旧服务须先停止。既有测试账号及随机密码在忽略目录 `.runtime/test-accounts.json`，未改密码。Node不在PATH时使用 `C:/Users/15008/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。

地图坐标来自 `Map Copper Cathodes.pdf`，标记“按图数字化，待现场校核”。未确认的容量为null；未关联图格为未知而非空位；旧A/B货位与历史混放异常单独显示。客户按**有效备货客户优先，否则货权客户**判断，入库、移库、锁定/释放、退装均受数据库客户一致性及容量约束。已装车未离场单列车辆区，不重复计入旧普通货位，不扣厂内实物。

当前预览从 `.runtime/stock-map-preview.json` 读取单独TEST库名（若未创建预览夹具则使用 `musonoi_map_development_test`）。`start:configured`仍按原.env，不能连接未升级的旧库。准备脚本依赖本机已有干净 `musonoi_ux_regression_test`；新电脑先恢复核验测试基线/本机凭据，不能向生产库注入演示数据。

```powershell
node scripts/prepare-map-compliant.cjs
node tests/map-all.cjs
# 或 pnpm test:map
```

完整测试覆盖既有模块与地图规则，结果保存在 `test-output/map-results.json`；原128条历史夹具保留，用于查询比对，新业务回归另建合规夹具，不关闭混放规则。实际备份恢复结果见 `test-output/map-recovery-results.json`。真实手机/现场设备与规模压测待现场验收。

版本交接见 [V2.5.5交接记录](V2.5.5_HANDOFF.md)。本次仅统一版本号，不改变库存业务或数据库。

以下为原UX及更早版本记录，当前地图专项应使用上面的启动和测试入口。

---

# 穆松尼库存管理系统 V2.5-UX 专项交付

本次在 V2.5.0 基础上增量完成独立页面、客户多合同、毛重扣包、库存/装车/离场联动。业务版本仍属 V2.5 系列。请先阅读 [完成报告](V2.5_UX_Optimization_Report.md)、[增量 API](V2_5_UX_API.md) 和 [验收记录](VALIDATION.md)。

**仅本机隔离 TEST，未发布生产。原 V2.5 数据库未迁移、未覆盖；当前预览使用 musonoi_ux_development_test。**

```powershell
# 已有本机 PG 集群/凭据及干净的 V2.5 回归基线库时
./scripts/local-db.ps1 -Action start
node scripts/prepare-ux.cjs
node scripts/start-ux.cjs
# 或 pnpm start / pnpm start:ux
```

Node 不在 PATH 时使用 `C:/Users/15008/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。

[信息总览](http://127.0.0.1:4174/overview) · [库存查询](http://127.0.0.1:4174/inventory) · [客户管理](http://127.0.0.1:4174/customers) · [入库管理](http://127.0.0.1:4174/receipts) · [备货管理](http://127.0.0.1:4174/preparation) · [出库管理](http://127.0.0.1:4174/outbounds)。

登录账号及既有随机密码仍在被 Git 忽略的 `.runtime/test-accounts.json`，未重置密码。测试预览中的合同、草稿都是明确虚构的测试操作。停止当前网页服务后才可重复启动同端口。

`prepare-ux` 只创建新的隔离克隆并向 UX 克隆应用增量迁移；它依赖本机已存在的 `musonoi_v25_regression_test`。在新电脑上需先恢复受核验的测试基线和本机凭据，不能对生产库运行演示 seed。`.env` 未修改。`pnpm start:configured` 仍按原 `.env` 启动业务后端，必须先在验证过的目标数据库完成迁移，不能拿新代码直接连接旧结构。

```powershell
node tests/ux-all.cjs
# 或 pnpm test:ux
```

最终504项分项检查通过，另有原型128条、空库重建、真实备份恢复、数据库重启及浏览器交互验证。旧版本测试命令为历史入口，UX 下请用上面统一回归命令（旧测试夹具适配只在 UX 隔离克隆启用）。没有执行生产迁移或真实手机/打印机实地验收。

以下保留原 V2.5 及更早交付说明，运行新专项应以上述 UX 入口为准。

---

# 穆松尼项目阴极铜库存管理系统 V2.5

在V2.4上增量新增：捆包UUID二维码/打印/批量标签Excel、六场景扫描中心、触控现场工作台、中英文账号偏好、PWA静态离线页、请求超时及未知结果回执。原V2.1–V2.4全部业务、查询与导出保留。

**仅本机隔离TEST，没有真实库存、联网发布或生产迁移。** [打开系统](http://127.0.0.1:4174/)后点“现场作业”或“业务”。交付时服务保持运行，重启电脑后：

```powershell
./scripts/local-db.ps1 start
node server/app.cjs
```

Node不在PATH时使用 `C:/Users/15008/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe` 完整路径。原账号和随机密码保留在被Git忽略的.runtime/test-accounts.json。

- [V2.5完成报告、实际功能/测试/风险](V2_5_COMPLETION.md)
- [运行和现场操作、手机HTTPS方案、弱网回执](V2_5_RUNBOOK.md)
- [API与权限](V2_5_API.md)
- [迁移](db/MIGRATIONS.md) · [验证记录](VALIDATION.md)

当前分支v2.5-development，开发库musonoi_inventory_v25_test，独立128条回归库musonoi_v25_regression_test。V2.4稳定代码和数据库保留。执行 `node tests/v25-all.cjs` / `pnpm test:v25`，419项计数检查（含真实数据库业务集成和客户端/图像单元），另有原演示与空库重建。56表备份恢复核验通过。

二维码仅识别捆包，不包含权限/重量/客户，扫码不等于业务确认；写入继续走原API/事务。弱网不自动离线记账，不以缓存库存冒充实时。摄像头需受信任HTTPS或本机localhost；手机不能直接访问电脑的127.0.0.1。实机相机、PWA安装和实体打印需现场验收，未声称通过。

---
以下为保留的V2.4及更早历史说明。当前版本、默认库和运行方式以V2.5文档为准。

# 穆松尼项目阴极铜库存管理系统 V2.4

V2.4在原HTML/CSS/JavaScript + Node.js/Fastify + PostgreSQL项目上新增：独立快照盘点、实盘Excel及流转对账、统一异常与管理员阈值、独立审批库存调整及授权反向单、九类历史报表、管理驾驶舱。原V2.1–V2.3查询、入库、备货、取样、检斤、装车和正式离场全部保留。

**仅本机隔离测试，没有真实生产数据或公网发布。** 当前[本地系统](http://127.0.0.1:4174/)及PostgreSQL保持运行；重启电脑后在项目根目录执行：

```powershell
./scripts/local-db.ps1 start
node server/app.cjs
```

Node不在PATH时使用`C:/Users/15008/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`的完整路径（见手册）。账号与原随机密码仍在Git忽略的`.runtime/test-accounts.json`，没有重置旧密码。

- [V2.4完成报告、变更、测试与限制](V2_4_COMPLETION.md)
- [运行、操作、备份与回退手册](V2_4_RUNBOOK.md)
- [API、权限与状态流转](V2_4_API.md)
- [数据库增量迁移](db/MIGRATIONS.md)
- [真实验证记录](VALIDATION.md)

当前开发库`musonoi_inventory_v24_test`；独立128条回归基线`musonoi_v24_regression_test`；旧V2.3数据库和v2.3-stable源码保留。分支`v2.4-development`。`node tests/v24-all.cjs` / `pnpm test:v24`：324项明确计数检查通过，另通过原型与空库重建；53表真实停启与新库恢复通过。

库存变化仅由授权事务生效；盘点批准和异常处理本身不扣库存。调整须申请人与审批人分离，保留原入库明细、原始净重及旧流水。历史从V2.4可靠开账起点开始，早于起点返回错误、跨起点明确部分期间；异常规则扫描由授权人员发起，尚无后台定时监控。当前全局记账串行锁优先保证准确性，并限制高并发吞吐。

---
以下保留V2.3及更早历史说明；当前版本、默认库与操作以以上V2.4文档为准。

# 穆松尼项目阴极铜库存管理系统 V2.3

V2.3在原HTML/CSS/JavaScript + Fastify/PostgreSQL上增量增加：取样及复检、捆包/车辆检斤、客户锁定装车、装箱单、生产/商务/安保独立审批、实际离场扣库、实物退回出库冲销、移库与全流程追溯。原入库、备货、查询、筛选、分页和Excel/CSV均保留。

**当前仅本机隔离测试，没有真实生产数据或正式发布。取样、检斤、装车、审批本身不扣库存；只有生产确认已通过安保核验的实际离场才正式扣库。**

当前电脑服务已运行，打开 [库存系统](http://127.0.0.1:4174/)，右上“业务”或原取样/出库导航进入。重启电脑后在项目目录执行：

```powershell
./scripts/local-db.ps1 start
node server/app.cjs
```

八个测试账号及随机密码在Git忽略的 `.runtime/test-accounts.json`：原test_admin/operator/supervisor/sales/viewer保留，新增test_production、test_commerce、test_security。不同职责须独立账号完成，不能用管理员单人审批所有节点。不要提交密码文件。

- [V2.3完成报告、阶段提交、测试与V2.4建议](V2_3_COMPLETION.md)
- [V2.3运行和操作手册](V2_3_RUNBOOK.md)
- [V2.3接口与状态](V2_3_API.md)
- [数据库迁移与回退](db/MIGRATIONS.md)
- [实际验证记录](VALIDATION.md)

当前开发库 `musonoi_inventory_v23_test`，独立128条回归库 `musonoi_v23_regression_test`；原V2.2库和稳定源码保留。执行 `node tests/v23-all.cjs` 或 `pnpm test:v23` 运行全套真实数据库回归。219项明确计数检查通过，另通过原型与空库重建；备份恢复记录见VALIDATION。

尚未提供已确认入库的授权调整；出库冲销只适用于整车实物退回。地磅/门禁自动采集、部分退装/返货、企业容差、政府检验接口和生产联网等边界见完成报告。

---

以下为保留的V2.2与V1.0历史说明。涉及版本、默认数据库、阶段范围及初始化流程，以以上V2.3手册为准。

# 穆松尼项目阴极铜库存管理系统 V2.2

V2.2 在 V2.1 页面及 Fastify + PostgreSQL 架构上增量开发：基础资料、入库草稿与独立审核、Excel 整批校验及确认、销售计划/客户备货、整捆锁定与解除、库存指标及历史联动。保留 Logo、中文界面、库存筛选、排序、分页、跨页勾选及 CSV/XLSX 导出。

**当前仅本机隔离测试，没有真实业务数据、外部源码上传或生产发布。已确认入库禁止直接改删；授权冲销/调整流程尚未提供，正式使用前必须补齐。**

当前电脑已经初始化，在项目目录执行：

```powershell
./scripts/local-db.ps1 start
node server/app.cjs
```

访问 [本机库存系统](http://127.0.0.1:4174/)，页面右上“业务”打开新模块。交付时服务保持运行。五个测试账号（test_admin、test_operator、test_supervisor、test_sales、test_viewer）及随机密码保存在被 Git 忽略的 `.runtime/test-accounts.json`；不要上传该文件。创建入库与审核必须使用不同账号。

- [V2.2 完成情况、阶段提交、测试与已知问题](V2_2_COMPLETION.md)
- [V2.2 运行、登录、操作及备份恢复手册](V2_2_RUNBOOK.md)
- [数据库关系、迁移顺序和回退方法](db/MIGRATIONS.md)
- [验证记录](VALIDATION.md)
- [V2.1 历史运行手册](V2_1_RUNBOOK.md)、[V2.1 完成报告](V2_1_COMPLETION.md)、[原技术评估](V2_Evaluation_Report.md)

当前应用库为 `musonoi_inventory_v22_test`；原 `musonoi_inventory_test` 保留，独立128条回归库为 `musonoi_v22_regression_test`。`node tests/v22-all.cjs` 执行真实 PostgreSQL 全套回归与并发测试；阶段测试均克隆独立库，不在开发库写验收库存。

独立 V1.0 演示入口 [离线演示回归](http://127.0.0.1:4174/demo) 保留；数据库模式出错不会自动使用模拟数据。Node.js 22+，依赖使用 `pnpm install --frozen-lockfile`；当前电脑无需重新初始化。

## 历史原型说明（V1.0，仅对应离线演示）

以下为保留的原型说明；其中“无数据库”“角色切换”等描述仅适用于独立演示模式。V2.2 数据库模式及安全边界以以上 V2.2 文档为准。

# 穆松尼阴极铜库存查询原型

中文、响应式、无外部运行依赖的静态网页。**全部 128 条捆包、客户、批次、日期、重量和铜含量均为虚构演示数据；没有连接真实数据库。** 演示快照日期为 2026-10-28。

## 本地运行

推荐安装 Node.js 18 或以上，在本目录打开终端执行：

```powershell
node server.cjs
```

浏览器打开 http://127.0.0.1:4173 。按 Ctrl+C 停止。也可直接双击 `dist/index.html` 离线运行。无须 npm install；全部字体、代码和样式使用本地文件或系统资源。若端口占用，设置 `$env:PORT=4174` 后运行。

## 已实现

- 四个库存指标卡随当前全部筛选结果更新，不受分页影响。
- 捆包号/批次/客户/货位搜索；货位、批次、客户、库存状态、取样状态、入库日期组合筛选，实时生效；日期含首尾，错误范围显示提示。
- 八列可排序，重量按数值排序；10/20/50 条分页；详情弹窗；无结果状态；查询和导出操作反馈。
- 本页全选、跨页勾选。修改筛选后仅保留仍匹配的勾选项。未勾选时导出全部筛选结果，勾选后仅导出已选项；导出顺序与排序一致。
- 真正的 OOXML `.xlsx` 导出（净重为数值，首行冻结及筛选）和 UTF-8 BOM CSV；每条导出记录都有“演示数据”标记；CSV 文本字段做公式注入防护。
- 演示管理员可查询/导出，只读访客可查询/查看详情，禁用导出并解释原因。角色切换会清空勾选。
- 桌面侧边栏与移动端紧凑布局；手机表格支持横向滚动；键盘可操作，弹窗支持 Escape 关闭。
- 演示操作记录仅保存在当前页面内存，刷新清空；筛选、角色也在刷新后重置。

库存口径：在库净重 = “在库”与“已预留”的净重合计；可用捆包 = “在库”数量；待完成取样 = 仍在库的“未取样”及“取样中”；匹配捆包 = 包括已出库的全部筛选结果。表格和导出含已出库记录，可用状态筛选排除。重量展示三位小数。

入库、出库、取样办理为标明“规划中”的范围说明，并非可用业务模块。前端角色切换用于交互演示，**没有登录、身份认证或真实安全边界**。

## 文件与验证

- `dist/index.html`、`styles.css`：界面与响应式布局。
- `dist/core.js`：确定性数据、筛选排序、统计、CSV/XLSX 打包；不发起网络请求。
- `dist/app.js`：查询交互、分页勾选、权限演示、反馈与弹窗。
- `server.cjs`：仅监听本机的静态预览服务，不提供数据库 API。
- `node test.cjs`：验证组合筛选、日期边界、空结果、排序、指标口径和导出，并在 `test-output/` 生成校验文件。

## 后续接入数据库方案

建议采用浏览器 → HTTPS 后端 API（Node.js/Fastify 或 Python/FastAPI）→ PostgreSQL。原型界面可保留；将内存中的 query/totals 改为调用服务端。生产环境禁止把数据库连接串或账户放入前端。

### 数据结构

1. `customers(id, code UNIQUE, name)`、`locations(id, code UNIQUE, warehouse_id)`。
2. `batches(id, batch_no UNIQUE, production_date, grade)`。
3. `bundles(id UUID, bundle_no UNIQUE, batch_id FK, location_id FK, customer_id FK, net_weight NUMERIC(12,3) CHECK(net_weight>0), stock_status, sample_status, inbound_date DATE, version INT, updated_at TIMESTAMPTZ)`。状态使用受限枚举或 CHECK，前后端统一代码值。
4. `stock_movements(id, bundle_id FK, type, from_location_id, to_location_id, document_no, occurred_at, actor_id, request_id UNIQUE)` 保存入库/出库/移位事件。
5. `samples(id, bundle_id FK, sample_no UNIQUE, status, sampled_at, result, actor_id)` 保存取样流程。
6. `users`、`roles`、`user_roles`、`user_customer_scopes`、`audit_logs` 保存身份、权限与审计。

为捆包号、批次、货位、客户、状态及入库日期建索引；大数据量时增加 pg_trgm 搜索索引。出库及预留通过事务与版本号/行锁避免重复出库；请求幂等键防止重复提交。重量使用定点十进制，禁止用浮点累加进行业务结算。

### 接口契约示例

```http
GET /api/v1/me
GET /api/v1/inventory?q=&location_id=&batch_id=&customer_id=&stock_status=&sample_status=&date_from=&date_to=&sort=net_weight&order=desc&page=1&page_size=20
GET /api/v1/bundles/{id}
POST /api/v1/inventory/exports
```

列表返回 `{items, total, page, page_size, summary, snapshot_at}`；summary 对同一权限范围及全部筛选结果计算，使用同一事务快照避免统计与列表不一致。限制 page_size，排序字段用白名单，查询使用参数化 SQL。空结果返回 200 与空数组；非法日期/排序返回 400，未登录 401，无权限 403，冲突 409。

导出请求体为 `{format:"xlsx", filters:{...}, sort:{field:"net_weight",order:"desc"}, selected_ids:[]}`；空选中列表表示导出全部筛选结果。后端重新验证所有选中 ID 的权限及筛选范围，统一使用列表筛选器和快照，不能信任前端提供的行数据或角色。小数据可同步下载；大数据返回 202 与任务 ID，通过短时效授权链接下载，限制条数、速率和有效期。统一做 CSV 公式防护，XLSX 文字显式写入字符串类型。

### 登录、权限及部署

- 使用组织 OIDC/SSO，服务端验证会话；Cookie 使用 HttpOnly、Secure、SameSite。按应用方式配置 CSRF 防护，严格设置 CORS。
- 权限建议 `inventory:read`、`inventory:export`、`inventory:write`、`sample:write`。客户范围和仓库范围必须在每次列表、统计、详情和导出查询中由服务端约束。
- 审计记录主体、时间、业务对象、筛选条件、导出数量和结果，持久化且限制修改；不记录敏感凭据。
- 仓库业务日期使用 DATE，事件时间保存 UTC 并按项目明确配置的时区显示；不要依赖浏览器本地时区推导业务日期。
- 前端可放在静态托管，API 部署在容器/内网服务器，PostgreSQL 私网访问；使用 HTTPS、环境密钥、数据库迁移、每日备份与恢复演练、访问日志和告警。
- 如将原型发布到 Sites，私有访问仍不能替代以上业务系统权限方案。正式上线前以真实业务口径做并发出库、越权访问、数据对账、导出与恢复验收。

## 本次交付状态

本地版本完整可运行。在线站点仅完成私有项目注册，未上传源码、未发布。发布时自动审批拒绝了 Git 上传操作，理由是未获得向该外部 Sites 仓库上传源码的明确授权。获得相应授权后可继续发布；不影响本地使用。

## V2.3 开发进度

V2.3.1 已新增取样批次、多捆与复检、检验结果、私有报告附件；保留原功能。测试及接口见 VALIDATION、V2_3_API.md。仅使用新增本机 V2.3 隔离库。

V2.3.2 新增单捆/车辆检斤、精确毛皮净与差异提示、磅单附件及保留历史的作废。

V2.3.3 已新增客户锁定库存装车、唯一车辆占用、整车取消/退装和装箱单Excel；装车不扣库存。

V2.3.4 已新增生产/商务/安保独立审批及正式离场扣库、重量异常主管放行、节点驳回、整单取消，以及须实物退回的独立授权出库冲销。

V2.3.5 新增原子移库、入库至车辆离场/退回的单捆生命周期、出库来源和导出联动；重量口径统一由数据库计算。

## V2.4开发进度

V2.4.1：独立库存版本/快照、逐捆与Excel实盘、复盘、对账、独立批准及附件。仅隔离测试，历史范围从升级记账起点开始。

V2.4.2：统一异常、阈值配置、规则扫描、责任人、独立处理审批和完整历史；异常处理不直接改库存。

V2.4.3：关联异常的库存调整申请、独立审批及原子生效；保留原始档案重量/历史单据，纠错新建反向单。

V2.4.4：九类统计报表、历史截止查询、统一权限与Excel导出；期初+各类带符号流转=期末，升级前历史不足明确提示。

### V2.4.5 管理驾驶舱
新增 `/api/v1/dashboard` 和 `/api/v1/dashboard/details?metric=...`，均要求 dashboard:read；复用历史版本、精确十进制汇总及服务端项目/客户/仓库范围。七张指标卡与授权明细、当月趋势、库龄、客户分配及货位分布保留原查询入口。历史起点不足整月时明确标注；异常数字为已登记未关闭记录，规则扫描由授权人员发起，不宣称自动监控。实测 tests/v24-5.cjs：16项真实 PostgreSQL 检查通过，包括装车不减实物、正式离场统计、历史截止及客户权限。
