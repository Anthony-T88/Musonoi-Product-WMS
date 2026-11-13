# Musonoi Product WMS 4.8.0

Runtime baseline: PostgreSQL migration 190. Upgrade the existing database after verifying a full backup and a migration dry run.

[UI design standard](docs/uiux/DESIGN.md) | [UI coverage](docs/uiux/COVERAGE.md) | [UI quality checks](docs/uiux/QUALITY.md)

## V4.7.2 release history


V4.7.2 从 V4.7.1-ui1（迁移 181）增量开发，新增独立铜钴出口许可证、审批、额度预占与核销。使用许可证的新装车计划由后端分配发票号，现有单据编号和 UUID 保留。运行时要求迁移 182。

许可证核销、销售开票确认、ARECOMS 确认和正式出库分别保留独立依据。迁移给指定岗位新增权限，并沿用现有授权变更后的重新登录规则。

V4.7.2 发布分支保留当前源码、配置样例及文档。旧版审计交付、加密备份及配套工具保存在原历史提交。[历史归档](https://github.com/Anthony-T88/Musonoi-Product-WMS/tree/16097779a3f19edf5465c324f9a2833a52d14ef1)

下文保留既有可靠性和运行环境说明。
[第二批报告](https://github.com/Anthony-T88/Musonoi-Product-WMS/blob/16097779a3f19edf5465c324f9a2833a52d14ef1/docs/reliability-r3-rc2/REPORT.txt) · [实体映射](https://github.com/Anthony-T88/Musonoi-Product-WMS/blob/16097779a3f19edf5465c324f9a2833a52d14ef1/docs/reliability-r3-rc2/audit-entity-matrix.json) · [回滚说明](https://github.com/Anthony-T88/Musonoi-Product-WMS/blob/16097779a3f19edf5465c324f9a2833a52d14ef1/docs/reliability-r3-rc2/ROLLBACK.txt) · [第一批报告](https://github.com/Anthony-T88/Musonoi-Product-WMS/blob/16097779a3f19edf5465c324f9a2833a52d14ef1/docs/security-r3-rc1/REPORT.txt)

修复钴匹配审核目录、代理登录限流、未知ARECOMS统计、真实业务审计范围及授权连接异常清理。业务状态机与独立审核规则保留，注册申请仍仅系统管理员审批。

V4.7.1 完整继承现有 178 条迁移及其校验值。原 r2 加密 TEST 备份保持第 172 号迁移基线。rc3 自动验收使用独立合成数据，历史备份恢复由授权环境复核。

测试需要Node.js >=22、pnpm11.25.0和独立TEST PostgreSQL。运行pnpm install --frozen-lockfile、pnpm test、pnpm run verify:integrity；设置报告所述测试环境后pnpm run test:acceptance创建随机隔离库执行完整验收。

GitHub Actions使用全新临时数据库及随机遮蔽密码，安排真实Docker构建和合成生产模式TLS启动。实际通过与否以Draft PR检查记录和交付报告为准，配置检查不能替代镜像实测。

代理默认不受信任。部署前按Nginx真正连接应用的来源IP填写TRUSTED_PROXY_IPS（精确IP，无网段或通配符），并覆盖转发头。V4.7.1 交付范围为本地 TEST。
