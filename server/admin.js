/**
 * server/admin.js —— 管理端业务层（管理员角色）
 *
 * 覆盖四项管理能力：
 *   1. 登录会话      —— 独立 admins / admin_sessions 表，与学生端 token 完全隔离
 *   2. 自习场地管理  —— 自习室增删改查（删除受预约记录约束，改完刷新内存缓存）
 *   3. 预约记录管理  —— 全量预约查询/筛选/统计、核销（按核销码或订单号）、管理员取消、导出与打印的数据源
 *   4. 用户管理      —— 学生账号增删改查、信用分与密码维护
 *
 * 角色约定：role = 'super' 超级管理员 / 'staff' 场馆管理员
 *   staff 只能做日常运营（核销、改场地信息、看预约），
 *   super 额外拥有：删除场地、用户增删改、取消预约
 *
 * 错误统一用 data.fail(code, message) 抛出（带 biz 标记），由 server.js 转成 { code, message }
 */
const crypto = require("crypto");
const db = require("./db");
const d = require("./data");

const ROOM_STATUS = ["open", "full", "maintenance"];
const CHECKIN_OPEN_MINUTES = 30; // 预约开始前 30 分钟开放核销

/* ============================ 小工具 ============================ */

/** '2026-09-10' + '09:00' → 本地时间毫秒 */
function slotMs(date, slot) {
  const dp = String(date).split("-").map(Number);
  const tp = String(slot).split(":").map(Number);
  return new Date(dp[0], (dp[1] || 1) - 1, dp[2] || 1, tp[0] || 0, tp[1] || 0, 0, 0).getTime();
}

function fmtMs(ms) {
  const dt = new Date(ms);
  return d.pad2(dt.getMonth() + 1) + "-" + d.pad2(dt.getDate()) + " " +
    d.pad2(dt.getHours()) + ":" + d.pad2(dt.getMinutes());
}

function fmtDateTime(ms) {
  if (ms === null || ms === undefined) return "";
  const dt = new Date(Number(ms));
  return dt.getFullYear() + "-" + d.pad2(dt.getMonth() + 1) + "-" + d.pad2(dt.getDate()) + " " +
    d.pad2(dt.getHours()) + ":" + d.pad2(dt.getMinutes());
}

/** 权限校验：仅超级管理员 */
function requireSuper(admin, action) {
  if (!admin || admin.role !== "super") {
    d.fail(403, "当前账号（" + ((admin && admin.name) || "场馆管理员") + "）无权限" + action + "，请使用超级管理员账号");
  }
}

/* ============================ 登录会话 ============================ */

function adminView(a) {
  return { id: a.id, username: a.username, name: a.name, role: a.role };
}

async function login(username, password) {
  const uname = String(username || "").trim();
  if (!uname || !password) d.fail(400, "请输入管理员账号与密码");

  const rows = await db.query(
    "SELECT id, username, password, name, role, active FROM admins WHERE username = ?",
    [uname]
  );
  const a = rows[0];
  if (!a || a.password !== String(password)) {
    d.fail(400, "管理员账号或密码不正确（演示账号：admin / 123456）");
  }
  if (!a.active) d.fail(403, "该管理员账号已停用，请联系超级管理员");

  const token = crypto.randomBytes(16).toString("hex");
  await db.exec("INSERT INTO admin_sessions (token, admin_id) VALUES (?,?)", [token, a.id]);
  return { token: token, admin: adminView(a) };
}

async function logout(token) {
  if (token) await db.exec("DELETE FROM admin_sessions WHERE token = ?", [token]);
  return { ok: true };
}

/** 由管理端 Bearer token 解析管理员（无/失效返回 null） */
async function authAdmin(token) {
  if (!token) return null;
  const rows = await db.query(
    "SELECT a.id, a.username, a.name, a.role FROM admins a " +
    "JOIN admin_sessions s ON s.admin_id = a.id WHERE s.token = ? AND a.active = 1",
    [token]
  );
  return rows[0] || null;
}

/* ============================ 概览看板 ============================ */

async function overview() {
  const c = (await db.query(
    "SELECT " +
    "(SELECT COUNT(*) FROM orders) AS orderTotal, " +
    "(SELECT COUNT(*) FROM orders WHERE reserve_date = CURDATE()) AS todayOrders, " +
    "(SELECT COUNT(*) FROM orders WHERE status = 'pending' AND reserve_date >= CURDATE()) AS pendingOrders, " +
    "(SELECT COUNT(*) FROM orders WHERE status = 'pending' AND reserve_date = CURDATE() " +
    "  AND start_slot <= CURTIME() AND end_slot > CURTIME()) AS usingOrders, " +
    "(SELECT COUNT(*) FROM orders WHERE checked_in_at IS NOT NULL) AS checkedInTotal, " +
    "(SELECT COUNT(*) FROM orders WHERE checked_in_at IS NOT NULL AND DATE(checked_in_at) = CURDATE()) AS checkedInToday, " +
    "(SELECT COUNT(*) FROM orders WHERE checked_in_at IS NULL AND status = 'pending' AND reserve_date >= CURDATE()) AS notCheckedIn, " +
    "(SELECT COUNT(*) FROM users) AS userTotal, " +
    "(SELECT COUNT(*) FROM admins) AS adminTotal, " +
    "(SELECT COUNT(*) FROM messages WHERE is_read = 0) AS unreadMessages"
  ))[0];

  const perRoom = new Map();
  (await db.query(
    "SELECT room_id AS roomId, COUNT(*) AS n FROM orders WHERE reserve_date = CURDATE() GROUP BY room_id"
  )).forEach(function (r) {
    perRoom.set(r.roomId, Number(r.n));
  });

  // 空闲座位按「当前时段真实占座」算（与小程序端同一口径）
  const usedNow = await d.usedSeatsNow();
  const rooms = d.getRooms().map(function (r) {
    return {
      id: r.id, name: r.name, campus: r.campus, building: r.building, floor: r.floor,
      capacity: r.capacity, status: r.status, openText: d.openTextOf(r),
      free: d.freeCountOf(r, usedNow), todayOrders: perRoom.get(r.id) || 0
    };
  });

  const stats = {
    roomTotal: rooms.length,
    roomOpen: rooms.filter(function (r) { return r.status === "open"; }).length,
    roomFull: rooms.filter(function (r) { return r.status === "full"; }).length,
    roomMaintenance: rooms.filter(function (r) { return r.status === "maintenance"; }).length,
    freeSeats: rooms.reduce(function (s, r) { return s + r.free; }, 0),
    orderTotal: Number(c.orderTotal),
    todayOrders: Number(c.todayOrders),
    pendingOrders: Number(c.pendingOrders),
    usingOrders: Number(c.usingOrders),
    checkedInTotal: Number(c.checkedInTotal),
    checkedInToday: Number(c.checkedInToday),
    notCheckedIn: Number(c.notCheckedIn),
    userTotal: Number(c.userTotal),
    adminTotal: Number(c.adminTotal),
    unreadMessages: Number(c.unreadMessages)
  };

  const orders = (await db.query(
    ADMIN_ORDER_SELECT + "ORDER BY o.created_at DESC, o.id DESC LIMIT 20"
  )).map(adminOrderView);

  const messages = await db.query(
    "SELECT id, user_id AS userId, type, title, content, is_read AS isRead, " +
    "CAST(UNIX_TIMESTAMP(created_at) * 1000 AS UNSIGNED) AS ts " +
    "FROM messages ORDER BY created_at DESC, id DESC LIMIT 12"
  );

  // 学生登录会话：带昵称与签发时间，管理台才看得懂（token 只留前 6 位用于区分同号多次登录）
  const sessions = (await db.query(
    "SELECT s.token, s.user_id AS userId, u.nickname AS nickname, " +
    "CAST(UNIX_TIMESTAMP(s.created_at) * 1000 AS UNSIGNED) AS ts " +
    "FROM sessions s LEFT JOIN users u ON u.student_id = s.user_id " +
    "ORDER BY s.created_at DESC LIMIT 20"
  )).map(function (s) {
    return {
      userId: s.userId, nickname: s.nickname || "",
      token: String(s.token).slice(0, 6), ts: Number(s.ts) || 0
    };
  });

  const adminSessions = (await db.query(
    "SELECT s.token, a.username, a.name, CAST(UNIX_TIMESTAMP(s.created_at) * 1000 AS UNSIGNED) AS ts " +
    "FROM admin_sessions s JOIN admins a ON a.id = s.admin_id " +
    "ORDER BY s.created_at DESC LIMIT 10"
  )).map(function (s) {
    return {
      username: s.username, name: s.name || "",
      token: String(s.token).slice(0, 6), ts: Number(s.ts) || 0
    };
  });

  return {
    stats: stats,
    rooms: rooms,
    orders: orders,
    messages: messages.map(function (m) {
      return { id: Number(m.id), userId: m.userId, type: m.type, title: m.title, content: m.content, ts: Number(m.ts), read: !!m.isRead };
    }),
    sessions: sessions,
    adminSessions: adminSessions
  };
}

/* ============================ 预约查询（列表/导出/打印共用） ============================ */

const ADMIN_ORDER_SELECT =
  "SELECT o.id, o.user_id AS userId, u.nickname AS nickname, u.college AS college, " +
  "o.room_id AS roomId, r.name AS roomName, r.campus AS campus, r.building AS building, r.floor AS floor, " +
  "o.seat_no AS seatNo, " +
  "DATE_FORMAT(o.reserve_date, '%Y-%m-%d') AS `date`, " +
  "DATE_FORMAT(o.start_slot, '%H:%i') AS startSlot, " +
  "DATE_FORMAT(o.end_slot, '%H:%i') AS endSlot, " +
  "o.status AS rawStatus, o.remark AS remark, " +
  "CAST(UNIX_TIMESTAMP(o.created_at) * 1000 AS UNSIGNED) AS createdAt, " +
  "o.checkin_code AS checkinCode, o.checked_in_by AS checkedInByName, " +
  "CASE WHEN o.checked_in_at IS NULL THEN NULL " +
  "     ELSE CAST(UNIX_TIMESTAMP(o.checked_in_at) * 1000 AS UNSIGNED) END AS checkedInAt " +
  "FROM orders o " +
  "LEFT JOIN rooms r ON r.id = o.room_id " +
  "LEFT JOIN users u ON u.student_id = o.user_id ";

function adminOrderView(row) {
  const v = d.mapOrder(row);
  v.userId = row.userId; // mapOrder 面向小程序端，不含 userId；管理端需要归属人
  v.nickname = row.nickname || "";
  v.college = row.college || "";
  v.checkinText = v.checkedIn ? "已核销" : "未核销";
  v.createdText = fmtDateTime(v.createdAt);
  v.checkedInAtText = v.checkedIn ? fmtDateTime(v.checkedInAt) : "";
  return v;
}

/** 排序：下单时间倒序（默认）/ 预约日期正序 / 预约日期倒序 */
function sortOrders(list, sort) {
  const arr = list.slice();
  if (sort === "reserve_asc") {
    arr.sort(function (a, b) {
      return a.date === b.date ? a.startSlot.localeCompare(b.startSlot) : a.date.localeCompare(b.date);
    });
  } else if (sort === "reserve_desc") {
    arr.sort(function (a, b) {
      return a.date === b.date ? b.startSlot.localeCompare(a.startSlot) : b.date.localeCompare(a.date);
    });
  } else {
    arr.sort(function (a, b) { return b.createdAt - a.createdAt; });
  }
  return arr;
}

/** 组装预约查询的 WHERE（状态是"派生"的，放到内存里过滤） */
function buildOrderWhere(f) {
  const where = [];
  const params = [];
  if (f.date) { where.push("o.reserve_date = ?"); params.push(f.date); }
  if (f.dateFrom) { where.push("o.reserve_date >= ?"); params.push(f.dateFrom); }
  if (f.dateTo) { where.push("o.reserve_date <= ?"); params.push(f.dateTo); }
  if (f.roomId) { where.push("o.room_id = ?"); params.push(f.roomId); }
  if (f.checkin === "checked") where.push("o.checked_in_at IS NOT NULL");
  else if (f.checkin === "none") where.push("o.checked_in_at IS NULL");
  if (f.keyword) {
    const k = "%" + f.keyword + "%";
    where.push("(o.id LIKE ? OR o.user_id LIKE ? OR u.nickname LIKE ? OR o.seat_no LIKE ? " +
      "OR u.college LIKE ? OR o.remark LIKE ?)");
    params.push(k, k, k, k, k, k);
  }
  return { sql: where.length ? " WHERE " + where.join(" AND ") : "", params: params };
}

/** 按筛选条件取出（不分页的）全部预约 + 统计 */
async function collectOrders(f) {
  const cond = buildOrderWhere(f);
  let list = (await db.query(
    ADMIN_ORDER_SELECT + cond.sql + " ORDER BY o.created_at DESC, o.id DESC",
    cond.params
  )).map(adminOrderView);

  // 派生状态过滤（pending/using/done/canceled）
  if (f.status && f.status !== "all") {
    list = list.filter(function (o) { return o.status === f.status; });
  }

  const summary = {
    total: list.length,
    pending: list.filter(function (o) { return o.status === "pending"; }).length,
    using: list.filter(function (o) { return o.status === "using"; }).length,
    done: list.filter(function (o) { return o.status === "done"; }).length,
    canceled: list.filter(function (o) { return o.status === "canceled"; }).length,
    checkedIn: list.filter(function (o) { return o.checkedIn; }).length,
    notCheckedIn: list.filter(function (o) { return !o.checkedIn; }).length,
    hours: list.reduce(function (s, o) { return s + (o.hours || 0); }, 0)
  };
  return { list: sortOrders(list, f.sort), summary: summary };
}

/**
 * 预约查询主入口（管理台列表 / 导出 Excel / 打印页共用同一套筛选语义）
 * @param {object} q date,dateFrom,dateTo,roomId,status,checkin,keyword,sort,page,pageSize
 * @returns {Promise<{list:object[],total:number,page:number,pageSize:number,hasMore:boolean,summary:object,filters:object}>}
 */
async function queryOrders(q) {
  const f = q || {};
  const collected = await collectOrders(f);
  const list = collected.list;

  const page = Math.max(1, parseInt(f.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(f.pageSize, 10) || 20));
  const total = list.length;
  return {
    list: list.slice((page - 1) * pageSize, page * pageSize),
    total: total,
    page: page,
    pageSize: pageSize,
    hasMore: page * pageSize < total,
    summary: collected.summary,
    filters: f
  };
}

/** 导出/打印需要完整结果集（不分页） */
async function exportOrders(q) {
  const f = q || {};
  const collected = await collectOrders(f);
  return {
    list: collected.list,
    total: collected.list.length,
    summary: collected.summary,
    filters: f
  };
}

async function getOrderById(id) {
  const rows = await db.query(ADMIN_ORDER_SELECT + "WHERE o.id = ?", [String(id)]);
  if (!rows.length) d.fail(404, "订单不存在：" + id);
  return adminOrderView(rows[0]);
}

/* ============================ 核销 ============================ */

/**
 * 核销订单（按订单视图对象）
 * @param {object} order 管理端订单视图
 * @param {object} admin 当前管理员
 * @param {boolean} force 是否强制核销（跳过时段校验）
 */
async function doCheckin(order, admin, force) {
  if (order.rawStatus === "canceled") d.fail(400, "该预约已取消，不能核销");
  if (order.checkedIn) {
    d.fail(400, "该订单已于 " + order.checkedInAtText + " 由 " + (order.checkedInByName || "管理员") + " 核销，请勿重复核销");
  }

  const startMs = slotMs(order.date, order.startSlot);
  const endMs = slotMs(order.date, order.endSlot);
  const openMs = startMs - CHECKIN_OPEN_MINUTES * 60 * 1000;
  const now = Date.now();

  if (!force) {
    if (now < openMs) {
      d.fail(400, "尚未到核销时间：可核销时段为 " + fmtMs(openMs) + " ~ " + fmtMs(endMs) +
        "（开始前 " + CHECKIN_OPEN_MINUTES + " 分钟开放核销，如需提前核销请勾选强制核销）");
    }
    if (now > endMs) {
      d.fail(400, "预约时段已于 " + fmtMs(endMs) + " 结束，无法核销（如需补核销请勾选强制核销）");
    }
  }

  const operator = admin.name || admin.username;
  await db.tx(async function (conn) {
    await db.execOn(conn,
      "UPDATE orders SET checked_in_at = NOW(3), checked_in_by = ? WHERE id = ? AND checked_in_at IS NULL",
      [operator, order.id]
    );
    await db.execOn(conn,
      "INSERT INTO messages (user_id, type, title, content, room_id, is_read) VALUES (?,?,?,?,?,0)",
      [order.userId, "order", "签到成功",
        "您已成功签到 " + order.roomName + " " + order.seatNo + "（" + order.date + " " +
        order.startSlot + "-" + order.endSlot + "）" + (force ? "，由" + operator + "补核销。" : "，祝学习顺利。"),
        order.roomId]
    );
  });

  return getOrderById(order.id);
}

/** 按 8 位核销码核销（管理员在后台输入用户出示的码） */
async function checkinByCode(code, admin, force) {
  const c = String(code || "").trim();
  if (!/^\d{8}$/.test(c)) d.fail(400, "核销码应为 8 位数字，请核对后重新输入");
  const rows = await db.query(ADMIN_ORDER_SELECT + "WHERE o.checkin_code = ?", [c]);
  if (!rows.length) d.fail(404, "核销码 " + c + " 不存在，请确认用户出示的凭证");
  return doCheckin(adminOrderView(rows[0]), admin, force);
}

/** 按订单号核销（管理台列表行内按钮） */
async function checkinById(id, admin, force) {
  return doCheckin(await getOrderById(id), admin, force);
}

/**
 * 撤销核销（前台误核销的更正操作）：清空核销记录，凭证恢复为「待核销」
 * @param {string} id 订单号
 * @param {object} admin 当前管理员
 */
async function undoCheckin(id, admin) {
  const order = await getOrderById(id);
  if (!order.checkedIn) d.fail(400, "该预约尚未核销，无需撤销");
  if (order.rawStatus === "canceled") d.fail(400, "该预约已取消，不能撤销核销");

  const operator = admin.name || admin.username;
  await db.tx(async function (conn) {
    await db.execOn(conn,
      "UPDATE orders SET checked_in_at = NULL, checked_in_by = NULL " +
      "WHERE id = ? AND checked_in_at IS NOT NULL",
      [order.id]
    );
    await db.execOn(conn,
      "INSERT INTO messages (user_id, type, title, content, room_id, is_read) VALUES (?,?,?,?,?,0)",
      [order.userId, "order", "核销已撤销",
        "管理员 " + operator + " 撤销了您在 " + order.roomName + " " + order.seatNo + "（" +
        order.date + " " + order.startSlot + "-" + order.endSlot + "）的签到核销，" +
        "凭证已恢复为待核销，请重新向管理员出示核销码。",
        order.roomId]
    );
  });
  return getOrderById(order.id);
}

/** 管理员取消预约（仅待使用；会推送消息给用户） */
async function cancelOrder(id, admin, reason) {
  requireSuper(admin, "取消预约");
  const order = await getOrderById(id);
  if (order.checkedIn) {
    d.fail(400, "该预约已于 " + order.checkedInAtText + " 核销签到，不能取消");
  }
  if (order.status !== "pending") d.fail(400, "仅“待使用”的预约可以取消（当前状态：" + order.status + "）");

  const note = String(reason || "").slice(0, 40);
  await db.tx(async function (conn) {
    await db.execOn(conn, "UPDATE orders SET status = 'canceled' WHERE id = ?", [order.id]);
    await db.execOn(conn,
      "INSERT INTO messages (user_id, type, title, content, room_id, is_read) VALUES (?,?,?,?,?,0)",
      [order.userId, "order", "预约已被取消",
        "您的预约 " + order.id + "（" + order.roomName + " " + order.seatNo + " " + order.date + " " +
        order.startSlot + "-" + order.endSlot + "）已被管理员取消" + (note ? "，原因：" + note : "") + "。",
        order.roomId]
    );
  });
  return getOrderById(order.id);
}

/* ============================ 场地管理 ============================ */

const ROOM_SELECT =
  "SELECT r.id, r.name, r.campus, r.building, r.floor, r.capacity, " +
  "r.seat_prefix AS seatPrefix, r.open_from AS openFrom, r.open_to AS openTo, " +
  "r.status, r.tags, r.cover, r.cover_card AS coverCard, r.description AS `desc`, r.notice, r.sort_no AS sortNo, " +
  "(SELECT COUNT(*) FROM orders o WHERE o.room_id = r.id) AS orderCount, " +
  "(SELECT COUNT(*) FROM orders o WHERE o.room_id = r.id AND o.status = 'pending' " +
  " AND o.reserve_date >= CURDATE()) AS activeOrderCount " +
  "FROM rooms r ";

function adminRoomView(row) {
  const v = d.mapRoom(row);
  v.sortNo = row.sortNo || 0;
  v.orderCount = Number(row.orderCount || 0);
  v.activeOrderCount = Number(row.activeOrderCount || 0);
  return v;
}

async function listRooms() {
  const rows = await db.query(ROOM_SELECT + "ORDER BY r.sort_no, r.id");
  return { list: rows.map(adminRoomView), total: rows.length };
}

/** 校验并规范化场地表单 */
function validateRoom(b) {
  const src = b || {};
  const name = String(src.name || "").trim();
  if (!name) d.fail(400, "请填写自习室名称");
  if (name.length > 32) d.fail(400, "自习室名称过长（最多 32 字）");

  const campus = String(src.campus || "").trim();
  if (!campus) d.fail(400, "请填写所在校区");

  const building = String(src.building || "").trim();
  if (!building) d.fail(400, "请填写所在楼栋");

  const floor = String(src.floor || "").trim();
  if (!floor) d.fail(400, "请填写楼层（如 3层）");

  const capacity = parseInt(src.capacity, 10);
  if (!(capacity > 0 && capacity <= 500)) d.fail(400, "座位容量需为 1-500 的整数");

  const seatPrefix = String(src.seatPrefix || "").trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(seatPrefix)) d.fail(400, "座位前缀需为 1-2 位大写字母（如 A、AB）");

  const openFrom = parseInt(src.openFrom, 10);
  const openTo = parseInt(src.openTo, 10);
  if (!(openFrom >= 0 && openFrom <= 23)) d.fail(400, "开始开放时间需为 0-23 的整点");
  if (!(openTo >= 1 && openTo <= 24)) d.fail(400, "结束开放时间需为 1-24 的整点");
  if (openTo - openFrom < 2) d.fail(400, "开放时长至少 2 小时");

  const status = ROOM_STATUS.indexOf(src.status) >= 0 ? src.status : "open";

  let tags = src.tags;
  if (typeof tags === "string") tags = tags.split(/[,，、\s]+/);
  if (!Array.isArray(tags)) tags = [];
  tags = tags.map(function (t) { return String(t).trim().slice(0, 16); })
    .filter(Boolean).slice(0, 6);

  const cover = String(src.cover || "/images/cover-1.jpg").trim().slice(0, 64);
  // 首页热门卡片用的 690x360 小图；留空则前端回退用 cover
  const coverCard = String(src.coverCard || "").trim().slice(0, 64);
  const desc = String(src.desc || "").trim().slice(0, 255);
  const notice = String(src.notice || "").trim().slice(0, 255);
  const sortNo = parseInt(src.sortNo, 10) || 0;
  const id = String(src.id || "").trim();

  return {
    id: id, name: name, campus: campus, building: building, floor: floor,
    capacity: capacity, seatPrefix: seatPrefix, openFrom: openFrom, openTo: openTo,
    status: status, tags: tags, cover: cover, coverCard: coverCard, desc: desc, notice: notice, sortNo: sortNo
  };
}

/** 生成新场地编号：r9 / r10 … */
async function nextRoomId() {
  const rows = await db.query("SELECT id FROM rooms");
  let max = 0;
  rows.forEach(function (r) {
    const m = /^r(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "r" + (max + 1);
}

async function createRoom(body) {
  const r = validateRoom(body);
  if (r.id && !/^[A-Za-z0-9_-]{1,16}$/.test(r.id)) {
    d.fail(400, "场地编号只能是 1-16 位字母/数字/下划线");
  }
  const id = r.id || (await nextRoomId());

  const dup = await db.query("SELECT id FROM rooms WHERE id = ?", [id]);
  if (dup.length) d.fail(400, "场地编号 " + id + " 已存在，请换一个");

  await db.exec(
    "INSERT INTO rooms (id, name, campus, building, floor, capacity, seat_prefix, open_from, open_to, " +
    "status, tags, cover, cover_card, description, notice, sort_no) VALUES (?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),?,?,?,?,?)",
    [id, r.name, r.campus, r.building, r.floor, r.capacity, r.seatPrefix, r.openFrom, r.openTo,
      r.status, JSON.stringify(r.tags), r.cover, r.coverCard, r.desc, r.notice, r.sortNo]
  );
  await d.loadCaches();
  return getRoomById(id);
}

async function updateRoom(id, body) {
  const r = validateRoom(Object.assign({}, body, { id: id }));
  const exists = await db.query("SELECT id FROM rooms WHERE id = ?", [id]);
  if (!exists.length) d.fail(404, "场地不存在：" + id);

  await db.exec(
    "UPDATE rooms SET name=?, campus=?, building=?, floor=?, capacity=?, seat_prefix=?, " +
    "open_from=?, open_to=?, status=?, tags=CAST(? AS JSON), cover=?, cover_card=?, description=?, notice=?, sort_no=? " +
    "WHERE id=?",
    [r.name, r.campus, r.building, r.floor, r.capacity, r.seatPrefix, r.openFrom, r.openTo,
      r.status, JSON.stringify(r.tags), r.cover, r.coverCard, r.desc, r.notice, r.sortNo, id]
  );
  await d.loadCaches();
  return getRoomById(id);
}

async function getRoomById(id) {
  const rows = await db.query(ROOM_SELECT + "WHERE r.id = ?", [id]);
  if (!rows.length) d.fail(404, "场地不存在：" + id);
  return adminRoomView(rows[0]);
}

async function removeRoom(id, admin) {
  requireSuper(admin, "删除场地");
  const room = await getRoomById(id);
  if (room.orderCount > 0) {
    d.fail(400, "该场地已有 " + room.orderCount + " 条预约记录，不能删除；如需暂停使用请把状态改为“维护中”");
  }
  await db.exec("DELETE FROM rooms WHERE id = ?", [id]);
  await d.loadCaches();
  return { removed: id };
}

/* ============================ 用户管理 ============================ */

const USER_ADMIN_SELECT =
  "SELECT u.student_id AS studentId, u.nickname, u.college, u.credit, " +
  "CAST(UNIX_TIMESTAMP(u.created_at) * 1000 AS UNSIGNED) AS createdAt, " +
  "CAST(UNIX_TIMESTAMP(u.wx_bound_at) * 1000 AS UNSIGNED) AS wxBoundAt, " +
  "(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.student_id) AS totalOrders, " +
  "(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.student_id AND o.status = 'pending' " +
  " AND o.reserve_date >= CURDATE()) AS activeOrders, " +
  "(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.student_id AND o.status = 'canceled') AS canceledOrders, " +
  "(SELECT COUNT(*) FROM messages m WHERE m.user_id = u.student_id AND m.is_read = 0) AS unreadMessages " +
  "FROM users u ";

function adminUserView(row) {
  return {
    studentId: row.studentId,
    nickname: row.nickname,
    college: row.college,
    credit: Number(row.credit),
    createdAt: Number(row.createdAt),
    createdText: fmtDateTime(row.createdAt),
    totalOrders: Number(row.totalOrders || 0),
    activeOrders: Number(row.activeOrders || 0),
    canceledOrders: Number(row.canceledOrders || 0),
    unreadMessages: Number(row.unreadMessages || 0),
    // 微信一键登录：未绑定时 wxBoundAt 为 NULL（CAST(NULL) → NULL）
    wxBound: !!row.wxBoundAt,
    wxBoundAt: row.wxBoundAt ? Number(row.wxBoundAt) : 0,
    wxBoundText: row.wxBoundAt ? fmtDateTime(row.wxBoundAt) : ""
  };
}

async function listUsers(q) {
  const f = q || {};
  const params = [];
  let where = "";
  if (f.keyword) {
    const k = "%" + String(f.keyword).trim() + "%";
    where = "WHERE (u.student_id LIKE ? OR u.nickname LIKE ? OR u.college LIKE ?) ";
    params.push(k, k, k);
  }
  const list = (await db.query(
    USER_ADMIN_SELECT + where + "ORDER BY u.student_id",
    params
  )).map(adminUserView);

  const page = Math.max(1, parseInt(f.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(f.pageSize, 10) || 20));
  const total = list.length;
  return {
    list: list.slice((page - 1) * pageSize, page * pageSize),
    total: total, page: page, pageSize: pageSize,
    hasMore: page * pageSize < total
  };
}

async function getUserById(studentId) {
  const rows = await db.query(USER_ADMIN_SELECT + "WHERE u.student_id = ?", [studentId]);
  if (!rows.length) d.fail(404, "用户不存在：" + studentId);
  return adminUserView(rows[0]);
}

async function createUser(body) {
  const b = body || {};
  const studentId = String(b.studentId || "").trim();
  if (!/^\d{8,12}$/.test(studentId)) d.fail(400, "学号应为 8-12 位数字");
  const password = String(b.password || "");
  if (password.length < 6) d.fail(400, "密码至少 6 位");
  const nickname = String(b.nickname || "").trim();
  if (!nickname) d.fail(400, "请填写昵称");
  if (nickname.length > 16) d.fail(400, "昵称过长（最多 16 字）");
  const college = String(b.college || "").trim().slice(0, 32);
  const credit = b.credit === undefined || b.credit === "" ? 100 : parseInt(b.credit, 10);
  if (!(credit >= 0 && credit <= 100)) d.fail(400, "信用分需为 0-100 的整数");

  const dup = await db.query("SELECT student_id FROM users WHERE student_id = ?", [studentId]);
  if (dup.length) d.fail(400, "学号 " + studentId + " 已存在");

  await db.exec(
    "INSERT INTO users (student_id, password, nickname, college, credit) VALUES (?,?,?,?,?)",
    [studentId, password, nickname, college, credit]
  );
  return getUserById(studentId);
}

async function updateUser(studentId, body) {
  const b = body || {};
  const user = await getUserById(studentId);
  const sets = [];
  const params = [];

  if (b.nickname !== undefined) {
    const nickname = String(b.nickname).trim();
    if (!nickname) d.fail(400, "昵称不能为空");
    if (nickname.length > 16) d.fail(400, "昵称过长（最多 16 字）");
    sets.push("nickname = ?");
    params.push(nickname);
  }
  if (b.college !== undefined) {
    sets.push("college = ?");
    params.push(String(b.college).trim().slice(0, 32));
  }
  if (b.credit !== undefined && b.credit !== "") {
    const credit = parseInt(b.credit, 10);
    if (!(credit >= 0 && credit <= 100)) d.fail(400, "信用分需为 0-100 的整数");
    sets.push("credit = ?");
    params.push(credit);
  }
  if (b.password !== undefined && b.password !== "") {
    const password = String(b.password);
    if (password.length < 6) d.fail(400, "密码至少 6 位");
    sets.push("password = ?");
    params.push(password);
    // 改密码后强制该用户重新登录
    await db.exec("DELETE FROM sessions WHERE user_id = ?", [studentId]);
  }
  if (!sets.length) d.fail(400, "没有需要更新的字段");

  params.push(studentId);
  await db.exec("UPDATE users SET " + sets.join(", ") + " WHERE student_id = ?", params);
  return getUserById(user.studentId);
}

async function removeUser(studentId, admin) {
  requireSuper(admin, "删除用户");
  const user = await getUserById(studentId);
  if (user.activeOrders > 0) {
    d.fail(400, "该用户还有 " + user.activeOrders + " 条进行中的预约，请先取消后再删除");
  }
  await db.exec("DELETE FROM users WHERE student_id = ?", [studentId]);
  return { removed: studentId, removedOrders: user.totalOrders };
}

/**
 * 解除某学生的微信一键登录（场馆管理员也可操作：只是断掉免密通道，不动账号与密码）
 * 与用户端自助解绑的区别：管理台是"代客撤销"，因此连同该学生的全部会话一起作废，
 * 让他下一次必须用学号密码重新登录。
 */
async function unbindWx(studentId, admin) {
  const user = await getUserById(studentId);
  if (!user.wxBound) d.fail(400, "学号 " + studentId + " 当前未绑定微信，无需解绑");
  await db.exec(
    "UPDATE users SET wx_key = NULL, wx_ticket = NULL, wx_bound_at = NULL WHERE student_id = ?",
    [studentId]
  );
  const killed = await db.exec("DELETE FROM sessions WHERE user_id = ?", [studentId]);
  return { unbound: studentId, wxBound: false, sessionsCleared: (killed && killed.affectedRows) || 0 };
}

/* ============================ 导出 ============================ */
module.exports = {
  CHECKIN_OPEN_MINUTES,
  // 会话
  login,
  logout,
  authAdmin,
  adminView,
  // 概览
  overview,
  // 预约
  queryOrders,
  exportOrders,
  getOrderById,
  adminOrderView,
  checkinByCode,
  checkinById,
  undoCheckin,
  cancelOrder,
  // 场地
  listRooms,
  createRoom,
  updateRoom,
  removeRoom,
  getRoomById,
  validateRoom,
  // 用户
  listUsers,
  createUser,
  updateUser,
  removeUser,
  getUserById,
  unbindWx,
  adminUserView,
  // 工具
  slotMs,
  fmtMs,
  fmtDateTime
};
