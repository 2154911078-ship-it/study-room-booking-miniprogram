/**
 * pages/profile —— 个人中心（tabBar）
 * onShow 刷新登录态 + 拉取用户资料/统计/未读角标；支持退出登录
 */
const userApi = require("../../apis/user");
const msgApi = require("../../apis/message");
const auth = require("../../utils/auth");

Page({
  data: {
    logged: false,
    user: {},
    stats: {},
    unread: 0,
    offline: false
  },

  onShow() {
    const logged = auth.isLogin();
    const user = logged ? auth.getUser() || {} : {};
    this.setData({
      logged,
      user,
      offline: !!getApp().globalData.offline
    });
    if (!logged) {
      this.setData({ stats: {}, unread: 0 });
      getApp().updateUnreadBadge(0);
      return;
    }
    userApi
      .profile()
      .then((res) => {
        auth.saveSession(auth.getToken(), res.user); // 同步最新昵称/信用分（含微信绑定状态，供其他页面取用）
        this.setData({ user: res.user, stats: res.stats });
      })
      .catch(() => {});
    msgApi
      .unreadCount()
      .then((d) => {
        this.setData({ unread: d.unread || 0 });
        getApp().updateUnreadBadge(d.unread);
      })
      .catch(() => {});
  },

  /* ---------- 入口 ---------- */
  goLogin() {
    if (auth.isLogin()) return;
    wx.navigateTo({ url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/profile/profile") });
  },
  goOrders() {
    wx.switchTab({ url: "/pages/orders/orders" });
  },
  goRooms() {
    wx.switchTab({ url: "/pages/rooms/rooms" });
  },
  goMessages() {
    if (!auth.ensureLogin()) return;
    wx.navigateTo({ url: "/pages/messages/messages" });
  },

  /* ---------- 信息弹窗（消息提示） ---------- */
  showRule() {
    wx.showModal({
      title: "自习公约",
      content:
        "1. 按时到馆签到，超时 30 分钟预约自动释放；\n2. 室内保持静音，接打电话请移步走廊；\n3. 离馆带走个人物品与垃圾；\n4. 恶意占座、频繁爽约将扣减信用分。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  showHours() {
    wx.showModal({
      title: "开放时间",
      content: "全校自习区 07:00 - 23:00 滚动开放，各自习室以详情页公示时间为准；考试周部分场馆延长开放。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  showCredit() {
    wx.showModal({
      title: "信用分规则",
      content: "初始 100 分：按时签到 +1/次；预约后无故爽约 -5/次；低于 60 分暂停预约，可在学期末自动恢复。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  showAbout() {
    wx.showModal({
      title: "关于慧自习",
      content: "慧自习 v1.0.0\n校园生活服务方向 · 课程演示项目\nLogo 与插画素材均为脚本自制生成。",
      showCancel: false,
      confirmText: "了解"
    });
  },

  /* ---------- 退出登录 ---------- */
  logout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后预约提醒将不再推送，确定退出吗？",
      confirmColor: "#F04B4B",
      success: (r) => {
        if (!r.confirm) return;
        auth.clear();
        getApp().updateUnreadBadge(0);
        this.setData({ logged: false, user: {}, stats: {}, unread: 0 });
        wx.showToast({ title: "已退出登录", icon: "success" });
      }
    });
  }
});
