/**
 * apis/_query.js —— GET 查询串拼接小工具
 */
function qs(obj) {
  const parts = [];
  Object.keys(obj || {}).forEach(function (k) {
    const v = obj[k];
    if (v === undefined || v === null || v === "") return;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  });
  return parts.length ? "?" + parts.join("&") : "";
}

module.exports = { qs };
