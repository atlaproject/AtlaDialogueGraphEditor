"use strict";
/* =====================================================
 * Google Drive 集成（纯前端，无后端）
 * - 登录：Google Identity Services Token Client（OAuth 2.0 隐式授权）
 * - 权限：drive.file（仅能访问本应用创建的 + 用户通过 Picker 选择的文件）
 * - 读写：Drive REST API v3 直接 fetch
 * Client ID / API Key 是公开标识，不是密钥；已在 Google
 * Console 按授权来源（域名）与 API 范围做了限制。
 * ===================================================== */
const GD_CLIENT_ID = "1019580829989-0kci7qs5q5fjm6kr2sjadkkfpcss3467.apps.googleusercontent.com";
const GD_API_KEY = "AIzaSyDabkoM2ZBZBKQRpIDixaCkSYNmV1RwNfM";
// openid/email/profile 用于右上角显示头像与账号（均为非敏感 scope）
const GD_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
const GD_PROJECT_NUMBER = GD_CLIENT_ID.split("-")[0];
const GD_CONNECTED_KEY = "dsu-graph-editor-gd";   // 登录过的标记：刷新页面后尝试静默恢复

let gdToken = null, gdTokenExp = 0, gdTokenClient = null;
let gdUser = null;                        // {name, email, picture}
// 分别记住 CSV / ATLADG 在 Drive 上的文件句柄，保存时覆盖原文件
let gdFiles = { csv: null, adg: null };   // {id, name, parent}

function gdConnected() { return !!gdToken; }
function gdClearFiles() { gdFiles.csv = null; gdFiles.adg = null; }

// 确保有有效 token（过期前 1 分钟内视为无效）；首次调用弹 Google 授权窗
// silent=true 时只尝试静默获取（页面加载恢复登录用），失败不打扰用户
function gdEnsureToken(cb, silent) {
  if (gdToken && Date.now() < gdTokenExp - 60000) return cb();
  if (!(window.google && google.accounts && google.accounts.oauth2)) { if (!silent) toast(t("gdLoading"), "warn"); return; }
  if (!gdTokenClient) {
    gdTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GD_CLIENT_ID, scope: GD_SCOPE,
      callback: () => {},
      error_callback: () => {}
    });
  }
  gdTokenClient.callback = (resp) => {
    if (resp.error) { if (!silent) toast(t("gdAuthFail", { msg: resp.error }), "err"); return; }
    gdToken = resp.access_token;
    gdTokenExp = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3600000);
    try { localStorage.setItem(GD_CONNECTED_KEY, "1"); } catch (e) {}
    gdFetchUser();
    cb();
  };
  gdTokenClient.error_callback = (err) => { if (!silent) toast(t("gdAuthFail", { msg: (err && err.type) || "popup" }), "err"); };
  // 已登录过 / 静默模式：尝试无感获取；否则走交互式授权
  gdTokenClient.requestAccessToken((gdToken || silent) ? { prompt: "" } : {});
}

function gdSignOut() {
  if (gdToken) { try { google.accounts.oauth2.revoke(gdToken, () => {}); } catch (e) {} }
  gdToken = null; gdTokenExp = 0; gdUser = null;
  gdClearFiles();
  try { localStorage.removeItem(GD_CONNECTED_KEY); } catch (e) {}
  gdRenderAccount();
  toast(t("gdSignedOut"));
}

/* ---------- 右上角账号区：登录按钮 / 头像 + 下拉菜单 ---------- */
async function gdFetchUser() {
  if (!gdUser && gdToken) {
    try {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + gdToken } });
      if (r.ok) gdUser = await r.json();
    } catch (e) {}
  }
  gdRenderAccount();
}

function gdRenderAccount() {
  const el = document.getElementById("gAccount");
  if (!el) return;
  el.innerHTML = "";
  if (!gdConnected()) {
    const b = document.createElement("button");
    b.id = "btnGSignIn";
    b.textContent = t("gdSignIn");
    b.onclick = () => gdEnsureToken(() => toast(t("gdSignedIn")));
    el.appendChild(b);
    return;
  }
  const hasPic = gdUser && gdUser.picture;
  const av = document.createElement(hasPic ? "img" : "span");
  av.className = "gAvatar";
  // Google 头像 URL 支持 =sNN-c 参数控制尺寸，请求 48px 的小图（2x 显示密度足够）
  if (hasPic) {
    av.src = gdUser.picture.replace(/=s\d+(-c)?$/, "=s48-c");
    av.width = 22; av.height = 22;   // 属性兜底：CSS 未加载时也不会撑大工具栏
    av.referrerPolicy = "no-referrer";
    av.onerror = () => { gdUser.picture = ""; gdRenderAccount(); };  // 加载失败退回首字母徽标
  }
  else av.textContent = ((gdUser && (gdUser.name || gdUser.email)) || "G")[0].toUpperCase();
  av.title = gdUser ? `${gdUser.name || ""}${gdUser.email ? " · " + gdUser.email : ""}`.trim() : "Google";
  av.onclick = () => {
    const r = av.getBoundingClientRect();
    const items = [];
    if (gdUser) items.push({ label: `${gdUser.name || ""}${gdUser.email ? " · " + gdUser.email : ""}`, dim: true }, "-");
    items.push({ label: t("gdSignOutItem"), danger: true, fn: gdSignOut });
    showCtxMenu(r.right - 180, r.bottom + 6, items);
  };
  el.appendChild(av);
}

// 页面加载：渲染账号区；之前登录过则尝试静默恢复
window.addEventListener("load", () => {
  gdRenderAccount();
  let flag = null;
  try { flag = localStorage.getItem(GD_CONNECTED_KEY); } catch (e) {}
  if (flag !== "1") return;
  let tries = 0;
  const tryRestore = () => {
    if (window.google && google.accounts && google.accounts.oauth2) gdEnsureToken(() => {}, true);
    else if (++tries < 20) setTimeout(tryRestore, 300);
  };
  tryRestore();
});
// 语言切换时刷新账号区文案
window.addEventListener("langchanged", gdRenderAccount);

/* ---------- 打开：Picker 选文件 → 下载 → 交给现有加载逻辑 ---------- */
function gdOpenFromDrive() {
  gdEnsureToken(() => {
    if (window.google && google.picker) return gdShowPicker();
    if (!window.gapi) { toast(t("gdLoading"), "warn"); return; }
    gapi.load("picker", gdShowPicker);
  });
}

function gdShowPicker() {
  const view = new google.picker.DocsView()
    .setIncludeFolders(true)
    .setMimeTypes("text/csv,application/json,application/octet-stream,text/plain");
  new google.picker.PickerBuilder()
    .enableFeature(google.picker.Feature.SUPPORT_DRIVES)   // 支持共享云端硬盘
    .setOAuthToken(gdToken)
    .setDeveloperKey(GD_API_KEY)
    .setAppId(GD_PROJECT_NUMBER)
    .addView(view)
    .setCallback((data) => {
      if (data.action !== google.picker.Action.PICKED) return;
      const doc = data.docs[0];
      gdDownload(doc.id, doc.name, doc.parentId || null);
    })
    .build()
    .setVisible(true);
}

// 从响应中提取 Google 返回的具体错误信息
async function gdApiError(resp) {
  let msg = "HTTP " + resp.status;
  try {
    const j = await resp.json();
    if (j.error && j.error.message) msg += " — " + j.error.message;
  } catch (e) {}
  console.warn("[gdrive] API error:", msg);
  return new Error(msg);
}

async function gdDownload(id, name, parent) {
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: "Bearer " + gdToken }
    });
    if (!r.ok) throw await gdApiError(r);
    const text = await r.text();
    gdClearFiles();
    if (/\.(atladg|adg)$/i.test(name)) {
      openAdgText(text, name);
      if (model) gdFiles.adg = { id, name, parent };
    } else {
      loadCsvText(text, name);
      if (model) { gdFiles.csv = { id, name, parent }; toast(t("gdOpenedFile", { f: name })); }
    }
  } catch (err) { toast(t("gdDownloadFail", { msg: err.message }), "err"); }
}

/* ---------- 保存：已从 Drive 打开则覆盖原文件，否则新建 ---------- */
function gdSaveToDrive(kind) {          // kind: "csv" | "adg"
  if (!model) { toast(t("openFirst"), "warn"); return; }
  const doSave = () => gdEnsureToken(() => gdUpload(kind));
  if (kind === "csv") {
    runValidation();
    const errs = conversations().flatMap(c => validateConv(c.id)).filter(v => v.level === "err");
    if (errs.length) { uiConfirm(t("exportWithErrors", { n: errs.length }), doSave, { okLabel: t("exportAnyway"), danger: true }); return; }
  }
  doSave();
}

// 覆盖已有文件；共享云端硬盘需要 supportsAllDrives=true，否则 API 一律返回 404
async function gdPatchFile(id, mime, content) {
  return fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true&fields=id,name`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + gdToken, "Content-Type": mime },
    body: content
  });
}
// 新建文件；parent 可为 null（进「我的云端硬盘」根目录）
async function gdCreateFile(name, mime, content, parent) {
  const meta = { name, mimeType: mime };
  if (parent) meta.parents = [parent];
  const boundary = "atla" + Date.now().toString(36);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n` + content + `\r\n--${boundary}--`;
  return fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents", {
    method: "POST",
    headers: { Authorization: "Bearer " + gdToken, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
}

async function gdUpload(kind) {
  try {
    let name, content, mime;
    const base = fileName.replace(/\.(csv|atladg|adg)$/i, "");
    if (kind === "csv") {
      name = base + ".csv";
      content = "﻿" + serializeDSUCsv(model);
      mime = "text/csv";
    } else {
      name = base + ".atladg";
      content = JSON.stringify({ format: ADG_FORMAT, version: 1, savedAt: Date.now(), fileName, csv: serializeDSUCsv(model), layout: projectLayoutSubset() });
      mime = "application/json";
    }
    const existing = gdFiles[kind];
    let notWritable = false;
    let resp = null;
    if (existing) {
      resp = await gdPatchFile(existing.id, mime, content);
      // 原文件不可写（只读共享 / 权限不足）：自动降级为另存新文件
      if (resp.status === 403 || resp.status === 404) { notWritable = true; resp = null; }
      else if (!resp.ok) throw await gdApiError(resp);
    }
    let createdNew = false;
    if (!resp) {
      createdNew = true;
      // 优先放到原文件所在文件夹；无权限时退回「我的云端硬盘」根目录
      const parent = existing ? existing.parent : (gdFiles.csv && gdFiles.csv.parent) || (gdFiles.adg && gdFiles.adg.parent) || null;
      if (parent) {
        resp = await gdCreateFile(name, mime, content, parent);
        if (resp.status === 403 || resp.status === 404) resp = null;
        else if (!resp.ok) throw await gdApiError(resp);
      }
      if (!resp) {
        resp = await gdCreateFile(name, mime, content, null);
        if (!resp.ok) throw await gdApiError(resp);
      }
    }
    const info = await resp.json();
    gdFiles[kind] = {
      id: info.id || (existing && existing.id),
      name: info.name || name,
      parent: (info.parents && info.parents[0]) || (existing && existing.parent) || null
    };
    dirty = false;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
    if (notWritable) toast(t("gdNotWritable", { f: gdFiles[kind].name }), "warn");
    else toast(t(createdNew ? "gdCreated" : "gdSaved", { f: gdFiles[kind].name }));
  } catch (err) { toast(t("gdSaveFail", { msg: err.message }), "err"); }
}
