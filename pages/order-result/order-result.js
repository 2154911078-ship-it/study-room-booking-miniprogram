/**
 * pages/order-result —— 预约结果 / 凭证页
 * onLoad 接收 orderId（+fresh 标记），体现页面间参数传递与结果反馈闭环
 */
const orderApi = require("../../apis/order");
const fmt = require("../../utils/format");

const HERO_DESC = {
  pending: "请在时段开始前 30 分钟内到馆签到",
  using: "自习中，祝你效率爆棚 📖",
  done: "本次自习已完成，欢迎再次预约",
  canceled: "预约已取消，期待下次见面"
};

Page({
  data: {
    order: null,
    fresh: false,
    statusText: "",
    heroDesc: "",
    loadError: false,
    /* 核销凭证：checkinState 为 usable（待核销）/ checked（已核销）/ invalid（凭证不可用） */
    checkinState: "invalid",
    checkinCode: "",
    checkinCodeText: "",
    checkedIn: false,
    checkedInAtText: "",
    checkedInByName: ""
  },

  onLoad(options) {
    const id = options && options.orderId;
    const fresh = options && options.fresh === "1";
    if (!id) {
      wx.showToast({ title: "缺少订单参数", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    this.orderId = id;
    this.setData({ fresh });
    this.load();
  },

  load(done) {
    orderApi
      .detail(this.orderId)
      .then((order) => {
        const days = fmt.nextDays(8);
        const day = days.filter((d) => d.full === order.date)[0];
        order.dateLabel = day ? day.label : "";
        order.createdText = fmt.fmtDateTime(order.createdAt);
        const meta = fmt.statusMeta(order.status);
        // 核销凭证：整理成模板直接可用的一组字段
        const checkinCode = order.checkinCode || "";
        const checkedIn = order.checkedIn === true;
        const checkedInAt = order.checkedInAt;
        this.setData({
          order,
          statusText: meta.text,
          heroDesc: HERO_DESC[order.status] || "",
          checkinState: fmt.checkinState(order),
          checkinCode,
          checkinCodeText: fmt.fmtCodeGroups(checkinCode),
          checkedIn,
          checkedInAtText: checkedIn && checkedInAt ? fmt.fmtDateTime(checkedInAt) : "",
          checkedInByName: checkedIn ? order.checkedInByName || "" : "",
          loadError: false
        });
        if (this.data.fresh) {
          // 结果反馈：预约流程进入本页时 toast + 震动提示
          wx.showToast({ title: "预约成功", icon: "success", duration: 1400 });
          try {
            wx.vibrateShort({ type: "light" });
          } catch (e) {}
          this.setData({ fresh: false });
        }
        if (done) done();
      })
      .catch(() => {
        this.setData({ loadError: true });
        if (done) done();
      });
  },

  retry() {
    this.setData({ loadError: false });
    this.load();
  },

  onCancel() {
    const order = this.data.order;
    wx.showModal({
      title: "取消预约",
      content: "确定取消订单 " + order.id + " 吗？",
      confirmText: "确认取消",
      confirmColor: "#F04B4B",
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: "处理中…" });
        orderApi
          .cancel(order.id)
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: "已取消预约", icon: "success" });
            this.load();
          })
          .catch(() => wx.hideLoading());
      }
    });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/rooms/rooms" });
    }
  },

  goOrders() {
    // switchTab 会自动关闭所有非 tabBar 页面，无需手动清栈
    wx.switchTab({ url: "/pages/orders/orders" });
  },

  goHome() {
    wx.switchTab({ url: "/pages/index/index" });
  }
});
