/**
 * utils/validate.js —— 表单校验规则（登录、预约共用）
 * 约定：校验通过返回空字符串，否则返回错误提示文案
 */

/** 学号：8-12 位数字 */
function studentId(v) {
  return /^\d{8,12}$/.test(String(v || "").trim()) ? "" : "学号应为 8-12 位数字";
}

/** 密码：至少 6 位 */
function password(v) {
  return String(v || "").length >= 6 ? "" : "密码至少 6 位";
}

/** 协议勾选 */
function agreed(ok) {
  return ok ? "" : "请先阅读并同意《自习公约》";
}

/** 确认密码：注册用，需与密码一致 */
function confirm(p1, p2) {
  if (!p2) return "请再次输入密码";
  return p1 === p2 ? "" : "两次输入的密码不一致";
}

/** 学院：注册时必选 */
function college(v) {
  return v ? "" : "请选择所在学院";
}

/** 昵称：选填，填了则 2-20 个字符（留空由服务端按学号生成） */
function nickname(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.length >= 2 && s.length <= 20 ? "" : "昵称需 2-20 个字符";
}

/** 预约时段：必须选择开始与结束，结束晚于开始，最长 6 小时 */
function slotRange(start, end) {
  if (!start) return "请选择开始时段";
  if (!end) return "请选择结束时段";
  if (end <= start) return "结束时段需晚于开始时段";
  if (parseInt(end, 10) - parseInt(start, 10) > 6) return "单次预约最长 6 小时";
  return "";
}

/** 自习室座位 */
function seat(no) {
  return no ? "" : "请点击平面图选择一个座位";
}

module.exports = { studentId, password, agreed, confirm, college, nickname, slotRange, seat };
