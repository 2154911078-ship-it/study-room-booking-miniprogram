/**
 * components/status-tag —— 订单状态标签（预约列表 / 订单详情复用）
 */
const fmt = require("../../utils/format");

Component({
  options: {
    styleIsolation: "apply-shared"
  },
  properties: {
    status: { type: String, value: "" }
  },
  data: {
    text: "",
    cls: "tag-off"
  },
  observers: {
    status: function (s) {
      const meta = fmt.statusMeta(s);
      this.setData({ text: meta.text, cls: meta.cls });
    }
  }
});
