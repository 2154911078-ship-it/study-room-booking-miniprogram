/**
 * components/section-head —— 板块标题 + “查看更多”跳转入口（复用）
 */
Component({
  options: {
    styleIsolation: "apply-shared"
  },
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    moreText: { type: String, value: "" }
  },
  methods: {
    onMore() {
      this.triggerEvent("more");
    }
  }
});
