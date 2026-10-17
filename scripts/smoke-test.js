/**
 * scripts/smoke-test.js —— 后端接口全链路冒烟测试
 * 依次走通：登录 → 概览 → 列表/搜索/分页 → 详情座位图 → 下单 → 列表 →
 * 重复下单拦截 → 消息未读 → 标记已读 → 取消 → 删除限制 → 角标 → 微信一键登录（绑定/免密/冲突/解绑）
 * 运行前提：node server/server.js 已在 3000 端口启动
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3000/api";

let token = "";
let passed = 0;
let failed = 0;

async function call(method, path, body, useAuth = true) {
  const headers = { "Content-Type": "application/json" };
  if (useAuth && token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.log("  ✗ " + name + (extra ? "  → " + JSON.stringify(extra) : ""));
  }
}

function nextDate() {
  const d = new Date(Date.now() + 3 * 864e5);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** 每次跑都用全新的"本机微信标识"，保证未绑定分支可复现（格式同 utils/auth.js 的 randomHex） */
function randHex(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, n);
}

(async () => {
  console.log("== 慧自习后端接口冒烟测试 ==\n");

  let r = await call("GET", "/summary", null, false);
  check("GET /summary 返回聚合数据", r.json.code === 0 && r.json.data.openCount >= 5, r.json);

  r = await call("GET", "/announcements", null, false);
  check("GET /announcements 公告+轮播", r.json.code === 0 && r.json.data.list.length === 3, r.json);

  r = await call("POST", "/user/login", { studentId: "20210101", password: "wrong" }, false);
  check("错误密码被拒绝（401/400）", r.json.code !== 0, r.json);

  r = await call("POST", "/user/login", { studentId: "20210101", password: "123456" }, false);
  token = (r.json.data || {}).token || "";
  check("登录成功并获得 token", r.json.code === 0 && !!token, r.json);

  r = await call("GET", "/user/profile");
  check("profile 返回用户与统计", r.json.code === 0 && r.json.data.user.studentId === "20210101" && r.json.data.stats.rooms === 5, r.json);

  r = await call("GET", "/rooms?page=1&pageSize=6", null, false);
  const totalAll = (r.json.data || {}).total;
  check("自习室分页（6/8）", r.json.code === 0 && r.json.data.list.length === 6 && r.json.data.hasMore === true, r.json);

  r = await call("GET", "/rooms?page=2&pageSize=6", null, false);
  check("第二页返回剩余 2 条", r.json.data.list.length === 2 && r.json.data.hasMore === false, r.json);

  r = await call("GET", "/rooms?campus=" + encodeURIComponent("东校区"), null, false);
  check("校区筛选", r.json.data.total === 3, r.json);

  r = await call("GET", "/rooms?keyword=" + encodeURIComponent("明理楼"), null, false);
  check("关键词搜索", r.json.data.total === 2, r.json);

  const date = nextDate();
  r = await call("GET", "/rooms/r1?date=" + date + "&start=09:00&end=12:00");
  const seats = (r.json.data || {}).seats || [];
  // 座位图席数 = 自习室真实容量（r1 capacity=40）
  const freeSeat = seats.find((s) => s.status === "free");
  check("详情座位图席数等于容量 40", r.json.code === 0 && seats.length === 40 && !!freeSeat, r.json);

  r = await call("POST", "/orders", { roomId: "r1", date: date, startSlot: "09:00", endSlot: "12:00", seatNo: freeSeat.no });
  const newId = (r.json.data || {}).id;
  check("创建预约成功", r.json.code === 0 && !!newId && r.json.data.status === "pending", r.json);

  // P0 回归要点：同一座位被别人订走后，第二个人必须订不到（旧实现用 hash 占位，这里会同时成功）
  const tokenBackup = token;
  r = await call("POST", "/user/login", { studentId: "20210102", password: "123456" }, false);
  const token2 = (r.json.data || {}).token || "";
  token = token2;
  r = await call("POST", "/orders", { roomId: "r1", date: date, startSlot: "09:30", endSlot: "11:00", seatNo: freeSeat.no });
  check("他人重复预订同一座位时段被拦截", r.json.code !== 0 && /已被占用|刚刚被他人/.test(r.json.message || ""), r.json);
  r = await call("GET", "/rooms/r1?date=" + date + "&start=09:00&end=12:00", null, false);
  const seatView = ((r.json.data || {}).seats || []).find((s) => s.no === freeSeat.no);
  check("座位图同步显示该座位已被占用", seatView && seatView.status !== "free", seatView);
  token = tokenBackup;

  r = await call("POST", "/orders", { roomId: "r1", date: date, startSlot: "10:00", endSlot: "11:00", seatNo: (seats.filter((s) => s.status === "free" && s.no !== freeSeat.no)[0] || {}).no });
  check("本人重叠时段重复下单被拦截", r.json.code !== 0, r.json);

  r = await call("GET", "/orders?status=pending");
  check("待使用列表含新订单", r.json.code === 0 && r.json.data.list.some((o) => o.id === newId), r.json);

  r = await call("GET", "/messages/unread-count");
  const unreadAfterCreate = r.json.data.unread;
  check("下单后产生未读消息", unreadAfterCreate >= 1, r.json);

  r = await call("GET", "/messages?page=1&pageSize=10");
  check("消息分页", r.json.code === 0 && r.json.data.list.length >= 3, r.json);

  r = await call("PUT", "/messages/" + r.json.data.list[0].id + "/read");
  check("单条已读后未读数 -1", r.json.data.unread === unreadAfterCreate - 1, r.json);

  r = await call("PUT", "/orders/" + newId + "/cancel");
  check("取消预约", r.json.code === 0 && r.json.data.status === "canceled", r.json);

  r = await call("PUT", "/orders/" + newId + "/cancel");
  check("已取消订单不能再次取消", r.json.code !== 0, r.json);

  r = await call("DELETE", "/orders/" + newId);
  check("删除已取消记录", r.json.code === 0, r.json);

  r = await call("GET", "/orders?status=all");
  const pendingOld = r.json.data.list.find((o) => o.status === "pending" || o.status === "using");
  if (pendingOld) {
    r = await call("DELETE", "/orders/" + pendingOld.id);
    check("进行中订单禁止删除", r.json.code !== 0, r.json);
  }

  r = await call("PUT", "/messages/read-all");
  check("全部已读", r.json.code === 0 && r.json.data.unread === 0, r.json);

  r = await call("GET", "/user/profile", null, false);
  check("无 token 访问受保护接口返回 401", r.json.code === 401, r.json);

  r = await call("GET", "/not-exist");
  check("未知接口 404", r.json.code === 404, r.json);

  /* ================= 微信一键登录（免密） ================= */
  const wxKey = randHex(32); // 全新"本机微信标识"，未绑定分支每次都能复现

  r = await call("POST", "/user/wxlogin", { wxKey: wxKey, ticket: "" }, false);
  check("未绑定的一键登录返回 bound:false（不报错）",
    r.json.code === 0 && r.json.data && r.json.data.bound === false, r.json);

  r = await call("POST", "/user/wxbind", { wxKey: wxKey });
  const wxTicket = (r.json.data || {}).ticket || "";
  check("已登录会话可绑定微信并拿到免密票据",
    r.json.code === 0 && r.json.data.wxBound === true && /^[0-9a-f]{32}$/.test(wxTicket), r.json);

  // 第一段握手：只回身份（弹窗要显示学号/姓名/学院），不签发会话、不滚动票据
  r = await call("POST", "/user/wxlogin", { wxKey: wxKey, ticket: "" }, false);
  const who = (r.json.data || {}).user || {};
  check("第一段只回身份不给 token，且带全学号/姓名/学院",
    r.json.code === 0 && r.json.data.bound === true && r.json.data.needConfirm === true &&
    !r.json.data.token && r.json.data.ticket === "" &&
    who.studentId === "20210101" && !!who.nickname && !!who.college, r.json);

  r = await call("POST", "/user/wxlogin", { wxKey: wxKey, ticket: "", confirm: true }, false);
  const rolledTicket = (r.json.data || {}).ticket || "";
  check("确认后第二段才签发会话 token",
    r.json.code === 0 && r.json.data.bound === true && !!r.json.data.token, r.json);
  check("每次一键登录滚动下发新票据", !!rolledTicket && rolledTicket !== wxTicket,
    { old: wxTicket, next: rolledTicket });

  r = await call("POST", "/user/wxlogin", { wxKey: wxKey, ticket: rolledTicket, confirm: true }, false);
  check("直接持票据也能免密登录",
    r.json.code === 0 && r.json.data.bound === true && !!r.json.data.token, r.json);

  const tokenA = token;
  token = (r.json.data || {}).token || token;
  r = await call("GET", "/user/profile");
  check("profile 标记该账号已开启一键登录",
    r.json.code === 0 && r.json.data.user.wxBound === true && r.json.data.user.wxBoundAt > 0, r.json);
  token = tokenA;

  // 第二个学号来抢同一个微信 → 必须拒绝（一个微信只能绑一个学号）
  r = await call("POST", "/user/login", { studentId: "20210102", password: "123456" }, false);
  token = (r.json.data || {}).token || "";
  r = await call("POST", "/user/wxbind", { wxKey: wxKey });
  check("同一微信绑第二个学号被拒绝", r.json.code !== 0, r.json);
  token = tokenA;

  // 本人解绑：绑定与 profile 标记同时回到未开启
  r = await call("POST", "/user/wxunbind", {});
  check("本人解绑成功", r.json.code === 0 && r.json.data.wxBound === false, r.json);
  r = await call("POST", "/user/wxlogin", { wxKey: wxKey, ticket: "" }, false);
  check("解绑后一键登录回到未绑定", r.json.code === 0 && r.json.data.bound === false, r.json);
  r = await call("GET", "/user/profile");
  check("解绑后 profile 标记未开启", r.json.code === 0 && r.json.data.user.wxBound === false, r.json);

  console.log("\n结果：通过 " + passed + " 项，失败 " + failed + " 项");
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.error("测试脚本异常：", e.message);
  process.exitCode = 1;
});
