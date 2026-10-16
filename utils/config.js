/**
 * utils/config.js —— 全局配置
 */

/* 后端地址切换说明（二选一，改完保存即生效）：
 * - 开发者工具「模拟器」演示：用 127.0.0.1（默认）
 * - 「真机调试 / 手机预览」：手机连与电脑同一网络（或本例的热点），
 *   改用电脑的局域网 IP，如 http://172.20.10.2:3000/api
 *   （IP 在电脑上看 ipconfig 的 IPv4 地址；若变动需同步修改）
 */
const BASE_URL = "http://127.0.0.1:3000/api"; // ← 模拟器用（默认）
// const BASE_URL = "http://172.20.10.2:3000/api"; // ← 真机调试用（本机当前 WLAN IP，按实际修改）

module.exports = {
  BASE_URL: BASE_URL,

  // 后端不可达时，自动降级为内置本地演示数据（保证课堂演示不中断）
  USE_LOCAL_FALLBACK: true,

  // 分页
  ROOM_PAGE_SIZE: 6,
  MSG_PAGE_SIZE: 10,

  // 本地缓存键
  TOKEN_KEY: "hzx_token",
  USER_KEY: "hzx_user",
  LOCALDB_KEY: "hzx_localdb_v1",
  WX_BIND_KEY: "hzx_wx_bind", // 微信资料与已绑定学号（含一键登录的滚动票据 ticket）
  WX_KEY_KEY: "hzx_wx_key",   // 本机微信标识：首次生成后长期不变，作为服务端 wx_key 的本地对应物

  // 自助开户（注册）时可选的学院，与数据库 users.college 取值保持一致
  COLLEGE_OPTIONS: ["计算机学院", "外国语学院", "机械工程学院", "经济管理学院", "数学与统计学院", "其他学院"]
};
