/**
 * pages/messages —— 消息中心
 * JS 交互：下拉刷新、上拉加载更多、点击标记已读并联动跳转
 */
const msgApi = require("../../apis/message");
const config = require("../../utils/config");
const auth = require("../../utils/auth");

const TYPE_META = {
  system: { text: "系统", cls: "tag-off" },
  order: { text: "预约", cls: "tag-success" },
  credit: { text: "信用", cls: "tag-warn" }
};

Page({
  data: {
    list: [],
    page: 1,
    pageSize: config.MSG_PAGE_SIZE,
    hasMore: true,
    loading: true,
    loadingMore: false,
    unread: 0,
    logged: false
  },

  onLoad() {
    this._loadingPage = false;
  },

  onShow() {
    const logged = auth.isLogin();
    this.setData({ logged });
    if (logged) this.loadPage(1, true);
    else this.setData({ list: [], loading: false });
  },

  onPullDownRefresh() {
    if (!auth.isLogin()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadPage(1, true, () => {
      wx.stopPullDownRefresh();
      wx.showToast({ title: "已更新", icon: "none", duration: 800 });
    });
  },

  onReachBottom() {
    if (!auth.isLogin() || !this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.setData({ loadingMore: true });
    this.loadPage(this.data.page + 1, false, () => this.setData({ loadingMore: false }));
  },

  loadPage(page, replace, done) {
    if (this._loadingPage) {
      if (done) done();
      return;
    }
    this._loadingPage = true;
    this.setData({ loading: replace && page === 1 ? true : this.data.loading });
    msgApi
      .list(page, this.data.pageSize)
      .then((res) => {
        const decorate = (m) => {
          const meta = TYPE_META[m.type] || TYPE_META.system;
          return Object.assign({}, m, { typeText: meta.text, typeCls: meta.cls, expanded: false });
        };
        this.setData({
          list: replace ? res.list.map(decorate) : this.data.list.concat(res.list.map(decorate)),
          page: res.page,
          hasMore: res.hasMore,
          unread: res.unread,
          loading: false
        });
        getApp().updateUnreadBadge(res.unread);
      })
      .catch(() => this.setData({ loading: false }))
      .then(() => {
        this._loadingPage = false;
        if (done) done();
      });
  },

  /* ---------- 点击：标记已读 + 联动跳转 ---------- */
  openMsg(e) {
    const i = e.currentTarget.dataset.index;
    const item = this.data.list[i];
    if (!item) return;

    // 先标记已读（数据处理 → 结果反馈）
    if (!item.read) {
      const patch = {};
      patch["list[" + i + "].read"] = true;
      this.setData(patch);
      const unread = Math.max(0, this.data.unread - 1);
      this.setData({ unread });
      getApp().updateUnreadBadge(unread);
      msgApi.read(item.id).catch(() => {});
    }

    if (item.roomId) {
      wx.navigateTo({ url: "/pages/room-detail/room-detail?id=" + item.roomId });
      return;
    }
    if (item.type === "order") {
      wx.switchTab({ url: "/pages/orders/orders" });
      return;
    }
    // 系统消息：展开/收起全文（再次点击折叠）
    const patch2 = {};
    patch2["list[" + i + "].expanded"] = !item.expanded;
    this.setData(patch2);
  },

  readAll() {
    if (!this.data.unread) {
      wx.showToast({ title: "暂无未读消息", icon: "none" });
      return;
    }
    msgApi.readAll().then(() => {
      wx.showToast({ title: "已全部读完", icon: "success" });
      this.loadPage(1, true);
    });
  },

  goLogin() {
    auth.ensureLogin();
  }
});
