/**
 * server/config.js —— 后端运行配置（数据库 / 端口）
 *
 * 默认连接本机 MySQL：root @ 127.0.0.1:3306，库名 huizixi。
 * 数据库密码不写进代码，通过环境变量 DB_PASSWORD 提供，例如：
 *   $env:DB_PASSWORD="你的密码"; node server/server.js
 *   $env:DB_HOST="192.168.1.10"; $env:DB_PORT="3307"; node server/server.js
 */

const DB = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "huizixi",

  // 连接池
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL || "10", 10),
  queueLimit: 0,
  // 与 Node 进程同一时区，保证 DATETIME 与时间戳互转精确
  timezone: "local"
};

module.exports = {
  DB: DB,
  HTTP_PORT: parseInt(process.env.PORT || "3000", 10),

  /**
   * 微信一键登录的凭证配置（可选，默认关闭）
   * - 留空：/user/wxlogin 走"前端本机 wxKey"路径（课程演示，拿不到 AppSecret 时唯一可行方案）
   * - 配置后：请求带 code 时优先调官方 jscode2session 换真 openid 作为微信标识，
   *   wxKey 自动退化为兜底，业务代码与接口契约不变
   *   $env:WX_APPID="wx….appid"; $env:WX_SECRET="….appsecret"; node server/server.js
   */
  WX: {
    appId: process.env.WX_APPID || "",
    appSecret: process.env.WX_SECRET || "",
    /** 是否已具备换真 openid 的条件 */
    enabled() {
      return !!(this.appId && this.appSecret);
    }
  }
};
