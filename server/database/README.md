# server/database —— 数据库脚本目录

本目录只有一个 SQL 文件：**`huizixi.sql`**。建库、9 张表结构、基础数据、演示数据全在这一个文件里，
与业务代码（`server/*.js`）分开管理，方便整体查看、交给老师、或用客户端直接导入。

## 文件说明

| 文件 | 作用 | 幂等性 |
| --- | --- | --- |
| `huizixi.sql` | 建库 → 9 张表 → 基础数据（2 个学生 / 2 个管理员 / 8 间自习室 / 3 条公告 / 3 张轮播）→ 演示数据（8 条订单 + 8 条消息） | ✅ 建表用 `CREATE TABLE IF NOT EXISTS`；数据一律 `INSERT IGNORE` 且**主键写死**，重复执行不会产生任何重复行 |

脚本内的分段顺序（按注释 `-- 一、`～`-- 四、` 定位）：

| 分段 | 内容 |
| --- | --- |
| 〇、建库 | `CREATE DATABASE IF NOT EXISTS huizixi` + `USE huizixi`（程序自动执行时会跳过这两句，见下） |
| 一、表结构 | 9 张表：`users`、`rooms`、`admins`、`announcements`、`banners`、`orders`、`messages`、`sessions`、`admin_sessions`。InnoDB / utf8mb4 / utf8mb4_unicode_ci，含索引与外键；建表顺序已按外键依赖排列（被引用的表在前） |
| 二、基础数据 | 演示账号与管理员账号、8 间自习室（东/西/南校区，含 open / full / maintenance 三种状态）、公告、轮播图 |
| 三、演示订单 | 8 条，两名学生各 4 条，日期用 `CURDATE()` 相对当天计算，任何时候导入都有"进行中"的样子；状态覆盖 `pending` / `done` / `canceled`（`using` 由时间派生），其中 2 条已完成订单已核销签到（分别由 `admin` 与 `staff01` 操作） |
| 四、演示消息 | 8 条，2 条未读（支撑 tabBar 角标与概览「未读消息」卡片），正文用 `CONCAT` 拼出与订单一致的相对日期 |

演示核销码为固定值 `12000001` ~ `12000007`（已取消订单故意不给核销码），可直接在管理后台「按码核销」里输入体验。

## 执行方式

### 自动（推荐）

```bash
node server/init-db.js            # 建库 + 执行 huizixi.sql（幂等，已有数据不动）
node server/init-db.js --check    # 只检查连通性与表结构
node server/init-db.js --reset    # 删库重建，重新导入演示数据（会清空业务数据！）
```

`node server/server.js` 启动时也会自动执行一遍 `huizixi.sql`，所以**重复启动、重复导入都安全**。
执行时程序会跳过 `CREATE DATABASE` 与 `USE` 两句：库名由 `server/config.js`（可用环境变量 `DB_NAME` 覆盖）决定，
并且 `USE` 会把连接池里那条连接的当前库改掉，留着反而危险；这两句只在用 mysql 客户端手动导入时才起作用。

### 手动（mysql 客户端 / Navicat）

```bash
mysql -uroot -p123456 < server/database/huizixi.sql
```

一条命令即可（文件开头自带建库与 `USE`，无需先手动建库）。
Navicat / SQLyog 里对目标连接「运行 SQL 文件」效果相同。

> 想把数据装进别的库名：先打开文件把 `huizixi` 改掉，或注释掉那两句后 `mysql -uroot -p123456 你的库名 < ...`；
> 代码侧则用 `$env:DB_NAME="你的库名"` 指定，两边保持一致。

## 要改表结构怎么办

- **新增整张表**：直接写进 `huizixi.sql`，重启后端即建（`CREATE TABLE IF NOT EXISTS`）。
- **给已有表加新列**：写进 `huizixi.sql` 的 `CREATE TABLE`（新库直接带上），同时在 `server/db.js` 的 `ADD_COLUMNS` 里登记一条 `ALTER TABLE ... ADD COLUMN ...`
  —— 后端启动时会先查 `information_schema`，缺哪列补哪列，因此**老库不用重建也能平滑升级**，`init-db.js` 会打印「自动补齐缺失列」。
  目前已登记：`rooms.cover_card`、`orders.checkin_code` / `checked_in_at` / `checked_in_by`。
- **改已有列的类型 / 删列 / 加索引**：请手动 `ALTER TABLE`，或演示环境直接 `node server/init-db.js --reset` 重建。

> 早期版本提供 `migrations/` 增量迁移机制（含 `schema_migrations` 版本表），已随单文件合并移除；现在只保留上面这套「缺列即补」的轻量方案。

## 常用排查 SQL

```sql
USE huizixi;

-- 各表行数
SELECT 'users' t, COUNT(*) n FROM users
UNION ALL SELECT 'admins', COUNT(*) FROM admins
UNION ALL SELECT 'rooms', COUNT(*) FROM rooms
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions;

-- 确认表数量（应为 9）
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'huizixi' ORDER BY TABLE_NAME;

-- 待使用订单（含自习室与座位、核销码）
SELECT o.id, o.user_id, r.name AS room, o.seat_no, o.checkin_code,
       o.reserve_date, o.start_slot, o.end_slot
FROM orders o JOIN rooms r ON r.id = o.room_id
WHERE o.status = 'pending' ORDER BY o.reserve_date;

-- 未读消息统计
SELECT user_id, COUNT(*) AS unread FROM messages WHERE is_read = 0 GROUP BY user_id;

-- 核销情况：哪些订单已核销、由谁在何时核销
SELECT o.id, o.user_id, r.name AS room, o.seat_no, o.checkin_code,
       o.checked_in_at, o.checked_in_by
FROM orders o JOIN rooms r ON r.id = o.room_id
WHERE o.checked_in_at IS NOT NULL ORDER BY o.checked_in_at DESC;

-- 缺核销码的有效订单（正常情况下应为 0 行；如有，重启服务会自动补发，已取消订单不需要码）
SELECT id, user_id, reserve_date FROM orders
WHERE status <> 'canceled' AND (checkin_code IS NULL OR checkin_code = '');

-- 管理员与其在线会话
SELECT a.username, a.name, a.role, a.active, COUNT(s.token) AS sessions
FROM admins a LEFT JOIN admin_sessions s ON s.admin_id = a.id
GROUP BY a.id;
```
