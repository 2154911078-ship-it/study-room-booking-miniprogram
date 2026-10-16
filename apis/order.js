/**
 * apis/order.js —— 预约下单 / 列表 / 详情 / 取消 / 删除
 */
const { request } = require("../utils/request");
const { qs } = require("./_query");

/** 创建预约 */
function create(data) {
  return request({ url: "/orders", method: "POST", data: data });
}

/** 我的预约列表 @param {string} status all|pending|using|done|canceled */
function list(status) {
  return request({ url: "/orders" + qs({ status: status }) });
}

/** 订单详情 */
function detail(id) {
  return request({ url: "/orders/" + encodeURIComponent(id) });
}

/** 取消预约（仅待使用状态） */
function cancel(id) {
  return request({ url: "/orders/" + encodeURIComponent(id) + "/cancel", method: "PUT" });
}

/** 删除记录（仅已完成/已取消） */
function remove(id) {
  return request({ url: "/orders/" + encodeURIComponent(id), method: "DELETE" });
}

module.exports = { create, list, detail, cancel, remove };
