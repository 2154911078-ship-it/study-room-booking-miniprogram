/**
 * server/print.js —— 预约名单打印页（服务端渲染 HTML）
 *
 * 后端根据与管理台列表相同的筛选条件查询数据，渲染一张 A4 横向的打印友好页面：
 *   · 表头信息：标题、筛选条件、导出时间、统计摘要
 *   · 明细表格：打印时每页重复表头、行不被跨页截断
 *   · 页面自带「打印」按钮，并在加载后自动唤起打印对话框
 */

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUS_TEXT = {
  pending: "待使用",
  using: "使用中",
  done: "已完成",
  canceled: "已取消"
};

/**
 * 渲染打印页
 * @param {object} result admin.exportOrders() 的返回值
 * @param {object} meta { operator, filterText }
 * @returns {string} HTML
 */
function render(result, meta) {
  const m = meta || {};
  const list = result.list || [];
  const s = result.summary || {};

  const rows = list.map(function (o, i) {
    const checkin = o.checkedIn
      ? '<span class="ok">已核销</span><br><span class="sub">' + esc(o.checkedInAtText || "") +
        (o.checkedInByName ? " · " + esc(o.checkedInByName) : "") + "</span>"
      : '<span class="warn">未核销</span>';
    return "<tr>" +
      "<td class='c'>" + (i + 1) + "</td>" +
      "<td class='code'>" + esc(o.checkinCode) + "</td>" +
      "<td class='mono'>" + esc(o.id) + "</td>" +
      "<td>" + esc(o.userId) + "</td>" +
      "<td>" + esc(o.nickname) + "</td>" +
      "<td>" + esc(o.college) + "</td>" +
      "<td>" + esc(o.roomName) + "</td>" +
      "<td class='c'>" + esc(o.seatNo) + "</td>" +
      "<td class='c'>" + esc(o.date) + "</td>" +
      "<td class='c'>" + esc(o.startSlot) + "-" + esc(o.endSlot) + "</td>" +
      "<td class='c'>" + esc(o.hours) + "</td>" +
      "<td class='c'>" + esc(STATUS_TEXT[o.status] || o.status) + "</td>" +
      "<td class='c'>" + checkin + "</td>" +
      "<td>" + esc(o.remark) + "</td>" +
      "</tr>";
  }).join("\n");

  const emptyRow = "<tr><td colspan='14' class='empty'>本次筛选条件下没有预约记录</td></tr>";

  return "<!DOCTYPE html>\n" +
"<html lang=\"zh-CN\">\n" +
"<head>\n" +
"<meta charset=\"utf-8\">\n" +
"<title>预约名单打印 · 慧自习</title>\n" +
"<style>\n" +
"  * { box-sizing: border-box; }\n" +
"  body { font-family: \"Microsoft YaHei\", \"PingFang SC\", Arial, sans-serif; color: #1F2937; margin: 24px; background: #fff; }\n" +
"  h1 { font-size: 20px; margin: 0 0 6px; text-align: center; letter-spacing: 2px; }\n" +
"  .brand { text-align: center; color: #2F5BFF; font-size: 12px; margin-bottom: 14px; }\n" +
"  .meta { display: flex; flex-wrap: wrap; gap: 6px 28px; font-size: 12px; color: #4B5563; margin-bottom: 10px; }\n" +
"  .meta b { color: #111827; }\n" +
"  .summary { border: 1px solid #D0D5E2; border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; background: #F8FAFF; }\n" +
"  .summary span { margin-right: 18px; white-space: nowrap; }\n" +
"  .summary i { font-style: normal; font-weight: 700; color: #2F5BFF; }\n" +
"  table { width: 100%; border-collapse: collapse; font-size: 11px; }\n" +
"  th, td { border: 1px solid #C9D0DE; padding: 4px 5px; vertical-align: middle; }\n" +
"  thead th { background: #EEF2FF; font-weight: 700; text-align: center; }\n" +
"  tbody tr:nth-child(even) { background: #FAFBFF; }\n" +
"  .c { text-align: center; }\n" +
"  .code { font-family: Consolas, \"Courier New\", monospace; font-weight: 700; letter-spacing: 1px; text-align: center; }\n" +
"  .mono { font-family: Consolas, \"Courier New\", monospace; }\n" +
"  .ok { color: #16A34A; font-weight: 700; }\n" +
"  .warn { color: #D97706; font-weight: 700; }\n" +
"  .sub { color: #6B7280; font-size: 10px; }\n" +
"  .empty { text-align: center; color: #8A93A6; padding: 22px; }\n" +
"  .sign { margin-top: 26px; display: flex; justify-content: space-between; font-size: 12px; color: #4B5563; }\n" +
"  .sign span { border-bottom: 1px solid #9CA3AF; min-width: 180px; display: inline-block; }\n" +
"  .toolbar { margin-bottom: 14px; text-align: right; }\n" +
"  .toolbar button { font-size: 13px; padding: 7px 16px; margin-left: 8px; border-radius: 6px; cursor: pointer;\n" +
"    border: 1px solid #2F5BFF; background: #2F5BFF; color: #fff; }\n" +
"  .toolbar button.ghost { background: #fff; color: #2F5BFF; }\n" +
"  @page { size: A4 landscape; margin: 10mm; }\n" +
"  @media print {\n" +
"    body { margin: 0; }\n" +
"    .toolbar { display: none; }\n" +
"    thead { display: table-header-group; }\n" +
"    tr { page-break-inside: avoid; }\n" +
"    .summary { background: #fff; }\n" +
"  }\n" +
"</style>\n" +
"</head>\n" +
"<body>\n" +
"  <div class=\"toolbar\">\n" +
"    <button onclick=\"window.print()\">打印 / 另存为 PDF</button>\n" +
"    <button class=\"ghost\" onclick=\"window.close()\">关闭</button>\n" +
"  </div>\n" +
"  <h1>慧自习 · 预约名单</h1>\n" +
"  <div class=\"brand\">校园自习室预约管理 · 线下核销用表</div>\n" +
"  <div class=\"meta\">\n" +
"    <div>筛选条件：<b>" + esc(m.filterText || "全部预约") + "</b></div>\n" +
"    <div>记录条数：<b>" + esc(result.total || 0) + "</b></div>\n" +
"    <div>导出时间：<b>" + esc(m.nowText || "") + "</b></div>\n" +
"    <div>操作管理员：<b>" + esc(m.operator || "管理员") + "</b></div>\n" +
"  </div>\n" +
"  <div class=\"summary\">\n" +
"    <span>待使用 <i>" + (s.pending || 0) + "</i></span>\n" +
"    <span>使用中 <i>" + (s.using || 0) + "</i></span>\n" +
"    <span>已完成 <i>" + (s.done || 0) + "</i></span>\n" +
"    <span>已取消 <i>" + (s.canceled || 0) + "</i></span>\n" +
"    <span>已核销 <i>" + (s.checkedIn || 0) + "</i></span>\n" +
"    <span>未核销 <i>" + (s.notCheckedIn || 0) + "</i></span>\n" +
"    <span>总时长(小时) <i>" + (s.hours || 0) + "</i></span>\n" +
"  </div>\n" +
"  <table>\n" +
"    <thead>\n" +
"      <tr>\n" +
"        <th style=\"width:34px\">序号</th>\n" +
"        <th style=\"width:76px\">核销码</th>\n" +
"        <th style=\"width:120px\">订单号</th>\n" +
"        <th style=\"width:70px\">学号</th>\n" +
"        <th style=\"width:60px\">姓名</th>\n" +
"        <th style=\"width:90px\">学院</th>\n" +
"        <th>自习室</th>\n" +
"        <th style=\"width:56px\">座位</th>\n" +
"        <th style=\"width:76px\">预约日期</th>\n" +
"        <th style=\"width:86px\">时段</th>\n" +
"        <th style=\"width:40px\">时长</th>\n" +
"        <th style=\"width:56px\">状态</th>\n" +
"        <th style=\"width:86px\">核销</th>\n" +
"        <th style=\"width:90px\">备注</th>\n" +
"      </tr>\n" +
"    </thead>\n" +
"    <tbody>\n" + (rows || emptyRow) + "\n    </tbody>\n" +
"  </table>\n" +
"  <div class=\"sign\">\n" +
"    <div>值班管理员签字：<span></span></div>\n" +
"    <div>场馆盖章：<span></span></div>\n" +
"    <div>日期：<span></span></div>\n" +
"  </div>\n" +
"  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>\n" +
"</body>\n" +
"</html>";
}

module.exports = { render, esc };
