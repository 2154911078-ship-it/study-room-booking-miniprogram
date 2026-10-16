# 慧自习 · 校园自习室预约小程序

生活服务方向（校园服务）课程演示项目：**微信小程序（前端） + Node.js 后端 + MySQL 数据库（wx.request 接口通信）**。
覆盖「用户交互 → 数据处理 → 结果反馈」完整业务闭环：登录、自习室浏览筛选、选座预约、滑动取消/删除、消息提醒与角标、个人中心，并包含 **预约核销凭证** 与 **管理员后台**（场地管理、全量预约查询、到场核销、用户管理、预约名单导出 Excel 与打印）。

> Logo、默认头像与空态插画由 `scripts/gen-brand-images.ps1` 绘制，**tabBar 图标**由 `scripts/gen-tab-icons.ps1` 绘制、**首页快捷入口图标**由 `scripts/gen-quick-icons.ps1` 绘制（均为卡通风格、透明 PNG），无任何商用/第三方版权素材；**8 张自习室封面（1125×510）、8 张热门卡片图（690×360）、3 张首页轮播图（1125×360）**为项目配图，统一由 `scripts/compose-covers.ps1` 按对应表合成。

---

## 一、快速运行

### 1. 准备 MySQL（默认 root / 123456 @ 127.0.0.1:3306，库名 huizixi）

```bash
mysql -uroot -p123456 -e "SELECT VERSION();"   # 确认 MySQL 已启动且密码为 123456
```

账号/密码/端口不同？**不用改代码**，用环境变量覆盖即可：

```powershell
$env:DB_PASSWORD="你的密码"; $env:DB_PORT="3307"; $env:DB_USER="root"; $env:DB_NAME="huizixi"; $env:DB_HOST="127.0.0.1"
```

### 2. 初始化数据库并启动后端（Node.js + mysql2）

```bash
cd server && npm install      # 唯一依赖：mysql2（国内已默认走 npmmirror 镜像）
node server/init-db.js        # 建库 + 执行 database/huizixi.sql（建表 + 数据，幂等可重复执行）
node server/server.js         # 默认监听 http://127.0.0.1:3000
```

- **数据库初始化工具**（`server/init-db.js`）：`--check` 只检查连通性与表结构；`--reset` 删库重建后重新导入演示数据
- **数据库脚本目录**（`server/database/`）：**只有一个 `huizixi.sql`**，内含建库 + 9 张表 + 基础数据 + 演示数据；可用 mysql 客户端 / Navicat 直接"运行 SQL 文件"导入，命令见 `server/database/README.md`
- **清库重播的另一种方式**：`$env:DB_RESET="1"; node server/server.js`
- **浏览器打开 http://127.0.0.1:3000/ 即为管理后台**（`server/admin.html`），用 **admin / 123456** 登录，含四个页签：
  概览看板、场地管理（自习室增删改查）、预约管理（全量查询/筛选/核销/导出 Excel/打印）、用户管理
- 管理账号：**admin / 123456**（超级管理员）、**staff01 / 123456**（场馆管理员，仅日常运营；详见第五节角色权限）
- 健康检查：`GET /api/health` 返回 MySQL 版本、库名、连接账号与各表行数（含管理员数与已核销数）
- 演示账号：**20210101 / 123456**（另备 20210102 / 123456）
- 后端每次启动都会重放 `server/database/huizixi.sql`（建表 `IF NOT EXISTS` + 数据 `INSERT IGNORE` + 写死主键），因此**幂等、不会重复插入**；改完这个 SQL 文件重启即生效，库里已有的业务数据不受影响
- 端口可用环境变量改：`$env:PORT=3100; node server/server.js`


### 3. 打开小程序

微信开发者工具 → 导入项目 → 选择**本目录**（含 `app.json` 的根目录）→ AppID 用测试号（touristappid）。

### 4. 联调设置（重要）

因使用本机 HTTP 接口，需在开发者工具「详情 → 本地设置」勾选：

- ✅ **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**

> 课堂演示保险：若后端未启动，请求层会**自动降级**到内置的本地演示数据（`utils/localdb.js`，接口与后端完全同构），流程依然完整可跑，首页/我的页会标注“本地演示数据模式”。

### 真机调试（手机扫码）须知

1. **必须使用自己注册的小程序 AppID**。项目默认 `touristappid`（试用号）**只能在模拟器运行**，点“真机调试”会报
   `41002 appid missing`。解决：注册小程序**测试号**（即时下发 AppID）→ 测试号后台把手机微信号添加为开发者 →
   开发者工具「详情 → 基本信息 → AppID → 修改」填入后重启工具。
2. **接口地址**：把 `utils/config.js` 的 `BASE_URL` 切到电脑局域网 IP（如 `http://172.20.10.2:3000/api`），手机与电脑须在同一 Wi-Fi/热点网段；回模拟器使用时再切回 `127.0.0.1`。
3. **防火墙**：首次运行放行 Node.js 入站（TCP 3000），否则手机访问不到电脑后端。
4. **域名校验**：手机端真机调试面板（右上角胶囊 → … → 开发调试）打开「不校验合法域名」。


## 二、目录结构

```
├── app.js / app.json / app.wxss      全局入口、页面注册、tabBar、全局样式
├── project.config.json / sitemap.json
├── styles/common.wxss                ★ 外部公共 WXSS：统一色彩/字体/按钮/间距
├── pages/                            8 个页面，每页独立子文件夹（js/json/wxml/wxss）
│   ├── index/                        首页：专属Logo、公告轮播、数据概览、快捷入口、热门自习室
│   ├── login/                        登录：表单校验、密码显隐、协议勾选、微信一键登录（免密）、登录后 redirect 回跳
│   ├── rooms/                        自习室列表：搜索、校区筛选、下拉刷新、上拉加载更多
│   ├── room-detail/                  详情：id 传参、日期/时段/座位三级联动、CSS Grid 座位图、下单
│   ├── orders/                       我的预约：状态 tab、左滑取消/删除（touch 手势）
│   ├── order-result/                 预约凭证/结果页：成功反馈、订单详情、取消入口
│   ├── profile/                      个人中心：资料统计、功能弹窗、退出登录
│   └── messages/                     消息中心：分页、点击已读、全部已读、Tab 角标联动
├── components/                       复用自定义组件：room-card / empty-tip / section-head / status-tag
├── utils/                            request 封装 / auth 登录态 / validate 校验 / format 格式化 / localdb 降级数据 / config / badge
├── apis/                             接口层：user / room / order / message（按业务分文件）
├── images/                           图片素材（8 张详情封面 1125×510 + 8 张热门卡片图 690×360 + 3 张轮播图 1125×360，均为 JPG；另有自制 PNG：logo、tabBar 图标、快捷入口图标 quick-*.png、头像、空态插画）
├── server/                           Node.js + MySQL 后端
│   ├── server.js                     原生 http 实现 REST API（37 个接口：学生端 17 + 管理端 20）+ 静态服务
│   ├── db.js                         mysql2 连接池 / 事务封装 / 健康检查 / 自动建库并执行 SQL 脚本
│   ├── config.js                     数据库与端口配置（默认 root/123456 @ 127.0.0.1:3306）
│   ├── data.js                       学生端业务数据层（预约/订单/消息的 MySQL 仓储查询）
│   ├── admin.js                      管理端业务层（管理员会话/场地/预约/核销/用户）
│   ├── export.js                     预约名单导出 Excel（exceljs 生成真实 .xlsx）
│   ├── print.js                      预约名单打印页（服务端渲染 A4 横向 HTML）
│   ├── init-db.js                    数据库初始化工具：导入 / --check / --reset
│   ├── database/                     ★ 数据库文件目录
│   │   ├── huizixi.sql               唯一 SQL 脚本：建库 + 9 张表（InnoDB / utf8mb4，含索引与外键）
│   │   │                               + 基础数据（账号/管理员/8 间自习室/公告/轮播）+ 演示数据
│   │   │                               （8 条订单覆盖四种状态、2 条已核销；8 条消息含 2 条未读）
│   │   └── README.md                 脚本说明、手动 mysql 导入命令、排查 SQL
│   └── admin.html                    浏览器「管理后台」（登录 + 概览/场地/预约/用户）
└── scripts/                          gen-images.js 素材生成器 / gen-brand-images.ps1 品牌图(logo·头像·空态) / gen-tab-icons.ps1 tabBar 图标 / gen-quick-icons.ps1 快捷入口图标 / compose-covers.ps1 + covers-map.json 封面·卡片图·轮播图合成 / smoke-test.js 学生端冒烟 / admin-smoke-test.js 管理端冒烟 / check-project.js 仿真回归
```

## 三、验收要点对照

| 要求 | 实现位置 |
| --- | --- |
| 首页 + ≥5 功能子页，非单页 | 1 首页 + 7 子页（见上方 pages/） |
| 外部公共 WXSS 统一风格 | `styles/common.wxss`（CSS 变量 + 按钮/卡片/标签/表单原子类），`app.wxss` @import 全局生效 |
| 每页标题栏 + 返回/跳转入口 | 原生导航栏按页配置标题；tabBar 四入口 + 页内“查看更多/返回/去登录”跳转 |
| 首页自制专属 Logo | `images/logo.png`（`scripts/gen-brand-images.ps1` 绘制：蓝色圆角徽章 + 白色拱门 + 翻开的书本 + 星星，首页 92rpx / 登录页 148rpx 共用） |
| ≥3 种 JS 交互 | ① 下拉刷新（rooms/orders/messages/index）② 上拉加载更多（rooms/messages）③ 左滑取消/删除（orders touch 手势）④ 表单校验（登录/预约）⑤ 公告纵向 swiper、日期时段选择、座位点选、密码显隐 |
| 页面跳转 + 参数传递 | 列表→详情 `?id=r1`；下单→结果页 `?orderId=xx&fresh=1`；登录页 `?redirect=` 回跳；缺参兜底提示并返回 |
| 登录 + 核心业务 + 个人中心 + 消息提示 | 登录（token 会话 + **微信一键登录免密**）→ 预约闭环（下单/冲突校验/取消/删除）→ 个人中心（统计/退出）→ 消息中心 + wx.showToast/showModal + tabBar 角标 |
| Node 后端 + MySQL + wx.request 通信 | `server/server.js` 原生 http 实现 **41 个 REST 接口**（学生端 20 + 管理端 21）；数据落 **MySQL 9 张表**（连接池 + 事务 + 外键约束），全部结构表数据集中在 **一个脚本** `server/database/huizixi.sql`，`server/init-db.js` 一键导入（启动时自动幂等重放）；`utils/request.js` 统一封装（token 注入、错误拆包、401 清理会话） |
| 微信一键登录（绑定学号后免密） | 头像昵称填写能力（`open-type="chooseAvatar"`）+ 本机微信标识 `wxKey` 绑到学号（`users.wx_key` / `wx_ticket` / `wx_bound_at`）；密码登录或自助开户成功后**自动绑定**，之后点「微信一键登录」→ 弹窗确认**学号/姓名/学院** → 免密换 token；票据每次登录滚动重发，解绑入口在管理台用户列表（详见 4.1 节） |
| 管理员角色（管理场地/全部预约/核销/用户） | `server/admin.js` + `server/admin.html`：独立 `admins` / `admin_sessions` 表与登录接口；场地增删改查（有预约记录禁止删除）；全量预约查询（日期/场地/状态/核销/关键词 + 分页 + 统计）；核销与管理员取消；用户增删改查与信用分/密码维护；`super` / `staff` 双角色权限 |
| 预约凭证 + 线下核销 | 每笔订单生成唯一 **8 位数字核销码**（`orders.checkin_code`）；小程序凭证页（`pages/order-result/`）大字出示核销码与核销状态；管理员按码核销（`POST /api/admin/checkin`）或按订单号核销；核销时段 = 开始前 30 分钟 ~ 结束时间，超时可强制核销；核销后给学生推送「签到成功」消息 |
| 预约数据导出 Excel / 打印 | `server/export.js` 用 exceljs 生成真实 `.xlsx`（「预约名单」19 列明细 + 「统计汇总」两个工作表，冻结首行/自动筛选/表头样式）；`server/print.js` 服务端渲染 A4 横向打印页（重复表头、签字栏、自动唤起打印）；两者与管理台列表共用同一套筛选参数 |
| 生命周期 | onLoad（取参/首屏）、onShow（登录态/角标刷新）、onPullDownRefresh、onReachBottom、onUnload 均有实际用途 |
| 兼容性 | 基础库 ≥2.21.0；未用私有 API；safe-area 底部适配；tab 页跳转严格 switchTab；ES6 由工具链转译（代码避免依赖 Promise.finally 等新特性） |
| 性能优化 | 全部 `<image lazy-load>`；`wx:if / hidden / wx:elif` 控制空态、遮罩渲染；`lazyCodeLoading: requiredComponents`；首屏并行请求聚合接口，单页体积 < 60KB，无网络字体，图片最大 124KB（35 个图片文件共约 1.12MB；封面 / 卡片图 / 轮播图由 `scripts/compose-covers.ps1` 合成，快捷入口图标由 `scripts/gen-quick-icons.ps1` 绘制） |
| 目录规范 | 分层清晰，全部英文命名（`scripts/check-project.js` 自动检查） |

## 四、接口一览（后端 = localdb 完全同构）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/summary | 首页聚合（开放数 / 空闲座位=座位总数−当前时段真实占座 / 今日预约） |
| GET | /api/health | 服务与 MySQL 健康检查（版本/库名/各表行数） |
| GET | /api/announcements | 公告 + 轮播 |
| POST | /api/user/login | 登录，签发 Bearer token |
| POST | /api/user/register | 自助开户（学号唯一，成功即返回 token = 注册即登录） |
| POST | /api/user/wxlogin | 微信一键登录（免密）：票据优先、本机微信标识兜底；未绑定返回 `bound:false`；不带 `confirm` 只回身份（弹窗确认用），带 `confirm:true` 才签发 token |
| POST | /api/user/wxbind | 绑定本机微信以开启一键登录（需 token，登录/开户成功后小程序自动调用） |
| POST | /api/user/wxunbind | 本人解除微信绑定（需 token，不影响当前会话） |
| GET | /api/user/profile | 个人资料 + 统计（需 token，含 `wxBound` / `wxBoundAt`） |
| GET | /api/rooms | 分页列表（campus/keyword/page/pageSize；`sort=hot` 时按预约热度=「近 7 天 + 未来 7 天」有效预约单数降序、同热度保持 `sort_no` 序，并在每条附带 `hot` 热度值——首页「热门自习室」数据源） |
| GET | /api/rooms/:id | 详情 + 指定日期时段实时座位图。**座位数 = 场地容量**（1-500），**列数自适应 5-8 列**（≈√容量，行数 = ⌈座位数/列数⌉），座位号位数随总席数扩展（≤99 两位 `A-08`、≥100 三位 `A-108`）；座位状态全部由 `orders` 表真实订单生成：同教室同日、时段重叠且未取消的订单才算「已约」，本人占的显示「我的」，教室维护中全「停用」——**新开场地没有订单就是全空闲** |
| POST | /api/orders | 创建预约（冲突/时段/座位校验） |
| GET | /api/orders | 我的预约（status 筛选） |
| GET | /api/orders/:id | 订单凭证 |
| PUT | /api/orders/:id/cancel | 取消（仅待使用） |
| DELETE | /api/orders/:id | 删除记录（仅已完成/已取消） |
| GET | /api/messages | 消息分页 |
| GET | /api/messages/unread-count | 未读数（Tab 角标） |
| PUT | /api/messages/:id/read | 单条已读 |
| PUT | /api/messages/read-all | 全部已读 |

**管理端接口**（独立 `admins` 表与独立 token，除 `login` 外都需要管理端 `Authorization: Bearer`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/admin/login | 管理员登录（admin / 123456） |
| POST | /api/admin/logout | 退出登录（清除会话） |
| GET | /api/admin/me | 当前管理员信息 |
| GET | /api/admin/overview | 管理看板：统计 + 场地 + 最近预约 + 消息 + 会话 |
| GET | /api/admin/rooms | 场地列表（含预约数统计） |
| POST | /api/admin/rooms | 新增场地 |
| GET | /api/admin/rooms/:id | 单个场地详情 |
| PUT | /api/admin/rooms/:id | 修改场地（名称/校区/容量/开放时间/状态/标签等） |
| DELETE | /api/admin/rooms/:id | 删除场地（super；有预约记录时拒绝） |
| GET | /api/admin/orders | 全部预约（dateFrom/dateTo/roomId/status/checkin/keyword/page/pageSize/sort + summary 统计；keyword 覆盖订单号/学号/姓名/座位/学院/备注） |
| GET | /api/admin/orders/export | 导出预约名单 **.xlsx**（与列表同一套筛选参数） |
| GET | /api/admin/orders/print | 打印版预约名单（HTML，A4 横向，自动唤起打印） |
| POST | /api/admin/checkin | 按 **8 位核销码** 核销（body `{code, force?}`） |
| PUT | /api/admin/orders/:id/checkin | 按订单号核销 |
| DELETE | /api/admin/orders/:id/checkin | **撤销误核销**（清空核销记录，凭证恢复为待核销并通知学生） |
| PUT | /api/admin/orders/:id/cancel | 管理员取消预约（super；会给学生推送消息） |
| GET | /api/admin/users | 学生用户列表（含预约统计） |
| POST | /api/admin/users | 新增学生用户 |
| GET | /api/admin/users/:studentId | 单个学生详情 |
| PUT | /api/admin/users/:studentId | 修改学生（昵称/学院/信用分/重置密码） |
| DELETE | /api/admin/users/:studentId | 删除学生（super；有进行中预约时拒绝） |
| POST | /api/admin/users/:studentId/wx-unbind | 解除该学生的微信一键登录（super/staff 皆可；连同其全部会话一起下线） |

统一响应结构 `{ code, message, data }`；`code=0` 成功；401 未登录；业务错误带中文提示，前端 toast 反馈。

### 4.1 微信一键登录（绑定学号后免密）

**流程**

1. 进入登录页时前端生成并持久化一个本机微信标识 `wxKey`（`hzx_wx_key`，32 位随机 hex，之后长期不变）。
2. 未绑定过：点「一键获取微信信息」（`open-type="chooseAvatar"`）取头像，首次弹窗「首次登录需要绑定相关信息」输入学号；绑定后自动切到「自助开户」（学号已带入），补全密码/学院等信息提交，开户成功即直接登录（注册即登录）。若该学号其实已开过户，提交时会自动切回学号登录态，只需补输密码。
3. 密码登录 / 自助开户**成功的那一刻**，前端自动调 `POST /api/user/wxbind`：后端把 `wxKey` 与该学号写进 `users`（`wx_key` / `wx_bound_at`），并回发一张 32 位免密票据 `wx_ticket`，前端存进 `hzx_wx_bind`。
4. 之后回到登录页，按钮变为「微信一键登录」，点击走**两段式握手**：第一段 `POST /api/user/wxlogin`（不带 `confirm`）只回身份，小程序弹「确认登录身份」框显示 **学号 / 姓名 / 学院**；点「确认登录」后第二段带 `confirm:true` 才真正换 token —— 后端往 `sessions` 写一条新会话返回，**不再要密码**，同时滚动换发新票据（旧票立即作废）。点「不是我」则不写任何会话状态，留在登录页手输学号密码。
5. 解绑入口在管理台用户列表的「解绑微信」（代客撤销，会一并下线该生全部会话）。小程序端保留了 `POST /api/user/wxunbind` 自助解绑接口（有冒烟用例覆盖，只是个人中心不再放这个入口）。退出登录**不**清除绑定。
6. 后端不认识本机票据时（被解绑 / 清库重播），一键登录返回 `bound:false`，前端自动清票并回落到学号密码登录，不会白屏或死循环。

**边界（务必知道）**

- 本项目用的是**测试号 AppID，拿不到 openid**，因此"这个微信是谁"由前端生成的 `wxKey` 承担，凭证与票据都存放在小程序 Storage：**清缓存或换设备后会回到未绑定状态，需再输一次密码**。绑定关系本身存在服务端 `users` 表，不再依赖缓存，也不会串号。
- 拿到正式 AppID + AppSecret 后无需改动业务代码：在环境里设 `WX_APPID` / `WX_SECRET` 再重启后端（`server/config.js` 的 `WX`），小程序端 `wx.login` 取到的 `code` 就会被后端 `jscode2session` 换成**真 openid** 作为微信标识，`wxKey` 自动退化为兜底路径。手机号快捷登录（`getPhoneNumber`）需要认证的非个人主体且按次计费，本项目未接。
- 触发方式刻意保留「点按钮 + 弹窗确认身份」两步，不做冷启动静默登录：共用手机上不会一打开、或误点一下就登进别人的账号。确认框里的学号/姓名/学院由服务端实时查出（`wxlogin` 第一段），不是本机缓存，改不了也看不到错的人。

### MySQL 数据表（库名 `huizixi`，9 张，全部建表与数据语句都在 `server/database/huizixi.sql`）

| 表 | 说明 | 关键设计 |
| --- | --- | --- |
| `users` | 学生用户 | 学号主键；昵称/学院/信用分；`wx_key` 唯一（一个微信只认一个学号）、`wx_ticket` 免密票据（每次一键登录滚动重发）、`wx_bound_at` 绑定时间，三列共同支撑微信一键登录 |
| `rooms` | 自习室 | 标签用 `JSON` 列；`status` 用 ENUM(open/full/maintenance)；`cover` 详情页大图（1125×510）、`cover_card` 首页热门卡片图（690×360，留空则回退用 `cover`） |
| `announcements` | 首页公告 | `active` 控制是否展示、`sort_no` 控制顺序 |
| `banners` | 首页轮播 | `target` 决定点击跳转 rooms/profile |
| `orders` | 预约订单 | 订单号主键；`checkin_code` 唯一 8 位核销码、`checked_in_at` / `checked_in_by` 记录核销；(user_id, reserve_date) 与 (room_id, reserve_date) 索引；外键关联用户与自习室 |
| `messages` | 消息中心 | `is_read` 支撑未读角标；(user_id, is_read) 索引 |
| `sessions` | 登录会话 | token 主键，登录写库、请求带 `Authorization: Bearer` 校验 |
| `admins` | 管理员账号 | `username` 唯一；`role` 区分 super / staff；`active` 可停用 |
| `admin_sessions` | 管理端会话 | 管理端 token 主键，与学生端 `sessions` 完全隔离 |

> 早期版本还有 `schema_migrations` 迁移记录表与 4 个拆分 SQL 文件，现已合并为单一 `huizixi.sql`（`node server/init-db.js --reset` 重建后即不存在该表）。

数据写入的事务保证：**下单**（订单 + 预约成功消息）、**取消**（状态更新 + 消息）、**核销**（写入核销时间 + 推送签到消息）都在同一事务内提交，避免消息丢失。

## 五、管理后台、核销凭证与预约名单导出

### 1. 管理员角色与权限

| 能力 | 超级管理员 `super`（admin） | 场馆管理员 `staff`（staff01） |
| --- | --- | --- |
| 登录管理后台、看板、查看全部预约 | ✅ | ✅ |
| 场地信息**新增/修改** | ✅ | ✅ |
| **删除场地** | ✅ | ❌ |
| **核销预约**（按码/按订单号） | ✅ | ✅ |
| **撤销误核销**（更正误扫） | ✅ | ✅ |
| 取消预约 | ✅ | ❌ |
| 用户**新增/修改**（昵称、学院、信用分、重置密码） | ✅ | ✅ |
| **删除用户** | ✅ | ❌ |

无权限时接口返回 `403` 与中文原因；管理端 token 与学生端 token 互不通用（学生 token 访问 `/api/admin/*` 一律 `401`）。

### 2. 预约凭证核销流程

```
学生小程序下单 ──► 生成唯一 8 位核销码（如 62916790）
                        │
       凭证页（pages/order-result）大字展示核销码 + 未核销/已核销状态
                        │
   到场后管理员在后台「预约管理」输入核销码（或点该行「核销」按钮）
                        │
     校验：未取消 · 未重复核销 · 在核销时段（开始前 30 分钟 ~ 结束时间）
                        │
       事务写入 checked_in_at / checked_in_by ──► 学生收到「签到成功」消息
```

- 超出核销时段会被拦截并提示，可勾选 **强制核销** 补录（`force: true`）
- 误核销可 **撤销**（`DELETE /api/admin/orders/:id/checkin`，管理台该行的「撤销」按钮）：清空核销记录、凭证恢复为待核销，并给学生推送「核销已撤销」通知
- 已核销的预约不能再取消，也不能重复核销；撤销后即可恢复正常取消/核销流程
- 订单详情接口（`GET /api/orders/:id`）新增字段：`checkinCode`、`checkedIn`、`checkedInAt`、`checkedInByName`

### 3. 预约名单导出与打印

- **导出 Excel**：`GET /api/admin/orders/export` + 筛选参数 → 真实 `.xlsx`（exceljs），含两个工作表：
  「预约名单」19 列明细（核销码/订单号/学号/姓名/学院/自习室/座位/日期/时段/时长/状态/核销状态/核销时间/核销人/备注/下单时间…），表头加粗、冻结首行、开启自动筛选；
  「统计汇总」记录导出人、导出时间、筛选条件与各状态数量
- **打印**：`GET /api/admin/orders/print` + 筛选参数 → A4 横向 HTML 名单（每页重复表头、行不跨页、含统计摘要与签字栏），页面加载后自动唤起打印对话框
- 两者与管理台列表**共用同一套筛选条件**，导出/打印的内容与屏幕所见一致

## 六、自测命令

```bash
node scripts/smoke-test.js        # 学生端 32 项接口用例（含微信一键登录绑定/免密/冲突/解绑；需先启动 MySQL 与 node server/server.js）
node scripts/admin-smoke-test.js  # 管理端 87 项用例：登录权限/场地 CRUD/预约查询/核销与撤销/导出 Excel/打印/用户管理/微信解绑
node scripts/check-project.js     # 工程静态检查（含图片引用存在性）+ 8 页面业务流仿真 122 项（无需后端与数据库，含离线模式一键登录）
# 两个接口用例默认打 http://127.0.0.1:3000/api，要换端口用 $env:API_BASE="http://127.0.0.1:3101/api"
node scripts/gen-images.js        # 只补齐缺失的自制素材（已存在默认跳过；--force 覆盖，--legacy 生成旧版轮播/封面占位图）
pwsh -File scripts/compose-covers.ps1   # 由方图合成 8 张自习室封面（对应表见 scripts/covers-map.json）
pwsh -File scripts/gen-quick-icons.ps1  # 重绘首页 4 个快捷入口图标（透明 PNG，可加 -Size 240）
pwsh -File scripts/gen-tab-icons.ps1    # 重绘 4 个 tabBar 图标（常态+选中，81x81 透明 PNG）
pwsh -File scripts/gen-brand-images.ps1 # 重绘 logo / 默认头像 / 空态插画（卡通风透明 PNG）
```

最近一次结果：**学生端冒烟 23/23 通过；管理端冒烟 77/77 通过（可重复运行，测试数据自清理）；工程静态检查 + 仿真 106/106 通过**。
