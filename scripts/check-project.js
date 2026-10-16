/**
 * scripts/check-project.js —— 小程序工程静态检查 + 页面逻辑仿真测试
 *
 * 由于本机微信开发者工具 CLI 无权限启动，本脚本在 Node 中：
 *  A. 静态检查：目录规范 / app.json 页面注册 / usingComponents / 图片引用 / 无中文文件名
 *  B. 逻辑仿真：注入 wx API 模拟层（request 强制走网络失败 → 触发 localdb 降级），
 *     依序驱动 8 个页面的 onLoad/onShow/交互事件，验证完整业务闭环：
 *     登录 → 列表筛选/分页 → 详情(id 传参/时段/座位) → 下单 → 滑动取消 → 删除 → 消息已读 → 角标
 *
 * 运行：node scripts/check-project.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    fails.push(name);
    console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
  }
}

/* ============================ A. 静态检查 ============================ */

console.log("== A. 静态结构检查 ==");

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));

check("页面数 ≥ 6（首页 + 5 功能页）", appJson.pages.length >= 6, appJson.pages.length);

appJson.pages.forEach((p) => {
  const base = path.join(ROOT, p);
  const need = [".js", ".json", ".wxml"];
  const missing = need.filter((ext) => !fs.existsSync(base + ext));
  check("页面文件齐全: " + p, missing.length === 0, missing);
});

const tabPaths = appJson.tabBar.list.map((t) => t.pagePath);
tabPaths.forEach((t) => check("tabBar 页面已注册: " + t, appJson.pages.indexOf(t) >= 0));
appJson.tabBar.list.forEach((t) => {
  check(
    "tabBar 图标存在: " + t.iconPath,
    fs.existsSync(path.join(ROOT, t.iconPath)) && fs.existsSync(path.join(ROOT, t.selectedIconPath))
  );
});

function checkComponents(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const uc = (j && j.usingComponents) || {};
  Object.keys(uc).forEach((k) => {
    const cp = uc[k].replace(/^\//, "");
    const base = path.join(ROOT, cp);
    const missing = [".js", ".json", ".wxml"].filter((e) => !fs.existsSync(base + e));
    check(
      path.relative(ROOT, file) + " → 组件 " + k + " 存在",
      missing.length === 0,
      missing
    );
  });
}
fs.readdirSync(path.join(ROOT, "pages")).forEach((d) => {
  const dir = path.join(ROOT, "pages", d);
  if (fs.existsSync(dir)) checkComponents(path.join(dir, d + ".json"));
});

const imgRefs = new Set();
function walkForImages(dir) {
  fs.readdirSync(dir).forEach((f) => {
    const full = path.join(dir, f);
    if (f === "node_modules" || f === ".git") return;
    const st = fs.statSync(full);
    if (st.isDirectory()) return walkForImages(full);
    if (/\.(js|wxml|wxss|json)$/.test(f)) {
      const text = fs.readFileSync(full, "utf8");
      const re = /\/images\/([\w.-]+\.(?:png|jpe?g|webp))/g;
      let m;
      while ((m = re.exec(text))) imgRefs.add(m[1]);
    }
  });
}
walkForImages(path.join(ROOT, "pages"));
walkForImages(path.join(ROOT, "components"));
walkForImages(path.join(ROOT, "utils"));
walkForImages(path.join(ROOT, "apis"));
walkForImages(path.join(ROOT, "server"));
[...imgRefs].sort().forEach((img) => {
  check("引用图片存在: images/" + img, fs.existsSync(path.join(ROOT, "images", img)));
});

function walkNames(dir, bad) {
  fs.readdirSync(dir).forEach((f) => {
    if (/[\u4e00-\u9fa5]/.test(f)) bad.push(path.join(dir, f));
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory() && f !== "node_modules") walkNames(full, bad);
  });
}
const cnNames = [];
walkNames(ROOT, cnNames);
check("文件夹/文件名均不含中文", cnNames.length === 0, cnNames);

check("根目录无散落页面文件（分层规范）", fs.existsSync(path.join(ROOT, "pages")) && fs.existsSync(path.join(ROOT, "components")) && fs.existsSync(path.join(ROOT, "utils")) && fs.existsSync(path.join(ROOT, "apis")) && fs.existsSync(path.join(ROOT, "images")));

/* ============================ B. 仿真测试 ============================ */

console.log("\n== B. 页面逻辑仿真（wx.request → 降级 localdb） ==");

const navlog = [];
const storage = {};
let modalConfirm = true;
const toastLog = [];
const modalLog = []; // 记录 showModal 的标题与内容，用于断言弹窗文案

function wxStub() {
  return {
    getStorageSync: (k) => (k in storage ? storage[k] : ""),
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    removeStorageSync: (k) => {
      delete storage[k];
    },
    showToast: (o) => toastLog.push(o.title),
    showLoading: () => {},
    hideLoading: () => {},
    showModal: (o) => {
      modalLog.push((o.title || "") + "|" + (o.content || ""));
      o.success && o.success({ confirm: modalConfirm, cancel: !modalConfirm });
    },
    // 模拟网络失败：触发 request.js 的 localdb 降级链路
    request: (o) => {
      setTimeout(() => o.fail && o.fail({ errMsg: "mock network down" }), 5);
    },
    setTabBarBadge: (o) => navlog.push("BADGE:" + o.index + "=" + o.text),
    removeTabBarBadge: (o) => navlog.push("BADGE-REMOVE:" + o.index),
    switchTab: (o) => navlog.push("switchTab:" + o.url),
    navigateTo: (o) => navlog.push("navigateTo:" + o.url),
    navigateBack: () => navlog.push("navigateBack"),
    redirectTo: (o) => navlog.push("redirectTo:" + o.url),
    reLaunch: (o) => navlog.push("reLaunch:" + o.url),
    stopPullDownRefresh: () => navlog.push("stopPullDown"),
    pageScrollTo: () => {},
    vibrateShort: () => {},
    getSystemInfoSync: () => ({ platform: "devtools", windowWidth: 375, windowHeight: 667 })
  };
}

function setByPath(target, key, value) {
  const parts = String(key)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".");
  let o = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (o[p] === undefined || o[p] === null) o[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[p];
  }
  o[parts[parts.length - 1]] = value;
}

const captured = {};
let currentFactory = null;

function installSandbox() {
  global.wx = wxStub();
  global.App = (factory) => {
    captured.app = factory;
    const inst = Object.assign({}, factory);
    inst.globalData = factory.globalData || {};
    global.__APP = inst;
    return inst;
  };
  global.getApp = () => global.__APP;
  global.Component = () => {};
  global.Page = (factory) => {
    currentFactory = factory;
  };
  global.getCurrentPages = () => pageStack;
}

let pageStack = [];

function makePage(name, route) {
  if (!currentFactory) {
    check("页面模块已注册 Page(): " + name, false);
    return null;
  }
  const factory = currentFactory;
  currentFactory = null;
  const page = {
    route,
    data: JSON.parse(JSON.stringify(factory.data || {})),
    setData(patch, cb) {
      Object.keys(patch).forEach((k) => setByPath(this.data, k, patch[k]));
      cb && cb();
    }
  };
  Object.keys(factory).forEach((k) => {
    if (typeof factory[k] === "function") {
      page[k] = factory[k].bind(page);
    }
  });
  pageStack = [{ route }];
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  installSandbox();

  /* --- app.js --- */
  require(path.join(ROOT, "app.js"));
  captured.app.onLaunch.call(global.__APP);
  check("App.onLaunch 正常（systemInfo 获取不抛错）", !!global.__APP.globalData.systemInfo);

  /* --- 1. 首页 --- */
  require(path.join(ROOT, "pages/index/index.js"));
  const index = makePage("index", "pages/index/index");
  index.onLoad();
  await sleep(600);
  check("首页：summary 数据渲染", index.data.summary.roomCount === 8, index.data.summary);
  check("首页：公告轮播 3 条", index.data.notices.length === 3);
  check("首页：banner 3 张", index.data.banners.length === 3);
  check("首页：热门自习室 4 间", index.data.hotRooms.length === 4);
  check("首页：降级模式标记生效", index.data.offline === true);
  index.onRoomSelect({ detail: { id: "r1" } });
  check("首页：卡片点击带 id 跳详情", navlog[navlog.length - 1] === "navigateTo:/pages/room-detail/room-detail?id=r1", navlog.slice(-1));
  index.goMessages();
  check("首页：未登录点消息 → 拦截去登录", navlog[navlog.length - 1].startsWith("navigateTo:/pages/login/login?redirect="), navlog.slice(-1));

  /* --- 2. 登录页 --- */
  require(path.join(ROOT, "pages/login/login.js"));
  const login = makePage("login", "pages/login/login");
  login.onLoad({ redirect: encodeURIComponent("/pages/profile/profile") });
  login.onSubmit();
  await sleep(50);
  check("登录：空表单校验拦截（3 条错误）", !!login.data.errors.studentId && !!login.data.errors.password && !!login.data.errors.agreed);
  login.onInputStudentId({ detail: { value: "123" } });
  login.onBlurId();
  check("登录：非法学号提示", login.data.errors.studentId === "学号应为 8-12 位数字", login.data.errors);

  /* --- 2a. 微信一键登录：未绑定时的回落分支（离线走 localdb 同构实现） --- */
  const auth = require(path.join(ROOT, "utils/auth.js"));
  check("首次进入登录页：本机无票据 → 仍显示「一键获取微信信息」", login.data.wxQuick === false, login.data.wxQuick);
  check("进入登录页即生成稳定的本机微信标识", /^[0-9a-f]{32}$/.test(storage.hzx_wx_key || ""), storage.hzx_wx_key);
  login.onQuickLogin();
  await sleep(600);
  check("未绑定点一键登录 → 回落提示且不产生会话", !storage.hzx_token && toastLog.indexOf("微信未绑定或已解绑，请用学号登录") >= 0, toastLog.slice(-2));

  login.fillDemo();
  login.onSubmit();
  await sleep(400);
  check("登录：成功后 token 已存", !!storage.hzx_token && storage.hzx_user.nickname === "林小知");
  check("登录：toast 成功反馈", toastLog.includes("登录成功"));
  await sleep(700);
  check("登录：redirect 回跳 tab 页用 switchTab", navlog[navlog.length - 1] === "switchTab:/pages/profile/profile", navlog.slice(-1));

  /* --- 2b. 微信一键登录：自动绑定 → 免密再登 → 服务端解绑后自愈 --- */
  await sleep(400);
  check("密码登录成功即自动绑定：免密票据落盘", /^[0-9a-f]{32}$/.test((storage.hzx_wx_bind || {}).ticket || ""), storage.hzx_wx_bind);
  check("绑定成功后登录页切到「微信一键登录」态", login.data.wxQuick === true && login.data.wxQuickId === "20210101", {
    wxQuick: login.data.wxQuick,
    wxQuickId: login.data.wxQuickId
  });

  const oldToken = storage.hzx_token;
  const oldTicket = (storage.hzx_wx_bind || {}).ticket;
  delete storage.hzx_token; // 等价于退出登录：绑定与票据都保留
  login.onShow();
  check("退出登录不影响绑定（仍可免密）", login.data.wxQuick === true && !!auth.getWxTicket());

  modalLog.length = 0;
  modalConfirm = false; // 先走"不是我"分支
  login.onQuickLogin();
  await sleep(900);
  const idModal = modalLog.filter(function (x) { return x.indexOf("确认登录身份") === 0; })[0] || "";
  check("一键登录先弹身份确认框（学号/姓名/学院齐全）",
    idModal.indexOf("20210101") >= 0 && idModal.indexOf("林小知") >= 0 && idModal.indexOf("计算机学院") >= 0, idModal);
  check("确认框点「不是我」不产生会话", !storage.hzx_token && toastLog.indexOf("已取消，可用学号密码登录") >= 0, {
    token: storage.hzx_token,
    tail: toastLog.slice(-2)
  });

  modalConfirm = true;
  login.onQuickLogin();
  await sleep(1200); // 两段握手 = 两次本地接口往返
  check("确认后免密换到新会话", !!storage.hzx_token && storage.hzx_token !== oldToken, {
    before: oldToken,
    after: storage.hzx_token
  });
  check("免密登录后票据滚动换新", !!auth.getWxTicket() && auth.getWxTicket() !== oldTicket, {
    before: oldTicket,
    after: auth.getWxTicket()
  });

  await require(path.join(ROOT, "apis/user.js")).wxUnbind(); // 模拟管理后台/其他设备解绑
  delete storage.hzx_token;
  login.onQuickLogin(); // 本机还握着已作废的票据，点一键登录要能自愈
  await sleep(600);
  check("服务端已解绑时一键登录自愈回落到密码登录", !storage.hzx_token && auth.getWxTicket() === "" && login.data.wxQuick === false, {
    token: storage.hzx_token,
    ticket: auth.getWxTicket(),
    wxQuick: login.data.wxQuick
  });

  login.fillDemo(); // 恢复登录态，供后续页面用例继续跑
  login.onSubmit();
  await sleep(600);
  check("重新用学号密码登录后自动绑定恢复", !!storage.hzx_token && login.data.wxQuick === true, login.data.wxQuick);

  /* --- 3. 自习室列表 --- */
  require(path.join(ROOT, "pages/rooms/rooms.js"));
  const rooms = makePage("rooms", "pages/rooms/rooms");
  rooms.onLoad();
  await sleep(400);
  check("列表：首屏 6 条/共 8 条", rooms.data.list.length === 6 && rooms.data.total === 8);
  check("列表：hasMore 分页标记", rooms.data.hasMore === true);
  rooms.onReachBottom();
  await sleep(400);
  check("列表：上拉加载至 8 条", rooms.data.list.length === 8 && rooms.data.hasMore === false);
  // 回归防护：loadingMore 必须在加载结束后复位，否则底部会永远显示“正在加载…”
  check("列表：上拉加载后 loadingMore 复位（否则底部一直转圈）", rooms.data.loadingMore === false, rooms.data.loadingMore);
  rooms.setCampus({ currentTarget: { dataset: { index: 1 } } });
  await sleep(400);
  check("列表：校区筛选=东校区 3 间", rooms.data.total === 3, rooms.data.total);
  rooms.onKeywordInput({ detail: { value: "明理" } });
  rooms.doSearch();
  await sleep(400);
  check("列表：校区+关键词组合筛选为 0（东校区无明理楼）", rooms.data.list.length === 0);
  check("列表：空态渲染（firstLoading 结束）", rooms.data.firstLoading === false);
  rooms.resetFilter();
  await sleep(600);
  check("列表：重置筛选回第一页（6 条/共 8 间/hasMore）", rooms.data.list.length === 6 && rooms.data.total === 8 && rooms.data.hasMore === true, {
    len: rooms.data.list.length,
    total: rooms.data.total,
    hasMore: rooms.data.hasMore
  });
  rooms.onPullDownRefresh();
  await sleep(400);
  check("列表：下拉刷新调用 stopPullDownRefresh", navlog.includes("stopPullDown"));

  /* --- 4. 详情页（id 传参 → 座位 → 下单） --- */
  require(path.join(ROOT, "pages/room-detail/room-detail.js"));
  const detail = makePage("room-detail", "pages/room-detail/room-detail");
  detail.onLoad({});
  await sleep(400);
  check("详情：缺 id 参数不请求接口", detail.data.room === null);
  detail.roomId = "r1";
  detail.data.dates = require(path.join(ROOT, "utils/format.js")).nextDays(7);
  detail.loadAll();
  await sleep(400);
  check("详情：room/r1 加载成功", detail.data.room && detail.data.room.id === "r1");
  check("详情：座位数=容量（列数自适应 5-8）", detail.data.seats.length === detail.data.room.capacity &&
    detail.data.seatCols >= 5 && detail.data.seatCols <= 8, {
    seats: detail.data.seats.length,
    capacity: detail.data.room.capacity,
    cols: detail.data.seatCols
  });
  check("详情：默认时段可用", !!detail.data.start && !!detail.data.end);
  // 关键：切到“明天”，避免深夜运行测试时当天时段已过被派生为“已完成”
  detail.onDateTap({ currentTarget: { dataset: { index: 1 } } });
  await sleep(600);
  check("详情：切换日期到明天", detail.data.dateIndex === 1);
  // 说明：种子数据“明天 09:00-12:00”已有预约，测试选 13:00 起的时段以避开冲突规则
  detail.onStartTap({ currentTarget: { dataset: { slot: "13:00" } } });
  await sleep(600);
  check("详情：切换开始时段并联动结束选项", detail.data.start === "13:00" && detail.data.ends.indexOf(detail.data.end) >= 0);
  detail.onEndTap({ currentTarget: { dataset: { slot: detail.data.ends[detail.data.ends.length - 1] } } });
  await sleep(600);
  check("详情：超 6 小时限制报错", detail.data.slotError === "单次预约最长 6 小时", detail.data.slotError);
  detail.onEndTap({ currentTarget: { dataset: { slot: "16:00" } } });
  await sleep(600);
  check("详情：重新选择合法结束时段", detail.data.end === "16:00" && !detail.data.slotError, {
    end: detail.data.end,
    slotError: detail.data.slotError
  });
  const free = detail.data.seats.find((x) => x.status === "free");
  detail.pickSeat({ currentTarget: { dataset: { no: free.no, status: free.status } } });
  check("详情：点选空闲座位", detail.data.selectedSeat === free.no);
  // 座位图以真实订单为准（新教室全空闲，不再有随机占座）：借另一位同学的名义占一个座位来验证「已约」不可点
  const rivalSeat = detail.data.seats.find((s) => s.status === "free" && s.no !== free.no);
  const ldb = storage.hzx_localdb_v1 || (storage.hzx_localdb_v1 = { orders: [] });
  ldb.orders.push({
    id: "HZXRIVAL01", userId: "20210102", roomId: "r1", seatNo: rivalSeat.no,
    date: detail.data.dates[1].full, startSlot: "13:00", endSlot: "16:00",
    status: "pending", createdAt: Date.now(), remark: ""
  });
  detail.fetchSeats();
  await sleep(300);
  const taken = detail.data.seats.find((x) => x.status === "reserved");
  check("详情：他人订单占用的座位显示为已约", !!taken && taken.no === rivalSeat.no, taken && taken.no);
  detail.pickSeat({ currentTarget: { dataset: { no: taken.no, status: taken.status } } });
  check("详情：不可点已约座位", detail.data.selectedSeat === free.no);
  detail.submit();
  await sleep(500);
  const orderNav = navlog.filter((n) => n.startsWith("navigateTo:/pages/order-result"));
  check("详情：提交后跳转结果页带 orderId", orderNav.length === 1, orderNav);
  const createdUrl = orderNav[0] || "";
  const newOrderId = createdUrl.split("orderId=")[1] ? createdUrl.split("orderId=")[1].split("&")[0] : "";

  /* --- 5. 结果页 --- */
  require(path.join(ROOT, "pages/order-result/order-result.js"));
  const result = makePage("order-result", "pages/order-result/order-result");
  result.onLoad({ orderId: newOrderId, fresh: "1" });
  await sleep(500);
  const ord = result.data.order || {};
  check("结果页：凭证数据加载", !!ord.id && ord.id === newOrderId, { newOrderId, ord: ord.id });
  check("结果页：状态=待使用", ord.status === "pending", ord.status);
  check("结果页：成功 toast 反馈", toastLog.includes("预约成功"));

  /* --- 6. 我的预约（滑动/取消/删除） --- */
  require(path.join(ROOT, "pages/orders/orders.js"));
  const orders = makePage("orders", "pages/orders/orders");
  orders.onShow();
  await sleep(400);
  check("预约列表：登录态加载", orders.data.logged === true && orders.data.list.length >= 3, orders.data.list.length);
  const idxNew = orders.data.list.findIndex((o) => o.id === newOrderId);
  check("预约列表：新订单在列", idxNew >= 0);
  orders.onTouchStart({ touches: [{ clientX: 300 }] });
  orders.onTouchMove({ touches: [{ clientX: 200 }] });
  orders.onTouchEnd({ changedTouches: [{ clientX: 200 }], currentTarget: { dataset: { index: idxNew } } });
  check("预约列表：左滑打开操作条", orders.data.list[idxNew].swiped === true);
  orders.onCancel({ currentTarget: { dataset: { index: idxNew } } });
  await sleep(700);
  const after = orders.data.list.find((o) => o.id === newOrderId);
  check("预约列表：滑动取消预约生效", !!after && after.status === "canceled", after && after.status);
  check("预约列表：取消 toast 反馈", toastLog.includes("已取消预约"));
  orders.onTabTap({ currentTarget: { dataset: { index: 4 } } }); // 已取消
  await sleep(700);
  check("预约列表：状态 tab 切换筛选", orders.data.list.length >= 1 && orders.data.list.every((o) => o.status === "canceled"));
  const delId = orders.data.list[0].id;
  orders.onRemove({ currentTarget: { dataset: { index: 0 } } });
  await sleep(700);
  check("预约列表：删除已取消记录后不再出现", !orders.data.list.some((o) => o.id === delId), {
    delId,
    left: orders.data.list.map((o) => o.id)
  });
  check("预约列表：删除 toast 反馈", toastLog.includes("已删除"));
  orders.onPullDownRefresh();
  await sleep(300);

  /* --- 7. 消息中心 --- */
  require(path.join(ROOT, "pages/messages/messages.js"));
  const msgs = makePage("messages", "pages/messages/messages");
  msgs.onShow();
  await sleep(600);
  check("消息：登录后列表加载", msgs.data.list.length >= 3, msgs.data.list.length);
  check("消息：取消预约产生未读消息", msgs.data.unread >= 2, msgs.data.unread);
  check("角标：已同步 tabBar 角标", navlog.some((n) => n.startsWith("BADGE:3=")), navlog.filter((n) => n.includes("BADGE")));
  const unreadIdx = msgs.data.list.findIndex((x) => !x.read);
  msgs.openMsg({ currentTarget: { dataset: { index: unreadIdx } } });
  await sleep(200);
  check("消息：点击标记已读", msgs.data.list[unreadIdx].read === true && msgs.data.unread >= 1);
  msgs.onReachBottom();
  await sleep(300);
  msgs.readAll();
  await sleep(700);
  check("消息：全部已读清零", msgs.data.unread === 0);
  check("角标：清零后移除角标", navlog[navlog.length - 1] === "BADGE-REMOVE:3", navlog.slice(-2));

  /* --- 8. 个人中心 --- */
  require(path.join(ROOT, "pages/profile/profile.js"));
  const profile = makePage("profile", "pages/profile/profile");
  profile.onShow();
  await sleep(400);
  check("我的：资料加载", profile.data.logged === true && profile.data.user.studentId === "20210101");
  check("我的：统计字段", profile.data.stats.rooms === 5 && typeof profile.data.stats.total === "number", profile.data.stats);
  profile.showRule();
  profile.goOrders();
  check("我的：跳转预约 tab", navlog[navlog.length - 1] === "switchTab:/pages/orders/orders");
  profile.logout();
  await sleep(100);
  check("我的：退出登录清除会话", !storage.hzx_token && profile.data.logged === false);
  check("我的：退出 toast", toastLog.includes("已退出登录"));

  /* --- 结果 --- */
  console.log("\n仿真结果：通过 " + passed + " 项，失败 " + failed + " 项");
  if (failed) {
    console.log("失败项：\n - " + fails.join("\n - "));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error("仿真脚本异常：", e && e.stack ? e.stack : e);
  process.exitCode = 2;
});
