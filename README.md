# 穆松尼项目产品仓储管理系统

**Musonoi Project Product WMS · V2.6.2**

本仓库仅提供当前V2.6.2源码、说明和验收测试。

## 当前功能

- 信息总览：入库、在库、出库核心指标及业务阶段分组；区分期间发生量、现场实物、账面库存与已离场待审批货物。
- 库存查询与地图：授权范围查询、导出、片数与四位吨位；P5公共临时堆存区及正式货位独占。
- 入库：固定Musonoi客户和临时区、捆包片数、批次识别及审核入账。
- 备货：Lot锁定、分阶段取样/检斤、铅封、主管确认归位、受控撤回和撤销。
- 装车与出库：分车装载、现场审核、真实离场及物流经理最终审批。
- 账户管理：五角色、多员工、逻辑删除、原ID恢复、会话撤销与角色权限上限。
- 中文/英文：单语言品牌、业务界面翻译及原地切换；保留表单输入、业务原文和滚动位置。

## 使用

Node.js >=22，项目使用pnpm。安装依赖后，在本机配置自己的环境和已核验的TEST数据库：

```powershell
pnpm install --frozen-lockfile
# 仅首次配置时复制示例，并在本机填写凭据，不提交.env
Copy-Item .env.example .env
pnpm start
```

本机入口：[信息总览](http://127.0.0.1:4176/overview)。启动脚本明确使用本机TEST数据库，不执行迁移、清理、演示数据注入或密码重设。已有.env不能用示例覆盖。仓库不附带数据库、账号密码或备份；首次环境应通过管理员核验的数据库交付与配置完成初始化。

只有核实目标后才增量迁移：

```powershell
node scripts/db.cjs migrate musonoi_v26_development_test
```

## 当前文档

- [功能与交付说明](RELEASE.md)
- [接口与统计口径](API.md)
- [运行与交接](HANDOFF.md)
- [验证说明](VALIDATION.md)
- [数据库迁移](db/MIGRATIONS.md)
- [云端源码说明](CLOUD_SOURCE.md)

## 验证

```powershell
pnpm test
pnpm test:flow
pnpm test:accounts
pnpm test:overview
pnpm test:browser
```

默认测试检查源码、依赖、资源和文档完整性，不连接或修改数据库。业务测试必须使用已恢复的独立TEST副本和本机受保护的验收凭据，具体条件见[验证说明](VALIDATION.md)。

## 仓库结构

当前界面在dist，服务在server，运行及维护工具在scripts，当前验收在tests。73条SQL迁移构成当前数据库结构，全部保留且不可改写已执行文件。部分当前模块和协议路径保留v26/v261命名，它们仍被V2.6.2调用，不是独立旧版安装包。

同步到私有GitHub仓库供Codex云端读取源码，不自动配置云端数据库或部署业务服务。敏感环境、数据库、附件及运行产物由管理员在各环境独立管理。
