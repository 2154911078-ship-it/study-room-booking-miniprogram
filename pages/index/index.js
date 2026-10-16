/**
 * pages/index —— 首页
 * 生命周期：onLoad 拉取首屏聚合数据；onShow 刷新登录态与未读角标
 */
const roomApi = require("../../apis/room");
const msgApi = require("../../apis/message");
const auth = require("../../utils/auth");

Page({
  data: {
    logged: false,
    nickname: "",
    offline: false,
    summary: {},
    notices: [],
    banners: [],
    hotRooms: [],
    unread: 0
  },

  onLoad() {
    // onLoad：首屏加载（并行请求，缩短首屏时间）
    this.loadHome();
  },

  onShow() {
    // onShow：从登录页/详情页返回时刷新登录态与角标
    this.refreshUserState();
    this.refreshUnread();
  },

  onPullDownRefresh() {
    this.loadHome(() => {
      wx.stopPullDownRefresh();
      wx.showToast({ title: "已更新", icon: "none", duration: 800 });
    });
  },

  loadHome(done) {
    Promise.all([
      roomApi.summary().catch(() => null),
      roomApi.announcements().catch(() => null),
      // 热门自习室：sort=hot 由后端按预约热度（近 7 天 + 未来 7 天有效预约量）排序，取前 4 间
      roomApi.list({ page: 1, pageSize: 4, sort: "hot" }).catch(() => null)
    ])
      .then(([summary, ann, rooms]) => {
        this.setData({
          summary: summary || {},
          notices: ann && ann.list ? ann.list : [],
          banners: ann && ann.banners ? ann.banners : [],
          hotRooms: rooms && rooms.list ? rooms.list : [],
          offline: !!getApp().globalData.offline
        });
        if (done) done();
      })
      .catch(() => {
        if (done) done();
      });
  },

  refreshUserState() {
    const logged = auth.isLogin();
    const user = logged ? auth.getUser() : null;
    this.setData({
      logged,
      nickname: user ? user.nickname : "",
      offline: !!getApp().globalData.offline
    });
  },

  refreshUnread() {
    if (!auth.isLogin()) {
      this.setData({ unread: 0 });
      getApp().updateUnreadBadge(0);
      return;
    }
    msgApi
      .unreadCount()
      .then((d) => {
        const n = d.unread || 0;
        this.setData({ unread: n });
        getApp().updateUnreadBadge(n);
      })
      .catch(() => {});
  },

  /* ------- 跳转入口（tabBar 用 switchTab，普通页用 navigateTo） ------- */
  onUserChip() {
    if (auth.isLogin()) {
      wx.switchTab({ url: "/pages/profile/profile" });
    } else {
      wx.navigateTo({ url: "/pages/login/login" });
    }
  },

  goRooms() {
    wx.switchTab({ url: "/pages/rooms/rooms" });
  },
  goOrders() {
    wx.switchTab({ url: "/pages/orders/orders" });
  },
  goProfile() {
    wx.switchTab({ url: "/pages/profile/profile" });
  },
  goMessages() {
    if (!auth.ensureLogin()) return;
    wx.navigateTo({ url: "/pages/messages/messages" });
  },

  onBannerTap(e) {
    const item = this.data.banners[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.to === "rooms") this.goRooms();
    else if (item.to === "profile") this.goProfile();
  },

  // 子组件 room-card 抛出 select 事件：id 传参到详情页
  onRoomSelect(e) {
    const id = e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: "/pages/room-detail/room-detail?id=" + id });
  }
});
