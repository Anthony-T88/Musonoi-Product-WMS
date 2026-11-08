# Musonoi Product WMS 4.6.9-r3-rc2

第二批可靠性审计整改候选，固定基线28988c4b814d1120414effc787c9566bf91c022f。独立Draft PR目标为fix/v4.6.9-r3-rc1-security，等待用户及GPT复审，不自动合并或部署。

[第二批报告](docs/reliability-r3-rc2/REPORT.txt) · [实体映射](docs/reliability-r3-rc2/audit-entity-matrix.json) · [回滚说明](docs/reliability-r3-rc2/ROLLBACK.txt) · [第一批报告](docs/security-r3-rc1/REPORT.txt)

修复钴匹配审核目录、代理登录限流、未知ARECOMS统计、真实业务审计范围及授权连接异常清理。业务状态机与独立审核规则保留，注册申请仍仅系统管理员审批。

原001—173迁移字节不变，仅追加174；启动要求完整验证至174。原r2加密TEST备份保持172基线，测试不读取或还原该备份。未上传密钥、真实密码或明文业务数据。

测试需要Node.js >=22、pnpm11.25.0和独立TEST PostgreSQL。运行pnpm install --frozen-lockfile、pnpm test、pnpm run verify:integrity；设置报告所述测试环境后pnpm run test:acceptance创建随机隔离库执行完整验收。

GitHub Actions使用全新临时数据库及随机遮蔽密码，安排真实Docker构建和合成生产模式TLS启动。实际通过与否以Draft PR检查记录和交付报告为准，配置检查不能替代镜像实测。

代理默认不受信任。部署前按Nginx真正连接应用的来源IP填写TRUSTED_PROXY_IPS（精确IP，无网段或通配符），并覆盖转发头。未连接或修改现有业务库，没有生产上线验收。
