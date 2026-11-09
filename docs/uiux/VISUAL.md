# 自动化视觉回归测试说明

## 准备隔离数据

按现有发行测试方式配置 `WMS_TEST_OWNER_URL` 和 `WMS_TEST_APP_PASSWORD`，使用回环地址上的 TEST PostgreSQL。运行下列命令。

```sh
pnpm run test:acceptance
node tests/release/uiux-fixtures.cjs
pnpm run test:uiux -- current .runtime/release-tests/uiux/current
pnpm run test:uiux:gate -- .runtime/release-tests/uiux/current
```

发行测试会建立随机命名的隔离库。可选的补充脚本通过正式业务接口生成待到厂、草稿入库和草稿装车计划场景。脚本输出受业务前置条件阻挡的样本。扫描会更新隔离测试账号的语言偏好。

## 覆盖与判定

- 浏览器记录实际注册的路由正则和可见导航。清单补充产品专用入口、查询参数、旧链接和单据状态。
- 管理员覆盖铜钴两个产品及中英文。按角色增加导航、列表、审批或权限场景。核心页面采集 1366×768、1440×900、1920×1080 的截图，重点页面再检查 390 像素窄屏。
- 采集文档宽度、控件文字裁切、表格及筛选区、标题和操作重复、无名称控件及低对比度候选。浏览器异常、数据缺失、权限拒绝和正常渲染分别记录。
- `--quick` 用于持续集成，覆盖代表性页面和已注册路由登记。全站专项验收运行完整模式。

## 截图基准

已复核的基准位于 `tests/release/uiux-baselines/`。每个场景声明用于比较的稳定矩形、平均色差和显著差异像素比例的容差。以相同操作系统、Chromium、视口和语言采集截图后运行下列命令。

```sh
pnpm run test:uiux:compare -- .runtime/release-tests/uiux/current
```

稳定矩形应避开日期、真实身份、动态任务数量和表格中的随机单号。渲染关闭动画并隐藏光标。跨平台使用布局门禁，避免系统字体渲染差异产生像素噪声。

出现差异时先打开当前图、基准图和对应页面，判断是业务数据变化、浏览器差异还是界面回归。基准变更按场景审核，保留原图及替换理由。
