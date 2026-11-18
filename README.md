# Musonoi Product WMS

## 版本更新

每次发布在此处按版本倒序记录主要业务变化、用户可见修复和必要的升级提示。

### V4.8.6

- 车辆出厂列表直接统计有效历史出库记录。历史详情链接打开对应出库单，桌面筛选按一行排列。
- 许可证创建入口更名为「新建出口许可证档案」。记录簿调整行操作的位置，已用量和剩余量显示四位小数。
- 历史导入列表只显示一组分页控件，并按当前页汇总明细重量。车辆出厂列表用同一次查询返回记录、状态统计和客户筛选项。
- 优化铜钴总览图表的悬浮提示和重绘，修复页面窄屏溢出、部分英文显示和按钮对齐问题。

## V4.7.4

V4.7.4 基于已交付的 V4.7.3-ui2 开发。本地 TEST 使用迁移 186，前端设计规范修订为 V4.7.4-ui2。

[全站设计规范](docs/uiux/DESIGN.md) · [页面覆盖与验收](docs/uiux/COVERAGE.md) · [质量门禁](docs/uiux/QUALITY.md)

[V4.7.4 变更和验收报告](docs/v4.7.4/acceptance.md) · [阴极铜库存地图方案](docs/v4.7.4/copper-map-proposal.html) · [氢氧化钴库存地图方案](docs/v4.7.4/cobalt-map-proposal.html)

[V4.7.3 交付报告](docs/v4.7.3/04-release-report.md) · [部署评估](docs/v4.7.3/03-deployment.md) · [页面评审方案](docs/v4.7.3/02-design-review.md)

## V4.7.2 开发基线

V4.7.2 从 V4.7.1-ui1（迁移 181）增量开发，新增独立铜钴出口许可证、审批、额度预占与核销。使用许可证的新装车计划由后端分配发票号，现有单据编号和 UUID 保留。运行时要求迁移 182。

许可证核销、销售开票确认、ARECOMS 确认和正式出库分别保留独立依据。迁移给指定岗位新增权限，并沿用现有授权变更后的重新登录规则。

下文保留既有可靠性和运行环境说明。
[第二批报告](docs/reliability-r3-rc2/REPORT.txt) · [实体映射](docs/reliability-r3-rc2/audit-entity-matrix.json) · [回滚说明](docs/reliability-r3-rc2/ROLLBACK.txt) · [第一批报告](docs/security-r3-rc1/REPORT.txt)

修复钴匹配审核目录、代理登录限流、未知ARECOMS统计、真实业务审计范围及授权连接异常清理。业务状态机与独立审核规则保留，注册申请仍仅系统管理员审批。

V4.7.1 完整继承现有 178 条迁移及其校验值。原 r2 加密 TEST 备份保持第 172 号迁移基线。rc3 自动验收使用独立合成数据，历史备份恢复由授权环境复核。

测试需要Node.js >=22、pnpm11.25.0和独立TEST PostgreSQL。运行pnpm install --frozen-lockfile、pnpm test、pnpm run verify:integrity；设置报告所述测试环境后pnpm run test:acceptance创建随机隔离库执行完整验收。

GitHub Actions使用全新临时数据库及随机遮蔽密码，安排真实Docker构建和合成生产模式TLS启动。实际通过与否以Draft PR检查记录和交付报告为准，配置检查不能替代镜像实测。

代理默认不受信任。部署前按Nginx真正连接应用的来源IP填写TRUSTED_PROXY_IPS（精确IP，无网段或通配符），并覆盖转发头。V4.7.1 交付范围为本地 TEST。
