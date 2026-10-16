/**
 * pages/orders —— 我的预约（tabBar）
 * JS 交互：① touch 滑动取消/删除 ② 状态下拉刷新 ③ tab 切换请求
 * 业务闭环：取消/删除 → 后端处理 → 消息推送 → Tab 角标更新
 */
const orderApi = require("../../apis/order");
const msgApi = require("../../apis/message");
const auth = require("../../utils/auth");
const fmt = require("../../utils/format");

Page({
  data: {
    tabs: [
      { key: "all", label: "全部" },
      { key: "pending", label: "待使用" },
      { key: "using", label: "使用中" },
      { key: "done", label: "已完成" },
      { key: "canceled", label: "已取消" }
    ],
    tabIndex: 0,
    list: [],
    logged: false,
    loading: true
  },

  onLoad() {
    this.loggedAt = "";
  },

  onShow() {
    // onShow：从登录页/详情页返回时刷新
    const logged = auth.isLogin();
    this.setData({ logged });
    if (logged) this.loadList();
    else this.setData({ list: [], loading: false });
  },

  onPullDownRefresh() {
    if (!auth.isLogin()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadList(() => wx.stopPullDownRefresh());
  },

  onTabTap(e) {
    const i = e.currentTarget.dataset.index;
    if (i === this.data.tabIndex) return;
    this.setData({ tabIndex: i });
    this.loadList();
  },

  /* ---------- 数据 ---------- */
  loadList(done) {
    if (!auth.isLogin()) {
      this.setData({ loading: false });
      done && done();
      return;
    }
    this.setData({ loading: true });
    const tab = this.data.tabs[this.data.tabIndex];
    orderApi
      .list(tab.key)
      .then((res) => {
        const days = fmt.nextDays(8);
        const list = res.list.map((o) => {
          const day = days.filter((d) => d.full === o.date)[0];
          return Object.assign({}, o, {
            swiped: false,
            dateLabel: day ? day.md + " " + day.label : o.date,
            createdText: fmt.fmtDateTime(o.createdAt)
          });
        });
        this.setData({ list, loading: false });
      })
      .catch(() => this.setData({ loading: false }))
      .then(() => done && done());
  },

  refreshBadge() {
    msgApi
      .unreadCount()
      .then((d) => getApp().updateUnreadBadge(d.unread))
      .catch(() => {});
  },

  /* ---------- 滑动交互（touch 三事件驱动） ---------- */
  onTouchStart(e) {
    this._sx = e.touches[0].clientX;
    this._moved = false;
  },

  onTouchMove(e) {
    const dx = e.touches[0].clientX - this._sx;
    if (Math.abs(dx) > 10) this._moved = true;
  },

  onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - this._sx;
    const i = e.currentTarget.dataset.index;
    if (dx < -50) {
      this.openSwipe(i);
      this._justSwiped = true;
    } else if (dx > 50 && this.data.list[i] && this.data.list[i].swiped) {
      this.closeSwipe();
      this._justSwiped = true;
    }
  },

  /** 打开第 i 条的操作按钮（互斥：其余条目收起） */
  openSwipe(i) {
    const patch = {};
    this.data.list.forEach((item, j) => {
      if (item.swiped || j === i) patch["list[" + j + "].swiped"] = j === i;
    });
    this.setData(patch);
  },

  closeSwipe() {
    const patch = {};
    let need = false;
    this.data.list.forEach((item, j) => {
      if (item.swiped) {
        patch["list[" + j + "].swiped"] = false;
        need = true;
      }
    });
    if (need) this.setData(patch);
  },

  onTapItem(e) {
    const i = e.currentTarget.dataset.index;
    const item = this.data.list[i];
    if (this._justSwiped) {
      // 刚完成滑动：本次 tap 视为“收起操作条”
      this._justSwiped = false;
      this.closeSwipe();
      return;
    }
    if (item.swiped) {
      this.closeSwipe();
      return;
    }
    this.viewOrder(item);
  },

  /* ---------- 操作 ---------- */
  onView(e) {
    this._justSwiped = false;
    this.viewOrder(this.data.list[e.currentTarget.dataset.index]);
  },

  viewOrder(item) {
    if (!item) return;
    this.closeSwipe();
    wx.navigateTo({ url: "/pages/order-result/order-result?orderId=" + item.id });
  },

  onCancel(e) {
    const item = this.data.list[e.currentTarget.dataset.index];
    this.closeSwipe();
    if (!item) return;
    wx.showModal({
      title: "取消预约",
      content: "确定取消「" + item.roomName + " " + item.seatNo + "」" + item.date + " " + item.startSlot + "-" + item.endSlot + " 的预约吗？",
      confirmText: "确认取消",
      confirmColor: "#F04B4B",
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: "处理中…" });
        orderApi
          .cancel(item.id)
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: "已取消预约", icon: "success" });
            this.loadList();
            this.refreshBadge();
          })
          .catch(() => wx.hideLoading());
      }
    });
  },

  onRemove(e) {
    const item = this.data.list[e.currentTarget.dataset.index];
    this.closeSwipe();
    if (!item) return;
    wx.showModal({
      title: "删除记录",
      content: "删除后不可恢复，确定删除订单 " + item.id + " 吗？",
      confirmText: "删除",
      confirmColor: "#F04B4B",
      success: (r) => {
        if (!r.confirm) return;
        orderApi
          .remove(item.id)
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            this.loadList();
          })
          .catch(() => {});
      }
    });
  },

  noop() {},

  goLogin() {
    auth.ensureLogin();
  },

  goRooms() {
    wx.switchTab({ url: "/pages/rooms/rooms" });
  }
});
