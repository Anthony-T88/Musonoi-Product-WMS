# V3.5 验证

已完成隔离业务流程、销售统计及跳转、鼠标输入区滚动、按钮对齐、装车切换、中英文Excel导出与导回、九类旧报表、装箱单动态行及承诺签字区、PDF客户与批次、权限、备份恢复和生产空库迁移演练。

结果见[V3.5_TEST_RESULTS.json](V3.5_TEST_RESULTS.json)。源码完整性入口为 tests/source-integrity.cjs；部署预检为 scripts/preflight-v35.cjs。当前工作库仅做只读验收和历史表一致性核对。

完整云端验收尚未执行：服务器、域名和证书未配置，本机没有Docker构建环境。不得将本机通过等同于正式上线通过。
