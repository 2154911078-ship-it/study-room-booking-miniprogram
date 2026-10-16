/**
 * server/init-db.js —— 数据库初始化 / 重置命令行工具
 *
 * 用法：
 *   node server/init-db.js            建库 + 执行 database/huizixi.sql（建表 + 数据，幂等）
 *   node server/init-db.js --reset     先删库再重建（清空全部数据后重新导入演示数据）
 *   node server/init-db.js --check     只做连通性与表结构检查（重放幂等脚本，不改动已有数据）
 *
 * 连接参数同样来自 server/config.js（默认 root/123456 @ 127.0.0.1:3306 / huizixi）
 * 库结构与数据全部在唯一脚本 server/database/huizixi.sql 中
 */
const db = require("./db");
const d = require("./data");
const { DB } = require("./config");

const args = process.argv.slice(2);
const RESET = args.indexOf("--reset") >= 0;
const CHECK_ONLY = args.indexOf("--check") >= 0;

function line() {
  console.log("------------------------------------------------");
}

(async function main() {
  console.log("慧自习 · MySQL 初始化工具");
  console.log("目标：" + DB.user + "@" + DB.host + ":" + DB.port + "  库：" + DB.database +
    (RESET ? "（--reset 将先删除该库）" : ""));

  try {
    if (CHECK_ONLY) {
      await db.init();
      const info = await db.health();
      line();
      console.log("连接正常 ✔  MySQL " + info.version + " / " + info.database);
      console.log("行数：users " + info.users + " · admins " + info.admins + " · rooms " + info.rooms +
        " · orders " + info.orders + " · messages " + info.messages +
        " · sessions " + info.sessions + " · 已核销 " + info.checkedIn);
      line();
      await db.close();
      return;
    }

    const info = await d.init({ reset: RESET });
    line();
    console.log((RESET ? "数据库已重建 ✔" : "数据库已就绪 ✔") + "  MySQL " + info.version + " / " + info.database);
    console.log("表行数：users " + info.users + " · admins " + info.admins + " · rooms " + info.rooms +
      " · orders " + info.orders + " · messages " + info.messages +
      " · sessions " + info.sessions + " · 已核销 " + info.checkedIn);
    console.log("SQL 脚本：server/database/huizixi.sql（建库 + 9 张表 + 数据）本次执行 " +
      info.sqlStatements + " 条语句，已有数据不受影响");
    if (info.addedColumns && info.addedColumns.length) {
      console.log("自动补齐缺失列：" + info.addedColumns.join(", "));
    }
    if (info.codesFilled) console.log("兜底补发核销码：" + info.codesFilled + " 个订单");

    const rooms = d.getRooms();
    const anns = d.getAnnouncements();
    const banners = d.getBanners();
    console.log("已载入缓存：自习室 " + rooms.length + " 间 · 公告 " + anns.length +
      " 条 · 轮播 " + banners.length + " 张");

    const tables = await db.query(
      "SELECT TABLE_NAME AS name, TABLE_ROWS AS rowsEst, ENGINE AS engine, TABLE_COLLATION AS coll " +
      "FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
      [DB.database]
    );
    line();
    console.log("表结构：");
    tables.forEach(function (t) {
      console.log("  · " + t.name.padEnd(16) + t.engine + "  " + t.coll + "  约 " + (t.rowsEst || 0) + " 行");
    });
    line();
    console.log("下一步：node server/server.js  然后浏览器打开 http://127.0.0.1:3000/");
    await db.close();
  } catch (err) {
    line();
    console.error(db.describeError(err));
    line();
    process.exitCode = 1;
    await db.close().catch(function () {});
  }
})();
