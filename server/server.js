/**
 * server/server.js —— 慧自习 Node.js 后端（原生 http，数据存 MySQL）
 *
 * 启动：node server/server.js
 *   · 默认监听 3000 端口（环境变量 PORT 覆盖）
 *   · 数据库默认 root/123456 @ 127.0.0.1:3306，库名 huizixi（见 server/config.js）
 *   · 首次启动自动建库建表并播种演示数据（见 server/data.js）
 *   · 需要清库重播：$env:DB_RESET="1"; node server/server.js
 *
 * 供小程序通过 wx.request 调用；接口契约与小程序端 utils/localdb.js 完全同构。
 *
 * 路由一览：
 *   GET    /                            网页版服务监控台（自习室/订单/消息/会话总览）
 *   GET    /api/health                  服务与数据库健康检查
 *   GET    /api/summary                 首页聚合数据
 *   GET    /api/announcements           公告 + 轮播
 *   POST   /api/user/login              学号密码登录 → token（写入 sessions 表）
 *   POST   /api/user/register           自助开户（学号唯一，成功即返回 token）
 *   POST   /api/user/wxlogin            微信一键登录（免密：票据优先、本机微信标识兜底；未绑定返回 bound:false）
 *   POST   /api/user/wxbind             绑定微信开启一键登录（需 token，登录/开户成功后由小程序自动调用）
 *   POST   /api/user/wxunbind           本人解除微信绑定（需 token）
 *   GET    /api/user/profile            个人信息 + 统计（需 token）
 *   GET    /api/rooms                   自习室分页（campus/keyword/page/pageSize；sort=hot 按预约热度排序）
 *   GET    /api/rooms/:id               详情 + 指定日期时段座位图
 *   POST   /api/orders                  创建预约（需 token，事务写订单+消息，附 8 位核销码）
 *   GET    /api/orders                  我的预约（status=all|pending|using|done|canceled）
 *   GET    /api/orders/:id              订单详情（含核销凭证字段）
 *   PUT    /api/orders/:id/cancel       取消预约
 *   DELETE /api/orders/:id              删除记录（仅已完成/已取消）
 *   GET    /api/messages                消息分页
 *   GET    /api/messages/unread-count   未读数
 *   PUT    /api/messages/:id/read       单条已读
 *   PUT    /api/messages/read-all       全部已读
 *
 *   —— 管理端（独立 admins 表 + 独立 token，除 login 外都需管理端 Bearer token）——
 *   POST   /api/admin/login             管理员登录（admin / 123456）
 *   POST   /api/admin/logout            退出登录
 *   GET    /api/admin/me                当前管理员
 *   GET    /api/admin/overview          管理看板（统计/场地/最近预约/消息/会话）
 *   GET    /api/admin/rooms             场地列表（含预约数）
 *   POST   /api/admin/rooms             新增场地
 *   PUT    /api/admin/rooms/:id         修改场地
 *   DELETE /api/admin/rooms/:id         删除场地（超级管理员；有预约记录时拒绝）
 *   GET    /api/admin/orders            全部预约（日期/场地/状态/核销/关键词筛选 + 分页 + 统计）
 *   GET    /api/admin/orders/export     导出预约名单 .xlsx（exceljs）
 *   GET    /api/admin/orders/print      打印版预约名单（HTML，A4 横向）
 *   POST   /api/admin/checkin           按 8 位核销码核销
 *   PUT    /api/admin/orders/:id/checkin 按订单号核销
 *   DELETE /api/admin/orders/:id/checkin 撤销误核销（凭证恢复为待核销）
 *   PUT    /api/admin/orders/:id/cancel 管理员取消预约（超级管理员）
 *   GET    /api/admin/users             学生用户列表（含预约统计）
 *   POST   /api/admin/users             新增学生用户
 *   PUT    /api/admin/users/:studentId  修改学生用户（昵称/学院/信用分/重置密码）
 *   DELETE /api/admin/users/:studentId  删除学生用户（超级管理员；有进行中预约时拒绝）
 *   POST   /api/admin/users/:studentId/wx-unbind 解除该学生的微信一键登录（并踢掉其全部会话）
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const d = require("./data");
const db = require("./db");
const adm = require("./admin");
const exp = require("./export");
const prt = require("./print");
const { HTTP_PORT, DB } = require("./config");

const PORT = HTTP_PORT;
const API_PREFIX = "/api";
const RESET = process.env.DB_RESET === "1";
const IMAGES_DIR = path.join(__dirname, "..", "images"); // 静态兜底：可用 /images/文件名 直接访问素材

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

/* ---------------- HTTP 工具 ---------------- */

function sendJson(res, statusCode, body) {
  const buf = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, Object.assign({}, JSON_HEADERS, {
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  }));
  res.end(buf);
}

function ok(res, data) {
  sendJson(res, 200, { code: 0, message: "ok", data: data });
}

function bizError(res, statusCode, message) {
  sendJson(res, statusCode, { code: statusCode, message: message, data: null });
}

/** 返回 HTML（打印页） */
function sendHtml(res, statusCode, html) {
  const buf = Buffer.from(html, "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": buf.length,
    "Cache-Control": "no-store"
  });
  res.end(buf);
}

/** 返回二进制下载（Excel 导出） */
function sendAttachment(res, buf, fileName, contentType) {
  // 中文文件名：同时给出 ASCII 回退名与 RFC 5987 的 filename*
  const ascii = "reservation-list.xlsx";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
    "Content-Disposition": "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(fileName),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Disposition"
  });
  res.end(buf);
}

const STATUS_TEXT = { pending: "待使用", using: "使用中", done: "已完成", canceled: "已取消" };
const SORT_TEXT = { created_desc: "下单时间倒序", reserve_asc: "预约日期正序", reserve_desc: "预约日期倒序" };

/** 把筛选条件拼成一句中文描述（导出/打印页表头显示） */
function buildFilterText(f) {
  const parts = [];
  if (f.date) parts.push("预约日期 " + f.date);
  else if (f.dateFrom || f.dateTo) parts.push("预约日期 " + (f.dateFrom || "最早") + " ~ " + (f.dateTo || "最晚"));
  if (f.roomId) {
    const room = d.roomById(f.roomId);
    parts.push("场地 " + (room ? room.name : f.roomId));
  }
  if (f.status && f.status !== "all") parts.push("状态 " + (STATUS_TEXT[f.status] || f.status));
  if (f.checkin === "checked") parts.push("仅已核销");
  else if (f.checkin === "none") parts.push("仅未核销");
  if (f.keyword) parts.push("关键词 “" + f.keyword + "”");
  if (f.sort && f.sort !== "created_desc") parts.push("排序 " + (SORT_TEXT[f.sort] || f.sort));
  return parts.length ? parts.join(" · ") : "全部预约";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        aborted = true;
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** 解析 Bearer token → 用户（查 sessions + users 表） */
async function authUser(req) {
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return d.authUser(token);
}

/* ---------------- 业务路由 ---------------- */

async function handleApi(req, res, pathname, query) {
  try {
    const method = req.method;

    /* ----- 管理端接口（独立会话，路由集中在下方的 handleAdmin） ----- */
    if (pathname === "/admin/login" || pathname.indexOf("/admin/") === 0) {
      return await handleAdmin(req, res, pathname, query);
    }

    /* ----- 健康检查 ----- */
    if (method === "GET" && pathname === "/health") {
      const info = await db.health();
      return ok(res, {
        status: "ok",
        database: {
          engine: "MySQL",
          version: info.version,
          schema: info.database,
          host: DB.host,
          port: DB.port,
          user: DB.user,
          serverTime: info.serverTime,
          counts: {
            users: Number(info.users),
            rooms: Number(info.rooms),
            orders: Number(info.orders),
            messages: Number(info.messages),
            sessions: Number(info.sessions),
            admins: Number(info.admins),
            checkedIn: Number(info.checkedIn)
          }
        }
      });
    }

    /* ----- 公开接口 ----- */
    if (method === "GET" && pathname === "/summary") {
      return ok(res, await d.summary(await authUser(req)));
    }

    if (method === "GET" && pathname === "/announcements") {
      return ok(res, await d.announcements());
    }

    if (method === "POST" && pathname === "/user/login") {
      const body = await readBody(req);
      return ok(res, await d.login(body.studentId, body.password));
    }

    if (method === "POST" && pathname === "/user/register") {
      const body = await readBody(req);
      return ok(res, await d.register(body));
    }

    // 微信一键登录（免密）：未绑定也返回 200 + bound:false，由前端引导去密码登录
    if (method === "POST" && pathname === "/user/wxlogin") {
      const body = await readBody(req);
      return ok(res, await d.wxLogin(body));
    }

    if (method === "GET" && pathname === "/rooms") {
      return ok(res, await d.listRooms(query));
    }

    let m = pathname.match(/^\/rooms\/([^/]+)$/);
    if (method === "GET" && m) {
      return ok(res, await d.roomDetail(decodeURIComponent(m[1]), query, await authUser(req)));
    }

    /* ----- 需登录接口 ----- */
    const user = await authUser(req);
    if (!user) return bizError(res, 401, "请先登录（token 无效或已过期）");

    if (method === "GET" && pathname === "/user/profile") {
      return ok(res, await d.profile(user));
    }

    if (method === "POST" && pathname === "/user/wxbind") {
      const body = await readBody(req);
      return ok(res, await d.wxBind(user, body));
    }

    if (method === "POST" && pathname === "/user/wxunbind") {
      return ok(res, await d.wxUnbind(user));
    }

    if (method === "POST" && pathname === "/orders") {
      const body = await readBody(req);
      return ok(res, await d.createOrder(user, body));
    }

    if (method === "GET" && pathname === "/orders") {
      return ok(res, await d.listOrders(user, query.status));
    }

    m = pathname.match(/^\/orders\/([^/]+)\/cancel$/);
    if (method === "PUT" && m) {
      return ok(res, await d.cancelOrder(user, decodeURIComponent(m[1])));
    }

    m = pathname.match(/^\/orders\/([^/]+)$/);
    if (m && method === "DELETE") {
      return ok(res, await d.removeOrder(user, decodeURIComponent(m[1])));
    }

    m = pathname.match(/^\/orders\/([^/]+)$/);
    if (m && method === "GET") {
      return ok(res, await d.getOrder(user, decodeURIComponent(m[1])));
    }

    if (method === "GET" && pathname === "/messages") {
      return ok(res, await d.listMessages(user, query.page, query.pageSize));
    }

    if (method === "GET" && pathname === "/messages/unread-count") {
      return ok(res, { unread: await d.unreadCount(user) });
    }

    m = pathname.match(/^\/messages\/(\d+)\/read$/);
    if (method === "PUT" && m) {
      return ok(res, await d.markMessageRead(user, m[1]));
    }

    if (method === "PUT" && pathname === "/messages/read-all") {
      return ok(res, await d.markAllRead(user));
    }

    return bizError(res, 404, "接口不存在：" + method + " " + pathname);
  } catch (err) {
    // 业务错误（d.fail 抛出，带 statusCode）直接回给前端；其它异常交给外层 500
    if (err && err.biz) return bizError(res, err.code, err.message);
    throw err;
  }
}

/* ---------------- 管理端路由（/api/admin/*） ---------------- */

function adminToken(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

/** 布尔参数兼容 true / 1 / "1" / "true" */
function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

async function handleAdmin(req, res, pathname, query) {
  const method = req.method;
  const token = adminToken(req);

  // 登录接口本身不需要 token
  if (method === "POST" && pathname === "/admin/login") {
    const body = await readBody(req);
    return ok(res, await adm.login(body.username, body.password));
  }

  // 其余管理接口一律要求有效的管理端 token（与学生端 token 完全隔离）
  const admin = await adm.authAdmin(token);
  if (!admin) return bizError(res, 401, "管理端登录已失效，请重新登录");

  try {
    /* ----- 会话 ----- */
    if (method === "POST" && pathname === "/admin/logout") return ok(res, await adm.logout(token));
    if (method === "GET" && pathname === "/admin/me") return ok(res, { admin: adm.adminView(admin) });
    if (method === "GET" && pathname === "/admin/overview") return ok(res, await adm.overview());

    /* ----- 场地管理 ----- */
    if (pathname === "/admin/rooms") {
      if (method === "GET") return ok(res, await adm.listRooms());
      if (method === "POST") return ok(res, { room: await adm.createRoom(await readBody(req)) });
    }
    let m = pathname.match(/^\/admin\/rooms\/([^/]+)$/);
    if (m) {
      const roomId = decodeURIComponent(m[1]);
      if (method === "GET") return ok(res, { room: await adm.getRoomById(roomId) });
      if (method === "PUT") return ok(res, { room: await adm.updateRoom(roomId, await readBody(req)) });
      if (method === "DELETE") return ok(res, await adm.removeRoom(roomId, admin));
    }

    /* ----- 预约记录：查询 / 导出 Excel / 打印 ----- */
    if (method === "GET" && pathname === "/admin/orders") {
      return ok(res, await adm.queryOrders(query));
    }

    if (method === "GET" && pathname === "/admin/orders/export") {
      const result = await adm.exportOrders(query);
      const meta = { operator: admin.name || admin.username, filterText: buildFilterText(query) };
      const buf = await exp.buildBuffer(result, meta);
      return sendAttachment(res, buf, exp.buildFileName(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    if (method === "GET" && pathname === "/admin/orders/print") {
      const result = await adm.exportOrders(query);
      const meta = {
        operator: admin.name || admin.username,
        filterText: buildFilterText(query),
        nowText: adm.fmtDateTime(Date.now())
      };
      return sendHtml(res, 200, prt.render(result, meta));
    }

    /* ----- 核销 ----- */
    if (method === "POST" && pathname === "/admin/checkin") {
      const body = await readBody(req);
      return ok(res, { order: await adm.checkinByCode(body.code, admin, truthy(body.force)) });
    }
    m = pathname.match(/^\/admin\/orders\/([^/]+)\/checkin$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (method === "PUT") {
        const body = await readBody(req);
        return ok(res, { order: await adm.checkinById(id, admin, truthy(body.force)) });
      }
      if (method === "DELETE") {
        // 撤销误核销：清空核销记录，凭证恢复为「待核销」
        return ok(res, { order: await adm.undoCheckin(id, admin) });
      }
    }
    m = pathname.match(/^\/admin\/orders\/([^/]+)\/cancel$/);
    if (method === "PUT" && m) {
      const body = await readBody(req);
      return ok(res, { order: await adm.cancelOrder(decodeURIComponent(m[1]), admin, body.reason) });
    }

    /* ----- 用户管理 ----- */
    if (pathname === "/admin/users") {
      if (method === "GET") return ok(res, await adm.listUsers(query));
      if (method === "POST") return ok(res, { user: await adm.createUser(await readBody(req)) });
    }
    m = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (m) {
      const studentId = decodeURIComponent(m[1]);
      if (method === "GET") return ok(res, { user: await adm.getUserById(studentId) });
      if (method === "PUT") return ok(res, { user: await adm.updateUser(studentId, await readBody(req)) });
      if (method === "DELETE") return ok(res, await adm.removeUser(studentId, admin));
    }
    m = pathname.match(/^\/admin\/users\/([^/]+)\/wx-unbind$/);
    if (m && method === "POST") {
      return ok(res, await adm.unbindWx(decodeURIComponent(m[1]), admin));
    }

    return bizError(res, 404, "管理端接口不存在：" + method + " " + pathname);
  } catch (err) {
    if (err && err.biz) return bizError(res, err.code, err.message);
    throw err;
  }
}

/* ---------------- 静态图片（便于浏览器直接验证素材） ---------------- */

function serveImage(res, pathname) {
  const name = path.basename(pathname);
  const file = path.join(IMAGES_DIR, name);
  if (!name.endsWith(".png") || !fs.existsSync(file)) return false;
  const buf = fs.readFileSync(file);
  res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length });
  res.end(buf);
  return true;
}

function serveAdmin(res) {
  const file = path.join(__dirname, "admin.html");
  if (!fs.existsSync(file)) return false;
  const buf = fs.readFileSync(file);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
  return true;
}

/* ---------------- 服务器 ---------------- */

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(u.pathname);

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (pathname.startsWith("/images/")) {
    if (serveImage(res, pathname)) return;
    return bizError(res, 404, "图片不存在");
  }

  if (pathname === "/" || pathname === "/admin" || pathname === "/admin.html") {
    if (serveAdmin(res)) return;
    return bizError(res, 404, "admin.html 缺失");
  }

  if (!pathname.startsWith(API_PREFIX)) {
    return bizError(res, 404, "慧自习后端运行中 ✔ 打开 http://127.0.0.1:" + PORT + "/ 查看服务监控台；API 示例：GET /api/summary");
  }

  const query = {};
  u.searchParams.forEach((v, k) => (query[k] = v));

  handleApi(req, res, pathname.slice(API_PREFIX.length) || "/", query).catch((err) => {
    console.error("[server] 未捕获异常：", err);
    bizError(res, 500, err.message || "服务器内部错误");
  });
});

/* ---------------- 启动：先连库建表，再监听端口 ---------------- */

(async function start() {
  let info;
  try {
    info = await d.init({ reset: RESET });
  } catch (err) {
    console.error("==============================================");
    console.error("  启动失败：" + db.describeError(err));
    console.error("==============================================");
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log("==============================================");
    console.log("  慧自习后端已启动（Node.js + MySQL）");
    console.log("  服务监控台：http://127.0.0.1:" + PORT + "/   ← 浏览器打开");
    console.log("  API 前缀  ：http://127.0.0.1:" + PORT + "/api");
    console.log("  演示账号：20210101 / 123456（学生端）");
    console.log("  管理账号：admin / 123456（管理后台，另备 staff01 / 123456）");
    console.log("  MySQL    ：" + DB.user + "@" + DB.host + ":" + DB.port + " / " + info.database +
      "（MySQL " + info.version + "）");
    console.log("  数据表   ：users " + info.users + " · admins " + info.admins +
      " · rooms " + info.rooms + " · orders " + info.orders +
      " · messages " + info.messages + " · 已核销 " + info.checkedIn);
    console.log("  SQL 脚本 ：server/database/huizixi.sql（建表 + 数据，幂等）共执行 " +
      (info.sqlStatements || 0) + " 条语句");
    if (RESET) console.log("  注意     ：本次以 DB_RESET=1 启动，数据库已重建并重新导入演示数据");
    console.log("==============================================");
  });
})();

/* ---------------- 优雅退出（关闭连接池） ---------------- */

["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    console.log("\n[server] 收到 " + sig + "，正在关闭…");
    server.close(() => {
      db.close().then(() => process.exit(0)).catch(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000);
  });
});
