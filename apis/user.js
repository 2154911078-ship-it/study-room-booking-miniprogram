/**
 * apis/user.js —— 登录 / 用户信息
 */
const { request } = require("../utils/request");

/** 学号密码登录（错误由登录页内联展示，故 silent） */
function login(studentId, password) {
  return request({
    url: "/user/login",
    method: "POST",
    auth: false,
    silent: true,
    data: { studentId: studentId, password: password }
  });
}

/** 自助开户（注册）：学号即账号，成功后直接返回 token，实现「注册即登录」 */
function register(data) {
  return request({
    url: "/user/register",
    method: "POST",
    auth: false,
    silent: true,
    data: data
  });
}

/**
 * 微信一键登录（免密）：{ wxKey, ticket?, code? }
 * 服务端票据优先命中、wxKey 兜底；未绑定返回 { bound:false }（不报错，由调用方引导去密码登录）
 */
function wxLogin(data) {
  return request({
    url: "/user/wxlogin",
    method: "POST",
    auth: false,
    silent: true,
    data: data
  });
}

/** 绑定本机微信以开启一键登录（需已登录会话；登录 / 开户成功后自动调用），返回 { ticket } */
function wxBind(data) {
  return request({
    url: "/user/wxbind",
    method: "POST",
    silent: true,
    data: data
  });
}

/** 本人解除微信绑定（解绑后需重新用学号密码登录才能再次开启） */
function wxUnbind() {
  return request({
    url: "/user/wxunbind",
    method: "POST",
    silent: true,
    data: {}
  });
}

/** 个人中心资料 + 统计 */
function profile() {
  return request({ url: "/user/profile" });
}

module.exports = { login, register, wxLogin, wxBind, wxUnbind, profile };
