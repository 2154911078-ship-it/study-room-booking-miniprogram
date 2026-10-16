-- ============================================================
-- 慧自习 · 校园自习室预约小程序 —— 完整数据库脚本（单文件）
-- 位置：server/database/huizixi.sql
--
-- 内容：建库 + 9 张表结构 + 基础数据 + 演示数据，一个文件搞定
-- 引擎 InnoDB · 字符集 utf8mb4 / utf8mb4_unicode_ci
--
-- 【两种执行方式】
--   ① 自动（推荐）：node server/init-db.js
--      程序会按 server/config.js 的库名建库，然后执行本文件的建表与数据语句
--      （本文件开头的 CREATE DATABASE / USE 两行会被程序自动跳过，以免与环境变量
--        DB_NAME 指定的其它库名冲突；用 mysql 客户端或 Navicat 手动导入时才需要它们）
--   ② 手动：mysql -uroot -p123456 < server/database/huizixi.sql
--      直接命令行导入（无需先建库）；Navicat 里"运行 SQL 文件"同理
--
-- 【幂等】可重复执行，不会产生重复数据：
--   建表 CREATE TABLE IF NOT EXISTS；数据一律 INSERT IGNORE + 写死主键
--   因此后端每次启动都会重放本文件，既补表也补数据，改完文件重启即可生效
--
-- 【演示账号】学生 20210101 / 123456（另有 20210102 / 123456）
--             管理员 admin / 123456（超级）· staff01 / 123456（场馆）
-- 【演示数据】8 条订单覆盖 待使用/使用中/已完成/已取消 四种状态，其中 2 条已核销签到
--             8 条消息（2 条未读），日期全部相对"当天"计算，任何时候导入都有进行中的样子
--
-- 密码为课程演示用途明文存储，正式项目请改为哈希（bcrypt /argon2）
-- ============================================================

-- ------------------------------------------------------------
-- 〇、建库（程序自动执行时跳过这两句，改由 server/config.js 决定库名）
-- ------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS huizixi DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE huizixi;

-- ------------------------------------------------------------
-- 一、表结构（9 张）
-- ------------------------------------------------------------

-- 1. 学生用户（登录账号）
CREATE TABLE IF NOT EXISTS users (
  student_id VARCHAR(20)  NOT NULL                COMMENT '学号（登录名）',
  password   VARCHAR(64)  NOT NULL                COMMENT '登录密码（课程演示用明文，生产应改哈希）',
  nickname   VARCHAR(32)  NOT NULL                COMMENT '昵称',
  college    VARCHAR(32)  NOT NULL DEFAULT ''     COMMENT '学院',
  credit     INT          NOT NULL DEFAULT 100    COMMENT '信用分',
  wx_key     VARCHAR(64)  DEFAULT NULL            COMMENT '微信一键登录：本机微信标识（配了 AppSecret 时为真 openid，否则为前端生成的稳定 key）',
  wx_ticket  CHAR(32)     DEFAULT NULL            COMMENT '微信一键登录：免密票据（每次一键登录滚动重发，解绑即作废）',
  wx_bound_at DATETIME(3) DEFAULT NULL            COMMENT '微信绑定时间（NULL = 未开启一键登录）',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (student_id),
  UNIQUE KEY uk_users_wx_key (wx_key),      -- 一个微信只能绑一个学号（NULL 不参与唯一约束）
  UNIQUE KEY uk_users_wx_ticket (wx_ticket) -- 票据全局唯一，便于按票据反查用户
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学生用户表';

-- 2. 自习室
CREATE TABLE IF NOT EXISTS rooms (
  id          VARCHAR(16)  NOT NULL               COMMENT '自习室编号 r1..r8',
  name        VARCHAR(64)  NOT NULL               COMMENT '名称',
  campus      VARCHAR(16)  NOT NULL               COMMENT '校区',
  building    VARCHAR(32)  NOT NULL               COMMENT '楼栋',
  floor       VARCHAR(16)  NOT NULL               COMMENT '楼层',
  capacity    INT          NOT NULL               COMMENT '座位容量',
  seat_prefix VARCHAR(4)   NOT NULL               COMMENT '座位号前缀 A/B/C',
  open_from   TINYINT UNSIGNED NOT NULL           COMMENT '开始开放整点',
  open_to     TINYINT UNSIGNED NOT NULL           COMMENT '结束开放整点',
  status      ENUM('open','full','maintenance') NOT NULL DEFAULT 'open' COMMENT '开放状态',
  tags        JSON         NOT NULL               COMMENT '标签数组',
  cover       VARCHAR(64)  NOT NULL               COMMENT '封面图（详情页大图 1125x510）',
  cover_card  VARCHAR(64)  NOT NULL DEFAULT ''    COMMENT '首页热门卡片封面图（690x360，留空则前端回退用 cover）',
  description VARCHAR(255) NOT NULL DEFAULT ''    COMMENT '简介',
  notice      VARCHAR(255) NOT NULL DEFAULT ''    COMMENT '入馆须知',
  sort_no     INT          NOT NULL DEFAULT 0     COMMENT '排序',
  PRIMARY KEY (id),
  KEY idx_rooms_campus (campus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自习室表';

-- 3. 管理员账号（独立于学生用户，仅用于管理后台）
CREATE TABLE IF NOT EXISTS admins (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username   VARCHAR(32) NOT NULL COMMENT '管理员账号',
  password   VARCHAR(64) NOT NULL COMMENT '登录密码（课程演示用明文，生产应改哈希）',
  name       VARCHAR(32) NOT NULL DEFAULT '' COMMENT '姓名',
  role       ENUM('super','staff') NOT NULL DEFAULT 'staff' COMMENT '角色：super 超级管理员 / staff 场馆管理员',
  active     TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '是否启用',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_admins_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账号表';

-- 4. 公告（首页纵向轮播）
CREATE TABLE IF NOT EXISTS announcements (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  content  VARCHAR(160) NOT NULL COMMENT '公告内容',
  sort_no  INT          NOT NULL DEFAULT 0,
  active   TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否展示',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告表';

-- 5. 首页轮播图
CREATE TABLE IF NOT EXISTS banners (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  img       VARCHAR(64)  NOT NULL COMMENT '图片路径',
  title     VARCHAR(64)  NOT NULL COMMENT '主标题',
  sub_title VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '副标题',
  target    VARCHAR(16)  NOT NULL DEFAULT 'rooms' COMMENT '跳转目标 rooms/profile',
  sort_no   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页轮播表';

-- 6. 预约订单（含线下签到核销字段）
CREATE TABLE IF NOT EXISTS orders (
  id           VARCHAR(32) NOT NULL              COMMENT '订单号 HZX…',
  user_id      VARCHAR(20) NOT NULL              COMMENT '预约人学号',
  room_id      VARCHAR(16) NOT NULL              COMMENT '自习室编号',
  seat_no      VARCHAR(16) NOT NULL              COMMENT '座位号 A-08',
  reserve_date DATE        NOT NULL              COMMENT '预约日期',
  start_slot   TIME        NOT NULL              COMMENT '开始时段',
  end_slot     TIME        NOT NULL              COMMENT '结束时段',
  status       ENUM('pending','using','done','canceled') NOT NULL DEFAULT 'pending' COMMENT '存储态（using/done 由时间派生）',
  remark       VARCHAR(64) NOT NULL DEFAULT ''   COMMENT '备注',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '下单时间',
  checkin_code CHAR(8)     DEFAULT NULL          COMMENT '8 位数字核销码（到场凭证）',
  checked_in_at DATETIME(3) DEFAULT NULL         COMMENT '核销时间（NULL 表示未核销）',
  checked_in_by VARCHAR(32) DEFAULT NULL         COMMENT '核销操作的管理员账号',
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_checkin_code (checkin_code),
  KEY idx_orders_user_date (user_id, reserve_date),
  KEY idx_orders_room_date (room_id, reserve_date),
  KEY idx_orders_checkin (checked_in_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (student_id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_room FOREIGN KEY (room_id) REFERENCES rooms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预约订单表';

-- 7. 消息中心
CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(20) NOT NULL                COMMENT '接收人学号',
  type       ENUM('system','order','credit') NOT NULL DEFAULT 'system' COMMENT '消息类型',
  title      VARCHAR(64) NOT NULL                COMMENT '标题',
  content    VARCHAR(255) NOT NULL               COMMENT '正文',
  room_id    VARCHAR(16) NOT NULL DEFAULT ''     COMMENT '关联自习室（可空）',
  is_read    TINYINT(1)  NOT NULL DEFAULT 0      COMMENT '是否已读',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_messages_user_read (user_id, is_read),
  KEY idx_messages_user_time (user_id, created_at),
  CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users (student_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息表';

-- 8. 登录会话（学生端 Bearer token）
CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(32)    NOT NULL COMMENT '登录令牌（hex 32 位）',
  user_id    VARCHAR(20) NOT NULL COMMENT '所属学号',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '签发时间',
  PRIMARY KEY (token),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (student_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话表';

-- 9. 管理员登录会话
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      CHAR(32)    NOT NULL COMMENT '管理端登录令牌（hex 32 位）',
  admin_id   INT UNSIGNED NOT NULL COMMENT '管理员 ID',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '签发时间',
  PRIMARY KEY (token),
  KEY idx_admin_sessions_admin (admin_id),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员登录会话表';

-- ------------------------------------------------------------
-- 二、基础数据（学生 / 管理员 / 自习室 / 公告 / 轮播）
-- ------------------------------------------------------------

-- 学生账号：20210101 / 123456、20210102 / 123456
INSERT IGNORE INTO users (student_id, password, nickname, college, credit) VALUES
  ('20210101', '123456', '林小知', '计算机学院', 100),
  ('20210102', '123456', '陈木木', '外国语学院', 98);

-- 管理员账号：admin / 123456（超级，可管理自习室与学生）、staff01 / 123456（场馆，只能核销与导出）
INSERT IGNORE INTO admins (id, username, password, name, role, active) VALUES
  (1, 'admin', '123456', '系统管理员', 'super', 1),
  (2, 'staff01', '123456', '前台值班员', 'staff', 1);

-- 8 间自习室（东/西/南三个校区，含开放/约满/维护三种状态）
INSERT IGNORE INTO rooms
  (id, name, campus, building, floor, capacity, seat_prefix, open_from, open_to, status, tags, cover, cover_card, description, notice, sort_no)
VALUES
  ('r1', '静远楼A · 静音自习室', '东校区', '静远楼', '3层', 40, 'A', 7, 22, 'open',
   '["静音区","空调","电源插座"]', '/images/cover-1.jpg', '/images/hot-jingyuan-a.jpg',
   '全程静音管理，适合深度学习与备考冲刺，配备独立台灯与插座。', '入馆请将手机调至静音，禁止语音通话。', 1),
  ('r2', '致远图书馆 · 综合自习区', '东校区', '致远图书馆', '2层', 80, 'B', 8, 21, 'open',
   '["空调","存包柜","打印点"]', '/images/cover-2.jpg', '/images/hot-zhiyuan-lib.jpg',
   '馆内综合区，座位充足，紧邻社科书库，查资料方便。', '闭馆前 30 分钟停止续位。', 2),
  ('r3', '明理楼B · 考研自习室', '西校区', '明理楼', '5层', 36, 'C', 7, 22, 'open',
   '["单人桌","台灯","白板墙"]', '/images/cover-3.jpg', '/images/hot-mingli-b.jpg',
   '考研同学专属氛围，单人固定桌位，配备刷题白板墙。', '禁止占座离座超过 60 分钟。', 3),
  ('r4', '学生活动中心 · 自习区', '西校区', '第三学生活动中心', '1层', 60, 'D', 8, 20, 'maintenance',
   '["空调","讨论区","茶水"]', '/images/cover-4.jpg', '/images/hot-student-center.jpg',
   '开放式自习区，可小声讨论，适合小组学习与课程项目。', '本周电路检修，暂停开放，预计周日恢复。', 4),
  ('r5', '长风楼C · 晚间自习区', '南校区', '长风楼', '2层', 50, 'E', 8, 23, 'open',
   '["延长开放","软座","热饮吧"]', '/images/cover-5.jpg', '/images/hot-changfeng-c.jpg',
   '南校区延长开放区域，晚到同学的首选，配有热饮自助吧。', '22:00 后请轻声交流，不影响他人。', 5),
  ('r6', '南区读书角 · 半开放卡座', '南校区', '读书角', '1层', 24, 'F', 9, 21, 'full',
   '["沙发座","轻音乐","Wi-Fi"]', '/images/cover-6.jpg', '/images/hot-south-corner.jpg',
   '半开放卡座，氛围轻松，适合阅读与轻度复习。', '座位少，建议错峰预约。', 6),
  ('r7', '致远图书馆 · 4F 靠窗座', '东校区', '致远图书馆', '4层', 18, 'G', 8, 21, 'full',
   '["靠窗","独立灯控","静音"]', '/images/cover-7.jpg', '/images/hot-zhiyuan-window.jpg',
   '最抢手的靠窗景观位，采光好，视野开阔。', '靠窗座每人每周最多预约 3 次。', 7),
  ('r8', '明理楼A · 共享自习室', '西校区', '明理楼', '3层', 42, 'H', 7, 21, 'open',
   '["可拼桌","投影","白板"]', '/images/cover-8.jpg', '/images/hot-mingli-a.jpg',
   '支持小组学习的共享空间，可预约投影与白板讲解时段。', '使用投影请提前在留言备注中说明。', 8);

-- 首页公告（纵向轮播）
INSERT IGNORE INTO announcements (id, content, sort_no, active) VALUES
  (1, '国庆假期自习室开放时间调整为 08:00 - 20:00', 1, 1),
  (2, '期末冲刺周（第17-18周）东校区自习室延长开放至 23:00', 2, 1),
  (3, '请节约用电，离馆时随手关灯并带走个人物品', 3, 1);

-- 首页轮播图（图片文件名与下方 title 文案一一对应，便于辨认）
INSERT IGNORE INTO banners (id, img, title, sub_title, target, sort_no) VALUES
  (1, '/images/banner-qimoji-kaowei.jpg', '期末季 · 考位充足', '一键预约，错峰自习', 'rooms', 1),
  (2, '/images/banner-xinguan-nanqu-wanjian.jpg', '新馆开放 · 南区晚间自习区', '最长开放至 23:00', 'rooms', 2),
  (3, '/images/banner-wenming-xinyongfen.jpg', '文明自习 · 信用分计划', '守约签到，攒学习学分', 'profile', 3);

-- ------------------------------------------------------------
-- 三、演示订单（8 条 · 两名学生 · 日期相对"当天"，状态覆盖四种）
--     核销码为写死的 8 位数字，方便演示"出示核销码 → 管理台签到"
--     已取消的订单不给核销码（status=canceled 时不参与签到）
-- ------------------------------------------------------------
INSERT IGNORE INTO orders
  (id, user_id, room_id, seat_no, reserve_date, start_slot, end_slot, status, remark, created_at, checkin_code, checked_in_at, checked_in_by)
VALUES
  -- ① 明天傍晚 · 待使用 · 未核销（演示"到场出示核销码 12000001"）
  --    刻意选 17:00-20:00：自测用例固定在明天 08:00-11:00 / 13:00-16:00 为该学号下单，
  --    而"同一学号同日时段重叠"会被 createOrder 拦截，演示数据必须与用例错开
  ('HZXDEMO001', '20210101', 'r1', 'A-08',
   DATE_ADD(CURDATE(), INTERVAL 1 DAY), '17:00', '20:00', 'pending', '靠窗座位，谢谢',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '20:15:00'), '12000001', NULL, NULL),

  -- ② 今天下午 · 待使用 / 到点后自动变使用中 · 未核销
  ('HZXDEMO002', '20210101', 'r5', 'E-03',
   CURDATE(), '14:00', '18:00', 'pending', '',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '09:40:00'), '12000002', NULL, NULL),

  -- ③ 前天上午 · 已完成 · 已核销（超级管理员操作，演示核销记录）
  ('HZXDEMO003', '20210101', 'r2', 'B-06',
   DATE_SUB(CURDATE(), INTERVAL 2 DAY), '08:00', '11:00', 'done', '',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '21:05:00'), '12000003',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '08:05:00'), 'admin'),

  -- ④ 五天前 · 已取消（无核销码）
  ('HZXDEMO004', '20210101', 'r1', 'A-02',
   DATE_SUB(CURDATE(), INTERVAL 5 DAY), '13:00', '17:00', 'canceled', '临时有事',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '16:20:00'), NULL, NULL, NULL),

  -- ⑤ 另一名同学 · 今天全天 · 待使用 · 未核销（管理台按学号筛选能看出两人区别）
  ('HZXDEMO005', '20210102', 'r3', 'C-05',
   CURDATE(), '08:00', '12:00', 'pending', '考研固定位',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '07:30:00'), '12000005', NULL, NULL),

  -- ⑥ 另一名同学 · 明天晚间 · 待使用 · 未核销
  ('HZXDEMO006', '20210102', 'r2', 'B-12',
   DATE_ADD(CURDATE(), INTERVAL 1 DAY), '19:00', '21:00', 'pending', '',
   TIMESTAMP(CURDATE(), '08:12:00'), '12000006', NULL, NULL),

  -- ⑦ 三天前 · 已完成 · 已核销（场馆管理员 staff01 操作，演示两种核销人）
  ('HZXDEMO007', '20210102', 'r8', 'H-01',
   DATE_SUB(CURDATE(), INTERVAL 3 DAY), '08:00', '12:00', 'done', '',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '19:50:00'), '12000007',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '08:12:00'), 'staff01'),

  -- ⑧ 六天前 · 已取消
  ('HZXDEMO008', '20210102', 'r5', 'E-11',
   DATE_SUB(CURDATE(), INTERVAL 6 DAY), '14:00', '17:00', 'canceled', '重复预约',
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '10:05:00'), NULL, NULL, NULL);

-- ------------------------------------------------------------
-- 四、演示消息（8 条 · 2 条未读 · 与上面的订单一一呼应）
-- ------------------------------------------------------------
INSERT IGNORE INTO messages (id, user_id, type, title, content, room_id, is_read, created_at) VALUES
  (1, '20210101', 'system', '欢迎加入慧自习',
   '首次使用请阅读《自习公约》，守约签到可累积信用分。', '', 1,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '10:00:00')),

  (2, '20210101', 'credit', '信用分奖励',
   '本月守约签到 12 次，信用分保持 100，继续加油！', '', 1,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '15:36:00')),

  (3, '20210101', 'order', '签到成功',
   CONCAT('您已于 ', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '%m月%d日'),
          ' 08:05 完成签到（致远图书馆 · 综合自习区 B-06），感谢守约。'), 'r2', 1,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '08:05:10')),

  (4, '20210101', 'system', '放假通知',
   '国庆假期自习室开放时间调整为 08:00 - 20:00，请合理安排复习计划。', '', 1,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '11:20:00')),

  (5, '20210101', 'order', '预约成功提醒',
   CONCAT('您已预约 静远楼A · 静音自习室 A-08（',
          DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '%m月%d日'),
          ' 17:00-20:00），核销码 12000001，请于时段开始前 30 分钟起向管理员出示完成签到。'), 'r1', 0,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '20:15:05')),

  (6, '20210101', 'order', '预约已取消',
   CONCAT('订单 HZXDEMO004 已取消（', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '%m月%d日'),
          ' 13:00-17:00），期待下次见面。'), 'r1', 1,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '12:00:00')),

  (7, '20210102', 'order', '预约成功提醒',
   CONCAT('您已预约 明理楼B · 考研自习室 C-05（', DATE_FORMAT(CURDATE(), '%m月%d日'),
          ' 08:00-12:00），核销码 12000005，请按时到馆签到。'), 'r3', 0,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '07:30:05')),

  (8, '20210102', 'order', '签到成功',
   CONCAT('您已于 ', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '%m月%d日'),
          ' 08:12 完成签到（明理楼A · 共享自习室 H-01），感谢守约。'), 'r8', 1,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '08:12:10'));
