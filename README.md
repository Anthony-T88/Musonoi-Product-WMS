# 穆松尼项目产品仓储管理系统 V3.5

版本3.5.0。Copyright © 2026 唐雷 (Tang Lei). All rights reserved.

包含客户与销售管理、入库、备货、库存查询与地图、装车管理、出库及装箱单、盘点、报表、权限与审计。按既有规则仅正式出库扣减库存，净重每捆减2.5kg，装车管理单与装车单保持1:1。

本地运行：Node.js 22以上，pnpm按package.json固定版本安装；填写私有.env后执行 pnpm start。此命令仅连接本机TEST，不迁移、不初始化、不清理数据。正式环境入口为 node server/app.cjs，见[部署说明](RUNBOOK.md)。

[修复清单](V3.5_IMPLEMENTATION.md) · [测试结果](V3.5_TEST_RESULTS.json) · [上线前自检](V3.5_PREFLIGHT.md) · [接口](API.md) · [数据库](DATABASE_REPORT.md) · [版权许可](LICENSE)

GitHub主分支仅维护当前源码，不包含旧交付包、旧发布报告、账号口令、业务数据库、附件和备份。运行代码中的API兼容模块与全部136条历史迁移属于当前版本依赖，继续保留。
