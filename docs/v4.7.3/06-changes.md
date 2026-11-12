# V4.7.3 文件变更

开发基线 `3e8f0d6d1a667828c1ba9f4cd42441af0d74eaea`。

| 类型 | 文件 |
| --- | --- |
| 修改 | `README.md` |
| 修改 | `RELEASE_MANIFEST.json` |
| 修改 | `SOURCE_MANIFEST.json` |
| 修改 | `VALIDATION.json` |
| 修改 | `db/migration-baseline.json` |
| 新增 | `db/migrations/183_v473_single_session.sql` |
| 新增 | `db/migrations/184_v473_copper_storage_areas.sql` |
| 修改 | `dist/api.js` |
| 修改 | `dist/boot.js` |
| 修改 | `dist/export-licenses.js` |
| 修改 | `dist/i18n-v262.js` |
| 修改 | `dist/i18n.js` |
| 修改 | `dist/index.html` |
| 修改 | `dist/map-viewport.css` |
| 新增 | `dist/registration-policy.js` |
| 修改 | `dist/registration-ui.js` |
| 修改 | `dist/release.js` |
| 修改 | `dist/router.js` |
| 修改 | `dist/stock-map.js` |
| 修改 | `dist/sw.js` |
| 修改 | `dist/uiux-governance.css` |
| 修改 | `dist/v26-ui.js` |
| 修改 | `dist/v262-supplement.js` |
| 修改 | `dist/v27-stocktaking.js` |
| 修改 | `dist/v27-ui.js` |
| 修改 | `dist/v271-map.js` |
| 新增 | `docs/v4.7.3/01-baseline.md` |
| 新增 | `docs/v4.7.3/02-design-review.md` |
| 新增 | `docs/v4.7.3/03-deployment.md` |
| 新增 | `docs/v4.7.3/04-release-report.md` |
| 新增 | `docs/v4.7.3/previews/licenses.html` |
| 新增 | `docs/v4.7.3/previews/preview.css` |
| 新增 | `docs/v4.7.3/previews/sales-detail.html` |
| 新增 | `docs/v4.7.3/previews/sales.html` |
| 修改 | `package.json` |
| 修改 | `scripts/run-release-tests.cjs` |
| 修改 | `server/app.cjs` |
| 新增 | `server/copper-storage-label.cjs` |
| 修改 | `server/export-licenses.cjs` |
| 修改 | `server/inventory.cjs` |
| 新增 | `server/login-session.cjs` |
| 修改 | `server/management-security.cjs` |
| 修改 | `server/registration-requests.cjs` |
| 修改 | `server/release.cjs` |
| 修改 | `server/stock-map.cjs` |
| 修改 | `server/v26.cjs` |
| 修改 | `server/v261.cjs` |
| 修改 | `server/v262.cjs` |
| 修改 | `server/warehouse-templates.cjs` |
| 修改 | `tests/release/copper-core.cjs` |
| 修改 | `tests/release/database.test.cjs` |
| 修改 | `tests/release/migrations.test.cjs` |
| 修改 | `tests/release/security.test.cjs` |
| 修改 | `tests/release/ui.test.cjs` |
| 修改 | `tests/release/uiux-inventory.json` |
| 修改 | `tests/release/uiux-matrix.cjs` |
| 修改 | `tests/release/uiux-routes.cjs` |
| 新增 | `tests/release/v473-performance.cjs` |
| 新增 | `tests/release/v473-security.cjs` |
| 新增 | `docs/v4.7.3/05-test-evidence.json` |
| 新增 | `docs/v4.7.3/06-changes.md` |
| 新增 | `docs/v4.7.3/previews/license-application.html` |

## V4.7.3-ui2 改版补充

- 许可证台账、详情和申请表由 `dist/export-licenses.js` 更新。记录簿的存储及校验由迁移 185、`server/export-license-books.cjs` 和 `server/export-licenses.cjs` 实现。
- 销售计划列表、详情及关联单据由 `dist/ui468.js`、`dist/ux10-sales.js`、`server/sales-approval.cjs` 和 `server/sales-invoices.cjs` 更新。
- 浏览器回归增加铜钴七类记录簿、账户过滤、重进表单、键盘和窄屏验证。业务回归增加银行不匹配拒绝、独立审核修改、历史资料迁移及销售执行数据断言。
