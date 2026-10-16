/**
 * scripts/admin-smoke-test.js —— 管理端全链路冒烟测试
 *
 * 覆盖三项新增能力：
 *   ① 管理员角色：独立登录会话、看板、场地增删改查、查看全部预约、用户管理、角色权限
 *   ② 预约凭证核销：8 位核销码核销、按订单号核销、重复核销拦截、核销时段校验与强制核销
 *   ③ 预约数据导出：.xlsx 真实文件（用 exceljs 回读校验）、可打印 HTML 名单
 *
 * 运行前提：node server/server.js 已启动（数据存 MySQL）
 *   node scripts/admin-smoke-test.js
 *
 * 可重复运行：核销等用例自带测试数据并在结束时自清理（撤销核销 → 取消 → 删除），零残留；
 * 若上次异常中断留下残留，开头会按备注自动清扫。
 */
const ExcelJS = require("../server/node_modules/exceljs");

const BASE = process.env.API_BASE || "http://127.0.0.1:3000/api";

let adminToken = "";
let staffToken = "";
let userToken = "";
let passed = 0;
let failed = 0;

const created = { rooms: [], users: [], orders: [] };

async function call(method, path, body, opts) {
  const o = opts || {};
  const headers = { "Content-Type": "application/json" };
  const token = o.token !== undefined ? o.token : adminToken;
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const ct = res.headers.get("content-type") || "";
  if (o.raw) {
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), contentType: ct, headers: res.headers };
  }
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json, contentType: ct };
}

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
  }
}

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = function (x) { return (x < 10 ? "0" : "") + x; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/**
 * 清理上次异常中断留下的测试订单：撤销核销 → 管理员取消 → 学生删除
 * （核销后的订单按业务规则不可取消，所以必须先撤销核销）
 */
async function sweepCleanup(remark) {
  const found = await call("GET", "/admin/orders?keyword=" + encodeURIComponent(remark) + "&pageSize=50");
  const arr = ((found.json || {}).data || {}).list || [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (o.checkedIn) await call("DELETE", "/admin/orders/" + o.id + "/checkin");
    if (o.status === "pending" || o.status === "using") {
      await call("PUT", "/admin/orders/" + o.id + "/cancel", { reason: "测试清理" });
    }
    await call("DELETE", "/orders/" + o.id, undefined, { token: userToken });
  }
  return arr.length;
}

(async function () {
  console.log("== 慧自习管理端冒烟测试 ==\n");

  /* ================= A. 管理员登录会话 ================= */
  console.log("A. 管理员登录与权限");

  let r = await call("GET", "/admin/overview", undefined, { token: "" });
  check("未登录访问管理接口返回 401", r.json.code === 401, r.json);

  r = await call("POST", "/admin/login", { username: "admin", password: "wrong" }, { token: "" });
  check("管理员密码错误被拒绝", r.json.code !== 0, r.json);

  r = await call("POST", "/admin/login", { username: "admin", password: "123456" }, { token: "" });
  adminToken = (r.json.data || {}).token || "";
  check("管理员登录成功并签发独立 token", r.json.code === 0 && !!adminToken && r.json.data.admin.role === "super", r.json);

  r = await call("GET", "/admin/me");
  check("GET /admin/me 返回当前管理员", r.json.code === 0 && r.json.data.admin.username === "admin", r.json);

  r = await call("POST", "/admin/login", { username: "staff01", password: "123456" }, { token: "" });
  staffToken = (r.json.data || {}).token || "";
  check("场馆管理员（staff）也能登录", r.json.code === 0 && r.json.data.admin.role === "staff", r.json);

  r = await call("POST", "/user/login", { studentId: "20210101", password: "123456" }, { token: "" });
  userToken = (r.json.data || {}).token || "";
  check("学生端登录获取 token（用于交叉验证）", r.json.code === 0 && !!userToken, r.json);

  r = await call("GET", "/admin/overview", undefined, { token: userToken });
  check("学生 token 不能访问管理接口", r.json.code === 401, r.json);

  /* ================= B. 管理看板 ================= */
  console.log("\nB. 管理看板");

  r = await call("GET", "/admin/overview");
  const st = (r.json.data || {}).stats || {};
  check("看板返回统计数据", r.json.code === 0 && typeof st.roomTotal === "number" && st.roomTotal >= 8, st);
  check("看板统计含核销与用户维度",
    typeof st.checkedInTotal === "number" && typeof st.notCheckedIn === "number" && st.userTotal >= 2, st);
  check("看板含场地列表与今日预约数", (r.json.data.rooms || []).length >= 8 && r.json.data.rooms[0].todayOrders !== undefined);
  check("看板返回最近预约与消息", (r.json.data.orders || []).length >= 1 && (r.json.data.messages || []).length >= 1);
  check("看板区分学生会话与管理会话", Array.isArray(r.json.data.sessions) && Array.isArray(r.json.data.adminSessions));

  /* ================= C. 场地管理 ================= */
  console.log("\nC. 自习场地管理");

  r = await call("GET", "/admin/rooms");
  check("场地列表含预约数统计", r.json.code === 0 && r.json.data.total >= 8 &&
    typeof r.json.data.list[0].orderCount === "number", r.json.data && r.json.data.total);

  const newRoomId = "rtest";
  await call("DELETE", "/admin/rooms/" + newRoomId).catch(function () {});
  r = await call("POST", "/admin/rooms", {
    id: newRoomId, name: "测试自习室（冒烟）", campus: "东校区", building: "测试楼", floor: "9层",
    capacity: 30, seatPrefix: "T", openFrom: 8, openTo: 20, status: "open",
    tags: ["测试", "空调"], cover: "/images/cover-1.jpg", desc: "冒烟测试用场地", notice: "测试", sortNo: 99
  });
  check("新增场地成功", r.json.code === 0 && r.json.data.room.id === newRoomId &&
    r.json.data.room.tags.length === 2, r.json.data || r.json);
  if (r.json.code === 0) created.rooms.push(newRoomId);

  r = await call("POST", "/admin/rooms", { name: "缺字段" });
  check("新增场地参数校验（容量/时间/前缀）生效", r.json.code === 400, r.json);

  r = await call("POST", "/admin/rooms", Object.assign({
    id: newRoomId, name: "重复编号", campus: "东校区", building: "测试楼", floor: "1层",
    capacity: 10, seatPrefix: "Z", openFrom: 8, openTo: 12, status: "open", tags: []
  }));
  check("重复场地编号被拒绝", r.json.code === 400, r.json);

  r = await call("PUT", "/admin/rooms/" + newRoomId, {
    name: "测试自习室（已改名）", campus: "西校区", building: "测试楼", floor: "9层",
    capacity: 45, seatPrefix: "T", openFrom: 7, openTo: 22, status: "maintenance",
    tags: "靠窗,静音", cover: "/images/cover-2.jpg", desc: "改过的简介", notice: "改过的须知", sortNo: 98
  });
  check("修改场地成功（含状态与标签解析）", r.json.code === 0 &&
    r.json.data.room.name === "测试自习室（已改名）" &&
    r.json.data.room.status === "maintenance" &&
    r.json.data.room.tags.join("/") === "靠窗/静音", r.json.data && r.json.data.room);

  r = await call("DELETE", "/admin/rooms/r1");
  check("存在预约记录的场地禁止删除", r.json.code === 400, r.json);

  r = await call("DELETE", "/admin/rooms/" + newRoomId, undefined, { token: staffToken });
  check("场馆管理员无权限删除场地（403）", r.json.code === 403, r.json);

  r = await call("DELETE", "/admin/rooms/" + newRoomId);
  check("超级管理员可删除无预约的场地", r.json.code === 0 && r.json.data.removed === newRoomId, r.json);
  if (r.json.code === 0) created.rooms = [];

  r = await call("POST", "/admin/rooms", { id: "r1", name: "覆盖已有编号", campus: "东校区", building: "X", floor: "1层", capacity: 10, seatPrefix: "Z", openFrom: 8, openTo: 12, status: "open", tags: [] });
  check("新增时编号冲突被拒绝", r.json.code === 400, r.json);

  /* ================= D. 预约记录查询与筛选 ================= */
  console.log("\nD. 全部预约记录查询");

  r = await call("GET", "/admin/orders?page=1&pageSize=50");
  const all = r.json.data || {};
  check("返回全部预约（跨用户）", r.json.code === 0 && all.total >= 4, all.total);
  check("列表含学生姓名/学院（JOIN users）", !!all.list[0].nickname && all.list[0].college !== undefined, all.list[0]);
  check("列表含核销码字段（8 位数字）", /^\d{8}$/.test(all.list[0].checkinCode), all.list[0] && all.list[0].checkinCode);
  check("列表返回统计摘要", all.summary && all.summary.total === all.total && typeof all.summary.hours === "number", all.summary);

  r = await call("GET", "/admin/orders?status=pending&pageSize=50");
  check("按派生状态筛选（待使用）", r.json.code === 0 &&
    r.json.data.list.every(function (o) { return o.status === "pending"; }), r.json.data && r.json.data.total);

  r = await call("GET", "/admin/orders?checkin=none&pageSize=50");
  check("按核销状态筛选（未核销）", r.json.code === 0 &&
    r.json.data.list.every(function (o) { return !o.checkedIn; }), r.json.data && r.json.data.total);

  r = await call("GET", "/admin/orders?keyword=20210101&pageSize=50");
  check("关键词搜索（学号）", r.json.code === 0 && r.json.data.total >= 1 &&
    r.json.data.list.every(function (o) { return o.userId === "20210101"; }), r.json.data && r.json.data.total);

  r = await call("GET", "/admin/orders?roomId=r1&pageSize=50");
  check("按场地筛选", r.json.code === 0 &&
    r.json.data.list.every(function (o) { return o.roomId === "r1"; }), r.json.data && r.json.data.total);

  r = await call("GET", "/admin/orders?dateFrom=" + dayOffset(-30) + "&dateTo=" + dayOffset(30) + "&pageSize=50");
  check("按日期区间筛选", r.json.code === 0 && r.json.data.total >= 1, r.json.data && r.json.data.total);

  r = await call("GET", "/admin/orders?page=1&pageSize=2");
  check("分页生效", r.json.code === 0 && r.json.data.list.length <= 2 && r.json.data.pageSize === 2, r.json.data && r.json.data.pageSize);

  /* ================= E. 核销 ================= */
  console.log("\nE. 预约核销（凭证）");

  // 核销测试自带数据（保证可重复运行）：先清理异常残留，再下一笔明天的预约
  const cleaned = await sweepCleanup("管理端核销测试") + await sweepCleanup("待管理员取消");
  if (cleaned) console.log("  - 已清理上次遗留的测试订单 " + cleaned + " 条");

  const tomorrow = dayOffset(1);
  r = await call("GET", "/rooms/r8?date=" + tomorrow + "&start=08:00&end=11:00", undefined, { token: userToken });
  const seatA = ((r.json.data || {}).seats || []).filter(function (s) { return s.status === "free"; })[0];
  check("取到可下单的空闲座位（服务端座位图）", !!seatA, (r.json.data || {}).seats && r.json.data.seats.length);

  r = await call("POST", "/orders", {
    roomId: "r8", date: tomorrow, startSlot: "08:00", endSlot: "11:00",
    seatNo: seatA ? seatA.no : "", remark: "管理端核销测试"
  }, { token: userToken });
  const target = r.json.data || {};
  check("学生下单成功且订单自带 8 位核销码",
    r.json.code === 0 && /^\d{8}$/.test(target.checkinCode), r.json);
  if (r.json.code === 0) created.orders.push(target.id);

  r = await call("POST", "/admin/checkin", { code: "99999999" });
  check("不存在的核销码返回 404", r.json.code === 404, r.json);

  r = await call("POST", "/admin/checkin", { code: "abc" });
  check("非法核销码格式返回 400", r.json.code === 400, r.json);

  r = await call("POST", "/admin/checkin", { code: target.checkinCode });
  check("未到核销时段被拦截并提示可强制核销",
    r.json.code === 400 && /尚未到核销时间/.test(r.json.message), r.json);

  r = await call("POST", "/admin/checkin", { code: target.checkinCode, force: true });
  check("强制核销（force=true）成功", r.json.code === 0 && r.json.data.order.checkedIn === true, r.json);
  check("核销回写核销时间与操作人", !!r.json.data.order.checkedInAt &&
    r.json.data.order.checkedInByName === "系统管理员", r.json.data && r.json.data.order);

  r = await call("POST", "/admin/checkin", { code: target.checkinCode });
  check("重复核销被拦截", r.json.code === 400 && /重复核销/.test(r.json.message), r.json);

  r = await call("PUT", "/admin/orders/" + target.id + "/checkin", { force: true });
  check("按订单号重复核销同样被拦截", r.json.code === 400, r.json);

  r = await call("GET", "/messages?page=1&pageSize=50", undefined, { token: userToken });
  check("用户消息中心出现“签到成功”记录",
    (r.json.data.list || []).some(function (m) { return m.title === "签到成功"; }), r.json.data && r.json.data.total);

  // 学生端凭证字段交叉验证
  r = await call("GET", "/orders/" + target.id, undefined, { token: userToken });
  check("学生端订单详情返回核销凭证字段", r.json.code === 0 &&
    r.json.data.checkinCode === target.checkinCode &&
    r.json.data.checkedIn === true &&
    typeof r.json.data.checkedInByName === "string", r.json.data);

  r = await call("PUT", "/admin/orders/" + target.id + "/cancel", { reason: "冒烟测试" });
  check("已核销的预约禁止被取消", r.json.code === 400, r.json);

  // 撤销误核销（前台误扫更正）
  r = await call("DELETE", "/admin/orders/" + target.id + "/checkin");
  check("撤销误核销成功，凭证恢复为待核销", r.json.code === 0 &&
    r.json.data.order.checkedIn === false && r.json.data.order.checkedInAt === null,
    r.json.data && r.json.data.order);

  r = await call("GET", "/messages?page=1&pageSize=50", undefined, { token: userToken });
  check("撤销后学生收到“核销已撤销”通知",
    (r.json.data.list || []).some(function (m) { return m.title === "核销已撤销"; }), r.json.data && r.json.data.total);

  r = await call("DELETE", "/admin/orders/" + target.id + "/checkin");
  check("未核销的订单不能再撤销", r.json.code === 400, r.json);

  r = await call("PUT", "/admin/orders/" + target.id + "/cancel", { reason: "测试清理" });
  check("撤销核销后可正常取消（流程恢复可用）", r.json.code === 0 &&
    r.json.data.order.status === "canceled", r.json);

  r = await call("DELETE", "/orders/" + target.id, undefined, { token: userToken });
  check("测试订单已删除（管理端冒烟零残留）", r.json.code === 0, r.json);
  created.orders = created.orders.filter(function (x) { return x !== target.id; });

  // 管理员取消（未核销的明天预约）：座位占用由服务端算法决定，动态取一个空闲座位
  r = await call("GET", "/rooms/r8?date=" + tomorrow + "&start=13:00&end=16:00", undefined, { token: userToken });
  const seats = ((r.json.data || {}).seats || []);
  const freeSeat = seats.find(function (s) { return s.status === "free"; });
  check("再次取空闲座位用于取消测试", !!freeSeat, seats.length);

  r = await call("POST", "/orders", {
    roomId: "r8", date: tomorrow, startSlot: "13:00", endSlot: "16:00",
    seatNo: freeSeat ? freeSeat.no : "", remark: "待管理员取消"
  }, { token: userToken });
  const cancelTarget = r.json.data || {};
  check("再下一单用于测试管理员取消", r.json.code === 0 && !!cancelTarget.id, r.json);

  r = await call("PUT", "/admin/orders/" + cancelTarget.id + "/cancel", { reason: "场馆临时检修" }, { token: staffToken });
  check("场馆管理员无权限取消预约（403）", r.json.code === 403, r.json);

  r = await call("PUT", "/admin/orders/" + cancelTarget.id + "/cancel", { reason: "场馆临时检修" });
  check("超级管理员取消预约成功", r.json.code === 0 && r.json.data.order.status === "canceled", r.json);

  r = await call("DELETE", "/orders/" + cancelTarget.id, undefined, { token: userToken });
  check("被取消的测试订单可由学生删除（清理）", r.json.code === 0, r.json);

  /* ================= F. 导出 Excel ================= */
  console.log("\nF. 预约名单导出 Excel / 打印");

  r = await call("GET", "/admin/orders/export?pageSize=200", undefined, { raw: true });
  const isXlsx = r.buffer && r.buffer.length > 2000 && r.buffer.slice(0, 2).toString() === "PK";
  check("导出接口返回 xlsx 二进制流（PK 头）", r.status === 200 && isXlsx && /spreadsheetml/.test(r.contentType), {
    status: r.status, size: r.buffer && r.buffer.length, ct: r.contentType
  });
  check("下载响应带中文文件名（filename*）",
    /filename\*=UTF-8''/.test(r.headers.get("content-disposition") || ""), r.headers.get("content-disposition"));

  let sheetNames = [];
  let rowCount = 0;
  let cols = [];
  let summarySheet = null;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    sheetNames = wb.worksheets.map(function (w) { return w.name; });
    const ws = wb.getWorksheet("预约名单");
    rowCount = ws ? ws.rowCount : 0;
    cols = ws ? ws.getRow(1).values.slice(1) : [];
    const ws2 = wb.getWorksheet("统计汇总");
    summarySheet = ws2 ? ws2.rowCount : 0;
  } catch (e) {
    console.log("    解析 xlsx 失败：" + e.message);
  }
  check("xlsx 可被 exceljs 正常解析（真实文件）", sheetNames.length === 2, sheetNames);
  check("包含「预约名单」与「统计汇总」两个工作表",
    sheetNames.indexOf("预约名单") >= 0 && sheetNames.indexOf("统计汇总") >= 0, sheetNames);
  check("明细表含 19 列表头且带核销码列",
    cols.length === 19 && cols[0] === "核销码" && cols.indexOf("核销状态") >= 0, cols.length);
  check("明细表有表头 + 数据行", rowCount >= 2, rowCount);
  check("统计汇总表有导出人/筛选条件等行", summarySheet >= 10, summarySheet);

  // 抽查首个数据行的关键单元格，防止"字段没带上导致导出空列"
  let sample = null;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    const ws = wb.getWorksheet("预约名单");
    sample = {
      code: ws.getRow(2).getCell(1).value,
      orderId: ws.getRow(2).getCell(2).value,
      studentId: ws.getRow(2).getCell(3).value,
      room: ws.getRow(2).getCell(6).value,
      checkin: ws.getRow(2).getCell(15).value
    };
  } catch (e) { /* 忽略 */ }
  check("导出数据行含核销码/订单号/学号/场地/核销状态（非空）",
    !!sample && /^\d{8}$/.test(String(sample.code)) && !!sample.orderId &&
    !!sample.studentId && !!sample.room && !!sample.checkin, sample);

  r = await call("GET", "/admin/orders/export?status=canceled&pageSize=200", undefined, { raw: true });
  let canceledRows = 0;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer);
    canceledRows = wb.getWorksheet("预约名单").rowCount - 1;
  } catch (e) { /* 忽略 */ }
  r = await call("GET", "/admin/orders?status=canceled&pageSize=200");
  check("按筛选条件导出（行数与筛选结果一致）",
    canceledRows === r.json.data.total, { exported: canceledRows, filtered: r.json.data.total });

  r = await call("GET", "/admin/orders/print?status=pending&pageSize=200", undefined, { raw: true });
  const html = r.buffer.toString("utf8");
  check("打印页返回 HTML", r.status === 200 && /text\/html/.test(r.contentType), r.contentType);
  check("打印页含标题/筛选条件/统计与表格",
    html.indexOf("慧自习 · 预约名单") >= 0 && html.indexOf("核销码") >= 0 &&
    html.indexOf("window.print()") >= 0 && html.indexOf("@page") >= 0, html.length);
  check("打印页含签字栏与操作管理员", html.indexOf("值班管理员签字") >= 0 && html.indexOf("操作管理员") >= 0);

  /* ================= G. 用户管理 ================= */
  console.log("\nG. 用户管理");

  r = await call("GET", "/admin/users?page=1&pageSize=50");
  check("用户列表返回预约统计", r.json.code === 0 && r.json.data.total >= 2 &&
    r.json.data.list[0].totalOrders !== undefined, r.json.data && r.json.data.total);

  const testSid = "20991231";
  await call("DELETE", "/admin/users/" + testSid).catch(function () {});
  r = await call("POST", "/admin/users", { studentId: testSid, password: "123456", nickname: "冒烟测试同学", college: "测试学院", credit: 90 });
  check("新增学生用户成功", r.json.code === 0 && r.json.data.user.studentId === testSid, r.json);
  if (r.json.code === 0) created.users.push(testSid);

  r = await call("POST", "/admin/users", { studentId: "123", password: "123456", nickname: "x" });
  check("学号格式校验生效", r.json.code === 400, r.json);

  r = await call("POST", "/admin/users", { studentId: testSid, password: "123456", nickname: "重复" });
  check("重复学号被拒绝", r.json.code === 400, r.json);

  r = await call("PUT", "/admin/users/" + testSid, { nickname: "改名同学", college: "新学院", credit: 88 });
  check("修改用户资料成功", r.json.code === 0 && r.json.data.user.nickname === "改名同学" && r.json.data.user.credit === 88, r.json.data && r.json.data.user);

  r = await call("PUT", "/admin/users/" + testSid, { credit: 999 });
  check("信用分范围校验生效", r.json.code === 400, r.json);

  r = await call("POST", "/admin/users", { studentId: testSid, password: "bad" });
  check("密码长度校验生效", r.json.code === 400, r.json);

  r = await call("DELETE", "/admin/users/" + testSid, undefined, { token: staffToken });
  check("场馆管理员无权限删除用户（403）", r.json.code === 403, r.json);

  r = await call("DELETE", "/admin/users/20210101");
  check("有进行中预约的用户禁止删除", r.json.code === 400, r.json);

  r = await call("DELETE", "/admin/users/" + testSid);
  check("删除测试用户成功", r.json.code === 0 && r.json.data.removed === testSid, r.json);
  if (r.json.code === 0) created.users = [];

  /* ================= G2. 微信一键登录与解绑 ================= */
  console.log("\nG2. 微信一键登录与解绑");

  // 独立测试账号，不依赖演示账号的会话与预约状态，跑完即删
  const wxSid = "20991232";
  const wxKey = (function () {
    let s = "";
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  })();
  await call("DELETE", "/admin/users/" + wxSid).catch(function () {});
  r = await call("POST", "/admin/users", { studentId: wxSid, password: "123456", nickname: "微信测试同学", college: "测试学院", credit: 100 });
  check("为微信用例创建独立测试账号", r.json.code === 0, r.json);

  r = await call("POST", "/user/login", { studentId: wxSid, password: "123456" }, { token: "" });
  const wxUserToken = (r.json.data || {}).token || "";
  check("测试账号登录获取会话", r.json.code === 0 && !!wxUserToken, r.json);

  r = await call("POST", "/user/wxbind", { wxKey: wxKey }, { token: wxUserToken });
  check("学生端绑定微信开启一键登录", r.json.code === 0 && r.json.data.wxBound === true &&
    /^[0-9a-f]{32}$/.test(r.json.data.ticket || ""), r.json);

  r = await call("GET", "/admin/users?keyword=" + encodeURIComponent(wxSid));
  const wxRow = (((r.json || {}).data || {}).list || [])[0] || {};
  check("用户列表带出微信绑定状态与时间", wxRow.wxBound === true && !!wxRow.wxBoundText, wxRow);

  r = await call("POST", "/admin/users/" + wxSid + "/wx-unbind", undefined, { token: staffToken });
  check("场馆管理员也可解除微信绑定", r.json.code === 0 && r.json.data.unbound === wxSid, r.json);
  check("解绑时一并作废该账号会话（下线数 ≥ 1）", !!r.json.data && (r.json.data.sessionsCleared || 0) >= 1, r.json.data);

  r = await call("POST", "/user/wxlogin", { wxKey: wxKey, ticket: "" }, { token: "" });
  check("管理台解绑后本机票据随之失效", r.json.code === 0 && r.json.data.bound === false, r.json);

  r = await call("GET", "/user/profile", undefined, { token: wxUserToken });
  check("被管理台解绑后原 token 已失效（401）", r.json.code === 401, r.json);

  r = await call("POST", "/admin/users/" + wxSid + "/wx-unbind");
  check("重复解绑给出明确业务错误", r.json.code !== 0, r.json);

  r = await call("DELETE", "/admin/users/" + wxSid);
  check("清理微信用例测试账号", r.json.code === 0, r.json);

  /* ================= H. 退出登录 ================= */
  console.log("\nH. 退出登录");

  r = await call("POST", "/admin/logout");
  check("管理员退出登录成功", r.json.code === 0, r.json);

  r = await call("GET", "/admin/me", undefined, { token: adminToken });
  check("退出后原 token 失效（401）", r.json.code === 401, r.json);

  /* ================= 收尾 ================= */
  for (const id of created.rooms) {
    await call("DELETE", "/admin/rooms/" + id).catch(function () {});
  }

  console.log("\n结果：通过 " + passed + " 项，失败 " + failed + " 项");
  if (created.orders.length) {
    console.log("提示：本次测试留下 " + created.orders.length + " 条已核销订单（" + created.orders.join(", ") +
      "），如需复原演示数据：node server/init-db.js --reset");
  }
  process.exitCode = failed ? 1 : 0;
})().catch(function (e) {
  console.error("测试脚本异常：", e);
  process.exitCode = 1;
});
