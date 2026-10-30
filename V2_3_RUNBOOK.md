# V2.3 本地运行与操作手册

## 启动、账号和隔离

当前电脑已初始化，不要重复init/provision/seed，不要覆盖.env。在项目目录PowerShell 7执行：

```powershell
./scripts/local-db.ps1 start
node server/app.cjs
```

打开 http://127.0.0.1:4174/ 。交付时两个服务保持运行，端口占用时先使用现有页面，电脑重启后需手动启动。数据库和网页分开启动，不把数据库的生命周期附着在网页终端上。

Node不在PATH时可用：

```powershell
& 'C:/Users/15008/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' server/app.cjs
```

使用Git忽略的 `.runtime/test-accounts.json` 查看本机随机密码；不要对外分享或纳入源码。旧账号密码未改变。

| 账号 | 主要用途 |
| --- | --- |
| test_admin | 全项目测试管理，异常/冲销申请，不能单人绕过独立审批 |
| test_operator | 入库、取样、检斤、装车、移库 |
| test_supervisor | 独立入库审核、异常/取消/冲销审批 |
| test_production | 生产装箱单确认和实际离场/返场最终确认 |
| test_commerce | 商务复核出库资料及离场条件 |
| test_security | 安保实际离场、返场观察核验 |
| test_sales | 原客户范围查询/备货/导出 |
| test_viewer | 原客户范围只读，无写入和导出 |

所有测试账号都是虚构用户。正式账户须根据岗位明确项目/客户/仓库范围。当前网页仅127.0.0.1:4174，独立PostgreSQL仅127.0.0.1:55432，未开放局域网、公网或修改防火墙。原V2.2库保留，当前.env指向musonoi_inventory_v23_test；128条独立回归库为musonoi_v23_regression_test。

## 操作顺序

1. 保留的V2.2入库/备货继续使用。客户要装车的捆包先正式锁定，不能拿“在库可用”直接当作客户已备货。
2. 顶部“业务→取样检验”登记机构、日期、客户及多个编号；复检新建一批，结果合格/不合格或取消均保留。附件最多256KiB，仅PDF/PNG/JPEG，不扣库存。
3. “车辆装车”输入车牌、运输商、装车点、带时区时间及编号，或先在库存页筛选分配客户/已预留并跨页勾选，进入装车表带入。保存草稿就占用车辆捆包，装车完成后可下载装箱单Excel，仍不扣库存。
4. 在装车详情“登记本车检斤”带入车辆、客户、单据及捆包；录毛重、皮重、平台秤编号及时间，净重/差异由数据库计算。独立“检斤”也可记录单捆/无装车关联车辆，但正式出库须用对应装车单的车辆磅单。
5. 返回装车详情，选择本车最新有效磅单并创建出库审批。磅单捆包必须与装车完全匹配。审批开始后如需重新检斤，先主管取消或节点驳回审批。
6. 使用test_production确认装箱单；非零差异先由未操作该检斤的主管独立接受并说明原因。使用test_commerce勾选资料及离场条件复核；使用test_security核验实际车辆/实际离场及现场观察时间；最后test_production勾选实际离场确认扣库。不能将计划发车作为已离场。
7. 实际核验前异常可由主管取消或当前审核部门驳回，再到装车单填写原因整车退装。退装不解除客户锁；需要解除时另在客户备货办理。
8. 已正式出库纠错：test_admin或主管申请冲销，另一位主管批准；test_security实际确认整车货物退回；test_production最终确认。只有最后一步恢复库存，旧出库及审批全保留，不自动复活客户锁/车辆占用。不得在货物未回厂时点击返场。
9. “货位移库”选择客户、目标货位、多捆编号和原因，整批确认。已装车捆包须先退装；已出库不能移库。移库只变位置，不改重量。
10. 库存捆包“详情→相关库存流水与操作历史”查看全流程。当前分配客户是有效备货，出库客户是已正式出库目的客户，货权客户是原货主，三者不要混淆。Excel/CSV使用当前筛选/已选和相同授权口径。

时间输入采用含时区ISO，例如2026-10-28T08:00:00+02:00；页面默认当前UTC，保存为TIMESTAMPTZ，项目业务日期沿用Africa/Lubumbashi。重量单位均吨，API十进制文本最多六位。移动设备表格可横向滚动，业务入口在顶部。

## 测试与恢复

```powershell
node tests/v23-all.cjs
# 或 pnpm test:v23
./scripts/local-db.ps1 backup
./scripts/local-db.ps1 restore-test -Archive '项目绝对路径/backups/inventory-test-实际时间戳.dump'
node tests/restore.cjs
```

全测试从独立回归基线克隆阶段库，保留测试库用于核查，故障注入只在克隆中；不会在开发库真实扣库存。日志写test-output/v23-results.json。恢复只写新库，先核对SHA256，原数据库不覆盖。恢复校验比较所有业务表数量和捆包内容/重量哈希；校验期间避免新的登录、导出或业务写入改变源库计数。

## 新电脑空环境

需要Node.js22+、pnpm11.25.0、PowerShell7、PostgreSQL16+。当前电脑复用的PostgreSQL程序位于E:\Odoo 19.0.20260601\PostgreSQL\bin，仅用程序，不操作其服务/数据。其他电脑给local-db.ps1传实际-PgBin。

仅在新副本、空集群执行：

```powershell
pnpm install --frozen-lockfile
./scripts/local-db.ps1 init
./scripts/local-db.ps1 start
node scripts/db.cjs provision
node scripts/db.cjs migrate
node scripts/db.cjs seed-test
node scripts/v23-test-accounts.cjs
node scripts/prepare-regression.cjs v23
node tests/v23-all.cjs
node server/app.cjs
```

provision存在角色会拒绝轮换密码，seed非空库拒绝，迁移/播种仅允许test及受限命名数据库。独立回归播种凭据在.runtime/v23-regression-accounts.json；现有克隆库自动使用原账号文件，均不重置开发账号。

回退不能只切旧代码连新数据库继续业务。使用v2.2-stable源码独立副本，恢复对应V2.2备份到新库，核对连接和数据后再切换。V2.3有新增出库历史，不提供破坏性down迁移。需要停止时网页终端Ctrl+C，数据库另执行local-db.ps1 stop；交付时不停止。

V2.3出库冲销不能替代尚缺的已确认入库授权调整。部分退装/部分返货、地磅/闸机接入、企业容差、化验分项、生产联网及异机灾备见完成报告的V2.4建议。
