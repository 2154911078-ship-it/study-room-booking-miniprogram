/**
 * utils/localdb.js —— 本地演示数据层（Node.js 后端接口的镜像实现）
 *
 * 仅当 wx.request 网络失败时由 utils/request.js 自动调用，
 * 接口路径 / 参数 / 返回结构与 server/ 后端完全一致，
 * 保证课堂演示在没有后端时也能完整走通业务流程。
 * 数据持久化到 Storage，重启小程序后预约记录仍然保留。
 */
const config = require("./config");
const fmt = require("./format");

/* ---------------- 种子数据（与 server/data.js 保持一致） ---------------- */

const USERS = [
  { studentId: "20210101", password: "123456", nickname: "林小知", college: "计算机学院", credit: 100 },
  { studentId: "20210102", password: "123456", nickname: "陈木木", college: "外国语学院", credit: 98 }
];

const ROOMS = [
  { id: "r1", name: "静远楼A · 静音自习室", campus: "东校区", building: "静远楼", floor: "3层", capacity: 40, seatPrefix: "A", openFrom: 7, openTo: 22, status: "open", tags: ["静音区", "空调", "电源插座"], cover: "/images/cover-1.jpg", coverCard: "/images/hot-jingyuan-a.jpg", desc: "全程静音管理，适合深度学习与备考冲刺，配备独立台灯与插座。", notice: "入馆请将手机调至静音，禁止语音通话。" },
  { id: "r2", name: "致远图书馆 · 综合自习区", campus: "东校区", building: "致远图书馆", floor: "2层", capacity: 80, seatPrefix: "B", openFrom: 8, openTo: 21, status: "open", tags: ["空调", "存包柜", "打印点"], cover: "/images/cover-2.jpg", coverCard: "/images/hot-zhiyuan-lib.jpg", desc: "馆内综合区，座位充足，紧邻社科书库，查资料方便。", notice: "闭馆前 30 分钟停止续位。" },
  { id: "r3", name: "明理楼B · 考研自习室", campus: "西校区", building: "明理楼", floor: "5层", capacity: 36, seatPrefix: "C", openFrom: 7, openTo: 22, status: "open", tags: ["单人桌", "台灯", "白板墙"], cover: "/images/cover-3.jpg", coverCard: "/images/hot-mingli-b.jpg", desc: "考研同学专属氛围，单人固定桌位，配备刷题白板墙。", notice: "禁止占座离座超过 60 分钟。" },
  { id: "r4", name: "学生活动中心 · 自习区", campus: "西校区", building: "第三学生活动中心", floor: "1层", capacity: 60, seatPrefix: "D", openFrom: 8, openTo: 20, status: "maintenance", tags: ["空调", "讨论区", "茶水"], cover: "/images/cover-4.jpg", coverCard: "/images/hot-student-center.jpg", desc: "开放式自习区，可小声讨论，适合小组学习与课程项目。", notice: "本周电路检修，暂停开放，预计周日恢复。" },
  { id: "r5", name: "长风楼C · 晚间自习区", campus: "南校区", building: "长风楼", floor: "2层", capacity: 50, seatPrefix: "E", openFrom: 8, openTo: 23, status: "open", tags: ["延长开放", "软座", "热饮吧"], cover: "/images/cover-5.jpg", coverCard: "/images/hot-changfeng-c.jpg", desc: "南校区延长开放区域，晚到同学的首选，配有热饮自助吧。", notice: "22:00 后请轻声交流，不影响他人。" },
  { id: "r6", name: "南区读书角 · 半开放卡座", campus: "南校区", building: "读书角", floor: "1层", capacity: 24, seatPrefix: "F", openFrom: 9, openTo: 21, status: "full", tags: ["沙发座", "轻音乐", "Wi-Fi"], cover: "/images/cover-6.jpg", coverCard: "/images/hot-south-corner.jpg", desc: "半开放卡座，氛围轻松，适合阅读与轻度复习。", notice: "座位少，建议错峰预约。" },
  { id: "r7", name: "致远图书馆 · 4F 靠窗座", campus: "东校区", building: "致远图书馆", floor: "4层", capacity: 18, seatPrefix: "G", openFrom: 8, openTo: 21, status: "full", tags: ["靠窗", "独立灯控", "静音"], cover: "/images/cover-7.jpg", coverCard: "/images/hot-zhiyuan-window.jpg", desc: "最抢手的靠窗景观位，采光好，视野开阔。", notice: "靠窗座每人每周最多预约 3 次。" },
  { id: "r8", name: "明理楼A · 共享自习室", campus: "西校区", building: "明理楼", floor: "3层", capacity: 42, seatPrefix: "H", openFrom: 7, openTo: 21, status: "open", tags: ["可拼桌", "投影", "白板"], cover: "/images/cover-8.jpg", coverCard: "/images/hot-mingli-a.jpg", desc: "支持小组学习的共享空间，可预约投影与白板讲解时段。", notice: "使用投影请提前在留言备注中说明。" }
];

const ANNOUNCEMENTS = [
  "国庆假期自习室开放时间调整为 08:00 - 20:00",
  "期末冲刺周（第17-18周）东校区自习室延长开放至 23:00",
  "请节约用电，离馆时随手关灯并带走个人物品"
];

const BANNERS = [
  { img: "/images/banner-qimoji-kaowei.jpg", title: "期末季 · 考位充足", sub: "一键预约，错峰自习", to: "rooms" },
  { img: "/images/banner-xinguan-nanqu-wanjian.jpg", title: "新馆开放 · 南区晚间自习区", sub: "最长开放至 23:00", to: "rooms" },
  { img: "/images/banner-wenming-xinyongfen.jpg", title: "文明自习 · 信用分计划", sub: "守约签到，攒学习学分", to: "profile" }
];

/**
 * 座位图规模：与 server/data.js 同构 —— 座位数 = 教室 capacity，列数自适应（5-8 列），
 * 行数 = ceil(座位数 / 列数)；座位号位数随总席数扩展（≤99 两位 A-08，≥100 三位 A-108）。
 */
const SEAT_MIN_COLS = 5;
const SEAT_MAX_COLS = 8;
const SEAT_MAX_TOTAL = 500;

/* ---------------- 工具函数 ---------------- */

/**
 * 8 位核销码：由订单号稳定派生（同一订单每次调用结果一致，离线演示可复现）
 * 用滚动哈希取 32 位值域，再用"最小标准"线性同余发生器展开成 8 位数字，
 * 避免不同订单撞码（seed*48271 不超出双精度整数范围）。
 */
function checkinCodeOf(orderId) {
  const s = String(orderId || "");
  let seed = 1;
  for (let i = 0; i < s.length; i++) seed = (seed * 33 + s.charCodeAt(i)) % 2147483647;
  if (!seed) seed = 1;
  let code = "";
  for (let i = 0; i < 8; i++) {
    seed = (seed * 48271) % 2147483647;
    code += String(seed % 10);
  }
  return code;
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function dayOffset(n) {
  const d = new Date();
  return fmt.toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

function slotHour(s) {
  return parseInt(String(s).split(":")[0], 10);
}

function slotsOverlap(a1, a2, b1, b2) {
  return !(slotHour(a2) <= slotHour(b1) || slotHour(a1) >= slotHour(b2));
}

/** 存储态 pending 的订单随时间推进派生为 using / done */
function deriveStatus(o) {
  if (o.status === "canceled" || o.status === "done") return o.status;
  const today = fmt.todayStr();
  if (o.date < today) return "done";
  if (o.date === today) {
    const nowH = new Date().getHours();
    if (nowH >= slotHour(o.endSlot)) return "done";
    if (nowH >= slotHour(o.startSlot)) return "using";
  }
  return "pending";
}

function publicUser(u, store) {
  const bind = store ? wxBindingOf(store, u.studentId) : null;
  return {
    studentId: u.studentId, nickname: u.nickname, college: u.college, credit: u.credit,
    avatar: "/images/avatar.png",
    // 与后端契约一致：微信一键登录状态（离线演示用 store.wx 这份本机映射表）
    wxBound: !!bind,
    wxBoundAt: bind ? bind.boundAt || 0 : 0
  };
}

/* ---------------- 微信一键登录（离线演示镜像实现） ---------------- */
/**
 * 后端 users 表的 wx_key / wx_ticket / wx_bound_at 三列，在离线模式下用
 * store.wx 这张表模拟：{ [wxKey]: { studentId, ticket, boundAt } }。
 * 唯一性规则与后端一致：一个 wxKey 只能绑一个学号，一个学号只保留一个 wxKey。
 */
function randHex(len) {
  const s = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < len; i++) out += s.charAt(Math.floor(Math.random() * 16));
  return out;
}

/** 按学号反查绑定（一个学号最多一条） */
function wxBindingOf(store, studentId) {
  const map = (store && store.wx) || {};
  const keys = Object.keys(map);
  const sid = String(studentId || "");
  for (let i = 0; i < keys.length; i++) {
    if (String(map[keys[i]].studentId) === sid) return { key: keys[i], ticket: map[keys[i]].ticket, boundAt: map[keys[i]].boundAt };
  }
  return null;
}

function wxKeyValid(k) {
  return /^[0-9a-f]{16,64}$/.test(String(k || "").trim().toLowerCase());
}

function wxTicketValid(t) {
  return /^[0-9a-f]{32}$/.test(String(t || "").trim().toLowerCase());
}

/** 该教室座位总数 = 容量（夹在 1-500，容错脏数据） */
function seatTotalOf(room) {
  const n = parseInt(room && room.capacity, 10);
  if (!(n > 0)) return SEAT_MIN_COLS * 4;
  return Math.min(SEAT_MAX_TOTAL, Math.max(1, n));
}

/** 列数自适应：5-8 列，取接近 √n 的整数 */
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

/** 座位号：前缀 + 序号（总席数 ≤99 两位，≥100 三位） */
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

/** 座位号是否属于这间教室（前缀一致 + 序号在范围内） */
function isValidSeatNo(room, seatNo) {
  return seatIndexOf(room, seatNo) >= 0;
}

/**
 * 座位图：座位数 = 容量，默认全空闲，只有被真实订单占用的才是「已约」，本人占的是「我的」。
 * 与 server/data.js 的 buildSeats 同构 —— 新教室没有订单就是全空闲。
 */
function buildSeats(room, taken, mine) {
  const seats = [];
  const t = taken || {};
  const m = mine || {};
  const total = seatTotalOf(room);
  for (let i = 0; i < total; i++) {
    const no = seatNoOf(room, i);
    let status = "free";
    if (room.status === "maintenance") status = "maintenance";
    else if (m[no]) status = "mine";
    else if (t[no]) status = "reserved";
    else if (room.status === "full") status = "reserved";
    seats.push({ no: no, status: status });
  }
  return seats;
}

/** 该教室某天某时段被占的座位号（离线用 store.orders 算，规则与后端一致） */
function seatOccupancy(store, room, date, start, end, uid) {
  const taken = {};
  const mine = {};
  store.orders.forEach(function (o) {
    if (o.roomId !== room.id || o.date !== date) return;
    if (["pending", "using"].indexOf(deriveStatus(o)) < 0) return;
    if (!slotsOverlap(o.startSlot, o.endSlot, start, end)) return;
    // 统一成该教室的规范座位号（历史/非规范写法也能对上座位图）
    const idx = seatIndexOf(room, o.seatNo);
    const no = idx >= 0 ? seatNoOf(room, idx) : String(o.seatNo || "").trim().toUpperCase();
    taken[no] = 1;
    if (uid && o.userId === uid) mine[no] = 1;
  });
  return { taken: taken, mine: mine };
}

/** 空闲座位数 = 座位总数（=容量）− 当前时段该教室被有效订单占用的座位数 */
function freeCountOf(room, usedNow) {
  if (room.status !== "open") return 0;
  const used = (usedNow && usedNow[room.id]) || 0;
  return Math.max(0, seatTotalOf(room) - used);
}

/** 当前整点各教室被占用的座位数（roomId → 去重座位数），与后端 usedSeatsNow 同构 */
function usedSeatsNow(store) {
  const hour = fmt.pad2(new Date().getHours()) + ":00";
  const m = {};
  const seen = {};
  store.orders.forEach(function (o) {
    if (o.status === "canceled") return;
    if (o.date !== fmt.todayStr()) return;
    if (!(o.startSlot <= hour && o.endSlot > hour)) return;
    const key = o.roomId + "|" + o.seatNo;
    if (seen[key]) return;
    seen[key] = 1;
    m[o.roomId] = (m[o.roomId] || 0) + 1;
  });
  return m;
}

function openTextOf(room) {
  return fmt.pad2(room.openFrom) + ":00 - " + fmt.pad2(room.openTo) + ":00";
}

/* ---------------- 存储 ---------------- */

function seedStore() {
  const today = fmt.todayStr();
  const base = Date.now();
  const store = {
    __v: 1,
    seq: 5,
    currentUser: USERS[0].studentId,
    tokens: {},
    wx: {},
    orders: [
      { id: "HZX" + today.replace(/-/g, "").slice(2) + "0001", userId: USERS[0].studentId, roomId: "r1", seatNo: "A-08", date: dayOffset(1), startSlot: "09:00", endSlot: "12:00", status: "pending", createdAt: base - 36e5, remark: "" },
      { id: "HZX" + today.replace(/-/g, "").slice(2) + "0002", userId: USERS[0].studentId, roomId: "r5", seatNo: "E-02", date: today, startSlot: "14:00", endSlot: "18:00", status: "pending", createdAt: base - 72e5, remark: "靠走廊过道一侧" },
      { id: "HZX" + today.replace(/-/g, "").slice(2) + "0003", userId: USERS[0].studentId, roomId: "r2", seatNo: "B-15", date: dayOffset(-2), startSlot: "09:00", endSlot: "11:00", status: "pending", createdAt: base - 4 * 864e5, remark: "" },
      { id: "HZX" + today.replace(/-/g, "").slice(2) + "0004", userId: USERS[0].studentId, roomId: "r3", seatNo: "C-05", date: dayOffset(-5), startSlot: "13:00", endSlot: "17:00", status: "canceled", createdAt: base - 6 * 864e5, remark: "" }
    ],
    messages: [
      { id: 1, type: "system", title: "欢迎加入慧自习", content: "首次使用请阅读《自习公约》，守约签到可累积信用分。", ts: base - 2 * 864e5, read: false, roomId: "" },
      { id: 2, type: "order", title: "预约成功提醒", content: "您已预约 静远楼A A-08（明天 09:00-12:00），请按时到馆签到。", ts: base - 36e5, read: true, roomId: "r1" },
      { id: 3, type: "system", title: "放假通知", content: "国庆假期自习室开放时间调整为 08:00 - 20:00，请合理安排复习计划。", ts: base - 864e5, read: false, roomId: "" },
      { id: 4, type: "credit", title: "信用分奖励", content: "本月守约签到 12 次，信用分保持 100，继续加油！", ts: base - 3 * 864e5, read: true, roomId: "" }
    ]
  };
  return store;
}

function loadStore() {
  let s = null;
  try {
    s = wx.getStorageSync(config.LOCALDB_KEY);
  } catch (e) {
    s = null;
  }
  if (!s || s.__v !== 1) {
    s = seedStore();
    saveStore(s);
  }
  // 老缓存补字段：微信一键登录映射表（等价于后端 db.js 的 ADD_COLUMNS 迁移）
  if (!s.wx) {
    s.wx = {};
    saveStore(s);
  }
  return s;
}

function saveStore(store) {
  try {
    wx.setStorageSync(config.LOCALDB_KEY, store);
  } catch (e) {
    /* 存储满等异常忽略 */
  }
}

/* ---------------- 路由实现 ---------------- */

function roomById(id) {
  return ROOMS.filter(function (r) { return r.id === id; })[0];
}

function needUser(store) {
  return store.currentUser || USERS[0].studentId;
}

function pushMessage(store, type, title, content, roomId) {
  store.messages.unshift({
    id: ++store.seq,
    type: type,
    title: title,
    content: content,
    ts: Date.now(),
    read: false,
    roomId: roomId || ""
  });
}

function orderView(store, o) {
  const room = roomById(o.roomId) || {};
  // 核销凭证：核销码由订单号稳定派生；本地演示数据均未核销（checkedInAt 缺失）
  const checkedInAt = typeof o.checkedInAt === "number" ? o.checkedInAt : null;
  const checkedIn = checkedInAt !== null;
  return {
    id: o.id,
    roomId: o.roomId,
    roomName: room.name,
    campus: room.campus,
    building: room.building,
    floor: room.floor,
    seatNo: o.seatNo,
    date: o.date,
    startSlot: o.startSlot,
    endSlot: o.endSlot,
    hours: slotHour(o.endSlot) - slotHour(o.startSlot),
    status: deriveStatus(o),
    rawStatus: o.status,
    createdAt: o.createdAt,
    remark: o.remark || "",
    checkinCode: o.checkinCode || checkinCodeOf(o.id),
    checkedIn: checkedIn,
    checkedInAt: checkedInAt,
    checkedInByName: checkedIn ? (o.checkedInByName || "") : ""
  };
}

function route(method, path, query, body, store) {
  /* --- 首页聚合 --- */
  if (method === "GET" && path === "/summary") {
    const openRooms = ROOMS.filter(function (r) { return r.status === "open"; });
    const usedNow = usedSeatsNow(store);
    let free = 0;
    openRooms.forEach(function (r) { free += freeCountOf(r, usedNow); });
    const uid = needUser(store);
    const todayOrders = store.orders.filter(function (o) {
      return o.userId === uid && deriveStatus(o) === "pending" && o.date === fmt.todayStr();
    }).length;
    return {
      openCount: openRooms.length,
      roomCount: ROOMS.length,
      freeSeats: free,
      todayOrders: todayOrders,
      hours: "07:00 - 23:00",
      notice: ANNOUNCEMENTS[0]
    };
  }

  if (method === "GET" && path === "/announcements") {
    return { list: ANNOUNCEMENTS, banners: BANNERS };
  }

  /* --- 用户 --- */
  if (method === "POST" && path === "/user/login") {
    const u = USERS.filter(function (x) { return x.studentId === String(body.studentId || "").trim(); })[0];
    if (!u || u.password !== body.password) {
      fail(400, "学号或密码不正确（演示账号：20210101 / 123456）");
    }
    const token = "L" + Date.now() + Math.floor(Math.random() * 1000);
    store.tokens[token] = u.studentId;
    store.currentUser = u.studentId;
    saveStore(store);
    return { token: token, user: publicUser(u, store) };
  }

  if (method === "POST" && path === "/user/register") {
    const sid = String(body.studentId || "").trim();
    const pwd = String(body.password || "");
    const college = String(body.college || "").trim();
    if (!/^\d{8,12}$/.test(sid)) fail(400, "学号应为 8-12 位数字");
    if (pwd.length < 6) fail(400, "密码至少 6 位");
    if (!college) fail(400, "请选择所在学院");
    if (USERS.filter(function (x) { return x.studentId === sid; }).length) {
      fail(400, "该学号已开户，请直接登录");
    }
    const raw = String(body.nickname || "").trim();
    const nick = (raw || "同学" + sid.slice(-4)).slice(0, 32);
    // 本地演示模式下的开户只加进当次运行的内存账号表，冷启动后需由后端接管
    const u = { studentId: sid, password: pwd, nickname: nick, college: college, credit: 100 };
    USERS.push(u);
    const token = "L" + Date.now() + Math.floor(Math.random() * 1000);
    store.tokens[token] = sid;
    store.currentUser = sid;
    saveStore(store);
    return { token: token, user: publicUser(u, store) };
  }

  /* --- 微信一键登录（与 server/data.js 的 wxLogin / wxBind / wxUnbind 同构） --- */
  if (method === "POST" && path === "/user/wxlogin") {
    const ticket = String(body.ticket || "").toLowerCase();
    const wxKey = String(body.wxKey || "").trim().toLowerCase();
    let bind = null;
    // 票据优先命中，其次按本机微信标识兜底（与后端同一顺序）
    if (wxTicketValid(ticket)) {
      Object.keys(store.wx).forEach(function (k) {
        if (String(store.wx[k].ticket) === ticket) bind = { key: k, studentId: store.wx[k].studentId };
      });
    }
    if (!bind && wxKeyValid(wxKey) && store.wx[wxKey]) {
      bind = { key: wxKey, studentId: store.wx[wxKey].studentId };
    }
    const u = bind && USERS.filter(function (x) { return x.studentId === String(bind.studentId); })[0];
    if (!u) return { bound: false, token: "", ticket: "", user: null };

    // 两段式握手（与后端一致）：confirm 非 true 只回身份，不签发会话、不滚动票据
    if (body.confirm !== true) {
      return { bound: true, needConfirm: true, token: "", ticket: "", user: publicUser(u, store) };
    }

    const next = randHex(32); // 滚动票据，旧票作废
    store.wx[bind.key] = { studentId: u.studentId, ticket: next, boundAt: store.wx[bind.key].boundAt || Date.now() };
    const t = "L" + Date.now() + Math.floor(Math.random() * 1000);
    store.tokens[t] = u.studentId;
    store.currentUser = u.studentId;
    saveStore(store);
    return { bound: true, needConfirm: false, ticket: next, token: t, user: publicUser(u, store) };
  }

  if (method === "POST" && path === "/user/wxbind") {
    const wxKey = String(body.wxKey || "").trim().toLowerCase();
    if (!wxKeyValid(wxKey)) fail(400, "缺少有效的微信标识，请退回登录页重试");
    const sid = needUser(store); // 离线模式下的"当前登录用户"
    const holder = store.wx[wxKey];
    if (holder && String(holder.studentId) !== String(sid)) {
      fail(400, "该微信已绑定学号 " + holder.studentId + "，请先在原设备或管理后台解绑");
    }
    const prev = wxBindingOf(store, sid);
    if (prev && prev.key !== wxKey) delete store.wx[prev.key]; // 换微信：一个学号只留一条
    const ticket = randHex(32);
    store.wx[wxKey] = { studentId: sid, ticket: ticket, boundAt: Date.now() };
    saveStore(store);
    return { wxBound: true, ticket: ticket, via: "wxKey", replaced: !!prev, studentId: sid };
  }

  if (method === "POST" && path === "/user/wxunbind") {
    const sid = needUser(store);
    const prev = wxBindingOf(store, sid);
    if (prev) delete store.wx[prev.key];
    saveStore(store);
    return { unbound: sid, wxBound: false };
  }

  if (method === "GET" && path === "/user/profile") {
    const uid = needUser(store);
    const u = USERS.filter(function (x) { return x.studentId === uid; })[0] || USERS[0];
    const mine = store.orders.filter(function (o) { return o.userId === uid; });
    const active = mine.filter(function (o) { return ["pending", "using"].indexOf(deriveStatus(o)) >= 0; });
    return {
      user: publicUser(u, store),
      stats: {
        total: mine.filter(function (o) { return o.status !== "canceled"; }).length,
        active: active.length,
        credit: u.credit,
        rooms: ROOMS.filter(function (r) { return r.status === "open"; }).length
      }
    };
  }

  /* --- 自习室 --- */
  let m = path.match(/^\/rooms$/);
  if (method === "GET" && m) {
    let list = ROOMS.slice();
    const campus = query.campus || "";
    const keyword = (query.keyword || "").trim();
    if (campus && campus !== "全部") {
      list = list.filter(function (r) { return r.campus === campus; });
    }
    if (keyword) {
      list = list.filter(function (r) {
        return (r.name + r.building + r.campus).indexOf(keyword) >= 0;
      });
    }
    // sort=hot：与 server/data.js 的 listRooms 同构 —— 按「近 7 天 + 未来 7 天」有效预约量降序，
    // 热度相同保持 ROOMS 原序（稳定排序）；离线模式下新下的单也会即时改变热门排序
    let heat = null;
    if (String(query.sort || "") === "hot") {
      heat = {};
      const lo = dayOffset(-6);
      const hi = dayOffset(7);
      store.orders.forEach(function (o) {
        if (o.status === "canceled") return;
        if (o.date >= lo && o.date <= hi) heat[o.roomId] = (heat[o.roomId] || 0) + 1;
      });
      list.sort(function (a, b) { return (heat[b.id] || 0) - (heat[a.id] || 0); });
    }
    const page = parseInt(query.page, 10) || 1;
    const pageSize = parseInt(query.pageSize, 10) || config.ROOM_PAGE_SIZE;
    const total = list.length;
    // 空闲座位按「当前时段真实占座」算，与后端同一口径（新教室没有订单就是全空闲）
    const usedNow = usedSeatsNow(store);
    const paged = list.slice((page - 1) * pageSize, page * pageSize).map(function (r) {
      const item = {
        id: r.id, name: r.name, campus: r.campus, building: r.building, floor: r.floor,
        capacity: r.capacity, cover: r.cover, coverCard: r.coverCard, tags: r.tags, status: r.status,
        free: freeCountOf(r, usedNow), openText: openTextOf(r)
      };
      if (heat) item.hot = heat[r.id] || 0;
      return item;
    });
    return { list: paged, total: total, page: page, pageSize: pageSize, hasMore: page * pageSize < total };
  }

  m = path.match(/^\/rooms\/([^/]+)$/);
  if (method === "GET" && m) {
    const room = roomById(decodeURIComponent(m[1]));
    if (!room) fail(404, "自习室不存在或已下线");
    const date = query.date || fmt.todayStr();
    const start = query.start || fmt.pad2(Math.max(room.openFrom, 8)) + ":00";
    const end = query.end || fmt.pad2(Math.min(room.openTo, slotHour(start) + 3)) + ":00";
    const uid = needUser(store);
    // 座位图按真实订单生成（在线时由后端同一套逻辑下发）；座位数=容量，列数自适应
    const occ = seatOccupancy(store, room, date, start, end, uid);
    const seats = buildSeats(room, occ.taken, occ.mine);
    const layout = seatLayoutOf(room);
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

  /* --- 预约订单 --- */
  if (method === "POST" && path === "/orders") {
    const uid = needUser(store);
    const room = roomById(body.roomId);
    if (!room) fail(404, "自习室不存在");
    if (room.status === "maintenance") fail(400, "该自习室正在维护中，暂不可预约");
    if (room.status === "full") fail(400, "该自习室已约满，暂不可预约");
    if (!body.date || !body.startSlot || !body.endSlot) fail(400, "请完善预约日期与时段");
    if (slotHour(body.endSlot) <= slotHour(body.startSlot)) fail(400, "结束时段需晚于开始时段");
    if (body.date < fmt.todayStr()) fail(400, "不能预约已过去的日期");
    if (body.date > dayOffset(6)) fail(400, "最多可预约未来 7 天的时段");
    if (!body.seatNo) fail(400, "请选择座位");
    const conflict = store.orders.filter(function (o) {
      return o.userId === uid && o.date === body.date &&
        ["pending", "using"].indexOf(deriveStatus(o)) >= 0 &&
        slotsOverlap(o.startSlot, o.endSlot, body.startSlot, body.endSlot);
    })[0];
    if (conflict) fail(400, "该时段您已有预约（" + conflict.id + "），请勿重复下单");
    // 座位校验：座位号必须属于该教室（并按容量归一成规范写法），且该时段没有别人的有效订单占着它
    const seatIdx = seatIndexOf(room, body.seatNo);
    if (seatIdx < 0) fail(400, "座位号不存在，请重新选择");
    const seatNo = seatNoOf(room, seatIdx);
    const occ = seatOccupancy(store, room, body.date, body.startSlot, body.endSlot, uid);
    if (occ.taken[seatNo]) fail(400, "座位 " + seatNo + " 该时段已被预约，换一个试试");
    const id = "HZX" + body.date.replace(/-/g, "").slice(2) + fmt.pad2(Math.floor(store.seq % 100)) + String(Date.now()).slice(-2);
    const order = {
      id: id, userId: uid, roomId: room.id, seatNo: seatNo,
      date: body.date, startSlot: body.startSlot, endSlot: body.endSlot,
      status: "pending", createdAt: Date.now(), remark: body.remark || ""
    };
    store.orders.unshift(order);
    store.seq++;
    pushMessage(store, "order", "预约成功提醒",
      "您已预约 " + room.name + " " + seatNo + "（" + body.date + " " +
      body.startSlot + "-" + body.endSlot + "），请按时到馆签到。", room.id);
    saveStore(store);
    return orderView(store, order);
  }

  if (method === "GET" && path === "/orders") {
    const uid = needUser(store);
    let list = store.orders.filter(function (o) { return o.userId === uid; });
    if (query.status && query.status !== "all") {
      list = list.filter(function (o) { return deriveStatus(o) === query.status; });
    }
    list = list.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    return { list: list.map(function (o) { return orderView(store, o); }), total: list.length };
  }

  m = path.match(/^\/orders\/([^/]+)\/cancel$/);
  if (method === "PUT" && m) {
    const uid = needUser(store);
    const o = store.orders.filter(function (x) { return x.id === decodeURIComponent(m[1]) && x.userId === uid; })[0];
    if (!o) fail(404, "订单不存在");
    if (deriveStatus(o) !== "pending") fail(400, "仅“待使用”的预约可以取消");
    o.status = "canceled";
    pushMessage(store, "order", "预约已取消", "订单 " + o.id + " 已取消，期待下次见面。", o.roomId);
    saveStore(store);
    return orderView(store, o);
  }

  m = path.match(/^\/orders\/([^/]+)$/);
  if (method === "DELETE" && m) {
    const uid = needUser(store);
    const idx = store.orders.findIndex(function (x) { return x.id === decodeURIComponent(m[1]) && x.userId === uid; });
    if (idx < 0) fail(404, "订单不存在");
    const o = store.orders[idx];
    if (["done", "canceled"].indexOf(deriveStatus(o)) < 0) fail(400, "仅已完成或已取消的记录可删除");
    store.orders.splice(idx, 1);
    saveStore(store);
    return { removed: o.id };
  }

  m = path.match(/^\/orders\/([^/]+)$/);
  if (method === "GET" && m) {
    const uid = needUser(store);
    const o = store.orders.filter(function (x) { return x.id === decodeURIComponent(m[1]) && x.userId === uid; })[0];
    if (!o) fail(404, "订单不存在");
    return orderView(store, o);
  }

  /* --- 消息 --- */
  if (method === "GET" && path === "/messages") {
    const page = parseInt(query.page, 10) || 1;
    const pageSize = parseInt(query.pageSize, 10) || config.MSG_PAGE_SIZE;
    const list = store.messages.slice((page - 1) * pageSize, page * pageSize);
    const unread = store.messages.filter(function (x) { return !x.read; }).length;
    return {
      list: list.map(function (x) {
        return { id: x.id, type: x.type, title: x.title, content: x.content, ts: x.ts, read: x.read, roomId: x.roomId, timeText: fmt.timeAgo(x.ts) };
      }),
      total: store.messages.length, unread: unread,
      page: page, hasMore: page * pageSize < store.messages.length
    };
  }

  if (method === "GET" && path === "/messages/unread-count") {
    return { unread: store.messages.filter(function (x) { return !x.read; }).length };
  }

  m = path.match(/^\/messages\/(\d+)\/read$/);
  if (method === "PUT" && m) {
    const msg = store.messages.filter(function (x) { return String(x.id) === m[1]; })[0];
    if (msg) msg.read = true;
    saveStore(store);
    return { unread: store.messages.filter(function (x) { return !x.read; }).length };
  }

  if (method === "PUT" && path === "/messages/read-all") {
    store.messages.forEach(function (x) { x.read = true; });
    saveStore(store);
    return { unread: 0 };
  }

  fail(404, "接口不存在：" + method + " " + path);
}

function parseQuery(qs) {
  const q = {};
  if (!qs) return q;
  qs.split("&").forEach(function (pair) {
    if (!pair) return;
    const kv = pair.split("=");
    q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
  });
  return q;
}

/**
 * 入口：与 server 同构的路由分发
 * @returns {Promise<any>}
 */
function handle(method, url, data) {
  const parts = String(url).split("?");
  const path = parts[0];
  const query = parseQuery(parts[1]);
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      try {
        const store = loadStore();
        resolve(route(method, path, query, data || {}, store));
      } catch (e) {
        reject(e);
      }
    }, 200);
  });
}

module.exports = {
  handle,
  USERS,
  ROOMS,
  ANNOUNCEMENTS,
  BANNERS
};
