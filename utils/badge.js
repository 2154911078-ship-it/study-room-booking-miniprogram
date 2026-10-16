/**
 * utils/badge.js —— “我的”Tab 未读消息角标统一管理
 */
const MY_TAB_INDEX = 3; // 与 app.json tabBar 顺序保持一致
let lastCount = -1;

/**
 * 设置/移除未读角标；数量不变时跳过，避免频繁调用原生接口
 * @param {number} count 未读消息数
 */
function set(count) {
  count = Math.max(0, parseInt(count, 10) || 0);
  if (count === lastCount) return;
  lastCount = count;
  try {
    if (count > 0) {
      wx.setTabBarBadge({
        index: MY_TAB_INDEX,
        text: count > 99 ? "99+" : String(count)
      });
    } else {
      wx.removeTabBarBadge({ index: MY_TAB_INDEX });
    }
  } catch (e) {
    // 非 tabBar 页面调用会失败，忽略即可
  }
}

module.exports = { set };
