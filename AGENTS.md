# Musonoi WMS

- 用户未明确要求调整界面时，沿用现有布局、栏目和交互。数据修复接入原有列表、指标和详情入口。新增区域、控件或布局调整须有用户明确指令。
- 凡涉及前端页面、组件、布局、样式、表单、表格、弹窗或交互的新增与修改，开发前须读取[《穆松尼 WMS 全站设计规范》](docs/uiux/DESIGN.md)，复用共享主题和公共组件。
- 现有组件无法覆盖新需求时，优先扩展公共组件并同步更新规范。业务专用布局须在规范中记录适用场景。涉及界面的变更在提交说明中列出受影响页面及验证结果。
- Use the [UI review checklist](docs/uiux/QUALITY.md) and update the [page coverage inventory](docs/uiux/COVERAGE.md) when a route, scenario or exception changes.
- Add new page and state examples to `tests/release/uiux-routes.cjs`. Run the static UI gate, affected browser checks and business regression before handoff. Record uncovered roles or states explicitly.
- Keep permission checks, approval actions, calculation units, statutory warnings and historical data intact when making UI changes. Review dependency and permission behavior before removing a business control.

## 本地开发工具复用

- Windows 本机开发使用工作区固定目录 `../.musonoi-toolchain/`。兼容锁文件的独立版本、工作树和验收副本通过该目录下的 `node_modules` 目录联接复用现有依赖。版本更新和修复前先核对锁文件和现有工具，再决定是否安装缺少的依赖。
- Node.js、pnpm、Chromium 和 PostgreSQL 等通用工具共用本机已有的一套安装。确需不同依赖版本时，在固定工具目录内按锁文件维护共享副本。发布环境沿用各自的锁文件与构建方式，数据库、环境变量和运行数据按环境隔离。
