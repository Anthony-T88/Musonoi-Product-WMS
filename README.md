# Musonoi Product WMS 4.6.9-r3-rc1

第一批安全整改候选分支，等待用户和 GPT 复审。仅提交独立 PR，不自动合并或部署。普通源码文件交付。

[给 GPT 的完整修复报告](docs/security-r3-rc1/REPORT.txt) · [测试证据](docs/security-r3-rc1/TEST_RESULTS.json) · [回滚说明](docs/security-r3-rc1/ROLLBACK.txt)

修复角色自授权、账号跨范围及管理员操作、旧新审计入口隔离、权限变更后的会话及在途请求一致性。铜钴业务审批流程和独立审核规则保持原样。注册申请审批按用户确认限定为系统管理员。

保留 172 条旧迁移原文，仅追加 173 安全迁移。原 r2 加密 TEST 备份保持不变，仍是 172 迁移基线；候选版启动需要先完成受控迁移至 173，不能直接运行于未迁移的原业务库。密钥和明文数据没有上传。

运行测试需要 Node.js >=22、pnpm 11.25.0 和独立 TEST PostgreSQL。`pnpm install --frozen-lockfile`，`pnpm test`，`pnpm run verify:integrity`。设置报告列明的 TEST 环境及浏览器后，`pnpm run test:acceptance` 执行数据库、权限、并发和前端回归。测试仅创建随机审计库。

具体权限收紧、测试覆盖、连接池预算与剩余风险见报告。旧 AUDIT_REMEDIATION.md 是此前 r2 工程整改记录，本候选以本次报告为准。本次没有生产上线验收或 Docker 镜像构建，不代表生产就绪。
