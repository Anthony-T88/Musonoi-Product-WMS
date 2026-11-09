# 自动化视觉回归测试说明

## 从干净检出运行

使用 Node.js 24 和锁定依赖。按发行测试配置回环地址上的 WMS_TEST_OWNER_URL 和 WMS_TEST_APP_PASSWORD。每次完整验收生成随机命名的隔离合成 TEST 库。

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node tests/release/uiux-verify.cjs .runtime/release-tests/uiux/verification
```

Windows 像素验收使用已复核的 Chromium 版本。必要时设置 CHROME_EXECUTABLE 指向同版本浏览器，并添加 --pixel。使用新的输出目录再次运行可生成独立数据集和对照结果。

```sh
node tests/release/uiux-verify.cjs .runtime/release-tests/uiux/verification-2 --pixel
```

## 分步复核

```sh
node tests/release/uiux-quality.cjs static
node scripts/run-release-tests.cjs acceptance
node tests/release/uiux-fixtures.cjs
node tests/release/uiux-audit.cjs current .runtime/uiux/quick --quick
node tests/release/uiux-quality.cjs layout .runtime/uiux/quick quick
node tests/release/uiux-audit.cjs current .runtime/uiux/full
node tests/release/uiux-quality.cjs layout .runtime/uiux/full full
node tests/release/uiux-quality.cjs compare .runtime/uiux/full full
node tests/release/uiux-workflows.cjs .runtime/uiux/workflows
```

快速和完整扫描由不同的必测矩阵驱动。布局门禁从源码重算矩阵，并检查产品路由锁、精确落地地址、关键控件、授权拒绝、截图像素尺寸和文件哈希。旧取样和检斤的列表及详情均验证原地址的拒绝页和对应接口的 403，详情使用合成历史样本。缺少合成样本默认失败。

## 证据

- coverage.json 包含提交、产品、角色、语言、分辨率、业务状态、落地地址、控件和页面问题。
- pixel-results.json 逐图记录平均色差、显著差异像素比例、容差及结果。权限矩阵、库存金属量和正式出库净重及确认值均有稳定裁剪区域。仅出库数字区允许横向配准 10 像素，以适应左侧合成合同和车牌的字宽变化。报告保留实际偏移值。
- workflows.json 记录实际审批、旧入口操作、键盘筛选及 Excel 下载结果。filter-390 PNG 包含完整筛选区域。
- exits.json 记录每个执行阶段退出码。shipment-results.json 汇总发运测试的 8 项子检查。failed PNG 留存失败页面。
- 截图基准按图审核。另一个操作系统或浏览器版本以布局和操作门禁为准，像素对比使用匹配环境。
