/**
 * apis/room.js —— 首页聚合 / 公告 / 自习室列表与详情
 */
const { request } = require("../utils/request");
const { qs } = require("./_query");

/** 首页数据聚合：开放自习室数、空闲座位、今日待用预约 */
function summary() {
  return request({ url: "/summary", auth: false });
}

/** 公告栏 + 首页轮播 */
function announcements() {
  return request({ url: "/announcements", auth: false });
}

/**
 * 自习室分页列表
 * @param {object} p { campus, keyword, page, pageSize, sort }
 *        
 */
function list(p) {
  return request({ url: "/rooms" + qs(p), auth: false });
}

/**
 * 自习室详情 + 指定日期时段的座位图
 * @param {string} id
 * @param {object} p { date, start, end }
 */
function detail(id, p) {
  return request({ url: "/rooms/" + encodeURIComponent(id) + qs(p), auth: false });
}

module.exports = { summary, announcements, list, detail };
