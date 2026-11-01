# V3.5 数据库迁移

当前完整链136条，本轮无新增迁移。必须按文件排序执行全部迁移，已执行文件的SHA256不得改变。保留历史命名文件，不以旧版本清理为由删除迁移。

本机TEST迁移使用 scripts/db.cjs，正式环境使用 scripts/production-db.cjs。正式迁移拒绝把TEST库转换为生产库；已存在生产库升级前必须验证备份。

数据及上线边界见[数据库说明](../DATABASE_REPORT.md)和[运行说明](../RUNBOOK.md)。
