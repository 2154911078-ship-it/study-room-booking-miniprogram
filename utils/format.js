/**
 * utils/format.js —— 日期 / 时段 / 状态 等格式化工具
 */

const WEEKS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function toDateStr(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/** 今天 'YYYY-MM-DD' */
function todayStr() {
  return toDateStr(new Date());
}

/**
 * 生成未来 n 天可选日期（预约日期选择用）
 * @returns [{ full:'2025-09-01', md:'09-01', label:'今天' }, ...]
 */
function nextDays(n) {
  const list = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    let label;
    if (i === 0) label = "今天";
    else if (i === 1) label = "明天";
    else if (i === 2) label = "后天";
    else label = WEEKS[d.getDay()];
    list.push({ full: toDateStr(d), md: pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()), label });
  }
  return list;
}

/**
 * 根据自习室开放时间生成整点开始时段选项
 * @param {number} openFrom 开始营业整点（如 7 表示 07:00）
 * @param {number} openTo   闭店整点（如 22 表示 22:00）
 */
function slotStarts(openFrom, openTo) {
  const from = Math.max(openFrom, 7);
  const arr = [];
  for (let h = from; h <= openTo - 2; h++) arr.push(pad2(h) + ":00");
  return arr;
}

/** 以 startHour 为起点，生成可选择的结束时段（至少 1 小时） */
function slotEndsFrom(startHour, openTo) {
  const arr = [];
  for (let h = startHour + 1; h <= openTo; h++) arr.push(pad2(h) + ":00");
  return arr;
}

/** '09:00' -> 9 */
function hourOf(slot) {
  return parseInt(String(slot).split(":")[0], 10);
}

/** 订单状态 -> 展示文案与样式类 */
function statusMeta(status) {
  switch (status) {
    case "pending":
      return { text: "待使用", cls: "tag-warn" };
    case "using":
      return { text: "使用中", cls: "tag-success" };
    case "done":
      return { text: "已完成", cls: "tag-off" };
    case "canceled":
      return { text: "已取消", cls: "tag-off" };
    default:
      return { text: "未知", cls: "tag-off" };
  }
}

/**
 * 订单核销凭证状态（凭证页据此决定展示哪一块内容）
 *  - "usable"  待使用 / 使用中且未核销 → 出示核销码
 *  - "checked" 已核销 → 展示核销时间与操作人，核销码置灰
 *  - "invalid" 已取消 / 已完成且未核销 → 凭证不可用
 * @param {object} order 订单对象（含 status、checkedIn）
 */
function checkinState(order) {
  if (!order) return "invalid";
  if (order.checkedIn === true) return "checked";
  if (order.status === "pending" || order.status === "using") return "usable";
  return "invalid";
}

/** 8 位核销码 -> 每 4 位一组的易读格式（'48213079' -> '4821 3079'） */
function fmtCodeGroups(code) {
  const s = String(code || "").replace(/\s+/g, "");
  const groups = [];
  for (let i = 0; i < s.length; i += 4) groups.push(s.slice(i, i + 4));
  return groups.join(" ");
}

/** 时间戳 -> 'YYYY-MM-DD HH:mm' */
function fmtDateTime(ts) {
  const d = new Date(ts);
  return toDateStr(d) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/** 相对时间（消息列表用） */
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60e3) return "刚刚";
  if (diff < 3600e3) return Math.floor(diff / 60e3) + " 分钟前";
  if (diff < 24 * 3600e3) return Math.floor(diff / 3600e3) + " 小时前";
  if (diff < 3 * 24 * 3600e3) return Math.floor(diff / (24 * 3600e3)) + " 天前";
  return toDateStr(new Date(ts));
}

module.exports = {
  pad2,
  todayStr,
  toDateStr,
  nextDays,
  slotStarts,
  slotEndsFrom,
  hourOf,
  statusMeta,
  checkinState,
  fmtCodeGroups,
  fmtDateTime,
  timeAgo,
  WEEKS
};
