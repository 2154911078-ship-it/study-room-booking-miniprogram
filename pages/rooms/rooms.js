/**
 * pages/rooms —— 自习室列表页（tabBar）
 * JS 交互：① 下拉刷新 ② 上拉加载更多 ③ 搜索/筛选
 */
const roomApi = require("../../apis/room");
const config = require("../../utils/config");

Page({
  data: {
    campusList: ["全部", "东校区", "西校区", "南校区"],
    campusIndex: 0,
    inputKeyword: "",
    keyword: "",
    list: [],
    page: 1,
    pageSize: config.ROOM_PAGE_SIZE,
    total: 0,
    hasMore: true,
    loadingMore: false,
    firstLoading: true
  },

  onLoad() {
    this.loadPage(1, true);
  },

  /**
   * 交互①：下拉刷新（json 开启 enablePullDownRefresh）
   */
  onPullDownRefresh() {
    this.loadPage(1, true, () => {
      wx.stopPullDownRefresh();
      wx.showToast({ title: "已为你刷新", icon: "none", duration: 900 });
    });
  },

  /**
   * 交互②：上拉加载更多（分页请求下一页并追加）
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.firstLoading) return;
    this.setData({ loadingMore: true });
    // 复位由 loadPage 统一负责（成功/失败都会复位），这里不再传回调，避免参数传错
    this.loadPage(this.data.page + 1, false);
  },

  /* ---------- 筛选 / 搜索 ---------- */
  setCampus(e) {
    const index = e.currentTarget.dataset.index;
    if (index === this.data.campusIndex) return;
    this.setData({ campusIndex: index });
    this.loadPage(1, true);
  },

  onKeywordInput(e) {
    this.setData({ inputKeyword: e.detail.value });
  },

  doSearch() {
    this.setData({ keyword: this.data.inputKeyword.trim() });
    this.loadPage(1, true);
  },

  clearKeyword() {
    this.setData({ inputKeyword: "", keyword: "" });
    this.loadPage(1, true);
  },

  resetFilter() {
    this.setData({ campusIndex: 0, inputKeyword: "", keyword: "" });
    this.loadPage(1, true);
  },

  /* ---------- 数据 ---------- */
  loadPage(page, replace, done, onError) {
    const d = this.data;
    const params = {
      campus: d.campusList[d.campusIndex] === "全部" ? "" : d.campusList[d.campusIndex],
      keyword: d.keyword,
      page: page,
      pageSize: d.pageSize
    };
    roomApi
      .list(params)
      .then((res) => {
        this.setData({
          list: replace ? res.list : d.list.concat(res.list),
          page: res.page,
          total: res.total,
          hasMore: res.hasMore,
          firstLoading: false,
          loadingMore: false   // 无论成功失败都要复位，否则底部会一直显示“正在加载…”
        });
        wx.pageScrollTo({ scrollTop: 0, duration: replace ? 120 : 0 });
        if (done) done();
      })
      .catch(() => {
        this.setData({ firstLoading: false, loadingMore: false });
        if (onError) onError();
        if (done) done();
      });
  },

  /* ---------- id 传参跳转详情页 ---------- */
  goDetail(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: "/pages/room-detail/room-detail?id=" + id });
  }
});
