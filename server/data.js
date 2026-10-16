/**
 * server/data.js —— 后端业务数据层（MySQL 持久化）
 *
 * 数据全部落在 MySQL（连接配置见 server/config.js，默认 root/123456、库名 huizixi）。
 * 表结构与数据集中在唯一的一个脚本 server/database/huizixi.sql：
 *   建库 + 9 张表 + 基础数据 + 演示数据，全程幂等，由 server/db.js 每次启动时重放。
 * 详见 server/database/README.md。
 *
 * 对外仍保持原 JSON 版本相同的函数语义与 JSON 字段名，
 * 因此 server/server.js 的路由契约、小程序端 apis/ 与 utils/localdb.js 的镜像结构都不受影响。
 *
 * 启动流程：建库 → 执行 huizixi.sql → 兜底补发核销码 → 载入自习室缓存
 */
const crypto = require("crypto");
const https = require("https");
const db = require("./db");
const { WX } = require("./config");

/**
 * 座位图规模：不再写死 4×5，而是由教室的 capacity（容纳人数）决定 ——
 * 容量多少就排多少座位，列数自适应（5–8 列，尽量接近方形且保证手机上一格能点准），
 * 行数 = ceil(座位数 / 列数)。座位号位数也随总席数扩展：≤99 用 2 位（A-08），≥100 用 3 位（A-108）。
 */
const SEAT_MIN_COLS = 5;
const SEAT_MAX_COLS = 8;
const SEAT_MAX_TOTAL = 500; // 与管理台「容量 1-500」的校验上限一致

/** 该教室的座位总数 = 容量（夹在 1-500 之间，容错脏数据） */
function seatTotalOf(room) {
  const n = parseInt(room && room.capacity, 10);
  if (!(n > 0)) return SEAT_MIN_COLS * 4; // 容量缺失时退回 20 席，避免整页空掉
  return Math.min(SEAT_MAX_TOTAL, Math.max(1, n));
}

/** 列数自适应：5-8 列，取接近 √n 的整数（20 席 → 5 列，40 席 → 7 列，99 席 → 8 列） */
function seatColsOf(total) {
  const cols = Math.ceil(Math.sqrt(total || 1));
  return Math.min(SEAT_MAX_COLS, Math.max(SEAT_MIN_COLS, cols));
}

/** 座位图布局：{ total, cols, rows } */
function seatLayoutOf(room) {
  const total = seatTotalOf(room);
  const cols = seatColsOf(total);
  return { total: total, cols: cols, rows: Math.ceil(total / cols) };
}

/* ============================ 纯函数工具 ============================ */

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function toDateStr(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function todayStr() {
  return toDateStr(new Date());
}
function dayOffset(n) {
  const d = new Date();
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}
function hourOf(slot) {
  return parseInt(String(slot).split(":")[0], 10);
}
function slotsOverlap(a1, a2, b1, b2) {
  return !(hourOf(a2) <= hourOf(b1) || hourOf(a1) >= hourOf(b2));
}

/** 存储态 pending 的订单随时间推进派生为 using / done */
function deriveStatus(o) {
  if (o.status === "canceled" || o.status === "done") return o.status;
  const today = todayStr();
  if (o.date < today) return "done";
  if (o.date === today) {
    const nowH = new Date().getHours();
    if (nowH >= hourOf(o.endSlot)) return "done";
    if (nowH >= hourOf(o.startSlot)) return "using";
  }
  return "pending";
}

function publicUser(u) {
  return {
    studentId: u.studentId,
    nickname: u.nickname,
    college: u.college,
    credit: u.credit,
    avatar: "/images/avatar.png",
    // 微信一键登录状态（wx_bound_at 由 USER_SELECT 一并查出；未绑定时为 null）
    wxBound: !!u.wxBoundAt,
    wxBoundAt: u.wxBoundAt ? new Date(u.wxBoundAt).getTime() : 0
  };
}

/** 座位号：前缀 + 序号（总席数 ≤99 用两位 A-08，≥100 用三位 A-108），与管理台容量保持一致 */
function seatNoOf(room, idx) {
  const n = idx + 1;
  const s = n < 10 ? "0" + n : String(n);
  const no = seatTotalOf(room) >= 100 && n < 100 ? "0" + s : s;
  return room.seatPrefix + "-" + no;
}

/** 座位号 → 该教室座位下标（0 基）；不属于该教室或超出容量返回 -1 */
function seatIndexOf(room, seatNo) {
  const m = String(seatNo || "").trim().toUpperCase().match(/^([A-Z]{1,2})-(\d{1,3})$/);
  if (!m) return -1;
  if (m[1] !== String(room.seatPrefix || "").toUpperCase()) return -1;
  const n = parseInt(m[2], 10);
  if (!(n >= 1) || n > seatTotalOf(room)) return -1;
  return n - 1;
}

/** 座位号是否属于这间教室：前缀一致 + 序号在容量范围内（拦住乱传的座位号） */
function isValidSeatNo(room, seatNo) {
  return seatIndexOf(room, seatNo) >= 0;
}

/**
 * 该教室某天某时段被谁占了座 —— 全部来自 orders 表的真实有效订单：
 *   taken：被占用的座位号集合（派生态 pending / using，已完成与已取消不算占座）
 *   mine ：其中属于当前登录学生的座位号集合
 * 只有时段与查询窗口有重叠的订单才算占用，所以同一座位不同时段可被不同人预约。
 */
async function seatOccupancy(room, date, start, end, studentId) {
  // 只取占座判定需要的字段（订单人 user_id 用于标记「我的」；mapOrder 不透出 userId，故这里单独查）
  const rows = await db.query(
    "SELECT seat_no AS seatNo, user_id AS userId, status AS rawStatus, " +
    "DATE_FORMAT(start_slot, '%H:%i') AS startSlot, DATE_FORMAT(end_slot, '%H:%i') AS endSlot " +
    "FROM orders WHERE room_id = ? AND reserve_date = ?",
    [room.id, date]
  );
  const taken = new Set();
  const mine = new Set();
  const sid = studentId === undefined || studentId === null ? "" : String(studentId);
  rows.forEach(function (o) {
    const status = deriveStatus({
      status: o.rawStatus,
      date: date,
      startSlot: o.startSlot,
      endSlot: o.endSlot
    });
    if (["pending", "using"].indexOf(status) < 0) return;
    if (!slotsOverlap(o.startSlot, o.endSlot, start, end)) return;
    // 统一成该教室的规范座位号（历史/非规范写法也能对上座位图）
    const idx = seatIndexOf(room, o.seatNo);
    const no = idx >= 0 ? seatNoOf(room, idx) : String(o.seatNo || "").trim().toUpperCase();
    taken.add(no);
    if (sid && String(o.userId) === sid) mine.add(no);
  });
  return { taken: taken, mine: mine };
}

/**
 * 座位图：座位数 = 教室容量（列数自适应），默认全空闲，只有被真实订单占用的才是「已约」，
 * 本人占的是「我的」，整间教室维护中则全部「停用」，管理员标记「已约满」的房间也全部显示已约。
 * 新开的教室没有任何订单 → 全部空闲，不再有随机占座。
 */
function buildSeats(room, taken, mine) {
  const seats = [];
  const t = taken || new Set();
  const m = mine || new Set();
  const total = seatTotalOf(room);
  for (let i = 0; i < total; i++) {
    const no = seatNoOf(room, i);
    let status = "free";
    if (room.status === "maintenance") status = "maintenance";
    else if (m.has(no)) status = "mine";
    else if (t.has(no)) status = "reserved";
    else if (room.status === "full") status = "reserved";
    seats.push({ no: no, status: status });
  }
  return seats;
}

/** 空闲座位数 = 座位总数（=容量）− 当前时段该教室被有效订单占用的座位数 */
function freeCountOf(room, usedNow) {
  if (room.status !== "open") return 0;
  const used = (usedNow && usedNow.get(room.id)) || 0;
  return Math.max(0, seatTotalOf(room) - used);
}

/** 当前整点各教室被占用的座位数（roomId → 去重座位数）；一次查询供列表/概览/管理台共用 */
async function usedSeatsNow() {
  const hour = pad2(new Date().getHours()) + ":00";
  const rows = await db.query(
    "SELECT room_id AS roomId, COUNT(DISTINCT seat_no) AS used FROM orders " +
    "WHERE status <> 'canceled' AND reserve_date = CURDATE() " +
    "AND start_slot <= ? AND end_slot > ? GROUP BY room_id",
    [hour, hour]
  );
  const m = new Map();
  rows.forEach(function (r) {
    m.set(r.roomId, Number(r.used) || 0);
  });
  return m;
}

function openTextOf(room) {
  return pad2(room.openFrom) + ":00 - " + pad2(room.openTo) + ":00";
}

/** 业务错误：带 HTTP 状态码，由 server.js 统一转成 { code, message } */
function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  e.biz = true;
  throw e;
}

/* ============================ 只读缓存（自习室/公告/轮播） ============================ */

let roomList = [];
const roomMap = new Map();
let announcementList = [];
let bannerList = [];

function roomById(id) {
  return roomMap.get(id);
}
function getRooms() {
  return roomList;
}
function getAnnouncements() {
  return announcementList;
}
function getBanners() {
  return bannerList;
}

async function loadCaches() {
  const rows = await db.query(
    "SELECT id, name, campus, building, floor, capacity, seat_prefix AS seatPrefix, " +
    "open_from AS openFrom, open_to AS openTo, status, tags, cover, cover_card AS coverCard, " +
    "description AS `desc`, notice FROM rooms ORDER BY sort_no, id"
  );
  roomList = rows.map(mapRoom);
  roomMap.clear();
  roomList.forEach(function (r) {
    roomMap.set(r.id, r);
  });

  const anns = await db.query("SELECT content FROM announcements WHERE active = 1 ORDER BY sort_no, id");
  announcementList = anns.map(function (a) {
    return a.content;
  });

  const banners = await db.query("SELECT img, title, sub_title AS sub, target AS `to` FROM banners ORDER BY sort_no, id");
  bannerList = banners.map(function (b) {
    return { img: b.img, title: b.title, sub: b.sub, to: b.to };
  });
}

/* ============================ 行 → 契约对象映射 ============================ */

function mapRoom(r) {
  let tags = r.tags;
  if (typeof tags === "string") {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      tags = [];
    }
  }
  return {
    id: r.id,
    name: r.name,
    campus: r.campus,
    building: r.building,
    floor: r.floor,
    capacity: r.capacity,
    seatPrefix: r.seatPrefix,
    openFrom: r.openFrom,
    openTo: r.openTo,
    status: r.status,
    tags: tags || [],
    cover: r.cover,
    coverCard: r.coverCard || "",
    desc: r.desc || "",
    notice: r.notice || ""
  };
}

const ORDER_SELECT =
  "SELECT o.id, o.user_id AS userId, o.room_id AS roomId, " +
  "r.name AS roomName, r.campus AS campus, r.building AS building, r.floor AS floor, " +
  "o.seat_no AS seatNo, " +
  "DATE_FORMAT(o.reserve_date, '%Y-%m-%d') AS `date`, " +
  "DATE_FORMAT(o.start_slot, '%H:%i') AS startSlot, " +
  "DATE_FORMAT(o.end_slot, '%H:%i') AS endSlot, " +
  "o.status AS rawStatus, o.remark AS remark, " +
  "CAST(UNIX_TIMESTAMP(o.created_at) * 1000 AS UNSIGNED) AS createdAt, " +
  "o.checkin_code AS checkinCode, " +
  "o.checked_in_by AS checkedInByName, " +
  "CASE WHEN o.checked_in_at IS NULL THEN NULL " +
  "     ELSE CAST(UNIX_TIMESTAMP(o.checked_in_at) * 1000 AS UNSIGNED) END AS checkedInAt " +
  "FROM orders o LEFT JOIN rooms r ON r.id = o.room_id ";

function mapOrder(row) {
  return {
    id: row.id,
    roomId: row.roomId,
    roomName: row.roomName,
    campus: row.campus,
    building: row.building,
    floor: row.floor,
    seatNo: row.seatNo,
    date: row.date,
    startSlot: row.startSlot,
    endSlot: row.endSlot,
    hours: hourOf(row.endSlot) - hourOf(row.startSlot),
    status: deriveStatus({
      status: row.rawStatus,
      date: row.date,
      startSlot: row.startSlot,
      endSlot: row.endSlot
    }),
    rawStatus: row.rawStatus,
    createdAt: Number(row.createdAt),
    remark: row.remark || "",
    // 核销凭证（线下到场核销用）
    checkinCode: row.checkinCode || "",
    checkedIn: row.checkedInAt !== null && row.checkedInAt !== undefined,
    checkedInAt: row.checkedInAt === null || row.checkedInAt === undefined ? null : Number(row.checkedInAt),
    checkedInByName: row.checkedInByName || ""
  };
}

const MESSAGE_SELECT =
  "SELECT id, user_id AS userId, type, title, content, room_id AS roomId, is_read AS isRead, " +
  "CAST(UNIX_TIMESTAMP(created_at) * 1000 AS UNSIGNED) AS ts FROM messages ";

function mapMessage(row) {
  return {
    id: Number(row.id),
    type: row.type,
    title: row.title,
    content: row.content,
    ts: Number(row.ts),
    read: !!row.isRead,
    roomId: row.roomId || ""
  };
}

const USER_SELECT =
  "SELECT student_id AS studentId, nickname, college, credit, wx_bound_at AS wxBoundAt FROM users ";

/* ============================ 初始化 ============================ */

/**
 * 初始化：建库 + 执行 huizixi.sql（见 db.init）→ 兜底补发核销码 → 载入缓存
 * @param {object} [opts] { reset:true } 会先删库重建（仅演示重置用）
 * @returns {Promise<object>} 健康信息（各表行数 + sqlStatements 本次执行语句数 + codesFilled 补码数）
 */
async function init(opts) {
  const dbInfo = await db.init(opts);
  const codesFilled = await ensureCheckinCodes();
  await loadCaches();
  const info = await db.health();
  info.sqlStatements = (dbInfo && dbInfo.statements) || 0;
  info.addedColumns = (dbInfo && dbInfo.addedColumns) || [];
  info.codesFilled = codesFilled;
  return info;
}

/* ============================ 用户与会话 ============================ */

/** 登录：校验学号密码 → 写入 sessions 表 → 返回 token 与用户信息 */
async function login(studentId, password) {
  const rows = await db.query(USER_SELECT + "WHERE student_id = ?", [String(studentId || "").trim()]);
  const u = rows[0];
  if (!u || !(await passwordMatches(u.studentId, password))) {
    fail(400, "学号或密码不正确（演示账号：20210101 / 123456）");
  }
  const token = crypto.randomBytes(16).toString("hex");
  await db.exec("INSERT INTO sessions (token, user_id) VALUES (?,?)", [token, u.studentId]);
  return { token: token, user: publicUser(u) };
}

/**
 * 自助开户（注册）：学号即账号，唯一性由 users 主键保证；注册成功直接发 token
 * 校验：学号 8-12 位数字、密码不少于 6 位、学院必选、昵称留空时按学号后四位生成
 */
async function register(body) {
  const sid = String((body && body.studentId) || "").trim();
  const pwd = String((body && body.password) || "");
  const college = String((body && body.college) || "").trim();
  let nick = String((body && body.nickname) || "").trim();
  if (!/^\d{8,12}$/.test(sid)) fail(400, "学号应为 8-12 位数字");
  if (pwd.length < 6) fail(400, "密码至少 6 位");
  if (!college || college.length > 32) fail(400, "请选择所在学院");
  if (!nick) nick = "同学" + sid.slice(-4);
  if (nick.length > 32) nick = nick.slice(0, 32);

  const dup = await db.query("SELECT student_id FROM users WHERE student_id = ?", [sid]);
  if (dup.length) fail(400, "该学号已开户，请直接登录或找管理员重置密码");

  try {
    await db.exec(
      "INSERT INTO users (student_id, password, nickname, college, credit, created_at) " +
      "VALUES (?,?,?,?,100,NOW(3))",
      [sid, pwd, nick, college]
    );
  } catch (e) {
    // 并发下两个相同学号同时通过上面的查询时，由主键冲突兜住
    if (e && e.code === "ER_DUP_ENTRY") fail(400, "该学号已开户，请直接登录或找管理员重置密码");
    throw e;
  }
  const token = crypto.randomBytes(16).toString("hex");
  await db.exec("INSERT INTO sessions (token, user_id) VALUES (?,?)", [token, sid]);
  return {
    token: token,
    user: publicUser({ studentId: sid, nickname: nick, college: college, credit: 100 })
  };
}

async function passwordMatches(studentId, password) {
  const rows = await db.query("SELECT password FROM users WHERE student_id = ?", [studentId]);
  return !!rows[0] && rows[0].password === String(password || "");
}

/* ============================ 微信一键登录（免密） ============================ */
/**
 * 绑定关系落在 users 表三列（见 database/huizixi.sql），不再只存在于小程序 Storage：
 *   wx_key      —— "这个微信是谁"。配了 WX_APPID/WX_SECRET 且请求带 code 时是真 openid（最可信）；
 *                  否则退化为前端首次生成并持久化的随机 wxKey（课程演示路径）
 *   wx_ticket   —— 免密票据：每次一键登录成功后滚动重发，旧票立即作废，解绑即失效
 *   wx_bound_at —— 绑定时间，供个人中心与管理台展示
 * 唯一性由 uk_users_wx_key 保证：一个微信只能绑一个学号；换手机重复绑定同一学号则覆盖旧标识。
 */

const WX_KEY_RE = /^[0-9a-f]{16,64}$/;  // 前端本机标识（或真 openid 也基本落在此长度）
const WX_TICKET_RE = /^[0-9a-f]{32}$/;  // crypto.randomBytes(16).toString("hex")

/** 带状态码的业务错误（fail() 的"只造错不抛"版本，供 Promise 内 reject 用） */
function bizErr(code, message) {
  const e = new Error(message);
  e.code = code;
  e.biz = true;
  return e;
}

function newWxTicket() {
  return crypto.randomBytes(16).toString("hex");
}

/** 用微信 code 换真 openid（仅当 server/config.js 里 WX.enabled() 为真时才会被调用） */
function openidByCode(code) {
  const url =
    "https://api.weixin.qq.com/sns/jscode2session?appid=" + encodeURIComponent(WX.appId) +
    "&secret=" + encodeURIComponent(WX.appSecret) +
    "&js_code=" + encodeURIComponent(code) +
    "&grant_type=authorization_code";
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let j = null;
          try { j = JSON.parse(raw); } catch (e) { j = null; }
          if (j && j.openid) return resolve(String(j.openid));
          reject(bizErr(400, "微信登录失败：" + ((j && j.errmsg) || "未取到 openid")));
        });
        res.on("error", () => reject(bizErr(400, "微信登录失败：响应异常")));
      })
      .on("error", () => reject(bizErr(400, "无法连接微信服务器，请稍后重试")));
  });
}

/**
 * 解析"这个微信是谁"：优先真 openid（需 AppSecret），其次前端上报的 wxKey
 * @returns {Promise<{key:string, via:"openid"|"wxKey"}>}
 */
async function resolveWxIdentity(body) {
  const b = body || {};
  const code = String(b.code || "").trim();
  if (code && WX.enabled()) {
    const openid = await openidByCode(code);
    return { key: openid, via: "openid" };
  }
  const k = String(b.wxKey || "").trim().toLowerCase();
  if (!WX_KEY_RE.test(k)) fail(400, "缺少有效的微信标识，请退回登录页重试");
  return { key: k, via: "wxKey" };
}

/**
 * 一键登录：票据优先命中，微信标识兜底
 * 未绑定不报错，返回 { bound:false }，由前端引导去学号密码登录（保持 code 0，避免请求层弹 toast）
 * 两段式握手：body.confirm 非 true 时只回 { needConfirm:true, user }（不签发 token、不滚动票据），
 * 前端弹「确认登录身份」后带 confirm:true 再请求一次才真正登录 —— 共用手机上不会一点就登进别人账号
 */
async function wxLogin(body) {
  const b = body || {};
  const ticket = String(b.ticket || "").trim();
  let rows = [];

  if (WX_TICKET_RE.test(ticket)) {
    rows = await db.query(USER_SELECT + "WHERE wx_ticket = ?", [ticket]);
  }
  if (!rows.length && (b.wxKey || (WX.enabled() && b.code))) {
    const id = await resolveWxIdentity(b);
    rows = await db.query(USER_SELECT + "WHERE wx_key = ?", [id.key]);
  }
  if (!rows.length) return { bound: false, token: "", ticket: "", user: null };

  const u = rows[0];

  // 第一步（confirm 非 true）：只回身份，不签发会话、不滚动票据 —— 供弹窗确认「学号/姓名/学院」
  if (b.confirm !== true) {
    return { bound: true, needConfirm: true, token: "", ticket: "", user: publicUser(u) };
  }

  const next = newWxTicket(); // 滚动票据：本次登录成功后，上一张票立即失效
  await db.exec("UPDATE users SET wx_ticket = ? WHERE student_id = ?", [next, u.studentId]);
  const token = crypto.randomBytes(16).toString("hex");
  await db.exec("INSERT INTO sessions (token, user_id) VALUES (?,?)", [token, u.studentId]);
  return { bound: true, needConfirm: false, ticket: next, token: token, user: publicUser(u) };
}

/**
 * 绑定微信（需 Bearer 会话）：学号密码登录 / 自助开户成功后由前端自动调用
 * @param {{studentId:string}} user 当前会话用户
 * @param {object} body { wxKey, code? }
 */
async function wxBind(user, body) {
  const sid = String((user && user.studentId) || "").trim();
  if (!sid) fail(401, "请先登录");
  const id = await resolveWxIdentity(body);

  const taken = await db.query(
    "SELECT student_id AS studentId FROM users WHERE wx_key = ? AND student_id <> ?",
    [id.key, sid]
  );
  if (taken.length) {
    fail(400, "该微信已绑定学号 " + taken[0].studentId + "，请先在原设备或管理后台解绑");
  }
  const prev = await db.query("SELECT wx_key FROM users WHERE student_id = ?", [sid]);
  if (!prev.length) fail(404, "用户不存在：" + sid);

  const ticket = newWxTicket();
  try {
    await db.exec(
      "UPDATE users SET wx_key = ?, wx_ticket = ?, wx_bound_at = NOW(3) WHERE student_id = ?",
      [id.key, ticket, sid]
    );
  } catch (e) {
    // 并发下同一微信被两个学号同时抢占，由唯一键兜住（与 register 的主键冲突处理同思路）
    if (e && e.code === "ER_DUP_ENTRY") fail(400, "该微信刚刚已绑定其他学号，请重新进入登录页");
    throw e;
  }
  return {
    wxBound: true,
    ticket: ticket,
    via: id.via,
    replaced: !!prev[0].wx_key && prev[0].wx_key !== id.key, // 换微信/换设备重绑
    studentId: sid
  };
}

/** 本人解绑：只断微信免密；当前已登录会话不受影响（要立刻退出请另外走退出登录） */
async function wxUnbind(user) {
  const sid = String((user && user.studentId) || "").trim();
  if (!sid) fail(401, "请先登录");
  await db.exec(
    "UPDATE users SET wx_key = NULL, wx_ticket = NULL, wx_bound_at = NULL WHERE student_id = ?",
    [sid]
  );
  return { unbound: sid, wxBound: false };
}

/** 由 Bearer token 解析当前用户（无/失效返回 null） */
async function authUser(token) {
  if (!token) return null;
  const rows = await db.query(
    USER_SELECT + "JOIN sessions s ON s.user_id = users.student_id WHERE s.token = ?",
    [token]
  );
  return rows[0] || null;
}

/** 个人资料 + 统计 */
async function profile(user) {
  const mine = (await db.query(ORDER_SELECT + "WHERE o.user_id = ?", [user.studentId])).map(mapOrder);
  const active = mine.filter(function (o) {
    return ["pending", "using"].indexOf(o.status) >= 0;
  });
  return {
    user: publicUser(user),
    stats: {
      total: mine.filter(function (o) { return o.rawStatus !== "canceled"; }).length,
      active: active.length,
      credit: user.credit,
      rooms: roomList.filter(function (r) { return r.status === "open"; }).length
    }
  };
}

/* ============================ 首页与自习室 ============================ */

async function summary(user) {
  const openRooms = roomList.filter(function (r) { return r.status === "open"; });
  const usedNow = await usedSeatsNow();
  let free = 0;
  openRooms.forEach(function (r) { free += freeCountOf(r, usedNow); });

  let todayOrders = 0;
  if (user) {
    const mine = (await db.query(
      ORDER_SELECT + "WHERE o.user_id = ? AND o.reserve_date = ?",
      [user.studentId, todayStr()]
    )).map(mapOrder);
    todayOrders = mine.filter(function (o) { return o.status === "pending"; }).length;
  }

  return {
    openCount: openRooms.length,
    roomCount: roomList.length,
    freeSeats: free,
    todayOrders: todayOrders,
    hours: "07:00 - 23:00",
    notice: announcementList[0] || ""
  };
}

async function announcements() {
  return { list: announcementList, banners: bannerList };
}

/**
 * 自习室预约热度表：roomId → 「近 7 天 + 未来 7 天」窗口内的有效预约单数（已取消不计）。
 * 首页「热门自习室」按它排序：谁被约得多谁靠前，下单/取消后热度即时变化，
 * 过期订单滑出窗口后热度自然回落 —— 排序随真实预约行为动态变化，不再依赖人工配置。
 */
async function roomHeatMap() {
  const rows = await db.query(
    "SELECT room_id AS roomId, COUNT(*) AS cnt FROM orders " +
    "WHERE status <> 'canceled' " +
    "AND reserve_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) " +
    "GROUP BY room_id"
  );
  const m = new Map();
  rows.forEach(function (r) {
    m.set(r.roomId, Number(r.cnt) || 0);
  });
  return m;
}

/** 自习室分页列表（campus/keyword/page/pageSize/date；sort=hot 按预约热度排序并附带 hot 字段） */
async function listRooms(params) {
  const p = params || {};
  let list = roomList.slice();
  const campus = p.campus || "";
  const keyword = String(p.keyword || "").trim();

  if (campus && campus !== "全部") {
    list = list.filter(function (r) { return r.campus === campus; });
  }
  if (keyword) {
    list = list.filter(function (r) {
      return (r.name + r.building + r.campus).indexOf(keyword) >= 0;
    });
  }

  // sort=hot：按预约热度降序；热度相同的保持 sort_no 原序（roomList 已按 sort_no 排好 + V8 稳定排序）
  let heat = null;
  if (String(p.sort || "") === "hot") {
    heat = await roomHeatMap();
    list.sort(function (a, b) {
      return (heat.get(b.id) || 0) - (heat.get(a.id) || 0);
    });
  }

  const page = parseInt(p.page, 10) || 1;
  const pageSize = parseInt(p.pageSize, 10) || 6;
  const total = list.length;
  // 空闲座位按「当前时段真实占座」算：座位总数 − 此刻被有效订单占用的座位数
  const usedNow = await usedSeatsNow();
  const paged = list.slice((page - 1) * pageSize, page * pageSize).map(function (r) {
    const item = {
      id: r.id, name: r.name, campus: r.campus, building: r.building, floor: r.floor,
      capacity: r.capacity, cover: r.cover, coverCard: r.coverCard, tags: r.tags, status: r.status,
      free: freeCountOf(r, usedNow), openText: openTextOf(r)
    };
    if (heat) item.hot = heat.get(r.id) || 0; // 热度值随热门排序一并下发（数据字段，卡片上不展示）
    return item;
  });

  return { list: paged, total: total, page: page, pageSize: pageSize, hasMore: page * pageSize < total };
}

/** 详情 + 指定日期时段的座位图 */
async function roomDetail(id, query, user) {
  const room = roomById(id);
  if (!room) fail(404, "自习室不存在或已下线");

  const q = query || {};
  const date = q.date || todayStr();
  const start = q.start || pad2(Math.max(room.openFrom, 8)) + ":00";
  const end = q.end || pad2(Math.min(room.openTo, hourOf(start) + 3)) + ":00";

  // 座位图完全按真实订单生成：该教室当天、与该时段重叠的 pending/using 订单才算占座
  const occ = await seatOccupancy(room, date, start, end, user && user.studentId);
  const seats = buildSeats(room, occ.taken, occ.mine);
  const layout = seatLayoutOf(room); // 座位数=容量，列数自适应，行数由前两者算出

  return {
    room: {
      id: room.id, name: room.name, campus: room.campus, building: room.building,
      floor: room.floor, capacity: room.capacity, status: room.status,
      openFrom: room.openFrom, openTo: room.openTo, openText: openTextOf(room),
      tags: room.tags, cover: room.cover, coverCard: room.coverCard, desc: room.desc, notice: room.notice
    },
    seats: seats,
    seatRows: layout.rows,
    seatCols: layout.cols,
    query: { date: date, start: start, end: end }
  };
}

/* ============================ 预约订单 ============================ */

/** 创建预约：参数校验 → 重复时段拦截 → 座位校验 → 落库 + 消息（同一事务） */
async function createOrder(user, body) {
  const b = body || {};
  const room = roomById(b.roomId);
  if (!room) fail(404, "自习室不存在");
  if (room.status === "maintenance") fail(400, "该自习室正在维护中，暂不可预约");
  if (room.status === "full") fail(400, "该自习室已约满，暂不可预约");
  if (!b.date || !b.startSlot || !b.endSlot) fail(400, "请完善预约日期与时段");
  if (hourOf(b.endSlot) <= hourOf(b.startSlot)) fail(400, "结束时段需晚于开始时段");
  if (b.date < todayStr()) fail(400, "不能预约已过去的日期");
  if (b.date > dayOffset(6)) fail(400, "最多可预约未来 7 天的时段");
  if (!b.seatNo) fail(400, "请选择座位");

  // 同一用户同日时段重叠拦截（沿用"派生状态"语义）
  const sameDay = (await db.query(
    ORDER_SELECT + "WHERE o.user_id = ? AND o.reserve_date = ?",
    [user.studentId, b.date]
  )).map(mapOrder);
  const conflict = sameDay.filter(function (o) {
    return ["pending", "using"].indexOf(o.status) >= 0;
  }).filter(function (o) {
    return slotsOverlap(o.startSlot, o.endSlot, b.startSlot, b.endSlot);
  })[0];
  if (conflict) fail(400, "该时段您已有预约（" + conflict.id + "），请勿重复下单");

  // 座位校验：座位号必须属于该教室（并按容量归一成规范写法），且该时段没有别人的有效订单占着它
  const seatIdx = seatIndexOf(room, b.seatNo);
  if (seatIdx < 0) fail(400, "座位号不存在，请重新选择");
  const seatNo = seatNoOf(room, seatIdx);
  const occ = await seatOccupancy(room, b.date, b.startSlot, b.endSlot, user.studentId);
  if (occ.taken.has(seatNo)) fail(400, "座位 " + seatNo + " 该时段已被预约，换一个试试");

  const order = {
    id: nextOrderId(b.date),
    userId: user.studentId,
    roomId: room.id,
    seatNo: seatNo,
    date: b.date,
    startSlot: b.startSlot,
    endSlot: b.endSlot,
    remark: String(b.remark || "").slice(0, 40)
  };

  // 订单 + 消息同一事务写入；订单号/核销码唯一键冲突时重新生成
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    order.checkinCode = await uniqueCheckinCode();
    try {
      await db.tx(async function (conn) {
        await db.execOn(conn,
          "INSERT INTO orders (id, user_id, room_id, seat_no, reserve_date, start_slot, end_slot, " +
          "status, remark, checkin_code) VALUES (?,?,?,?,?,?,?,'pending',?,?)",
          [order.id, order.userId, order.roomId, order.seatNo, order.date, order.startSlot,
            order.endSlot, order.remark, order.checkinCode]
        );
        await insertMessageOn(conn, user.studentId, "order", "预约成功提醒",
          "您已预约 " + room.name + " " + order.seatNo + "（" + order.date + " " +
          order.startSlot + "-" + order.endSlot + "），核销码 " + order.checkinCode +
          "，请按时到馆签到。", room.id);
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (!e || e.code !== "ER_DUP_ENTRY") throw e;
      order.id = nextOrderId(b.date);
    }
  }
  if (lastErr) throw lastErr;

  return getOrder(user, order.id);
}

/** 订单号：HZX + yyMMdd + 4 位时间后缀（与原实现一致） */
function nextOrderId(date) {
  return "HZX" + String(date).replace(/-/g, "").slice(2) + String(Date.now()).slice(-4);
}

/** 生成全局唯一的 8 位数字核销码 */
async function uniqueCheckinCode() {
  for (let i = 0; i < 10; i++) {
    const code = String(crypto.randomInt(0, 100000000)).padStart(8, "0");
    const rows = await db.query("SELECT 1 FROM orders WHERE checkin_code = ? LIMIT 1", [code]);
    if (!rows.length) return code;
  }
  fail(500, "核销码生成失败，请稍后重试");
}

/**
 * 兜底补发核销码：huizixi.sql 里的演示订单已带固定核销码，
 * 这里只处理手工往库里插订单、或导入外部数据时漏了码的情况（已取消订单不需要凭证，保持 NULL）。
 */
async function ensureCheckinCodes() {
  const rows = await db.query(
    "SELECT id FROM orders WHERE status <> 'canceled' AND (checkin_code IS NULL OR checkin_code = '') " +
    "ORDER BY created_at"
  );
  for (const r of rows) {
    const code = await uniqueCheckinCode();
    await db.exec("UPDATE orders SET checkin_code = ? WHERE id = ?", [code, r.id]);
  }
  return rows.length;
}

/** 我的预约（status: all|pending|using|done|canceled） */
async function listOrders(user, status) {
  let list = (await db.query(
    ORDER_SELECT + "WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC",
    [user.studentId]
  )).map(mapOrder);
  if (status && status !== "all") {
    list = list.filter(function (o) { return o.status === status; });
  }
  return { list: list, total: list.length };
}

async function getOrder(user, id) {
  const rows = await db.query(
    ORDER_SELECT + "WHERE o.id = ? AND o.user_id = ?",
    [String(id), user.studentId]
  );
  if (!rows.length) fail(404, "订单不存在");
  return mapOrder(rows[0]);
}

/** 取消预约：仅"待使用"可取消 */
async function cancelOrder(user, id) {
  const order = await getOrder(user, id);
  if (order.checkedIn) fail(400, "该预约已核销签到，不能取消");
  if (order.status !== "pending") fail(400, "仅“待使用”的预约可以取消");

  await db.tx(async function (conn) {
    await db.execOn(conn, "UPDATE orders SET status = 'canceled' WHERE id = ? AND user_id = ?", [order.id, user.studentId]);
    await insertMessageOn(conn, user.studentId, "order", "预约已取消", "订单 " + order.id + " 已取消，期待下次见面。", order.roomId);
  });

  return getOrder(user, order.id);
}

/** 删除记录：仅"已完成/已取消"可删 */
async function removeOrder(user, id) {
  const order = await getOrder(user, id);
  if (["done", "canceled"].indexOf(order.status) < 0) fail(400, "仅已完成或已取消的记录可删除");
  await db.exec("DELETE FROM orders WHERE id = ? AND user_id = ?", [order.id, user.studentId]);
  return { removed: order.id };
}

/* ============================ 消息中心 ============================ */

async function pushMessage(userId, type, title, content, roomId) {
  await db.exec(
    "INSERT INTO messages (user_id, type, title, content, room_id, is_read) VALUES (?,?,?,?,?,0)",
    [userId, type, title, content, roomId || ""]
  );
}

/** 事务内插入消息 */
async function insertMessageOn(conn, userId, type, title, content, roomId) {
  await db.execOn(conn,
    "INSERT INTO messages (user_id, type, title, content, room_id, is_read) VALUES (?,?,?,?,?,0)",
    [userId, type, title, content, roomId || ""]
  );
}

async function listMessages(user, page, pageSize) {
  const p = parseInt(page, 10) || 1;
  const ps = parseInt(pageSize, 10) || 10;
  const rows = await db.query(
    MESSAGE_SELECT + "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [user.studentId, ps, (p - 1) * ps]
  );
  const total = (await db.query("SELECT COUNT(*) AS n FROM messages WHERE user_id = ?", [user.studentId]))[0].n;
  const unread = await unreadCount(user);
  return {
    list: rows.map(mapMessage),
    total: Number(total),
    unread: unread,
    page: p,
    hasMore: p * ps < Number(total)
  };
}

async function unreadCount(user) {
  const rows = await db.query(
    "SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND is_read = 0",
    [user.studentId]
  );
  return Number(rows[0].n);
}

async function markMessageRead(user, id) {
  await db.exec("UPDATE messages SET is_read = 1 WHERE id = ? AND user_id = ?", [id, user.studentId]);
  return { unread: await unreadCount(user) };
}

async function markAllRead(user) {
  await db.exec("UPDATE messages SET is_read = 1 WHERE user_id = ? AND is_read = 0", [user.studentId]);
  return { unread: 0 };
}

/* ============================ 管理台数据 ============================ */
// 管理端只读看板已迁移到 server/admin.js（含场地/预约/用户/核销），
// 这里仅保留健康统计所需的基础查询。

module.exports = {
  // 常量
  seatTotalOf,
  seatColsOf,
  seatLayoutOf,
  // 查询片段与行映射（供 server/admin.js 复用）
  ORDER_SELECT,
  MESSAGE_SELECT,
  USER_SELECT,
  mapOrder,
  mapRoom,
  mapMessage,
  // 纯函数工具
  pad2,
  toDateStr,
  todayStr,
  dayOffset,
  hourOf,
  slotsOverlap,
  deriveStatus,
  publicUser,
  seatNoOf,
  freeCountOf,
  usedSeatsNow,
  openTextOf,
  fail,
  // 只读缓存
  roomById,
  getRooms,
  getAnnouncements,
  getBanners,
  // 生命周期
  init,
  loadCaches,
  // 仓储
  login,
  register,
  wxLogin,
  wxBind,
  wxUnbind,
  authUser,
  profile,
  summary,
  announcements,
  listRooms,
  roomDetail,
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  removeOrder,
  pushMessage,
  listMessages,
  unreadCount,
  markMessageRead,
  markAllRead
};
