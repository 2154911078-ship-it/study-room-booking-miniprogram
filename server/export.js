/**
 * server/export.js —— 预约名单导出 Excel（exceljs 生成真正的 .xlsx）
 *
 * 两个工作表：
 *   1. 预约名单 —— 明细数据，表头加粗、冻结首行、自动筛选、列宽适配
 *   2. 统计汇总 —— 本次导出的筛选条件、各类状态数量、导出人与导出时间
 */
const ExcelJS = require("exceljs");

const STATUS_TEXT = {
  pending: "待使用",
  using: "使用中",
  done: "已完成",
  canceled: "已取消"
};

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5BFF" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const THIN = { style: "thin", color: { argb: "FFD0D5E2" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function fmtDateTime(ms) {
  if (ms === null || ms === undefined || ms === "") return "";
  const d = new Date(Number(ms));
  const p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes());
}

function stamp(ms) {
  const d = new Date(ms || Date.now());
  const p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
}

/** 导出文件名（含中文，供 Content-Disposition 使用） */
function buildFileName() {
  return "预约名单_" + stamp(Date.now()) + ".xlsx";
}

/**
 * 生成工作簿
 * @param {object} result admin.exportOrders() 的返回值 { list, summary, total, filters }
 * @param {object} [meta] { operator, roomName, filterText }
 */
async function buildWorkbook(result, meta) {
  const m = meta || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = "慧自习 · 校园自习室预约";
  wb.lastModifiedBy = m.operator || "管理员";
  wb.created = new Date();
  wb.modified = new Date();

  /* ---------- 工作表 1：预约名单 ---------- */
  const ws = wb.addWorksheet("预约名单", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 }
  });

  ws.columns = [
    { header: "核销码", key: "checkinCode", width: 12 },
    { header: "订单号", key: "id", width: 20 },
    { header: "学号", key: "userId", width: 12 },
    { header: "姓名", key: "nickname", width: 10 },
    { header: "学院", key: "college", width: 18 },
    { header: "自习室", key: "roomName", width: 26 },
    { header: "校区", key: "campus", width: 10 },
    { header: "楼栋", key: "building", width: 18 },
    { header: "座位", key: "seatNo", width: 10 },
    { header: "预约日期", key: "date", width: 13 },
    { header: "开始", key: "startSlot", width: 8 },
    { header: "结束", key: "endSlot", width: 8 },
    { header: "时长(小时)", key: "hours", width: 11 },
    { header: "状态", key: "statusText", width: 10 },
    { header: "核销状态", key: "checkinText", width: 11 },
    { header: "核销时间", key: "checkedInAtText", width: 18 },
    { header: "核销人", key: "checkedInByName", width: 12 },
    { header: "备注", key: "remark", width: 20 },
    { header: "下单时间", key: "createdText", width: 18 }
  ];

  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell(function (cell) {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = BORDER;
  });

  (result.list || []).forEach(function (o) {
    const row = ws.addRow({
      checkinCode: o.checkinCode || "",
      id: o.id,
      userId: o.userId,
      nickname: o.nickname || "",
      college: o.college || "",
      roomName: o.roomName || "",
      campus: o.campus || "",
      building: o.building || "",
      seatNo: o.seatNo,
      date: o.date,
      startSlot: o.startSlot,
      endSlot: o.endSlot,
      hours: o.hours,
      statusText: STATUS_TEXT[o.status] || o.status,
      checkinText: o.checkedIn ? "已核销" : "未核销",
      checkedInAtText: o.checkedIn ? fmtDateTime(o.checkedInAt) : "",
      checkedInByName: o.checkedInByName || "",
      remark: o.remark || "",
      createdText: fmtDateTime(o.createdAt)
    });
    row.eachCell(function (cell) {
      cell.border = BORDER;
      cell.alignment = { vertical: "middle" };
    });
    // 核销码用等宽、加粗，便于现场核对
    row.getCell("checkinCode").font = { bold: true, name: "Consolas" };
    if (!o.checkedIn) row.getCell("checkinText").font = { color: { argb: "FFD97706" } };
    else row.getCell("checkinText").font = { color: { argb: "FF16A34A" } };
  });

  if (!(result.list || []).length) {
    const row = ws.addRow(["本次筛选条件下没有预约记录"]);
    ws.mergeCells(row.number, 1, row.number, ws.columns.length);
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(1).font = { italic: true, color: { argb: "FF8A93A6" } };
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, ws.rowCount), column: ws.columns.length }
  };

  /* ---------- 工作表 2：统计汇总 ---------- */
  const ws2 = wb.addWorksheet("统计汇总");
  ws2.columns = [
    { header: "项目", key: "k", width: 22 },
    { header: "内容", key: "v", width: 46 }
  ];
  const h2 = ws2.getRow(1);
  h2.height = 22;
  h2.eachCell(function (cell) {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER;
  });

  const s = result.summary || {};
  const rows = [
    ["导出时间", fmtDateTime(Date.now())],
    ["导出人", m.operator || "管理员"],
    ["筛选条件", m.filterText || "全部预约"],
    ["记录条数", String(result.total || 0)],
    ["待使用", String(s.pending || 0)],
    ["使用中", String(s.using || 0)],
    ["已完成", String(s.done || 0)],
    ["已取消", String(s.canceled || 0)],
    ["已核销", String(s.checkedIn || 0)],
    ["未核销", String(s.notCheckedIn || 0)],
    ["预约总时长(小时)", String(s.hours || 0)],
    ["数据来源", "慧自习小程序 · MySQL 数据库"]
  ];
  rows.forEach(function (r) {
    const row = ws2.addRow({ k: r[0], v: r[1] });
    row.getCell("k").font = { bold: true };
    row.eachCell(function (cell) { cell.border = BORDER; });
  });

  return wb;
}

/** 直接产出 xlsx 二进制（供 HTTP 响应使用） */
async function buildBuffer(result, meta) {
  const wb = await buildWorkbook(result, meta);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = {
  buildWorkbook,
  buildBuffer,
  buildFileName,
  STATUS_TEXT,
  fmtDateTime
};
