/**
 * scripts/devtools-verify.js —— 微信开发者工具真机联调验证
 * 前提：
 *   1) node server/server.js 已启动（3000）
 *   2) cli auto --project <root> --auto-port 9420 已开启自动化端口
 * 流程：连接 IDE → 逐页断言渲染数据 → 走真实 wx.request（不降级）→ 截图留证
 * 运行：node scripts/devtools-verify.js
 */
const fs = require("fs");
const path = require("path");
const automator = require(path.join(__dirname, "..", ".autotool", "node_modules", "miniprogram-automator"));

const SHOT_DIR = path.join(__dirname, "..", "screenshots");
let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.log("  ✗ " + name + (extra !== undefined ? " → " + JSON.stringify(extra) : ""));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 给自动化调用加超时：IDE 内 evaluate 若不回调，脚本必须能继续往下走而不是永久挂起。
 * 超时返回 { __timeout: label }，调用方据此跳过对应断言。
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ __timeout: label }), ms))
  ]);
}

async function until(fn, ms, label) {
  const deadline = Date.now() + (ms || 8000);
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch (e) {
      /* ignore and retry */
    }
    if (v) return v;
    if (Date.now() > deadline) {
      console.log("    (timeout waiting: " + label + ")");
      return null;
    }
    await sleep(300);
  }
}

async function shot(mini, name) {
  const file = path.join(SHOT_DIR, name + ".png");
  try {
    const r = await mini.screenshot({ path: file });
    if (typeof r === "string" && r.length > 100) {
      fs.writeFileSync(file, Buffer.from(r.replace(/^data:image\/\w+;base64,/, ""), "base64"));
    }
    if (fs.existsSync(file)) console.log("    📸 screenshots/" + name + ".png (" + Math.round(fs.statSync(file).size / 1024) + "KB)");
  } catch (e) {
    try {
      const r2 = await mini.screenshot(file);
      if (typeof r2 === "string") fs.writeFileSync(file, Buffer.from(r2, "base64"));
      console.log("    📸 screenshots/" + name + ".png (alt-api)");
    } catch (e2) {
      console.log("    (screenshot skipped: " + e2.message.slice(0, 60) + ")");
    }
  }
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.log("== 连接开发者工具自动化端口 9420 ==");
  const mini = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
  console.log("  connected ✔\n");

  const exceptions = [];
  mini.on("exception", (e) => exceptions.push((e && (e.message || e.errMsg)) || String(e)));

  /* ---------- 1. 首页（真实接口渲染） ---------- */
  console.log("== 1. 首页 ==");
  await mini.reLaunch("/pages/index/index");
  let page = await until(async () => {
    const p = await mini.currentPage();
    if (!p || p.path.indexOf("pages/index/index") < 0) return null;
    const n = await p.data("notices");
    return n && n.length === 3 ? p : null;
  }, 10000, "index notices from server");
  check("首页加载并渲染服务端公告（wx.request → Node）", !!page);
  if (page) {
    const sum = await page.data("summary");
    check("首页 summary 来自后端（roomCount=8）", sum && sum.roomCount === 8, sum);
    const hot = await page.data("hotRooms");
    check("首页热门自习室 4 间", hot && hot.length === 4);
    const offline = await page.data("offline");
    check("未触发本地降级（offline=false）", offline === false, offline);
    await shot(mini, "01-index");
  }

  /* ---------- 2. 列表 → 详情（id 传参） ---------- */
  console.log("\n== 2. 列表与详情 ==");
  await mini.switchTab("/pages/rooms/rooms");
  page = await until(async () => {
    const p = await mini.currentPage();
    const l = p && (await p.data("list"));
    return l && l.length === 6 ? p : null;
  }, 8000, "rooms list");
  check("列表页服务端分页 6 条", !!(page && (await page.data("total")) === 8));
  await shot(mini, "02-rooms");
  await mini.navigateTo("/pages/room-detail/room-detail?id=r5");
  page = await until(async () => {
    const p = await mini.currentPage();
    const r = p && (await p.data("room"));
    return r && r.id === "r5" ? p : null;
  }, 8000, "room detail r5");
  check("详情页接收 id=r5 并渲染服务端数据", !!(page && (await page.data("room")).campus === "南校区"));
  const seats = await page.data("seats");
  check("座位图席数等于容量 50（r5，服务端下发）", seats && seats.length === 50, seats && seats.length);
  const freeSeat = (seats || []).find((s) => s.status === "free");
  await page.callMethod("pickSeat", { currentTarget: { dataset: { no: freeSeat.no, status: freeSeat.status } } });
  check("点选空闲座位 " + freeSeat.no, (await page.data("selectedSeat")) === freeSeat.no);
  await shot(mini, "03-detail");

  /* ---------- 3. 登录（真实接口签发 token） ---------- */
  console.log("\n== 3. 登录 ==");
  await page.callMethod("submit"); // 未登录 → ensureLogin 跳登录页
  page = await until(async () => {
    const p = await mini.currentPage();
    return p && p.path.indexOf("pages/login/login") >= 0 ? p : null;
  }, 8000, "login page");
  check("未登录提交 → 拦截跳登录页", !!page);
  const redirect = await page.data("redirect");
  check("登录页收到 redirect 参数", !!redirect, redirect);
  await page.callMethod("fillDemo");
  await page.callMethod("onSubmit");
  const token = await until(async () => {
    const t = await mini.evaluate(() => wx.getStorageSync("hzx_token"));
    return t || null;
  }, 8000, "token via server login");
  check("登录成功：后端签发 token 已存储", !!token);
  await shot(mini, "04-login");

  /* ---------- 4. 直接经应用层 wx.request 验证下单闭环 ---------- */
  console.log("\n== 4. 前后端下单闭环（应用层真实请求） ==");
  const api = await withTimeout(mini.evaluate(
    (tkArg) =>
      new Promise((resolve) => {
        const tk = Array.isArray(tkArg) ? tkArg[0] : tkArg;
        const d = new Date(Date.now() + 4 * 864e5);
        const p = (n) => (n < 10 ? "0" : "") + n;
        const date = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
        // 每一步都兜底 resolve，绝不让 Promise 悬空（IDE 内抛错会导致脚本挂死）
        wx.request({
          url: "http://127.0.0.1:3000/api/rooms/r1?date=" + date + "&start=13:00&end=15:00",
          header: { Authorization: "Bearer " + tk },
          success: (r) => {
            const body = (r && r.data) || {};
            if (body.code !== 0 || !body.data) {
              resolve({ created: "ERR", status: "座位图接口 code=" + body.code + " " + (body.message || "") });
              return;
            }
            const seat = (body.data.seats || []).find((x) => x.status === "free");
            if (!seat) { resolve({ created: "ERR", status: "该时段无空闲座位" }); return; }
            wx.request({
              url: "http://127.0.0.1:3000/api/orders",
              method: "POST",
              header: { Authorization: "Bearer " + tk, "Content-Type": "application/json" },
              data: { roomId: "r1", date: date, startSlot: "13:00", endSlot: "15:00", seatNo: seat.no, remark: "devtools 联调单" },
              success: (r2) => {
                const b2 = (r2 && r2.data) || {};
                wx.request({
                  url: "http://127.0.0.1:3000/api/messages/unread-count",
                  header: { Authorization: "Bearer " + tk },
                  success: (r3) => {
                    const b3 = (r3 && r3.data) || {};
                    resolve({
                      created: b2.code === 0 && b2.data ? b2.data.id : "ERR",
                      status: b2.code === 0 && b2.data ? b2.data.status : (b2.message || "下单失败"),
                      unread: b3.code === 0 && b3.data ? b3.data.unread : -1
                    });
                  },
                  fail: (e3) => resolve({ created: b2.code === 0 && b2.data ? b2.data.id : "ERR", status: b2.message || "", unread: -1, err3: e3 && e3.errMsg })
                });
              },
              fail: (e2) => resolve({ created: "ERR", status: "下单请求失败 " + ((e2 && e2.errMsg) || "") })
            });
          },
          fail: (e1) => resolve({ created: "NETFAIL", status: "座位图请求失败 " + ((e1 && e1.errMsg) || "") })
        });
      }),
    [token]
  ), 25000, "下单闭环 evaluate");

  if (api && api.__timeout) {
    console.log("    (evaluate 25 秒未回调，跳过该组断言：多为 IDE 未勾选「不校验合法域名」或 request 被拦)");
  }
  const createdId = api && !api.__timeout && api.created !== "ERR" && api.created !== "NETFAIL" ? api.created : null;
  check("POST /orders 服务端创建成功", !!createdId, api);
  check("新订单状态=待使用(pending)", api && !api.__timeout && api.status === "pending", api && api.status);
  check("下单后未读消息角标同步（unread≥2）", api && !api.__timeout && api.unread >= 2, api && api.unread);

  /* ---------- 5. 预约列表 / 消息 / 我的 ---------- */
  console.log("\n== 5. 其余页面 ==");
  await mini.reLaunch("/pages/index/index"); // 先回 tab，保证后续 switchTab 合法
  await sleep(500);
  await mini.switchTab("/pages/orders/orders");
  page = await until(async () => {
    const p = await mini.currentPage();
    const l = p && (await p.data("list"));
    return l && l.length >= 3 ? p : null;
  }, 8000, "orders list");
  check("预约列表含联调新订单", !!page && (createdId
    ? (await page.data("list")).some((o) => o.id === createdId)
    : (await page.data("list")).length >= 3), createdId || "（第 4 步未拿到订单号，退化为校验列表条数）");
  await shot(mini, "05-orders");
  await mini.navigateTo("/pages/messages/messages");
  page = await until(async () => {
    const p = await mini.currentPage();
    const l = p && (await p.data("list"));
    return l && l.length >= 3 ? p : null;
  }, 8000, "messages");
  check("消息中心加载（含预约提醒）", !!page);
  await shot(mini, "06-messages");
  await mini.switchTab("/pages/profile/profile");
  page = await until(async () => {
    const p = await mini.currentPage();
    const u = p && (await p.data("user"));
    return u && u.nickname === "林小知" ? p : null;
  }, 8000, "profile");
  check("个人中心从后端拉取资料+统计", !!page && (await page.data("stats")).rooms === 5);
  await shot(mini, "07-profile");

  /* ---------- 6. 运行时异常 ---------- */
  console.log("\n== 6. 运行时异常检查 ==");
  await sleep(800);
  check("无未捕获 JS 异常", exceptions.length === 0, exceptions.slice(0, 3));

  console.log("\n真机联调结果：通过 " + passed + " 项，失败 " + failed + " 项");
  if (failed) process.exitCode = 1;
  await mini.disconnect();
})().catch(async (e) => {
  console.error("联调脚本异常：", e && e.message ? e.message : e);
  process.exitCode = 2;
});
