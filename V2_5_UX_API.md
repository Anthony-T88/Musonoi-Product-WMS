# V2.5-UX API 增量说明

业务 API 前缀继续为 `/api/v1`；HTML 页面路径独立于 API，不改变原有服务端授权、CSRF、Idempotency-Key 和版本控制。

## 客户与合同

复用 `/masters/customers` 新增/修改及 `/masters` 查询。客户是主数据，合同是独立一对多记录。

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| GET /contracts | master:read | search、customer_id、validity 筛选；最多1000条，项目/客户范围校验 |
| GET /contracts/:id | master:read | 详情及服务端有效期状态，越权对象返回404 |
| POST /contracts | master:write | 全项目范围；project_id/customer_id/contract_no/effective_date/end_date/active |
| PATCH /contracts/:id | master:write | version 必填；仅日期及启停可变，合同号、客户、项目不可替换 |

validity 为 VALID/UPCOMING/EXPIRED/INACTIVE，按 Africa/Lubumbashi 业务日期判定。客户停用同样不能产生新计划/分配。所有写入有幂等回执与审计；不提供删除接口。

POST /plans 现在必须提供 contract_id。现有历史计划可以继续查看/关闭/释放原锁定，但未关联合同的历史计划不能新增备货；需新建关联合同的计划。不自动将历史计划匹配到某份合同。

新增备货草稿和正式锁定均再次验证合同，防止草稿创建后合同到期/停用。数据库 INSERT sales_plans、allocations、reservations 同样校验，不只依靠前端。已经锁定的历史业务可以继续履约、解除或审批，不在到期时自动抹除。

## 重量输入与原始计量依据

POST/PATCH /receipts 的新行使用 gross_weight（吨字符串，最多6位小数）或 gross_weight_kg（kg字符串，最多3位小数），不能只提供 net_weight。两个毛重字段同时提供时必须一致；提供净重时必须等于服务器结果。

```json
{"gross_weight_kg":"2450"}
```

返回：gross_weight="2.450000"、packaging_weight="0.002500"、net_weight="2.447500"、weight_rule_version="PACK_2_5KG_V1"。服务端 BigInt 计算，数据库 numeric(14,6) 再校验。

GET /receipts/template 第5列现为“毛重（吨）”；旧净重模板明确拒绝。import-preview 返回毛重、包装及净重，保存/确认仍整批原子提交。历史草稿继续提交前需要实测毛重后编辑，不从旧净重倒推毛重。

inventory_view / GET inventory / bundles 新增 gross_weight、packaging_weight、weight_rule_version、weight_basis、contract_no。

- GROSS_MINUS_PACKAGING：原始毛重扣包所得净重，当前未被重量调整。
- LEGACY_NET_ONLY：历史或授权盘盈等缺少毛重证据，毛重/包装/规则为空。
- AUTHORIZED_ADJUSTED_NET：原始毛重依据不变，当前净重经授权调整，与原始净重分开展示。

库存及历史报表继续以当前或历史截止版本的**净重**记账，绝不因新增默认包装规则重算原库存。

GET /inventory 新增 contract_no 完整值匹配、weight_basis 筛选；新增 gross_weight/packaging_weight/contract_no 排序。原有筛选、分页与跨页选择接口保留。

GET /inventory/weight-exceptions：inventory:read，遵循库存数据范围，支持库存筛选，返回毛重未知或已授权调整的清单，最多10000行。大范围清单需按现有日期/客户等拆分；授权导出用库存筛选页面的 CSV/XLSX。

库存导出原21列保持，末尾追加5列：原始毛重、包装重量、规则版本、重量依据、合同号。缺失历史毛重为空，不填0或推算值。XLSX 数值显示6位小数，CSV 精确文本。

## 装车、出库和总览

loads、outbounds 详情及列表新增 customer_name、contract_nos 数组、contract_notice、total_weight。单车含多份合同时展示全部合同，含未关联历史捆包时明确提示。单捆离场后仍可沿 loading_items → reservations → allocations → sales_plans 查到原合同。

装箱单净重取冻结的 loading_items.original_weight，附原始毛重/包装/规则及合同号。没有修改 loading_action/outbound_action 的审批状态机。装车完成不减库；实际离场多节点确认仍是唯一正式出库时点。

/dashboard 新增 day_inbound、day_outbound；/dashboard/details?metric=day_inbound|day_outbound 支持相同权限、日期/货位等统计范围及 as_of 历史截止。所有指标是服务器读取时点的快照；页面进入/刷新及原业务变更事件会重新查询，不宣称推送实时连接。

/operations/status 原白名单增加 contracts，可重新查询本账号幂等提交结果；未查到仍为 UNKNOWN，不自动离线重试记账。

## HTML 路由

/overview、/inventory、/customers、/receipts、/preparation、/outbounds；/field 保留手机入口。

详情 /receipts/:id，编辑 /receipts/:id/edit，新建 /receipts/new，Excel /receipts/import；合同 /customers/contracts/:id[/edit]、/customers/contracts/new；销售计划 /preparation/plans/new、/preparation/plans/:id/edit；备货 /preparation/new、/preparation/:id；装车 /outbounds/loads[/new|/:id]；检斤 /outbounds/weighings[/new|/:id]；出库 /outbounds/:id；总览 /overview/details?metric=...&as_of=...；扫码 /field/scan。

静态资源根路径加载，History API 处理返回/刷新/导航激活；服务端只对白名单页面回退 index.html，未知 API 返回404，业务 API 本身仍需登录。原 /#inventory、/#dashboard、/#field 兼容映射。

026迁移补充：旧毛重未知的待审核单同样不能直接确认入库；API返回409，数据库confirm_receipt也会回滚。先由独立审核人驳回，核实毛重并修改草稿后重提，不反推毛重，不更新已确认档案。
