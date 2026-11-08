# Musonoi Product WMS 4.6.9-r2

当前仓库以普通源码文件交付 4.6.9-r2，可直接浏览 server、dist、db、scripts、templates、deploy 目录。

- 氢氧化钴袋级库存采用批次展开清单，保留筛选、分页、实际货位调整、历史与 Excel 导出。
- 账户权限采用横向勾选框，25 个业务模块、67 项权限，初审和终审独立设置。
- 保留当前运行依赖的完整 172 条数据库迁移。

运行需要 Node.js 22 以上、pnpm 11.25.0、PostgreSQL 及私有环境配置。安装依赖后运行 pnpm test 核验源码，pnpm start 启动本机 TEST；目标环境部署使用 pnpm start:configured，并完成目标环境验收。

数据库来自本机 TEST，保留业务历史和账户。仓库仅提供 AES-256-GCM 加密备份 Musonoi-Database-V4.6.9-R2.dump.enc；解密密钥单独保存在本机，未上传。

解密：node decrypt-database.cjs 数据库.enc 本地私钥.json 新输出.dump
使用 PostgreSQL pg_restore 恢复到新建独立数据库。验证结果见 VALIDATION.json，文件校验见 RELEASE_MANIFEST.json。
