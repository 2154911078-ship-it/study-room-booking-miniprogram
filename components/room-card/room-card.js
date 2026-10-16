/**
 * components/room-card —— 自习室卡片（首页热门 & 列表页复用）
 */
const STATUS = {
  open: { text: "开放中", cls: "tag-success" },
  full: { text: "已约满", cls: "tag-warn" },
  maintenance: { text: "维护中", cls: "tag-off" }
};

Component({
  options: {
    // 允许 app/页面公共样式（.tag/.flex 等原子类）作用于组件
    styleIsolation: "apply-shared"
  },
  properties: {
    room: { type: Object, value: {} },
    // horizontal：左图右文（列表页）；vertical：上图下文（首页热门横滑区）
    layout: { type: String, value: "horizontal" }
  },
  data: {
    statusMeta: STATUS.open
  },
  observers: {
    room: function (room) {
      if (!room) return;
      this.setData({ statusMeta: STATUS[room.status] || STATUS.open });
    }
  },
  methods: {
    onTap() {
      // 向父级页面抛出 select 事件，由页面处理跳转（携带 id 参数）
      this.triggerEvent("select", { id: this.data.room.id });
    }
  }
});
