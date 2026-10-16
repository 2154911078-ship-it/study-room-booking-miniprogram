/**
 * components/empty-tip —— 通用空态 / 错误态占位
 */
Component({
  options: {
    styleIsolation: "apply-shared"
  },
  properties: {
    text: { type: String, value: "暂无内容" },
    desc: { type: String, value: "" },
    btnText: { type: String, value: "" },
    icon: { type: String, value: "/images/empty.png" }
  },
  methods: {
    onAction() {
      this.triggerEvent("action");
    }
  }
});
