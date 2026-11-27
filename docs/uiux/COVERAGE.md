# 全站界面覆盖与验收

## V4.9.0 安全管理

| 页面 | 场景 |
| --- | --- |
| /audit | 日志分类、请求编号、脱敏详情与 JSON 证据导出，沿用日志权限与数据范围。 |
| /workbench/report-mail | 铜钴共用。按已确认设计覆盖发送计划与服务器邮箱切换、下次计划发送时间、单项启停、收件账号与注册邮箱、原固定地址保留、服务器未配置、保存结果和非管理员访问拒绝。核对桌面和窄屏。 |
| /cobalt-metal 和 /workbench/permissions | 物流办公室操作员的菜单、直达页面、正式出库和历史出库金属量录入、待审批状态、项目/仓库/客户数据范围，及角色矩阵中的钴金属量查看与录入。另核对独立确认、退回及停用录入权限。 |
| /workbench/permissions | 核对所有岗位展示完整的现行业务权限及建议岗位，可将原特定岗位权限授给自定义或其他岗位。检验跨岗位实际提交、未授权拒绝、关联权限提示和保存结果。 |
| /outbounds/loads/:id 和 /outbounds/:id | 铜钴可补填过去或未来的出库日期。正式出库日期更正在同一单据内提交、审批与查看历史。分别核验物流和生产审批、申请人回避、未终审保留原日期。 |
| /outbounds/loads/:id 和 /preparation/:id | 阴极铜核对授权、实物核验和执行各阶段。冲销后有效出库剔除原单，恢复原备货单并复核其修改、重新送审与再装车。旧冲销按单恢复，已有后续业务时保留并提示原因。 |
| /overview、/reports 和清关单据 | 铜钴终审后按有效申报日期统计车辆，历史导入按原发运日期。核对商业发票和装箱单的发运日、更正后的重生成提示与原归档。 |
| /inventory/:id | 核对同一账号同时有捆包更正申请及审核权限时可自审，单独只有申请权时仍无法审核。 |
| 阴极铜捆包详情和备货检斤 | 核对铅封号更正审批前仍防重，更正生效且旧号没有其他有效用途时可在备货预检和检斤保存中复用。检查重复保存、并行认领、历史凭证和更正记录。 |
| /outbounds、铜钴备货和钴金属量明细 | 核对有对应授权的系统管理员可审核自己发起的业务单据，出库日期更正逐级审批并留痕。测试非管理员原有回避规则和操作范围。 |

V4.8.0 复核了路由切换、批次号译名、铜钴总览、钴地图、权限页和历史报表。权限页仅展示角色与功能权限，账户授权继续约束数据读取。报表改版另见[确认稿](../v4.8.0/统计报表改版确认稿.md)。

V4.8.1 的统计报表沿用 `/reports`，在铜钴路线矩阵分别登记发运及单证、出入库流水、收发存与对账、盘点与差异以及销售与履约。五类共用筛选、指标及表格容器。页面提供分组明细和双语 Excel，查询、盘点、销售和导出沿用各自授权。

V4.9.0-ui3 复核铜钴发运及单证和出入库流水的历史明细。发运明细包含票证、司机、车辆、运输和销售计划资料。历史缺项说明同时进入页面及 Excel，在线与历史的重量和数量继续按各自数据来源计算。销售与履约按已确认的历史派车关联去重。

出入库流水的业务类型筛选包含备货流转。已核实关联备货单的出入范围事件按备货流转列示，并使用备货单号。其他范围流转沿用原业务分类。入库明细显示入库单号，出库明细显示装箱单号。历史入库没有可核实的原始入库单关联时，明细和导出提示待确认补充。

| V4.7.9 受影响页面 | 共用组件和验证范围 |
| --- | --- |
| 铜钴库存地图 `/stock-map` | `StockMapReview`，桌面与 390 px、中英文、铜货位卡和钴全景。 |
| 阴极铜占用货位明细与地图 PDF | 同一货位多个客户、未分配捆包、逐批捆数与净重、已知部分重量、货位与客户筛选。新生产捆包堆存区共享卡显示捆数并可打开专用明细，页面与 PDF 的占用货位明细均排除此区。 |
| 钴基础资料 `/customers/master-data` | 仓库、库区和货位分别按钴产品及账号范围读取。旧的钴编辑书签回到对应资料类别。铜基础资料编辑入口沿用原有权限。 |
| 钴库存地图失效筛选 `/stock-map?zone_id=obsolete` | 移除失效范围及旧库存筛选参数，返回授权默认地图。筛选选项请求失败时保留地图操作。直接 API 请求仍检查权限。 |
| 历史装箱单复核 `/workbench/historical-movements` | 管理员在原预览逐份核对重复编号并填写原因。来源详情可查复核意见和原行标记。 |
| 历史装箱单异常 `/workbench/historical-movements` | 混合批次逐文件查看模板、日期、明细和合计的具体异常，标出原表位置及相关值，覆盖中英文。 |
| 历史装箱单与销售开票 | 按同产品、项目、车牌、发运月份和客户或合同核对候选。确认导入派车时，系统关联唯一趟次并确认有原始发票号的历史单据。多趟候选及缺少发票号的保留原核对入口。 |
| 铜钴派车管理 | 复测相同工作表跨计划重导、原计划恢复部分或全部手动删除车辆，以及取消标记仍被跳过。核对误导入自动关联车辆的撤销、已取消装车与已清除到场的删除入口，以及原单、人工确认和有效作业的保护。 |
| 历史车辆出厂管理 | 有效历史出库导入纳入已出厂，详情打开对应历史出库单。原单无审批时间时留空，发运日期独立显示。 |
| 历史导入记录 | 筛选、总数、每页行数和翻页共用服务器分页，页面底部保留一组分页控件。 |
| 新建出口许可证档案 | 中英文入口一致。记录簿每条记录的编辑和删除放在信息右侧，台账和详情的已用量、剩余量显示四位小数。 |
| 创建装车计划 | 选销售计划即可推荐发票号，关联许可证后按其形式发票号推荐。留空保存时分配编号，手工号执行查重。核对仓库授权下可选许可证及合同、日期和额度缺项反馈。选择到场车辆时核验派车运输商和目的地，缺项时停用保存并提示补录。 |
| 铜钴装车计划备货批次与发票号 | 核对批次选择只列出已完成备货且可装车的记录。直接提交未完成或已失效的批次时提示重新选择。取消后可手工重用未使用的原发票号，核对取消历史以及仍占用的发票号。 |
| 铜钴车辆到场登记 | 两辆活动车辆的挂车 2 均可填 `N/A` 并确认到场。草稿、确认后重开、清关生成及 Excel 导出须保留该标记。实车牌在两个挂车栏之间仍参与查重。有效历史出库关联显示「已到场（历史）」，筛选和导出沿用状态，未知实际到场时间留空。 |
| 历史单据批量作废 `/workbench/historical-movements` | 管理员可筛选单据状态，按页勾选铜钴有效单据，填写原因后确认作废。已打开的入库及出库列表保留筛选并重新查询。 |
| 到场登记 `/loading-plans` | 铜钴在原派车行保存草稿，显示待修改确认并拦截装车计划；编辑时可取消到场并清空登记字段。 |
| 已作废历史装箱单详情 | 保留作废记录及原件入口，取消库存和关联业务单据跳转。铜钴均检查历史库存及四类派生单据查询。 |
| 备货计划创建与列表 | 创建支持保存草稿及直接提交审核。列表仅对有权办理的勾选计划启用一键提交审核或审批。 |
| 铜钴备货计划详情 V4.8.5-ui3 | 使用共用审批历史组件。核对授权范围、审批动作、人员、办理时记录的角色、时间、结果和退回意见。历史事件缺少角色时标注未记录。覆盖桌面和手机、中英文。 |
| 英文页面 V4.8.5-ui3 | 核对铜钴导航、面包屑、页面标题及全站路由的可见文字和控件名称，含登录、启动等待、离线和审批详情。 |
| 铜钴信息总览 `/overview` | 共用筛选栏、图表悬浮数据和钴指标卡。 |
| 铜钴我的待办 `/overview?management=todos` | 核对各业务的审批阶段文案。备货作业和出库待办显示关联批次号并打开原单据。验证授权范围，以及发起和办理记录。 |
| 铜钴库存明细 `/inventory` | 原表的备注和真实入库日期。用历史入库日期缺失及日期有据的记录复验。 |
| 单据列表及操作页 | `DocumentDrafts` 接入既有表格。草稿保存、续填和权限用例覆盖备货、入库、装车、盘点、许可证及车辆登记。 |
| 出口许可证 | 铜钴台账按形式发票号、许可证号、客户、合同号、开证清关公司、开证银行和状态查询。登记页的银行账号与账户名来自同一记录。项目授权人员维护共享选项。待审批记录进入审批人待办，已导入装箱单在额度明细中可追溯。 |
| 出口许可证详情 V4.8.2 | 铜钴共用详情。首屏显示额度、有效期和可办操作，装车及额度记录、办证资料、审核与延期使用页签。许可状态与延期审核状态独立展示。许可证附件入口和接口取消，历史附件保留归档。 |
| 用户菜单 · 自助修改密码 | 铜钴共用。覆盖新密码 10–48 字符及确认密码校验、旧密码兼容登录、改密后重新登录和管理员重置。 |
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
| cu-bag | `/inventory/:id` | 铜 | 管理员 | 表格 | 6 / 0 / 0 | 可用库存捆包更正申请与生产管理审批 |
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
| export-license-new | `/export-licenses/new` | 铜、钴 | 管理员 | 骨架、表单 | 20 / 0 / 0 | — |
| cu-export-license | `/export-licenses/:id` | 铜 | 管理员 | 骨架、表单、表格、状态 | 10 / 0 / 0 | — |
| co-export-license | `/export-licenses/:id` | 钴 | 管理员 | 骨架、表单、表格、状态 | 10 / 0 / 0 | — |
| cu-export-license-edit | `/export-licenses/:id/edit` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| co-export-license-edit | `/export-licenses/:id/edit` | 钴 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| sales-new | `/sales-plans/new` | 铜、钴 | 管理员、销售员 | 骨架、表单 | 16 / 0 / 0 | — |
| cu-sales-detail | `/sales-plans/:id` | 铜 | 管理员 | 骨架、表单、表格、状态、指标 | 10 / 0 / 0 | 共用单据页眉 |
| cu-sales-edit | `/sales-plans/:id/edit` | 铜 | 管理员 | 骨架、表单、表格、状态、指标 | 6 / 0 / 0 | — |
| cu-dispatch | `/sales-plans/:id/dispatch` | 铜 | 管理员、物流经理 | 骨架、派车重导预览、指标 | 12 / 0 / 0 | — |
| co-sales-detail | `/sales-plans/:id` | 钴 | 管理员 | 骨架、表单、表格、状态、指标 | 10 / 0 / 0 | 共用单据页眉 |
| co-sales-edit | `/sales-plans/:id/edit` | 钴 | 管理员 | 骨架、表单、表格、状态、指标 | 6 / 0 / 0 | — |
| co-dispatch | `/sales-plans/:id/dispatch` | 钴 | 管理员、物流经理 | 骨架、派车重导预览、表格、指标 | 12 / 0 / 0 | — |
| cu-sales-shipping | `/sales-plans/:id/shipping` | 铜 | 管理员 | 骨架、表格、指标、反馈 | 6 / 0 / 0 | — |
| legacy-sales-new | `/preparation/plans/new` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | — |
| legacy-sales-edit | `/preparation/plans/:id/edit` | 铜 | 管理员 | 骨架、表单、表格、状态、指标 | 6 / 0 / 0 | — |
| legacy-sales-shipping | `/preparation/plans/:id/shipping` | 铜 | 管理员 | 骨架、表格、指标、反馈 | 6 / 0 / 0 | — |
| receipts | `/receipts` | 铜、钴 | 管理员、现场操作员、现场主管、生产经理 | 筛选、表格、状态、指标、预览、骨架、反馈 | 28 / 4 / 0 | 列表与只读预览，钴入库与备货管理显示待创建备货单计划数。 |
| receipt-new | `/receipts/new` | 铜、钴 | 管理员、现场操作员 | 骨架、表单、表格、反馈、筛选、状态 | 22 / 2 / 0 | 阴极铜手录识别捆包号的字母后缀并自动带出生产批次。生产日期不符时在对应行提示应填日期。 |
| cu-receipt | `/receipts/:id` | 铜 | 管理员 | 骨架、表格、指标 | 6 / 0 / 0 | — |
| cu-receipt-edit | `/receipts/:id/edit` | 铜 | 管理员 | 骨架、表单、表格 | 6 / 0 / 0 | 草稿编辑沿用新建的生产日期校验。 |
| cu-receipt-import | `/receipts/import` | 铜 | 管理员 | 骨架、表单 | 6 / 0 / 0 | Excel 预览保留字母后缀。生产日期错误提示原表行号、捆包号和应填日期。 |
| co-prep | `/receipts/:id` | 钴 | 管理员、现场主管、物流经理 | 表格、指标、撤销快照 | 10 / 0 / 0 | 已批准整批可申请撤销，新计划沿用实物袋号。 |
| co-prep-work | `/receipts/:id` | 钴 | 管理员、现场操作员、现场主管 | 表格、指标 | 14 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-prep-draft | `/receipts/:id` | 钴 | 管理员 | 表格 | 6 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-prep-alias | `/receipts/:id/work` | 钴 | 管理员 | 表格、指标 | 6 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| preparation | `/preparation` | 铜、钴 | 管理员、现场操作员、现场主管 | 筛选、表格、状态、指标、预览 | 28 / 0 / 0 | 待创建备货单计划数紧邻全部，按产品、授权范围及可执行状态统计。 |
| preparation-new | `/preparation/new` | 铜、钴 | 管理员 | 骨架、筛选、表格、状态 | 12 / 0 / 0 | — |
| preparation-plans | `/preparation/work-plans` | 铜、钴 | 管理员、物流经理、现场操作员、出口主管 | 骨架、筛选、待审批角标、状态 | 32 / 0 / 0 | 菜单按当前授权显示待审批数。计划状态显示待创建或关联备货单的实时状态，创建入口位于详情和备货办理页。 |
| cu-work-plan-detail | `/preparation/work-plans/:id` | 铜 | 管理员 | 骨架、状态 | 10 / 0 / 0 | 共用单据页眉 |
| co-work-plan-detail | `/preparation/work-plans/:id` | 钴 | 管理员 | 骨架、状态 | 10 / 0 / 0 | 共用单据页眉 |
| cu-preparation-from-plan | `/preparation/new` | 铜 | 管理员 | 骨架、表单、表格 | 10 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| co-preparation-from-plan | `/receipts/new` | 钴 | 管理员 | 骨架、表单 | 10 / 0 / 0 | 现场逐捆、逐袋或匹配 |
| cu-lot | `/preparation/:id` | 铜 | 管理员、现场主管、物流经理、物流现场操作员 | 表格、反馈、撤销快照、驳回后撤销与重选 | 10 / 0 / 0 | 覆盖首次驳回及授权更正后再次驳回，沿用原计划和批次号。复核页内切换语言后重选按钮、撤销按钮和确认弹窗。 |
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
| 清关单据管理 | `/customs`、`/customs/bp`、`/customs/bp?view=documents`、`/customs/packing-list`、`/customs/templates` | 铜、钴 | 办公室业务员、管理员、获授权模板维护人员 | BP 批次净毛重及装车日期、归档修订、编制内代理簿、模板维护权限 | — | 核对默认模板、企业资料和归档修订。核对列表、批次展开和反馈的英文 Lot 术语。预览、打印和 Excel 核对日期、挂车 2 的 N/A、常见字段单行显示和超长内容完整性。 |
| 装车出库管理只读预览 | `/outbounds` | 铜、钴 | 获授权查看装车单的岗位 | 选择在线单据，核对单据详情、更正与历史跳转，预览异常时保留详情入口 | — | 详情接口校验单据范围 |
| 商业发票与装箱单 | `/customs/packing-list`、`/customs/packing-list/:id` | 铜、钴 | 有装车单查看权限的岗位 | 清关单据预览、批次行选择、授权生成和修订弹窗、单据详情、打印及归档 | — | 生成与下载校验权限。查询与版本展开按项目、仓库及客户范围 |
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
| cu-invoice | `/export-shipments/:id` | 铜 | 管理员 | 骨架、表格 | 10 / 0 / 0 | 新旧商业发票单页打印、装箱单分页和预览 |
| metal | `/cobalt-metal` | 钴 | 管理员、物流经理、生产经理 | 骨架、筛选、表格、指标 | 14 / 0 / 0 | — |
| metal-outbound | `/cobalt-metal` | 钴 | 管理员 | 骨架、筛选、表格、指标 | 10 / 0 / 0 | — |
| metal-confirmations | `/cobalt-metal` | 钴 | 管理员、物流经理、生产经理 | 在线与历史出库待确认、按批次检索、详情入口 | 10 / 0 / 0 | 归档沿用原出库日期 |
| co-historical-metal | `/stock-outbound/historical/:id` | 钴 | 管理员、物流经理、生产经理 | 原始资料、金属量录入、独立审批、结果及历史 | — | 作废归档退出待确认清单，审批记录保留 |
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
| Excel 拖放 | 铜入库导入、铜钴客户派车单、库存实盘导入、历史装箱单批量选择和单份重传；按原有权限和业务状态出现。覆盖单选、多选、无效格式、窄屏、中英文和点击选择。 |
| 分页行数 | 客户端列表、服务端列表及铜库存筛选页，核对刷新和离开后返回时的行数，并验证页面间独立记忆。 |
| 铜钴总览悬浮提示 | 日期刻度和图形位置对应同一期间，覆盖柱状图、折线图及横向滚动。 |
| 铜钴创建装车计划及草稿 | 草稿位于保存按钮左侧。在「单证资料」按销售计划与日期选择许可证。覆盖单一入口、跨页选项和发票号预览。到场查询及装车计划查询按车牌筛选。车辆出厂打印可设发起日期。 |
| 钴侧「我的待办」与入库备货详情 | 物流现场主管审核、生产确认入库；以详情当前节点和状态标签比对列表，保留历史流程的审核文案。 |
| `/inventory/historical/:id` | 铜捆包与钴备货批次档案、发运日期、逐件重量和关联单据 |
| `/receipts/historical`、`/loading-plans/historical`、`/outbounds/historical` | 旧列表地址转入原业务列表。既有详情地址继续按原模块权限访问。 |
| `/overview`、`/inventory`、`/receipts`、`/loading-plans/query`、`/outbounds` | V4.7.8-ui3 铜钴历史数据进入现有图表、指标和单据表格。列表沿用原筛选、排序、分页和只读详情。 |
| `/sales-plans` | 两产品履约进度、数值排序及一致列对齐 |
| `/preparation/new`、`/receipts/new` | 选取可执行备货计划、直接带入计划和权限拒绝 |
| `/preparation`（钴进入 `/receipts`）、`/preparation/work-plans` | 待创建统计与可执行计划一致，创建或撤销备货单后即时变化。列表显示独立的审批和作业状态标签。 |
| `/preparation/work-plans/new` | 铜钴的按客户或批次查询、批量录入、冲突校验、整批草稿和权限 |
| `/:area/historical/:id`、`/workbench/historical-movements/:id` | 历史入库、装车计划、装车、出库、库存档案和原件来源相互跳转，恢复上一页上下文 |
| `/outbounds?view=departures` | 铜钴当前及已签发版本的出门证使用 241.3 × 139.7 毫米三联二等分纸，验证原生纸型无旋转、表格与签字栏留在首联。历史导入记录仍从出厂列表查看。 |
| `/workbench/accounts?registrations=pending` | 注册申请审批待办、单角标和审批后刷新 |
| `/stocktaking` | 两产品编号、类型、时期、创建日期与状态组合筛选 |

## V4.8.1-ui6

| 页面 | 场景 |
| --- | --- |
| 铜钴派车管理 | 具备派车月份调整权限的销售业务员、销售经理或管理员，先选月份，再将车辆转移到该月同客户的有效销售计划。已关联到场、装车或历史单据的车辆保留原业务关系。原 Excel 导入区显示待补录车辆数，再次上传文件即可批量补齐运输商和目的地。已保存车辆可按车牌查找。 |
| 铜钴 BP 表 | 编制时推荐同产品同编号年份的最大标准流水号加一。修订时测试 BP 编号更正及重号提示，核对批次与车辆明细保留。已创建列表、打印和 Excel 使用对应版本的编号和数据。打印与 Excel 核对栏位顺序、版面比例、合计和签署区。 |
| 铜钴车辆到厂登记 | 查询、重置和 Excel 导出并列。导出按已应用的筛选及当前账号语言取数。 |
| 存取异常 | 系统不可达、业务页加载失败、权限不足及会话被替换。 |
| 历史出入库导入 | 文件读取、校验、可导入、已导入、待修正及可重试。 |
| 铜钴单据办理 | 同一账号具备当前节点权限时可办理本人单据，原审批节点、岗位限制、证据、记录和库存事务继续适用。 |

## 异常状态覆盖

使用 `tests/release/exception-pages.cjs` 验证异常界面和恢复动作。入口状态覆盖启动资源缺失、服务不可用、离线、登录过期和会话被替换。业务状态覆盖 403、404、500、库存查询超时、车辆到厂记录冲突、结果待确认和字段校验。铜钴到厂登记复用同一表单异常处理。反向代理须从其宿主机读取 `dist/wms-unavailable.html` 以便在应用停止时显示 503。
