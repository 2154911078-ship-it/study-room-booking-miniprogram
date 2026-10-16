/**
 * server/db.js —— MySQL 连接池与建库建表（mysql2/promise）
 *
 * 职责边界：
 *   - 连接池创建与释放、通用查询/事务封装
 *   - 启动时按 server/config.js 建库，并执行唯一脚本 database/huizixi.sql（建表 + 数据）
 *   - 健康检查（供 /api/health 与管理台使用）
 * 业务查询都在 server/data.js，本文件不写业务逻辑。
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { DB } = require("./config");

const SQL_DIR = path.join(__dirname, "database");    // 数据库相关文件目录
const SQL_FILE = path.join(SQL_DIR, "huizixi.sql");  // 唯一的 SQL 文件：建库 + 9 张表 + 全部数据

// 程序内执行时要跳过的语句：库名由 server/config.js（DB_NAME 环境变量）决定，
// 且 USE 会把连接池里这条连接的当前库改掉，只对 mysql 客户端手动导入有意义
const SKIP_RE = /^\s*(CREATE\s+DATABASE|USE\s)/i;

let pool = null;

/* ---------------- 连接与初始化 ---------------- */

/**
 * 初始化数据库：确保库存在 → 建连接池 → 执行 database/huizixi.sql（建表 + 数据，幂等）
 * @param {object} [opts]
 * @param {boolean} [opts.reset] 为 true 时先 DROP DATABASE（谨慎，用于演示重置）
 * @returns {Promise<{pool:object, statements:number, addedColumns:string[]}>}
 *          statements 为本次执行的 SQL 语句条数；addedColumns 为老库自动补齐的列
 */
async function init(opts) {
  const reset = !!(opts && opts.reset);

  // 1) 先不带库名直连，保证目标库存在（避免"Unknown database"）
  const boot = await mysql.createConnection({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password: DB.password,
    charset: DB.charset
  });
  try {
    if (reset) {
      await boot.query("DROP DATABASE IF EXISTS `" + DB.database + "`");
    }
    await boot.query(
      "CREATE DATABASE IF NOT EXISTS `" + DB.database + "` " +
      "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
  } finally {
    await boot.end();
  }

  // 2) 建立连接池（业务查询全部走这里）
  //    同一进程重复 init() 时先关掉旧池，避免连接泄漏导致进程退不出去
  if (pool) {
    await pool.end().catch(function () {});
    pool = null;
  }
  pool = mysql.createPool({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password: DB.password,
    database: DB.database,
    charset: DB.charset,
    waitForConnections: DB.waitForConnections,
    connectionLimit: DB.connectionLimit,
    queueLimit: DB.queueLimit,
    timezone: DB.timezone,
    // 每个 DATETIME 读取都用显式 SQL 转换，这里不做隐式处理
    supportBigNumbers: true,
    bigNumberStrings: false
  });

  // 3) 老库补列：huizixi.sql 只建新表，已有表不会自动长出新列（如 rooms.cover_card）
  const addedColumns = await ensureColumns();

  // 4) 建表 + 写入数据（huizixi.sql 全程幂等，每次启动重放都不会产生重复数据）
  const statements = await runSqlFile(SQL_FILE);
  return { pool: pool, statements: statements, addedColumns: addedColumns };
}

/**
 * 老库补列：MySQL 8 没有 ADD COLUMN IF NOT EXISTS，所以先查 information_schema 再决定是否 ALTER。
 * 幂等：列已存在就跳过；表还不存在也跳过（huizixi.sql 会直接建出最新结构）。
 */
const ADD_COLUMNS = [
  { table: "rooms", column: "cover_card",
    ddl: "ALTER TABLE rooms ADD COLUMN cover_card VARCHAR(64) NOT NULL DEFAULT '' " +
         "COMMENT '首页热门卡片封面图（690x360）' AFTER cover" },
  { table: "orders", column: "checkin_code",
    ddl: "ALTER TABLE orders ADD COLUMN checkin_code CHAR(8) DEFAULT NULL " +
         "COMMENT '8 位数字核销码' AFTER created_at, ADD UNIQUE KEY uk_orders_checkin_code (checkin_code)" },
  { table: "orders", column: "checked_in_at",
    ddl: "ALTER TABLE orders ADD COLUMN checked_in_at DATETIME(3) DEFAULT NULL " +
         "COMMENT '核销时间（NULL=未核销）' AFTER checkin_code" },
  { table: "orders", column: "checked_in_by",
    ddl: "ALTER TABLE orders ADD COLUMN checked_in_by VARCHAR(32) DEFAULT NULL " +
         "COMMENT '核销操作的管理员账号' AFTER checked_in_at" },
  // 微信一键登录（users 三列 + 两个唯一键）：huizixi.sql 只对新库生效，老库靠这里补
  { table: "users", column: "wx_key",
    ddl: "ALTER TABLE users ADD COLUMN wx_key VARCHAR(64) DEFAULT NULL " +
         "COMMENT '微信一键登录：本机微信标识' AFTER credit, " +
         "ADD UNIQUE KEY uk_users_wx_key (wx_key)" },
  { table: "users", column: "wx_ticket",
    ddl: "ALTER TABLE users ADD COLUMN wx_ticket CHAR(32) DEFAULT NULL " +
         "COMMENT '微信一键登录：免密票据（滚动重发）' AFTER wx_key, " +
         "ADD UNIQUE KEY uk_users_wx_ticket (wx_ticket)" },
  { table: "users", column: "wx_bound_at",
    ddl: "ALTER TABLE users ADD COLUMN wx_bound_at DATETIME(3) DEFAULT NULL " +
         "COMMENT '微信绑定时间（NULL=未开启一键登录）' AFTER wx_ticket" }
];

async function ensureColumns() {
  const added = [];
  for (const c of ADD_COLUMNS) {
    const t = await query(
      "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1",
      [DB.database, c.table]
    );
    if (!t.length) continue;
    const col = await query(
      "SELECT 1 FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
      [DB.database, c.table, c.column]
    );
    if (col.length) continue;
    await exec(c.ddl);
    added.push(c.table + "." + c.column);
  }
  return added;
}

/** 读取 SQL 文件并切分为可执行语句 */
function statementsOf(sqlFile) {
  return splitStatements(fs.readFileSync(sqlFile, "utf8"));
}

/** 顺序执行一个 SQL 文件中的全部语句，返回实际执行条数（跳过 CREATE DATABASE / USE） */
async function runSqlFile(sqlFile) {
  const stmts = statementsOf(sqlFile).filter(function (s) { return !SKIP_RE.test(s); });
  for (const stmt of stmts) {
    await pool.query(stmt);
  }
  return stmts.length;
}

/** 去掉 SQL 注释并按分号切分语句 */
function splitStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* ---------------- 查询封装 ---------------- */

/** SELECT：返回行数组 */
async function query(sql, params) {
  const [rows] = await pool.query(sql, params || []);
  return rows;
}

/** INSERT/UPDATE/DELETE：返回 ResultSetHeader（含 affectedRows / insertId） */
async function exec(sql, params) {
  const [result] = await pool.query(sql, params || []);
  return result;
}

/** 在指定连接上查询（事务内部使用） */
async function queryOn(conn, sql, params) {
  const [rows] = await conn.query(sql, params || []);
  return rows;
}

/** 在指定连接上执行写操作（事务内部使用） */
async function execOn(conn, sql, params) {
  const [result] = await conn.query(sql, params || []);
  return result;
}

/**
 * 事务包装：fn 内所有操作共用同一连接，抛错自动回滚
 * @param {(conn:import('mysql2/promise').PoolConnection) => Promise<any>} fn
 */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try {
      await conn.rollback();
    } catch (ignore) {
      /* 回滚失败时保留原始异常 */
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** 健康检查：版本 / 库名 / 各表行数 */
async function health() {
  const rows = await query(
    "SELECT VERSION() AS version, DATABASE() AS `database`, " +
    "NOW(3) AS serverTime, " +
    "(SELECT COUNT(*) FROM users) AS users, " +
    "(SELECT COUNT(*) FROM rooms) AS rooms, " +
    "(SELECT COUNT(*) FROM orders) AS orders, " +
    "(SELECT COUNT(*) FROM messages) AS messages, " +
    "(SELECT COUNT(*) FROM sessions) AS sessions, " +
    "(SELECT COUNT(*) FROM admins) AS admins, " +
    "(SELECT COUNT(*) FROM orders WHERE checked_in_at IS NOT NULL) AS checkedIn, " +
    "(SELECT COUNT(*) FROM orders WHERE status <> 'canceled' AND checked_in_at IS NULL AND checkin_code IS NULL) AS missingCodes"
  );
  return rows[0];
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** 统一的连库失败提示（课堂上最常见的就是密码/服务没起） */
function describeError(err) {
  const code = err && err.code;
  const base = "MySQL 连接失败：" + ((err && err.message) || err);
  const hints = [];
  hints.push("目标 " + DB.user + "@" + DB.host + ":" + DB.port + "，库名 " + DB.database);
  if (code === "ER_ACCESS_DENIED_ERROR") {
    hints.push("账号或密码不正确：默认使用 root / 123456，可用环境变量 DB_USER / DB_PASSWORD 覆盖");
  } else if (code === "ECONNREFUSED") {
    hints.push("3306 端口没有服务在监听：请先启动 MySQL 服务（net start MySQL80）或用 mysqld 手动启动");
  } else if (code === "ER_BAD_DB_ERROR") {
    hints.push("数据库不存在：node server/init-db.js 会自动建库建表");
  } else {
    hints.push("请确认 MySQL 已启动、密码正确；必要时用 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 覆盖默认配置");
  }
  return base + "\n  · " + hints.join("\n  · ");
}

module.exports = {
  DB,
  SQL_DIR,
  SQL_FILE,
  init,
  query,
  exec,
  queryOn,
  execOn,
  tx,
  health,
  close,
  describeError,
  splitStatements,
  statementsOf,
  runSqlFile
};
