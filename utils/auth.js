/**
 * utils/auth.js —— 登录态管理（token / 用户信息缓存，登录拦截）
 */
const config = require("./config");

/** tabBar 页面路径，登录后跳回时只能使用 switchTab */
const TAB_PAGES = [
  "pages/index/index",
  "pages/rooms/rooms",
  "pages/orders/orders",
  "pages/profile/profile"
];

function getToken() {
  return wx.getStorageSync(config.TOKEN_KEY) || "";
}

function getUser() {
  return wx.getStorageSync(config.USER_KEY) || null;
}

/** 登录成功后保存会话 */
function saveSession(token, user) {
  wx.setStorageSync(config.TOKEN_KEY, token);
  wx.setStorageSync(config.USER_KEY, user);
  const app = getApp();
  if (app) app.globalData.user = user;
}

/** 退出登录 / token 失效 */
function clear() {
  wx.removeStorageSync(config.TOKEN_KEY);
  wx.removeStorageSync(config.USER_KEY);
  const app = getApp();
  if (app) app.globalData.user = null;
}

function isLogin() {
  return !!getToken();
}

/**
 * 登录拦截：未登录时跳转登录页，并携带当前页面路径用于登录后回跳
 * @returns {boolean} 已登录返回 true，否则 false（调用方应中断后续逻辑）
 */
function ensureLogin() {
  if (isLogin()) return true;
  const pages = getCurrentPages();
  const cur = pages[pages.length - 1];
  const route = cur && cur.route ? "/" + cur.route : "/pages/index/index";
  wx.navigateTo({
    url: "/pages/login/login?redirect=" + encodeURIComponent(route)
  });
  return false;
}

/**
 * 登录成功后的回跳策略：
 * - 有 redirect 参数：tab 页用 switchTab，普通页用 redirectTo
 * - 无 redirect：能返回则 navigateBack，否则回首页
 */
function redirectAfterLogin(redirectEncoded) {
  const done = () => {
    if (!redirectEncoded) {
      if (getCurrentPages().length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: "/pages/index/index" });
      }
      return;
    }
    const route = decodeURIComponent(redirectEncoded);
    const path = route.replace(/^\//, "");
    if (TAB_PAGES.indexOf(path) >= 0) {
      wx.switchTab({ url: route });
    } else {
      wx.redirectTo({ url: route });
    }
  };
  setTimeout(done, 600);
}

/* ---------- 微信一键登录：本机微信标识、免密票据与微信资料绑定 ---------- */
/**
 * 绑定关系存在服务端 users 表（wx_key / wx_ticket / wx_bound_at），本地只留两样东西：
 * - hzx_wx_key ：本机微信标识。首次进入登录页生成一次（32 位 hex）后长期不变，
 *                它对应服务端的 wx_key —— 后端若配了 AppSecret，会改用真 openid 覆盖，
 *                本字段就自动退化为兜底（详见 server/config.js 的 WX）。
 * - ticket     ：免密票据，随 hzx_wx_bind 一起存。每次一键登录服务端都会滚动重发一张新票，
 *                旧票立即作废；解绑（本人或管理台）后本地这张也清掉。
 * 另外继续保留头像与学号的本地回填（{ studentId, avatar, boundAt, boundIds }）：
 * - studentId：当前绑定的学号（首次获取微信信息时必须绑定，且必须用该学号登录成功才算生效）
 * - boundIds ：本机历史上绑定过的学号，只用于交互提示，唯一性由服务端 uk_users_wx_key 决定
 * 边界：wxKey 与票据都存在 Storage 里，清缓存或换设备后会回到"未绑定"，需再输一次密码。
 */

/** 读取绑定信息，未绑定过返回空对象 */
function getWxBind() {
  return wx.getStorageSync(config.WX_BIND_KEY) || {};
}

/** 保存绑定信息，并把本次学号追加进历史绑定列表 */
function saveWxBind(bind) {
  const old = getWxBind();
  const ids = old.boundIds ? old.boundIds.slice() : [];
  const next = Object.assign({}, old, bind || {});
  if (next.studentId && ids.indexOf(next.studentId) < 0) ids.push(next.studentId);
  next.boundIds = ids;
  wx.setStorageSync(config.WX_BIND_KEY, next);
  return next;
}

/** 该学号此前是否已绑定过（微信资料与学号一对多不允许，避免重复绑定） */
function isWxStudentBound(studentId) {
  const b = getWxBind();
  return !!studentId && (b.boundIds || []).indexOf(studentId) >= 0;
}

/** 随机 hex 串（小程序没有 crypto API，长度 32 足够避免撞码） */
function randomHex(len) {
  const s = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < len; i++) out += s.charAt(Math.floor(Math.random() * 16));
  return out;
}

/** 本机微信标识：没有就生成一个并永久保存，之后所有绑定/解绑都沿用它 */
function getWxKey() {
  let k = wx.getStorageSync(config.WX_KEY_KEY) || "";
  if (!/^[0-9a-f]{16,64}$/.test(k)) {
    k = randomHex(32);
    wx.setStorageSync(config.WX_KEY_KEY, k);
  }
  return k;
}

/** 免密票据（未绑定过返回空串） */
function getWxTicket() {
  return getWxBind().ticket || "";
}

/** 保存服务端滚动下发的新票据 */
function saveWxTicket(ticket) {
  return saveWxBind({ ticket: ticket || "", ticketAt: Date.now() });
}

/** 清除票据（解绑、或一键登录被服务端判定未绑定时调用；保留头像与学号回填） */
function clearWxTicket() {
  return saveWxBind({ ticket: "", ticketAt: 0 });
}

/** 本机是否具备"一键登录"的条件：拿到过 wxKey 且手里有票据 */
function canWxQuickLogin() {
  return !!getWxTicket();
}

/**
 * 取一次 wx.login 的 code（可选增强：后端配了 AppSecret 才会真正拿它换 openid）
 * 拿不到就返回空串，调用方一律带 wxKey 兜底，不影响一键登录可用性。
 */
function getWxCode() {
  return new Promise((resolve) => {
    if (!wx.login) return resolve("");
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    // 极端情况下 wx.login 不回调，4 秒后放行，避免一键登录卡死
    setTimeout(() => fin(""), 4000);
    try {
      wx.login({
        success: (r) => fin((r && r.code) || ""),
        fail: () => fin("")
      });
    } catch (e) {
      fin("");
    }
  });
}

module.exports = {
  getToken,
  getUser,
  saveSession,
  clear,
  isLogin,
  ensureLogin,
  redirectAfterLogin,
  getWxBind,
  saveWxBind,
  isWxStudentBound,
  getWxKey,
  getWxTicket,
  saveWxTicket,
  clearWxTicket,
  canWxQuickLogin,
  getWxCode
};
