# V2.5 增量接口与业务边界

## 标签
POST /api/v1/labels/jobs：label:print、CSRF及Idempotency-Key；bundle_ids（编号）或batch_id/receipt_id，最多200捆，width_mm/height_mm各40–100。混合筛选取交集，不忽略越权编号。
GET /labels/jobs/:id（/api/v1前缀）仅创建者且当前仍有全部捆包权限；QR payload为MSN:BUNDLE:<稳定UUID>，不含任何库存事实或授权。
POST /labels/jobs/:id/print {reason}记录PRINT_REQUESTED，不能证明纸张已打印；每次重打使用新幂等键、同请求重试同键。POST /:id/export输出带二维码图像的Excel，另需inventory:export。
GET /labels/preview/:id是认证打印页面，尺寸来自服务端CSS；预览/打印/导出均审计。

## 扫描
POST /scan/resolve {code,context:{kind:query|stocktake|allocation|load|move|sample,id?}}，inventory:read+Origin/CSRF。仅解析MSN:BUNDLE:UUID或人工编号，不执行外来URL。按现有接口访问函数核查整单授权、当前有效锁、装车占用、盘点范围/版本/重复；返回check.matched并审计，但绝不确认库存业务。
扫描中心的盘点录入、移库、新建取样直接复用原/stocktakes/:id/observations、/moves、/samples接口，权限、事务、版本与幂等不变。已有取样单只核对，不向已登记的不可变明细追加捆包；关联新捆包须新建取样单。
解码器本地托管ZXing Browser0.1.5，手输始终保留；摄像头需安全上下文和用户授权，关闭/切后台停止媒体流。

## 移动与PWA
新增#field现场工作台及触控布局。manifest启动到/#field，安装依浏览器支持；相机仅安全上下文并显式授权，手动输入不依赖相机。Service Worker只白名单缓存非敏感静态资源，从不拦截API、标签私有预览或POST；离线导航显示offline.html而非历史库存。当前仅本机服务，真实手机HTTPS、相机权限和打印机仍须现场验收。


## 多语言
POST /me/language {language:zh-CN|en}：所有已认证用户可更新自己的显示偏好，CSRF+幂等及审计；/me返回language_code。法语词典占位但不启用。统一词典覆盖导航、表单、状态与操作反馈；动态显示通过DOM文本适配保留现有页面，冻结option原值，业务状态代码、用户输入及主数据不翻译。语言仅本地保存非敏感界面偏好并由登录账号偏好覆盖；不缓存库存数据。


## 弱网与操作回执
GET /operations/status?key=...&method=POST|PATCH&path=/moves等，认证后仅查当前账号的幂等提交记录。仅返回提交证据/实体标识，不返回库存快照或原业务载荷；不存在返回UNKNOWN，不可据此认定失败。当前单据仍须走原授权接口查询。
客户端15秒超时，正式写入反馈SUBMITTING/CONFIRMED/REJECTED/UNKNOWN；网络错误、响应丢失或5xx按UNKNOWN处理。手动查回执、同键原请求重试；无后台自动重放。仅sessionStorage保存账号ID、路径、方法、幂等键、时间及请求指纹SHA256，不保存库存、客户、重量、密码、CSRF、请求体；重载后相同规范化请求复用未知请求键。退出清理内存载荷；仅未知回执的最小元数据按账号保留于当前标签页会话，重新登录本账号后可核对，其他账号不显示。只在内存中保留本页待重试原请求。
浏览器online只提示连接可能性，另显示最近服务器响应时点；不以该标识保证数据库可用。

## 解码兼容性验收补充
实测发现ZXing对特定尺寸二维码可能报校验错误，最终相机及图片使用本地jsQR1.4.0为主、ZXing Browser0.1.5为图片备用。新增真实API标签图片及6个UUID×200/240/400像素的往返回归；浏览器实际问题PNG已识别并查询成功。无CDN、远端上传或图像外传。库原始许可证随vendor保留。依据：[node-qrcode](https://github.com/soldair/node-qrcode)、[ZXing Browser](https://github.com/zxing-js/browser)、[jsQR](https://github.com/cozmo/jsQR)。
