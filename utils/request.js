/**
 * utils/request.js —— wx.request 统一封装
 * 能力：
 *  1. 自动拼接 baseURL、JSON 请求头、Authorization Bearer token
 *  2. 统一响应结构 { code, message, data } 的拆包与错误提示
 *  3. 后端不可达时自动降级到 utils/localdb.js 本地演示数据（课堂演示保障）
 */
const config = require("./config");
const auth = require("./auth");
const localdb = require("./localdb");

let offlineToastShown = false;
function notifyOffline() {
  const app = getApp();
  if (app) app.globalData.offline = true;
  if (offlineToastShown) return;
  offlineToastShown = true;
  wx.showToast({
    title: "后端未连接，已切换本地演示数据",
    icon: "none",
    duration: 2500
  });
}

/**
 * @param {object} options
 * @param {string} options.url      以 / 开头的接口路径（含查询串）
 * @param {string} [options.method] GET/POST/PUT/DELETE
 * @param {object} [options.data]   请求体或查询参数
 * @param {boolean}[options.auth]   是否携带 token，默认 true
 * @param {boolean}[options.silent] 失败时不弹 toast
 * @returns {Promise<any>} resolve 业务 data，reject Error
 */
function request(options) {
  const opts = options || {};
  const method = (opts.method || "GET").toUpperCase();
  const silent = !!opts.silent;

  return new Promise((resolve, reject) => {
    const header = { "Content-Type": "application/json" };
    const token = auth.getToken();
    if (opts.auth !== false && token) {
      header.Authorization = "Bearer " + token;
    }

    wx.request({
      url: config.BASE_URL + opts.url,
      method,
      data: opts.data || {},
      header,
      timeout: 6000,
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 200 && body.code === 0) {
          resolve(body.data);
          return;
        }
        const err = new Error(body.message || "服务异常（" + res.statusCode + "）");
        err.code = body.code || res.statusCode;
        if (err.code === 401) auth.clear(); // token 失效，清除本地登录态
        if (!silent) {
          wx.showToast({ title: err.message, icon: "none", duration: 2200 });
        }
        reject(err);
      },
      fail() {
        // 网络层失败：尝试本地降级数据
        if (!config.USE_LOCAL_FALLBACK) {
          const err = new Error("网络不可用，请检查后端服务是否启动");
          if (!silent) wx.showToast({ title: err.message, icon: "none" });
          reject(err);
          return;
        }
        localdb.handle(method, opts.url, opts.data || {}).then(
          (data) => {
            notifyOffline();
            resolve(data);
          },
          (e) => {
            if (!silent) {
              wx.showToast({ title: (e && e.message) || "网络不可用", icon: "none" });
            }
            reject(e);
          }
        );
      }
    });
  });
}

module.exports = { request };
