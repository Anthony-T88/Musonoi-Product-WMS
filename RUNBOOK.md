# V3.5 运行与部署

## 本地TEST

使用本机私有.env执行 pnpm start。本地入口仅连接既有TEST，不迁移、不初始化、不清理业务。源码检查为 pnpm test。写入测试只针对预先恢复的隔离库，测试库名和凭据文件不能直接用于生产。

## 云部署准备

当前尚未购买服务器，本机没有Docker。以下是目标服务器步骤，尚未在实际云端执行。

1. 从V3.5干净源码包准备独立目录，核对包SHA256和SOURCE_MANIFEST。安装Docker Compose与Nginx，准备域名和TLS证书。
2. 把deploy/environment.example复制为服务器私有文件，填写不同的强数据库口令、精确HTTPS来源及URL编码的口令。文件仅部署管理员可读，不提交Git，不粘贴到聊天或日志。
3. 构建镜像：docker compose --env-file /private/wms.env -f deploy/compose.yaml build。应用以非root用户运行，数据库仅内部网络可达。
4. 启动数据库：docker compose --env-file /private/wms.env -f deploy/compose.yaml up -d database。首次正式迁移：docker compose --env-file /private/wms.env -f deploy/compose.yaml --profile maintenance run --rm migrate。
5. 迁移仅创建结构，不创建用户、项目、仓库或测试库存。正式初始管理员、项目仓库、角色范围和实际货位须由受控初始化流程核实创建；不得执行TEST账户重置、TEST种子脚本或直接复制本机测试库。未完成此项不能开放业务登录。
6. 已存在正式库升级前先停写，完成数据库和附件备份并恢复到独立库验证，再设置PRODUCTION_BACKUP_VERIFIED=yes执行增量迁移。程序拒绝TEST库转换为生产库，拒绝已执行迁移校验和变化。
7. 启动应用：docker compose --env-file /private/wms.env -f deploy/compose.yaml up -d app。应用监听容器内部0.0.0.0:4174，宿主仅127.0.0.1:4174。替换deploy/nginx.conf.example中的域名和证书路径，验证Nginx配置后启用。
8. HTTPS下检查/api/v1/health返回production与database=ok；核对安全Cookie、登录退出、各角色直接API、审批独立性、地图PDF、Excel导出导入、附件持久化、UTC+2业务时间和现场网络响应。
9. 配置防火墙、磁盘告警、数据库与附件定时备份，实际执行首次任务并恢复到独立库验证。不能仅凭备份文件存在认定可恢复。确认后再正式开放业务。

## 版本与保护

生产镜像启用VERIFY_SOURCE_INTEGRITY=1核对发布文件。此校验不是加密或数字签名，不能阻止有服务器权限的人修改源码及清单。网页只发布dist目录，数据库、后台脚本、凭据、备份及源映射不得对外开放。浏览器收到的JavaScript仍可查看。

唐雷署名和专有许可见LICENSE和NOTICE。公开GitHub仓库仍可下载源码；若需限制获取，应另外设为私有并配置协作者。本轮保持现有可见性。

## 回退

保留升级前源码镜像、数据库与附件备份。回退前停写并核对迁移兼容性，不得清库或覆盖未备份的新业务。旧单证保留原字节，重新生成创建新修订。
