/**
 * apis/message.js —— 消息中心
 */
const { request } = require("../utils/request");
const { qs } = require("./_query");

/** 分页消息列表 */
function list(page, pageSize) {
  return request({ url: "/messages" + qs({ page: page, pageSize: pageSize }) });
}

/** 未读数量（用于 Tab 角标） */
function unreadCount() {
  return request({ url: "/messages/unread-count", silent: true });
}

/** 单条标记已读 */
function read(id) {
  return request({ url: "/messages/" + encodeURIComponent(id) + "/read", method: "PUT", silent: true });
}

/** 全部标记已读 */
function readAll() {
  return request({ url: "/messages/read-all", method: "PUT" });
}

module.exports = { list, unreadCount, read, readAll };
