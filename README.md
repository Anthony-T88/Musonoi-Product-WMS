# Musonoi Product WMS 4.6.9-r3-rc3

两批审计整改整合候选。候选分支承接第二批最终提交 `7e25ec3d1b4e20ec75dd9671b16b7003354f6a47`，整合 Draft PR 目标为 `main`。

[第二批报告](docs/reliability-r3-rc2/REPORT.txt) · [实体映射](docs/reliability-r3-rc2/audit-entity-matrix.json) · [回滚说明](docs/reliability-r3-rc2/ROLLBACK.txt) · [第一批报告](docs/security-r3-rc1/REPORT.txt)

修复钴匹配审核目录、代理登录限流、未知ARECOMS统计、真实业务审计范围及授权连接异常清理。业务状态机与独立审核规则保留，注册申请仍仅系统管理员审批。

整合版原样继承第 001—174 号迁移，运行时要求完整验证至 174。原 r2 加密 TEST 备份保持第 172 号迁移基线。rc3 自动验收使用独立合成数据，历史备份恢复由授权环境复核。

测试需要Node.js >=22、pnpm11.25.0和独立TEST PostgreSQL。运行pnpm install --frozen-lockfile、pnpm test、pnpm run verify:integrity；设置报告所述测试环境后pnpm run test:acceptance创建随机隔离库执行完整验收。

GitHub Actions使用全新临时数据库及随机遮蔽密码，安排真实Docker构建和合成生产模式TLS启动。实际通过与否以Draft PR检查记录和交付报告为准，配置检查不能替代镜像实测。

代理默认不受信任。部署前按Nginx真正连接应用的来源IP填写TRUSTED_PROXY_IPS（精确IP，无网段或通配符），并覆盖转发头。未连接或修改现有业务库，没有生产上线验收。
