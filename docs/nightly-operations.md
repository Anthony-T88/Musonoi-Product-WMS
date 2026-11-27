# WMS 零点备份与报表邮件

## 备份内容

- `database/YYYY-MM-DD.dump.enc` 是 PostgreSQL 的完整自定义格式快照。文件名标识上一个已结束的卢本巴希业务日，快照记录实际执行时间。服务器延迟启动时，快照反映实际执行时的数据。
- `logs/YYYY-MM-DD.jsonl.gz.enc` 保存该业务日 `00:00:00` 到次日 `00:00:00` 之间的业务审计和 WMS 应用日志。日志内容按记录的时间归档，文件内含记录数。
- 两项任务分别调度、校验和记录执行结果。同一天已存在且通过认证的归档会复用。旧文件由服务器管理员按保存周期管理。
- 数据库快照覆盖数据库内的数据。上传文件、数据库角色、服务器配置和备份密钥需要按原有运维流程单独保存。密钥应有独立的受限副本。

## Linux Docker 主机

1. 以该环境的现有 Compose 项目为基础，合并 `deploy/compose.nightly.yaml`。复制 `deploy/nightly-host.env.example` 至 `/etc/musonoi/nightly-host.env`。填写当前发布目录、项目名、Compose 文件和插值配置。已有多个覆盖文件时，按原顺序写入 `WMS_COMPOSE_OVERRIDES_FILE` 指定的文本文件。设置 `WMS_PG_CLIENT_MAJOR` 与 PostgreSQL 主版本一致。
2. 在选定服务器硬盘上创建 `WMS_BACKUP_HOST_DIR` 下的 `database` 和 `logs`。确保两目录属于任务容器用户 UID 1000，权限为 0700。备份目录位于 Web 发布目录之外。
3. 在 `WMS_BACKUP_SECRET_DIR` 创建一个只有运行任务的用户和管理员可读取的 `backup.key`，内容为 32 字节随机密钥的 64 位十六进制表示。用私有 `WMS_BACKUP_JOB_ENV_FILE` 指定与本环境吻合的 `APP_ENV`、`DEPLOYMENT_TIER`、`DATABASE_OWNER_URL`、`DB_ALLOWED_HOSTS`、`DB_EXPECTED_NAME` 和 `DB_EXPECTED_MAJOR`。正式环境还需 `DB_TLS_CA_FILE`，指向同一容器只读挂载的 CA，例如 `/run/wms-backup/db-ca.pem`。数据库所有者凭据仅提供给备份任务。
4. 以同一 Compose 文件组合构建 `nightly-backup`，再将 `musonoi-maintenance@.service`、`musonoi-backup-database.timer` 和 `musonoi-backup-logs.timer` 安装至 `/etc/systemd/system/`。执行 `systemctl daemon-reload` 后，分别启动一次 `musonoi-maintenance@database.service` 和 `musonoi-maintenance@logs.service`。验证输出后，通过 `systemctl enable --now musonoi-backup-database.timer musonoi-backup-logs.timer` 启用零点备份。
5. 查看 `systemctl list-timers 'musonoi-*'` 和对应任务的 `journalctl -u` 记录。通过现有应用审计查询核对备份历史。测试环境可使用 `WMS_REQUEST_AUDIT=1` 开启结构化 HTTP 日志。云主机需保留覆盖目标日期的容器日志。

### 恢复验证

设置 `WMS_BACKUP_KEY_FILE` 后，使用 `node scripts/database-backup.cjs verify <档案>` 校验。使用 `node scripts/database-backup.cjs decrypt <档案> <受限临时路径>` 解封。数据库文件通过相同主版本的 `pg_restore --list` 检查，然后恢复到独立的验证数据库核对业务数据。日志解封后为 gzip 压缩的 JSON Lines。

## Windows 本地 TEST

`deploy/nightly-local-test.ps1` 接收 `-Job database|logs`、`-ProfileRoot <本地私有配置目录>` 和 `-Node <node.exe绝对路径>`。使用现有 TEST 所有者配置与 PostgreSQL 工具。准备 `<配置目录>/nightly` 下的两处归档目录与受限密钥，使用 Windows 计划任务在零点分别启动。计划任务的运行账户需要读取配置、密钥和日志，并能写入归档目录。

## 报表邮件

邮件需要配置后启用，默认关闭。支持仓储出入库、发运和盘点日报或月报，以及库存平衡、销售月报。生成报表时校验已配置账号的报表读取、导出及仓库范围权限，邮件只发给配置内同时获准的地址。请准备可用的 TLS SMTP 系统邮箱，并在服务器私有目录配置发件地址、允许接收人、报表范围和发送时间。

在 `WMS_REPORT_SECRET_DIR` 保存私有 `reports.json`，例如：

```json
{
  "smtp": {"url": "smtp://smtp.company.example:587", "from": "wms@company.example"},
  "recipientAllowlist": ["reader@company.example"],
  "schedules": [
    {
      "id": "warehouse-daily",
      "hour": 7,
      "frequency": "daily",
      "actor": "wms_report_reader",
      "recipients": ["reader@company.example"],
      "reports": [{"kind": "movement", "product": "CU_CATHODE"}]
    }
  ]
}
```

- `hour` 使用卢本巴希时间。日报读取上一个完整日，月报在每月 1 日读取上一个完整月。报表标识为 `shipping`、`movement`、`stocktake`、`balance`、`sales`。产品值为 `CU_CATHODE` 或 `CO_HYDROXIDE`。
- 生产邮件需要同目录内权限仅允许任务用户读取的 `smtp.netrc`，格式为 `machine <SMTP主机> login <邮箱账号> password <SMTP凭据>`。使用企业自签 CA 时，在私有任务环境文件设置 `WMS_REPORT_MAIL_CA_FILE=/run/wms-mail/smtp-ca.pem`。
- 私有 `WMS_REPORT_JOB_ENV_FILE` 使用现有 WMS 应用账户的数据库连接配置。生产环境还需将数据库 CA 放入邮件配置目录，并在环境文件中设置容器内路径。新建 0700 的持久化 `WMS_REPORT_STATE_DIR`，由容器用户 UID 1000 写入。
- 构建 `report-mail` 服务后，安装且启用 `musonoi-report-mail.timer`。该任务每小时检查是否到达指定发送时段。TEST 邮件限制为回环 SMTP 与 `.test` 邮箱。
