/**
 * 慧自习 · 校园自习室预约小程序
 * 全局入口：恢复登录态、提供公共能力
 */
const auth = require("./utils/auth");
const badge = require("./utils/badge");

App({
  globalData: {
    // 是否处于本地演示模式（后端未启动时由请求层自动置 true）
    offline: false,
    systemInfo: null
  },

  onLaunch() {
    // 读取系统信息，用于安全区适配（onLaunch 生命周期）
    try {
      this.globalData.systemInfo = wx.getSystemInfoSync();
    } catch (e) {
      this.globalData.systemInfo = null;
    }
    // 恢复本地登录态，避免每次冷启动都要求重新登录
    if (auth.getToken()) {
      this.globalData.user = auth.getUser();
    }
  },

  /**
   * 更新“我的”Tab 上的未读消息角标
   * @param {number} count 未读数量，0 表示移除角标
   */
  updateUnreadBadge(count) {
    badge.set(count);
  }
});
