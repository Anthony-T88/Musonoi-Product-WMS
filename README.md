# Musonoi Product WMS 4.6.9-r2

当前以普通文件交付 4.6.9-r2，包含 server、dist、db、scripts、templates、deploy 及可复跑的 tests/release。第一阶段审计整改见 [AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md)。

- 氢氧化钴袋级库存采用批次展开清单；权限为横向勾选框，25 个模块、67 项权限。
- 本次审计整改修复部署迁移链和初始化校验、测试交付、Docker 文件边界、第 172 条迁移的前后断言，并将 Fastify 升级至 5.12.8。
- 现有 172 条 SQL 迁移原文与审计基线一致，保留历史数据及已确认的业务流程。

Node.js 22 以上，pnpm 11.25.0，PostgreSQL。`pnpm install --frozen-lockfile` 安装依赖；`pnpm test` 运行单元及规则测试；`pnpm run verify:integrity` 独立校验源码；`pnpm run test:acceptance` 执行数据库、接口、权限、并发及前端测试，所需独立 TEST 环境变量和浏览器设置见整改说明。

本机使用私有环境配置及 `pnpm start`；目标环境使用 `pnpm start:configured`，部署前完成 TLS、网络、地图、设备和环境验收。本机没有 Docker，镜像实际构建未验证，不能据此认定生产就绪。

仓库按用户决定保持公开。数据库备份来自本机 TEST，保留业务历史及账户，只提供 AES-256-GCM 加密文件 Musonoi-Database-V4.6.9-R2.dump.enc。密钥和明文备份仅保存在本机。

解密：`node decrypt-database.cjs 数据库.enc 本地私钥.json 新输出.dump`。使用 PostgreSQL pg_restore 恢复到新建独立数据库。验证结果见 VALIDATION.json，全部发布文件校验见 RELEASE_MANIFEST.json。
