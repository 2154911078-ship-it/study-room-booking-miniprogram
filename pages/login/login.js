/**
 * pages/login —— 登录 / 自助开户（同一页切换）
 * 交互：一键获取微信信息（首次弹窗「首次登录需要绑定相关信息」，绑定学号后自动跳自助开户，开户即登录）、
 *       微信一键登录（免密）、表单校验、密码显隐、协议勾选、注册即登录、登录后回跳
 */
const userApi = require("../../apis/user");
const auth = require("../../utils/auth");
const validate = require("../../utils/validate");
const config = require("../../utils/config");

Page({
  data: {
    mode: "login", // login | register（自助开户）
    studentId: "",
    password: "",
    password2: "", // 注册：确认密码
    nickname: "", // 注册：昵称（选填，留空由服务端按学号生成）
    colleges: config.COLLEGE_OPTIONS, // 注册：学院选项
    collegeIndex: -1,
    agreed: false,
    showPwd: false,
    submitting: false,
    focusId: false,
    focusPwd: false,
    errors: {}, // { studentId, password, password2, nickname, college, agreed }
    redirect: "",
    wxAvatar: "", // 已获取的微信头像（落盘后的本地路径）
    supportAvatar: true, // 当前基础库是否支持 open-type="chooseAvatar"
    wxQuick: false, // 本机有免密票据 → 登录按钮下方改为「微信一键登录」
    wxQuickId: ""   // 已绑定的学号（仅用于提示文案）
  },

  onLoad(options) {
    this.alive = true;
    // onLoad 接收 redirect 参数，登录后返回来源页面
    this.setData({ redirect: options.redirect || "" });
    // 能力探测：老基础库不支持 chooseAvatar，按钮改走提示分支
    this.setData({
      supportAvatar: !!(wx.canIUse && wx.canIUse("button.open-type.chooseAvatar"))
    });
    // 提前生成并留存本机微信标识，保证"首次绑定"和"后续一键登录"用的是同一个 key
    auth.getWxKey();
    this.refreshWxQuick();
  },

  onShow() {
    // 个人中心可能刚解除过绑定，回到登录页要重新判断能否免密
    this.refreshWxQuick();
  },

  onUnload() {
    this.alive = false;
  },

  /** 异步回调回来时页面可能已被 redirect 卸载，setData 前判一次存活 */
  setPageData(patch) {
    if (this.alive === false) return;
    this.setData(patch);
  },

  /* ---------- 登录 / 开户切换 ---------- */
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    // 切换时清空校验提示与密码，避免把登录态的错误文案带到开户态
    this.setData({
      mode: mode,
      errors: {},
      password: "",
      password2: "",
      submitting: false
    });
  },

  /* ---------- 输入与校验 ---------- */
  onInputStudentId(e) {
    this.setData({ "studentId": e.detail.value, "errors.studentId": "" });
  },
  onInputPassword(e) {
    this.setData({ password: e.detail.value, "errors.password": "" });
  },
  onInputPassword2(e) {
    this.setData({ password2: e.detail.value, "errors.password2": "" });
  },
  onInputNickname(e) {
    this.setData({ nickname: e.detail.value, "errors.nickname": "" });
  },
  onCollegeChange(e) {
    this.setData({ collegeIndex: Number(e.detail.value), "errors.college": "" });
  },
  onFocusId() {
    this.setData({ focusId: true });
  },
  onBlurId() {
    this.setData({ focusId: false });
    const msg = validate.studentId(this.data.studentId);
    if (msg) this.setData({ "errors.studentId": msg });
  },
  onFocusPwd() {
    this.setData({ focusPwd: true });
  },
  onBlurPwd() {
    this.setData({ focusPwd: false });
    const msg = validate.password(this.data.password);
    if (msg) this.setData({ "errors.password": msg });
  },
  onBlurPwd2() {
    const msg = validate.confirm(this.data.password, this.data.password2);
    if (msg) this.setData({ "errors.password2": msg });
  },

  togglePwd() {
    this.setData({ showPwd: !this.data.showPwd });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed, "errors.agreed": "" });
  },

  openRule() {
    wx.showModal({
      title: "自习公约",
      content:
        "1. 按时到馆签到，超时 30 分钟预约自动释放；\n2. 室内保持静音，接打电话请移步走廊；\n3. 离馆带走个人物品与垃圾；\n4. 恶意占座、频繁爽约将扣减信用分。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  fillDemo() {
    this.setData({
      mode: "login",
      studentId: "20210101",
      password: "123456",
      agreed: true,
      errors: {}
    });
  },

  /* ---------- 一键获取微信信息（首次需绑定相关信息 → 自动跳自助开户） ---------- */
  /**
   * 头像取自官方「头像昵称填写能力」：<button open-type="chooseAvatar">，
   * 由用户主动点选后回调 avatarUrl（wx.getUserProfile 已废弃，只会返回匿名资料）。
   * 微信资料只是补充，账号主体仍是学号：首次使用弹窗提示「首次登录需要绑定相关信息」，
   * 输入学号后自动切到「自助开户」，补全密码/学院等信息提交，开户成功即直接登录。
   */
  onChooseAvatar(e) {
    const temp = e.detail && e.detail.avatarUrl;
    if (!temp) {
      wx.showToast({ title: "未选择头像", icon: "none" });
      return;
    }
    this.persistAvatar(temp);
  },

  /** 回调给的是临时路径，冷启动后会失效，故另存到用户数据目录 */
  persistAvatar(temp) {
    const fsm = wx.getFileSystemManager ? wx.getFileSystemManager() : null;
    if (!fsm || !wx.env || !wx.env.USER_DATA_PATH) {
      this.afterAvatarGot(temp); // 环境不支持落盘时，本次会话内直接用临时路径
      return;
    }
    const dest = wx.env.USER_DATA_PATH + "/hzx_wx_avatar.png";
    fsm.saveFile({
      tempFilePath: temp,
      filePath: dest,
      success: (r) => this.afterAvatarGot((r && r.savedFilePath) || dest),
      fail: () => this.afterAvatarGot(temp)
    });
  },

  /** 拿到微信资料后分两种情况：本机绑过学号就带出并继续开户，首次使用弹窗绑定 */
  afterAvatarGot(avatar) {
    this.setData({ wxAvatar: avatar });
    const bind = auth.getWxBind();
    if (bind.studentId) {
      // 绑过学号却还在走这个按钮 = 没有免密票据（上次开户没走完 / 票据被清）：
      // 带出学号继续跳自助开户；若学号其实已开户，提交时会被服务端拦下并自动切回登录态
      this.gotoRegister(bind.studentId);
      wx.showToast({ title: "已绑定学号，请完善开户信息", icon: "none" });
      return;
    }
    this.bindStudentId(avatar);
  },

  /** 首次绑定：弹窗「首次登录需要绑定相关信息」，输入学号后跳到自助开户补全信息 */
  bindStudentId(avatar) {
    wx.showModal({
      title: "首次登录需要绑定相关信息",
      editable: true,
      placeholderText: "请输入 8-12 位学号",
      confirmText: "去开户",
      success: (r) => {
        if (!r.confirm) {
          wx.showToast({ title: "未绑定，可用学号密码登录", icon: "none" });
          return;
        }
        const sid = String(r.content || "").trim();
        const bad = validate.studentId(sid); // 复用公共校验：8-12 位数字
        if (bad) {
          wx.showToast({ title: bad, icon: "none" });
          return;
        }
        if (auth.isWxStudentBound(sid)) {
          wx.showToast({ title: "该学号已绑定过，请换一个", icon: "none" });
          return;
        }
        auth.saveWxBind({ studentId: sid, avatar: avatar, boundAt: Date.now() });
        // 绑定完学号直接切到「自助开户」：学号已带入，补全信息提交即注册并直接登录
        this.gotoRegister(sid);
        wx.showToast({ title: "绑定成功，请完善开户信息", icon: "none", duration: 1800 });
      },
      fail: () => {
        wx.showToast({ title: "当前微信版本不支持，请直接用学号登录", icon: "none" });
      }
    });
  },

  /** 切到「自助开户」并带入学号（微信一键获取信息绑定学号后调用），清空密码与旧错误提示 */
  gotoRegister(sid) {
    this.setData({
      mode: "register",
      studentId: sid,
      password: "",
      password2: "",
      errors: {}
    });
  },

  /** 老基础库降级入口：不弹授权，只提示 */
  onWxUnsupported() {
    wx.showToast({ title: "微信版本过低，请升级后使用", icon: "none" });
  },

  /* ---------- 微信一键登录（免密，需先绑定过学号） ---------- */
  /** 本机手里有票据就显示「微信一键登录」；票据是否仍有效由服务端在点击时判定 */
  refreshWxQuick() {
    const bind = auth.getWxBind();
    const quick = auth.canWxQuickLogin();
    this.setData({
      wxQuick: quick,
      wxQuickId: quick ? bind.studentId || "" : ""
    });
  },

  /**
   * 发起一次一键登录请求：每次单独取 wx.login 的 code（code 是一次性的，不能复用），
   * 后端配了 AppSecret 才会用它换真 openid，否则用 wxKey/ticket
   */
  wxLoginOnce(extra) {
    const payload = { wxKey: auth.getWxKey(), ticket: auth.getWxTicket() };
    Object.keys(extra || {}).forEach((k) => {
      payload[k] = extra[k];
    });
    return auth.getWxCode().then((code) => {
      if (code) payload.code = code;
      return userApi.wxLogin(payload);
    });
  },

  /**
   * 点「微信一键登录」：先问服务端"这个微信绑的是谁"，弹窗确认学号/姓名/学院后才真正换 token。
   * 共用手机上不会一点就登进别人账号；未绑定则回落到学号密码登录。
   */
  onQuickLogin() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: "正在识别…", mask: true });

    this.wxLoginOnce()
      .then((res) => {
        wx.hideLoading();
        if (!res || !res.bound) return this.afterWxUnbound();

        const u = res.user || {};
        wx.showModal({
          title: "确认登录身份",
          content:
            "学号：" + (u.studentId || "-") +
            "\n姓名：" + (u.nickname || "-") +
            "\n学院：" + (u.college || "-"),
          confirmText: "确认登录",
          cancelText: "不是我",
          success: (r) => {
            if (!r.confirm) return this.cancelQuickLogin();
            this.confirmQuickLogin();
          },
          // showModal 自身失败（极老版本）时不放行登录，退回手动输入
          fail: () => this.cancelQuickLogin()
        });
      })
      .catch((err) => this.failQuickLogin(err));
  },

  /** 确认后换会话 token（第二段握手，服务端此刻才滚动票据） */
  confirmQuickLogin() {
    wx.showLoading({ title: "登录中…", mask: true });
    this.wxLoginOnce({ confirm: true })
      .then((res) => {
        wx.hideLoading();
        if (!res || !res.bound) {
          this.setPageData({ submitting: false });
          return this.afterWxUnbound();
        }
        auth.saveWxTicket(res.ticket); // 服务端每次滚动重发票据，旧票作废
        auth.saveSession(res.token, res.user);
        this.refreshWxBind(res.user.studentId);
        this.setPageData({ submitting: false });
        wx.showToast({ title: "登录成功", icon: "success", duration: 900 });
        auth.redirectAfterLogin(this.data.redirect);
      })
      .catch((err) => this.failQuickLogin(err));
  },

  /** 点了「不是我」：什么都不写，留在登录页让用户自己输学号密码 */
  cancelQuickLogin() {
    this.setPageData({ submitting: false });
    wx.showToast({ title: "已取消，可用学号密码登录", icon: "none", duration: 2000 });
  },

  /** 服务端不认识本机（管理台解绑 / 清库重播）：丢掉票据回到密码登录 */
  afterWxUnbound() {
    auth.clearWxTicket();
    this.setPageData({ submitting: false });
    this.refreshWxQuick();
    wx.showToast({ title: "微信未绑定或已解绑，请用学号登录", icon: "none", duration: 2200 });
  },

  failQuickLogin(err) {
    wx.hideLoading();
    this.setPageData({
      submitting: false,
      "errors.password": (err && err.message) || "微信登录失败，请用学号密码登录"
    });
  },

  /**
   * 密码登录 / 自助开户成功后，自动把本机微信与该学号绑定，
   * 下次进登录页就能点「微信一键登录」免密进入。
   * 绑定失败不影响本次已完成的登录（例如该微信已绑在其他学号上）。
   */
  autoBindWx(sid) {
    const payload = { wxKey: auth.getWxKey() };
    auth
      .getWxCode()
      .then((code) => {
        if (code) payload.code = code;
        return userApi.wxBind(payload);
      })
      .then((res) => {
        auth.saveWxTicket(res.ticket);
        this.setPageData({ wxQuick: true, wxQuickId: sid });
        wx.showToast({ title: "已开启微信一键登录", icon: "none", duration: 1600 });
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || "未能开启微信一键登录", icon: "none", duration: 2000 });
      });
  },

  /* ---------- 提交 ---------- */
  onSubmit() {
    if (this.data.submitting) return;
    if (this.data.mode === "register") return this.onRegister();

    const errors = {};
    errors.studentId = validate.studentId(this.data.studentId);
    errors.password = validate.password(this.data.password);
    errors.agreed = validate.agreed(this.data.agreed);
    if (errors.studentId || errors.password || errors.agreed) {
      this.setData({ errors });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在登录…", mask: true });

    const sid = this.data.studentId.trim();
    userApi
      .login(sid, this.data.password)
      .then((res) => {
        wx.hideLoading();
        auth.saveSession(res.token, res.user);
        // 登录成功才让微信绑定生效：把头像与这个已通过校验的学号关联起来
        this.refreshWxBind(sid);
        // 顺带开启免密：本机微信 ↔ 该学号写入服务端，下次可一键登录
        this.autoBindWx(sid);
        this.setData({ submitting: false });
        wx.showToast({ title: "登录成功", icon: "success", duration: 900 });
        auth.redirectAfterLogin(this.data.redirect);
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({
          submitting: false,
          "errors.password": (err && err.message) || "登录失败，请重试"
        });
      });
  },

  /** 自助开户：校验四项 → 提交注册 → 后端直接下发 token（注册即登录） */
  onRegister() {
    const d = this.data;
    const errors = {};
    errors.studentId = validate.studentId(d.studentId);
    errors.password = validate.password(d.password);
    errors.password2 = validate.confirm(d.password, d.password2);
    errors.college = validate.college(d.colleges[d.collegeIndex]);
    errors.nickname = validate.nickname(d.nickname);
    errors.agreed = validate.agreed(d.agreed);
    if (errors.studentId || errors.password || errors.password2 || errors.college ||
        errors.nickname || errors.agreed) {
      this.setData({ errors });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在开户…", mask: true });

    const sid = d.studentId.trim();
    userApi
      .register({
        studentId: sid,
        password: d.password,
        nickname: d.nickname.trim(),
        college: d.colleges[d.collegeIndex]
      })
      .then((res) => {
        wx.hideLoading();
        auth.saveSession(res.token, res.user);
        this.refreshWxBind(sid);
        // 自助开户即绑定：新账号也直接获得微信一键登录能力
        this.autoBindWx(sid);
        this.setData({
          submitting: false,
          mode: "login",
          password: "",
          password2: "",
          nickname: "",
          collegeIndex: -1
        });
        wx.showToast({ title: "开户成功，已登录", icon: "none", duration: 1200 });
        auth.redirectAfterLogin(this.data.redirect);
      })
      .catch((err) => {
        wx.hideLoading();
        const msg = (err && err.message) || "开户失败，请重试";
        // 学号其实已开过户（老用户误走开户 / 绑定后中断过）：自动切回登录态，补个密码就能进
        if (msg.indexOf("已开户") >= 0) {
          this.setData({
            submitting: false,
            mode: "login",
            password: "",
            password2: "",
            errors: { studentId: "该学号已开户，请直接输入密码登录" }
          });
          return;
        }
        this.setData({
          submitting: false,
          // 学号重复等业务错误回填到学号下方，与登录错误的提示位置保持一致
          "errors.studentId": msg
        });
      });
  },

  /** 微信资料与学号的绑定：本机没绑过、或绑的就是这个学号时才写入，不覆盖其他学号的绑定 */
  refreshWxBind(sid) {
    const avatar = this.data.wxAvatar;
    if (!avatar) return;
    const bind = auth.getWxBind();
    if (bind.studentId && bind.studentId !== sid) return;
    auth.saveWxBind({ studentId: sid, avatar: avatar, boundAt: Date.now() });
  },

  backBrowse() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/index/index" });
    }
  }
});
