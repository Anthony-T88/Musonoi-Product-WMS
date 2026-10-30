# V2.6.2 API 与数据口径

## 账户及信息总览

完整口径与验收见 `RELEASE.md`，数据库截至065共73条迁移。

账户API仅admin角色且具有管理权限可访问；所有写请求仍需同源及CSRF。`GET /users`支持`q/role/status`（status为active/disabled/deleted/all，缺省只查未删除）；返回创建/最近登录/删除元数据，不返回密码哈希。`GET /users/options`只列五角色及授权范围内主数据。

- `POST /users`：username、display_name、password（12—128字符）、role_code、可选active、必需scopes数组。username格式`[a-z][a-z0-9_]{2,39}`，全局不复用。成功200并返回新ID。
- `PATCH /users/:id`：display_name、role_code、active、可选scopes；不可修改已删除身份或移除自身管理能力。
- `GET /users/:id/deletion-check`：身份及本人关联待处理receipts/lots/loads数量。
- `DELETE /users/:id`：username二次确认、reason必填，有待办时acknowledge_pending必须true。逻辑删除并撤销会话，不级联删除业务。
- `POST /users/:id/restore`：password必填，可选有效role_code及授权scopes；使用原ID及用户名，新密码恢复登录。
- `POST /users/:id/reset-password`：password必填，撤销旧会话。
- `GET/PUT /security/roles[/code]`：沿用真实角色上限，角色变更撤销其所有用户会话；admin最高权限不可降低。

`GET /dashboard/workflow`复用from/to、as_of及原报表范围参数。响应包含window、period（inbound_bundles/outbound_bundles/outbound_weight）、current（onsite_bundles/known_net_weight/unweighed_bundles/available_bundles/preparing_bundles/departed_pending_bundles/ledger_bundles）、states及pending_receipts。无入库审核权限时pending_receipts为null。当前待审批数量独立于历史期间，与入库摘要一致。

可用`state`读取同一截止及范围的互斥捆包明细：available、working、preparation_pending、prepared、loading_pending、ready_departure、departed_pending、departed_correction、legacy_loaded、other_locked、sampling_unallocated、adjustment_pending；分别要求库存/备货/装车查看权限。历史累计状态不混入当前阶段。本接口不改状态、不写业务。

日期采用既有刚果金业务日和历史起点；入库按confirmed_at，正式出库按有效最终记账事件，当前现场排除已离场待审批。未知净重保持null，所有显示使用4位小数。旧`/dashboard`及其片数汇总字段兼容保留，但新信息总览不显示两项片数指标。

## 入库、备货和地图

- `POST /api/v1/v262/lots/:id/withdraw`：`allocation:write`及创建人校验，请求`{version}`。只允许从未审核通过、无装车历史的待审核Lot撤回至WORKING。保留捆包、货位锁及作业数据，记录withdrawn_by/withdrawn_at和WITHDRAW历史。
- `POST /api/v1/v262/lots/:id/revoke`：`allocation:write`及角色/归属/范围校验。请求`{version,reason,work_stopped:true,physical_state_verified:true,observation?}`。操作员仅本人Lot，授权主管/经理/管理员可处理范围内未审核Lot。已有作业或移动必须填写observation；取样中、不明实际位置、状态/锁定冲突整批拒绝。返回已撤销Lot，状态编码沿用CANCELLED，保留No.及历史。旧`/v261/.../cancel`同样禁止已审核/装车历史绕过。
- `GET /api/v1/receipts/summary`：仅`receipt:review`，返回`{pending,confirmed,rejected,draft,actionable}`。按当前项目/客户/仓库范围统计全量，不以列表200条为基数。actionable另应用独立审核与TEST自审例外，提醒不改变审批权限。
- `GET /api/v1/receipts?status=PENDING`：状态筛选先在数据库执行，再按待审批优先、创建时间返回最近200条。合法状态DRAFT/PENDING/CONFIRMED/REJECTED。
- `/v261/lots/:id`增加`preapproval`权限/状态提示；服务端写动作仍重新校验，不能信任前端提示。
- 地图按`locations.map_usage`区分FORMAL、TEMPORARY、TEMPORARY_LEGACY和REVIEW。`map_parent_id`归并旧P5子货位，不改捆包物理位置。`/stock-map`只展示有效正式位置及P5公共区；`review_summary`保留未定位实物，`/locate`返回UNMAPPED与空location_id，不虚构定位。


认证、HttpOnly 会话、CSRF、五角色及幂等机制沿用既有服务。写操作需 `Origin`、`X-CSRF-Token`、`Idempotency-Key`。所有接口在后端校验权限、范围、状态和版本，失败事务整批回滚。

## 检斤与捆包元数据

- `POST /api/v1/v262/lots/:id/weigh`：`allocation:write`。请求 `{version,items:[{bundle_id,item_version,gross_weight?,seal_no?}],note?}`。只传修改字段，1–500 捆，UUID 和版本必填；毛重用最多四位小数的字符串，铅封用非空字符串。返回 `{lot,warnings}`，包含完整最新版本、捆包和数量摘要及重复铅封提示。重量可先保存，尚未填写不强制完成整 Lot。任何非法行或陈旧版本均不部分写入。
- `GET /api/v1/v262/locations`：`inventory:read`。返回真实货位声明及 `allocation_state`：`AVAILABLE`、`RELEASED`、`PLANNED`、`OCCUPIED`、`PENDING_REALLOCATION`、`UNAVAILABLE`。包含有权查看的关联 Lot；不能将空实物数量当作可用货位。前端禁用不替代数据库校验。
- `PATCH /api/v1/v262/bundles/:id/sheets`：仅管理员权限。`{version,sheets_per_bundle,reason}`，片数为 PostgreSQL 正整数范围，核实原因必填，保留不可变变更记录。
- `PATCH /api/v1/v262/bundles/:id/seal`：仅管理员权限。`{version,seal_no,reason}`，仅已备货且有有效最终检斤、未被装车占用的捆包。适用于历史补录或授权更正，不改变原重量或历史装车快照。
- `GET /api/v1/v262/bundles/:id/metadata-history`：库存读取权限及捆包范围校验，返回当前捆包的片数、铅封前后值、核实原因、操作者与时间。

## 业务接口

- `/receipts` 新建要求每行 `sheets_per_bundle`；历史单据 `requires_sheets=false` 保持兼容，原 NULL 不伪造。新 Excel 模板为“捆包编号、捆包片数、生产日期、入库时间（含时区）、备注”。
- `/v261/lots` 创建同时锁捆包和货位；沿用既有接口及流程族，产品版本是 2.6.2。`/v261/lots/:id` 返回片数、铅封有效性、逐行版本、释放时点、`quantities` 原始/有效/装车/出库/释放统计。取样、主管确认归位及取消继续使用原业务动作。
- `/v261/lots/:id/items/:bundle/weigh` 支持可选 `seal_no`，另有 `/seal` 动作；前端单捆保存使用批量接口的一行请求，统一返回重复号提示与最新详情。单独复磅不自动认定原铅封仍有效。
- `/v261/lots/:id/submit`、`/approve` 都检查有效 Seal No.；已审核 Lot 普通操作员不得直接修改。
- `/v26/loads/:id/approve` 在同一事务释放本 Lot 尚未被任何有效装车单占用的合规余捆；待审核或驳回不释放。重复幂等请求不重复执行。
- `/loads/:id`、装箱单、出库历史读取装车时铅封与片数快照。`/inventory`、`/stock-map`、`/dashboard` 增加片数、缺失片数统计及对应元数据；库存导出只有当前分配客户展示，不重复列出货权客户。

## 统计、历史与错误

“原始”以原 allocation_items 明细及 Lot 作业重量为准；“有效”排除已合法释放余捆；“已装车”累计经过审核的有效装车/已出库关联，不把待审核占用当作已审核装车；“已出库”以经理正式批准为准。原 Lot 结案不被释放至其他 Lot 的余捆阻止。

当前片数来源为 bundles；原入库及装车行保留当时的单据值，变更可追溯。seal_no 是字符串，未提供者 NULL；有效性独立于历史字符串是否存在。重量原值保留 numeric 精度，展示/导出用共享四位十进制格式化，不在接口层舍入后重新写库。

4xx 为输入、权限、版本或业务冲突；5xx 沿用可关联错误编号和脱敏日志。前端对未知提交保留原幂等键和操作结果查询，不自动重建写操作。详情见 `RELEASE.md`。
