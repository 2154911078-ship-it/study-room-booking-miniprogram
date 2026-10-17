/**
 * pages/room-detail —— 自习室详情 + 预约下单
 * 关键流程：onLoad 接收 id 传参 → 请求详情接口 → 日期/时段变化重新拉取座位图
 *          → 表单校验 → 确认弹窗 → POST 创建订单 → 跳转结果页反馈
 */
const roomApi = require("../../apis/room");
const orderApi = require("../../apis/order");
const auth = require("../../utils/auth");
const fmt = require("../../utils/format");
const validate = require("../../utils/validate");

const ROOM_STATUS = {
  open: { text: "开放中", cls: "tag-success" },
  full: { text: "已约满", cls: "tag-warn" },
  maintenance: { text: "维护中", cls: "tag-off" }
};

Page({
  data: {
    room: null,
    statusMeta: ROOM_STATUS.open,
    seats: [],
    dates: [],
    dateIndex: 0,
    starts: [],
    ends: [],
    start: "",
    end: "",
    slotError: "",
    selectedSeat: "",
    remark: "",
    duration: 0,
    loadingSeats: false,
    loadError: false,
    submitting: false
  },

  /* ---------- 生命周期：onLoad 接收列表页传来的 id ---------- */
  onLoad(options) {
    const id = options && options.id;
    if (!id) {
      // 参数缺失兜底：提示并返回，避免带空参数渲染
      wx.showToast({ title: "缺少自习室参数", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    this.roomId = id;
    this.setData({ dates: fmt.nextDays(7) });
    this.loadAll();
  },

  onUnload() {
    this.roomId = null;
  },

  /* ---------- 数据 ---------- */
  loadAll(done) {
    const d = this.data;
    roomApi
      .detail(this.roomId, {
        date: d.dates[d.dateIndex] ? d.dates[d.dateIndex].full : fmt.todayStr(),
        start: d.start,
        end: d.end
      })
      .then((res) => {
        const room = res.room;
        // 首次进入：以服务端默认时段初始化开始/结束选项
        let start = this.data.start || res.query.start;
        let end = this.data.end || res.query.end;
        const starts = fmt.slotStarts(room.openFrom, room.openTo);
        let ends = fmt.slotEndsFrom(fmt.hourOf(start), room.openTo);
        if (ends.indexOf(end) < 0) end = ends[1] || ends[0] || "";

        this.setData({
          room,
          statusMeta: ROOM_STATUS[room.status] || ROOM_STATUS.open,
          seats: res.seats,
          starts,
          ends,
          start,
          end,
          duration: end ? fmt.hourOf(end) - fmt.hourOf(start) : 0,
          loadError: false
        });
        if (done) done();
      })
      .catch(() => {
        this.setData({ loadError: !this.data.room });
        if (done) done();
      });
  },

  /** 日期/时段变化 → 重新拉取该时段座位图（数据处理环节） */
  fetchSeats() {
    if (!this.data.start || !this.data.end) return;
    this.setData({ loadingSeats: true, slotError: "" });
    const d = this.data;
    roomApi
      .detail(this.roomId, { date: d.dates[d.dateIndex].full, start: d.start, end: d.end })
      .then((res) => {
        const stillValid = res.seats.filter(
          (s) => s.no === d.selectedSeat && (s.status === "free" || s.status === "mine")
        ).length;
        this.setData({
          seats: res.seats,
          selectedSeat: stillValid ? d.selectedSeat : "",
          loadingSeats: false,
          duration: fmt.hourOf(d.end) - fmt.hourOf(d.start)
        });
        if (!stillValid && d.selectedSeat) {
          wx.showToast({ title: "座位状态已更新，请重新选择", icon: "none" });
        }
      })
      .catch(() => this.setData({ loadingSeats: false }));
  },

  /* ---------- 选择交互 ---------- */
  onDateTap(e) {
    const i = e.currentTarget.dataset.index;
    if (i === this.data.dateIndex) return;
    this.setData({ dateIndex: i, selectedSeat: "" });
    this.fetchSeats();
  },

  onStartTap(e) {
    const s = e.currentTarget.dataset.slot;
    if (s === this.data.start) return;
    const ends = fmt.slotEndsFrom(fmt.hourOf(s), this.data.room.openTo);
    let end = this.data.end;
    if (ends.indexOf(end) < 0) end = ends[1] || ends[0] || "";
    this.setData({ start: s, ends, end });
    this.fetchSeats();
  },

  onEndTap(e) {
    const v = e.currentTarget.dataset.slot;
    if (v === this.data.end) return;
    if (v <= this.data.start) {
      this.setData({ slotError: "结束时段需晚于开始时段" });
      return;
    }
    if (fmt.hourOf(v) - fmt.hourOf(this.data.start) > 6) {
      this.setData({ slotError: "单次预约最长 6 小时" });
      return;
    }
    this.setData({ end: v });
    this.fetchSeats();
  },

  pickSeat(e) {
    const { no, status } = e.currentTarget.dataset;
    if (status === "free") {
      this.setData({ selectedSeat: this.data.selectedSeat === no ? "" : no });
      return;
    }
    const tips = {
      reserved: "该座位此时段已被预约",
      maintenance: "该座位暂停使用",
      mine: "您已预约该座位此时段"
    };
    wx.showToast({ title: tips[status] || "不可选", icon: "none" });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  retry() {
    this.loadAll();
  },

  /* ---------- 提交预约：校验 → 确认 → 下单 → 结果反馈 ---------- */
  submit() {
    if (this.data.submitting) return;
    const d = this.data;

    // 登录拦截（未登录跳登录页并带回跳地址）
    if (!auth.ensureLogin()) return;

    const slotMsg = validate.slotRange(d.start, d.end);
    if (slotMsg) {
      this.setData({ slotError: slotMsg });
      wx.showToast({ title: slotMsg, icon: "none" });
      return;
    }
    const seatMsg = validate.seat(d.selectedSeat);
    if (seatMsg) {
      wx.showToast({ title: seatMsg, icon: "none" });
      return;
    }
    if (d.room.status !== "open") {
      wx.showToast({ title: "该自习室暂不可预约", icon: "none" });
      return;
    }

    const date = d.dates[d.dateIndex].full;
    wx.showModal({
      title: "确认预约",
      content:
        d.room.name +
        "\n" +
        date +
        "（" +
        d.dates[d.dateIndex].label +
        "）" +
        d.start +
        " - " +
        d.end +
        "\n座位：" +
        d.selectedSeat,
      confirmText: "确认预约",
      confirmColor: "#2F5BFF",
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ submitting: true });
        wx.showLoading({ title: "提交中…", mask: true });
        orderApi
          .create({
            roomId: this.roomId,
            date: date,
            startSlot: d.start,
            endSlot: d.end,
            seatNo: d.selectedSeat,
            remark: d.remark.trim()
          })
          .then((order) => {
            wx.hideLoading();
            this.setData({ submitting: false });
            // 结果反馈页：orderId 传参
            wx.navigateTo({
              url: "/pages/order-result/order-result?orderId=" + order.id + "&fresh=1"
            });
          })
          .catch(() => this.setData({ submitting: false, }));
      }
    });
  }
});
