# 库存地图 API（V2.5 专项）

前缀 `/api/v1`。继续使用 HttpOnly 会话、CSRF、同源校验及既有角色/数据范围。页面 `/stock-map` 只显示、选择、定位和跳转，不确认库存业务。

## 查询接口

| 方法和路径 | 权限 | 用途 |
| --- | --- | --- |
| GET /stock-map | inventory:read | 一致事务内的图形配置、授权普通货位及车辆区汇总 |
| GET /stock-map/locations/:id | inventory:read | 每页20捆、货位指标、排除的装车库存、最近30条授权捆包操作元数据 |
| GET /stock-map/locate?bundle=编号 | inventory:read | 当前位置定位；返回 LOCATION、VEHICLE 或 NOT_IN_STOCK |
| PATCH /stock-map/locations/:id | master:write，另需admin/supervisor及完整项目范围 | 地图关联与容量配置；版本、幂等、审计，不写库存余额 |

地图及货位详情筛选参数：`project_id`、`warehouse_id`、`customer_id`、`location_id`（UUID），`region`（P1—P5），`contract_no`（完整合同号）。不传项目/仓库时选择第一项授权范围，并在返回的 `context` 明示，不聚合其他仓库。

- `status`：AVAILABLE、LOCKED。
- `sample`：NOT_SAMPLED、SAMPLING、SAMPLED。
- `preparation`：UNLOCKED、LOCKED。
- `outbound`：NONE、DRAFT_LOADING、LOADED、CREATED、PACKING_CONFIRMED、COMMERCIAL_APPROVED、GATE_VERIFIED、DEPARTED。当前地图实物口径下DEPARTED始终为零，不混入已离场历史。
- `stocktake_id`：按既有盘点任务的仓库、货位、批次或堆场范围查询**当前**库存；不是重新解释冻结快照。
- `allocation_id`：仅该备货单的有效锁定捆包；复用既有整单授权。
- `load_id`：仅对应当前有效装车占用；复用装车整单授权。
- `page`：详情页码，固定每页20条。

前端独有参数：`mode=status|customer|region`、`only_occupied=1`、`focus=货位UUID`、`location_code=货位编号`、`bundle=捆包编号`、`loading_id=车辆定位`。扫码链接由服务端重新查最新位置，不能靠URL声明授权或确认业务。

## 汇总与空位口径

`summary` 是本次筛选的厂内实物（含已装车未离场），`warehouse_summary` 是同一授权仓库的未筛选实物；`locations[].current` 是未筛选授权普通货位占用，`matched` 是筛选匹配部分。非匹配但实存的格子变淡，不冒充空货位。

`region_summary` 仅普通堆场；`vehicles` 单列LOADED库存。普通货位与车辆区合计等于厂内实物，不重复计入旧的 `bundles.location_id`。DRAFT装车仍属于普通货位。

当前客户 = `coalesce(有效 reservations → allocations → sales_plans.customer_id, bundles.customer_id)`。不建立货位客户余额/地图库存副本。

重量单位t，SQL numeric聚合，接口使用精确十进制字符串；历史毛重缺失时 `gross_weight=null`，另给 `known_gross_weight`、`missing_gross_count`，不由净重推算毛重。

`occupancy` 的主数据货位数、实占数、空位数、异常数和图纸目录数分开。图格未关联主数据为UNCONFIGURED，不是EMPTY；客户范围不完整的账号 `empty_locations=null`，不承诺可用容量。当前仓库有旧A/B编码时单列“未定位货位”，仍计入总量，不自动搬到P区。

颜色优先：异常/混放红色 → 取样中黄色 → 有效锁定蓝色 → 可用绿色；空位灰色，LOADED在装车点/车辆区橙色。没有新增“冻结业务状态”；红色为告警显示，不代替业务冻结审批。

## 地图货位配置

PATCH必须带当前整数 `version` 和 `Idempotency-Key`。示例（**下列仅测试示例，不是现场容量**）：

```json
{
  "version": 1,
  "map_cell_code": "P1-1",
  "max_bundles": null,
  "max_net_weight": null,
  "map_order": 1,
  "map_note": "待现场确认容量"
}
```

省略字段保留原值，显式null清除可空配置。最大重量明确为**净重t**；未知保持null，正数才生效。降低到实际占用以下被拒绝。精确P编号可自动与同名图格对应；旧编号可显式关联。数据库唯一索引防止同一项目/仓库出现同图格的精确编号和别名双重映射。

配置功能本阶段提供受控API，没有开放普通用户修改布局、客户归属或库存余额的入口。实际生产映射须先形成现场核验清单。

## 事务与错误

既有业务API继续负责入库、锁定/释放、移库、装车/退装、离场、授权调整。新增数据库延迟约束在事务最终状态检查货位客户及容量；沿用全局记账锁24000，加货位行锁和修订行，防止READ COMMITTED与陈旧REPEATABLE READ同时占空位。失败整笔回滚，不留下部分库存、流水或成功幂等回执。

同客户不同批次、合同可以同位；部分改锁为其他客户、释放后暴露不同货权客户、混客户入库/移库/退装会409拒绝。历史混放不原地改写，可先通过合法移库减少原位库存，逐步整理。装车后清出的源货位可依法再用；退装或授权回厂时仍必须检查最终目标，不能覆盖其他客户。

401未登录；403无权限；404不存在或不在范围；400参数错误；409版本、唯一映射、混放或容量冲突；数据库失败503，不返回演示替代库存。服务端校验不依赖前端是否显示按钮。

当前地图读取为请求时快照，显示读取时间；没有自动轮询或WebSocket承诺。断网/超时显示失效提示，只能重新联网查询，不缓存API库存响应或离线写账。
