# V2.4 完成报告

日期：2026-10-29。版本2.4.0，在现有项目HTML/CSS/JavaScript + Node.js/Fastify + PostgreSQL上增量实现。仅本机隔离测试，没有生产数据、外部源码上传、生产迁移或公网发布。

## 基线检查与保存

实际基线为V2.3提交1373e19，已存在V2.1/V2.2入库、备货及V2.3取样、检斤、装车、生产/商务/安保离场流程。开发前重跑原219项真实数据库检查、原128条演示回归和空库重建，均通过。读取现有API、权限及迁移，确认PostgreSQL16.14可用，原前端为静态HTML/CSS/JS，后端Fastify。

保存tag `v2.3-stable`、分支 `release/v2.3`；源码归档backups/v2.3-stable-source.zip及SHA256，升级前测试库转储backups/inventory-test-20261029-085505452.dump。创建 `v2.4-development`，开发库musonoi_inventory_v24_test与回归库musonoi_v24_regression_test由旧测试库独立复制，原V2.3库保留。密码、数据库文件、附件、备份与测试输出均被Git忽略。

## 实际功能与阶段记录

| 阶段 | 本地Git提交 | 实现与阶段验证 |
| --- | --- | --- |
| V2.4.1 | d576c71 | 盘点范围、任务、基准快照、逐捆/Excel、流转对账、复盘、独立审批与私有附件；8项 |
| V2.4.2 | 33ba7fa | 七类统一异常、服务端阈值、扫描去重、调查/独立处理/关闭及责任历史；8项 |
| V2.4.3 | d5ed1c0 | 盘盈/盘亏/净重/货位调整、独立审批、事务/版本/幂等与授权反向单；11项 |
| V2.4.4 | 39fe17e | 九类报表、历史截止、精确勾稽、权限筛选及预览截止一致的Excel；17项 |
| V2.4.5 | a8b78d7 | 七项驾驶舱指标、授权明细、趋势/库龄/客户/货位图表，手机导航；16项 |
| V2.4.6 | 本报告所在提交，执行git log查看 | 综合27项+历史/权限/异常补充18项，原业务完整回归、真实重启/恢复、文档与最终校验 |

保留原Logo、登录、中文导航、库存组合筛选、排序、分页、跨页勾选及CSV/XLSX。业务工作台增加盘点、异常、调整和报表，首页增加驾驶舱，手机页面可在驾驶舱与库存查询之间跳转。

盘点快照含全部厂内实物，包括锁定及装车未正式离场。保存观察版本，按“实盘值 + 期末账面 − 观察时账面”折算期间流转；新增入范围未观察项需核验，不伪报盘亏。批准报告不调整库存；重复盘点和未核验流转阻止批准。复盘保留各轮、附件、原因与动作。重量及货位同时不符时分别登记异常。

全部调整禁止申请人自审，草稿/待审批不动库存。批准时余额投影、库存流水、单据和审计同事务提交，重复/并发批准只生效一次。原始净重、原入库明细与已确认历史保留；盘亏使用ADJUSTED_OUT，不冒充正式车辆出库。逆向纠错创建新单重新审批，正式出库返场继续走V2.3流程。

## 数据库和核心口径

001–012旧迁移没有改写。增量013、013b、014、014b、015、015b、016、016b、017、018、019共11个迁移文件；最终合计27个，按SHA256校验、同事务及迁移锁执行。

新增核心关系：

- inventory_revisions→inventory_history/document_history；inventory_history_boundary、inventory_reporting_epoch确定可信历史起点，inventory_origins保存开账余额。
- stocktakes→stocktake_snapshot/stocktake_observations/stocktake_reconciliations/stocktake_steps；复用users、warehouses、yards、locations、batches、bundles。
- exception_rules→exception_rule_history；inventory_exceptions→exception_steps及原关联业务单据。
- stock_adjustments→adjustment_lines/adjustment_steps，关联exception_id及reverses_id；库存流水关联记账版本。附件复用workflow_attachments，不建重复主数据。

重量PostgreSQL numeric(14,6)，单位吨，API用十进制文本。SQL计算所有业务余额与报表，浏览器Number只用于图表比例及安全精度范围的Excel数值单元格；导出超Excel安全精度时保留文本。新增original_net_weight及调整来源，原确认单据和流水不覆盖。

正式离场confirmed_at与库存记账版本同一时点；安保观察时间单独保留。期末=期初+入库−正式离场+返场+调整+范围流转+开账。按仓库/客户/货位切换范围时通过流转项解释余额变化，装车/锁定不减少实物。

V2.3历史不足以复原任意旧日期。V2.4仅从可信升级/开账起点查询，早于起点返回422，跨起点明确partial。当前测试数据不能提供完整旧月份趋势；页面明确标注，不以当前库存替代过去库存。

所有业务写入与管理报表使用统一24000事务级记账锁，使版本、顺序及截止读保持一致，单据仍有版本和行锁。此方案优先保证当前规模正确性，跨项目写入和长报表会串行，是吞吐限制；V2.5应研究按项目分区、提交序列及异步报表，再保留同等级并发测试。

## 文件变化

新增：server/control-common.cjs、stocktakes.cjs、exceptions.cjs、adjustments.cjs、reports.cjs、dashboard.cjs；dist/controls.js、dashboard.js；11个数据库迁移；tests/v24-helper.cjs、v24-1至v24-6.cjs、v24-extra.cjs、v24-all.cjs、v24-durability.cjs；scripts/v24-test-accounts.cjs；V2_4_API.md、V2_4_RUNBOOK.md及本报告。

修改：server/app.cjs业务注册/版本；business-common.cjs统一记账锁；workflow-common.cjs非实物状态防护；receipt-import.cjs复用有界XLSX检查；workflow-attachments.cjs复用私有附件并冻结完成单据；bundle-history.cjs调整与盘点生命周期；inventory.cjs正式实物口径；dist/boot.js、api.js、app.js、index.html、history-ui.js、styles.css增量入口/展示/接口反馈；package.json、.env.example、scripts/db.cjs、local-db.ps1、prepare-regression.cjs更新独立V2.4默认环境；tests/v23-helper.cjs允许原回归指定新模板；tests/restore.cjs加强全部表和结构比较；README、VALIDATION、db/MIGRATIONS更新当前说明。

精确文件清单以 `git diff --stat v2.3-stable..HEAD` 为准。`.env`仅本机切换到新测试库，未提交；旧配置仅保存于被忽略的.runtime/v23.env。

## 实际测试结果

最终完整回归 `node tests/v24-all.cjs` 全部通过，共 **324项明确计数检查**：V2.1 49、V2.2 81、V2.3 89、V2.4 105；另有原128条演示回归及空库重建/重复迁移通过。原219项全部保留。真实PostgreSQL测试通过Fastify真实处理链app.inject执行，不是假数据库；浏览器页面另行验收。

V2.4覆盖：快照含锁定/装车、实盘后移库及离场无假差异、新入库待核验、复盘与独立审批、批准结果冻结；Excel模板可读、公式/重复/错误行定位、后行错误整批回滚；未审批不改库存、自审拒绝、同key与异key并发批准、后行版本冲突全事务回滚；盘盈唯一/未来日期拒绝、盘亏及新反向恢复、位置不改总量、附件摘要冻结、原净重保留；调整后再装车/离场精确扣除已授权余额；历史取样状态及非空盘点/调整报表；服务端客户/位置过滤及只读导出拒绝；各期勾稽与截止导出一致。

额外只在独立验收副本通过owner注入一条标注test_injected_ledger_fault的错误流水，验证LEDGER异常被真实识别且不自动修改库存；该故障未注入开发库、回归基线或生产库。

2026-10-29实际正常停止/启动本项目PostgreSQL：停库时health/inventory/dashboard返回503，无模拟回退。重启前后恢复测试库53张表数量与内容哈希全部一致，含盘点、调整、库存历史和审计。新库恢复：musonoi_restore_test_20261029095453955，53表、131捆、全部表内容哈希一致，函数/触发器/约束定义一致。这里293.865143吨为所有档案净重合计（含已离场档案），不是当前厂内实物指标。

备份：backups/inventory-test-20261029-095453765.dump及SHA256；源为musonoi_v24_recovery_1793260468012_test，恢复始终新建库，没有覆盖旧业务库。证据：test-output/v24-results.json、v24-restart-results.json、v24-database-unavailable.json、v24-restore-results.json。应用重启及数据库故障处理也由V2.1集成测试复验。

浏览器实际验收：登录会话恢复，创建货位盘点并登记2.322000吨后显示一致；日报勾稽0，真实下载Excel；指标卡打开同版本授权明细；390×844手机布局及新旧页导航验证。截图、界面验收记录在test-output，未将浏览器显示成功代替事务测试。

## 遗留限制与V2.5建议

1. 仅本机隔离测试，未经过生产真实数据、现场操作人员签字验收、长时间压力/高可用演练；没有执行断电、磁盘损坏、WAL损坏或物理崩溃注入。正常停启、服务不可用及新库恢复已实测，不能扩写为上述破坏性验证通过。
2. 历史截止范围从V2.4可靠开账起点开始，无法补造更早历史。正式迁移前应清点历史流水完整性、确定授权开账与审计签字，再另行设计迁移。
3. 阈值扫描为授权人员手动发起；盘点批准自动生成盘差异常。尚无定时调度、邮件/短信推送或长期无人值守预警。
4. 为防部分授权当全仓，盘点需仓库完整客户范围；调整需完整项目客户与仓库范围。细粒度部门协作可在V2.5设计授权分区与复核汇总，不能直接放开整单信息。
5. 当前全局记账锁限制吞吐；最多367日报表、10000行导出，XLSX实盘每批500行、512KiB，私有附件256KiB。大规模任务、分块异步导出、对象存储、附件病毒扫描和容量监控需扩展。
6. 当前审批支持驳回后新建申请/新反向单，不提供直接删除、修改历史或批量自动纠错。未盘捆包在开放任务中暂列盘亏候选，提交审批前应完成实盘/复盘；批准差异也不会自动扣库。
7. 建议V2.5增加盘点任务分派界面、条码/PDA、盲盘/双人复盘、带时区自定义截止、周期结账与库存关账、规则定时任务、监控告警、备份加密与异地恢复、按项目并发扩容及组织权限审计。联网与生产部署需独立批准。

运行与业务流程详见[V2.4运行手册](V2_4_RUNBOOK.md)，API详见[V2.4接口文档](V2_4_API.md)。本版本交付不代表已上线正式生产环境。
