"use strict";
/* =====================================================
 * DSU CSV 数据模型
 * 与 Pixel Crushers CSVConverterWindow / CSVExporter 的
 * 转义规则保持一致：字段内真实换行写成字面 \n，
 * 含逗号/引号的字段用双引号包裹并把 " 写成 ""。
 * ===================================================== */
const SECTION_NAMES = ["Database","Actors","Items","Locations","Variables","Conversations","DialogueEntries","OutgoingLinks"];

function unescapeField(s) {
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}
function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false; let rawCur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      rawCur += c;
      if (c === '"') { if (line[i+1] === '"') { rawCur += '"'; i++; } else inQ = false; }
    } else if (c === '"') { inQ = true; rawCur += c; }
    else if (c === ",") { out.push(unescapeField(rawCur)); rawCur = ""; }
    else rawCur += c;
  }
  out.push(unescapeField(rawCur));
  return out;
}
function wrapCsvValue(v) {
  v = String(v == null ? "" : v).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  if (v.includes('"')) v = '"' + v.replace(/"/g, '""') + '"';
  else if (v.includes(",")) v = '"' + v + '"';
  return v;
}
function rowToLine(row) { return row.map(wrapCsvValue).join(","); }

// 把因引号内真实换行被拆开的行重新合并（与导入器 CombineMultilineSourceLines 一致）
function combineMultiline(lines) {
  const out = [];
  let buf = null;
  const unterminated = (s) => {
    let q = false, prev = "";
    for (const c of s) { if (c === '"' && prev !== "\\") q = !q; prev = c; }
    return q;
  };
  for (const line of lines) {
    if (buf === null) { buf = line; } else { buf += "\\n" + line; }
    if (!unterminated(buf)) { out.push(buf); buf = null; }
  }
  if (buf !== null) out.push(buf + '"');
  return out;
}

function parseDSUCsv(text) {
  let lines = combineMultiline(text.split(/\r\n|\n|\r/));
  const firstField = (l) => (l.includes(",") ? l.slice(0, l.indexOf(",")) : l);
  const m = {
    dbHeader: [], dbValues: [], globalUserScript: "",
    assets: {},       // Actors/Items/Locations/Variables/Conversations -> {header, types, rows[][]}
    entriesHeader: [], entriesTypes: [], entries: [],   // entries: string[][] aligned to header
    linksHeader: ["OriginConvID","OriginID","DestConvID","DestID","ConditionPriority"],
    linksTypes: ["Number","Number","Number","Number","Special"],
    links: []
  };
  let i = 0;
  while (i < lines.length) {
    const name = firstField(lines[i]).trim();
    if (name === "Database") {
      m.dbHeader = splitCsvLine(lines[++i]);
      m.dbValues = splitCsvLine(lines[++i]);
      i++;
      if (i < lines.length && firstField(lines[i]).trim() === "Global User Script") {
        i++;
        m.globalUserScript = (i < lines.length && !SECTION_NAMES.includes(firstField(lines[i]).trim()))
          ? unescapeField(lines[i++]) : "";
      }
    } else if (["Actors","Items","Locations","Variables","Conversations"].includes(name)) {
      const sec = { header: splitCsvLine(lines[i+1]), types: splitCsvLine(lines[i+2]), rows: [] };
      i += 3;
      while (i < lines.length && !SECTION_NAMES.includes(firstField(lines[i]).trim())) {
        if (lines[i].trim() !== "") sec.rows.push(splitCsvLine(lines[i]));
        i++;
      }
      m.assets[name] = sec;
    } else if (name === "DialogueEntries") {
      m.entriesHeader = splitCsvLine(lines[i+1]);
      m.entriesTypes = splitCsvLine(lines[i+2]);
      i += 3;
      while (i < lines.length && !SECTION_NAMES.includes(firstField(lines[i]).trim())) {
        if (lines[i].trim() !== "") {
          const row = splitCsvLine(lines[i]);
          while (row.length < m.entriesHeader.length) row.push("");
          m.entries.push(row);
        }
        i++;
      }
    } else if (name === "OutgoingLinks") {
      m.linksHeader = splitCsvLine(lines[i+1]);
      m.linksTypes = splitCsvLine(lines[i+2]);
      i += 3;
      while (i < lines.length && !SECTION_NAMES.includes(firstField(lines[i]).trim())) {
        if (lines[i].trim() !== "") m.links.push(splitCsvLine(lines[i]).map(s => s.trim()));
        i++;
      }
    } else i++;
  }
  if (!m.entriesHeader.includes("canvasRect")) m.entriesHeader.push("canvasRect");
  return m;
}

function serializeDSUCsv(m) {
  const L = [];
  L.push("Database");
  L.push(rowToLine(m.dbHeader));
  L.push(rowToLine(m.dbValues));
  L.push("Global User Script");
  L.push(wrapCsvValue(m.globalUserScript));
  for (const name of ["Actors","Items","Locations","Variables","Conversations"]) {
    const sec = m.assets[name] || { header: ["ID"], types: ["Number"], rows: [] };
    L.push(name);
    L.push(rowToLine(sec.header));
    L.push(rowToLine(sec.types));
    for (const r of sec.rows) L.push(rowToLine(r));
  }
  L.push("DialogueEntries");
  L.push(rowToLine(m.entriesHeader));
  L.push(rowToLine(m.entriesTypes));
  for (const r of m.entries) L.push(rowToLine(r));
  L.push("OutgoingLinks");
  L.push(rowToLine(m.linksHeader));
  L.push(rowToLine(m.linksTypes));
  for (const r of m.links) L.push(rowToLine(r));
  return L.join("\r\n") + "\r\n";
}

/* ===================================================== 全局状态 ===================================================== */
let model = null;
let fileName = "dialogue.csv";
let currentConv = null;                 // 当前对话 ID (string)
let selection = null;                   // {type:'node'|'nodes'|'link'|'conv', ...}
let selNodes = new Set();               // 多选的节点 ID 集合（当前对话内）
function setNodeSelection(ids) {
  selNodes = new Set(ids);
  selection = selNodes.size === 0 ? null
    : selNodes.size === 1 ? { type: "node", id: [...selNodes][0] }
    : { type: "nodes" };
}
function clearSelection() { selNodes.clear(); selection = null; }
const view = { x: 60, y: 60, s: 1 };
const els = {
  world: document.getElementById("world"), nodes: document.getElementById("nodes"),
  edgeG: document.getElementById("edgeG"), tempEdge: document.getElementById("tempEdge"),
  wrap: document.getElementById("canvasWrap"), convList: document.getElementById("convList"),
  actorList: document.getElementById("actorList"),
  inspector: document.getElementById("inspector"), validation: document.getElementById("validationPanel"),
  fileName: document.getElementById("fileName"), emptyHint: document.getElementById("emptyHint")
};

/* ---------- 模型访问辅助 ---------- */
const col = (name) => model.entriesHeader.indexOf(name);
const eGet = (row, name) => { const c = col(name); return c >= 0 ? (row[c] || "") : ""; };
const eSet = (row, name, v) => { const c = col(name); if (c >= 0) { while (row.length <= c) row.push(""); row[c] = v; } };
function actorCol(name) { return model.assets.Actors ? model.assets.Actors.header.indexOf(name) : -1; }
function actors() {
  if (!model.assets.Actors) return [];
  const idC = actorCol("ID"), nameC = actorCol("Name"), playerC = actorCol("IsPlayer");
  let zhC = actorCol("Display Name zh-CN");
  return model.assets.Actors.rows.map(r => ({
    id: r[idC], name: r[nameC] || ("Actor" + r[idC]),
    zh: zhC >= 0 ? (r[zhC] || "") : "",
    isPlayer: String(r[playerC]).toLowerCase() === "true"
  }));
}
function actorById(id) { return actors().find(a => a.id === String(id)); }
function conversations() {
  if (!model.assets.Conversations) return [];
  const h = model.assets.Conversations.header;
  return model.assets.Conversations.rows.map(r => ({ id: r[h.indexOf("ID")], title: r[h.indexOf("Title")], row: r }));
}
function convEntries(convId) { return model.entries.filter(r => eGet(r, "ConvID") === String(convId)); }
function convLinks(convId) { return model.links.filter(l => l[0] === String(convId)); }
function findEntry(convId, id) { return model.entries.find(r => eGet(r, "ConvID") === String(convId) && eGet(r, "ID") === String(id)); }
function nodePos(row) {
  const cr = eGet(row, "canvasRect");
  if (cr && cr.includes(";")) { const [x, y] = cr.split(";"); return { x: parseFloat(x) || 0, y: parseFloat(y) || 0 }; }
  return null;
}
function makeEntrytag(row) {
  const a = actorById(eGet(row, "Actor"));
  const an = (a ? a.name : "Actor").replace(/[\s,"]/g, "_");
  return `${an}_${eGet(row, "ConvID")}_${eGet(row, "ID")}`;
}

/* ---------- 自动保存（编辑时写入 localStorage，页面显示上次保存时间） ---------- */
const AUTOSAVE_KEY = "dsu-graph-editor-autosave";
let dirty = false;
let lastDriveSaveAt = 0;   // 最近一次成功写入 Google Drive 的时间（由 gdrive.js 置位）
// 只有文件确实在 Drive 上时才显示自动保存时间；本地文件/新建项目不显示，避免误导
function updateAutosaveInfo() {
  const el = document.getElementById("autosaveInfo");
  if (!el) return;
  const onDrive = typeof gdAutoTarget !== "undefined" && gdAutoTarget && gdFiles[gdAutoTarget];
  el.textContent = onDrive && lastDriveSaveAt
    ? t("gdAutosavedAt", { t: new Date(lastDriveSaveAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour12: false }) })
    : "";
}
function markDirty() {
  dirty = true;
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ fileName, csv: serializeDSUCsv(model), t: Date.now() })); } catch (e) {}
}

/* ---------- 布局持久化：网页端排版按 对话:节点 记忆，重新导入 CSV 时恢复 ---------- */
const LAYOUT_KEY = "dsu-graph-editor-layout";
let layoutStore = {};
try { layoutStore = JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch (e) {}
function saveNodeLayout(convId, id, xy) {
  layoutStore[convId + ":" + id] = xy;
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutStore)); } catch (e) {}
}
function applySavedLayout() {
  for (const r of model.entries) {
    const k = eGet(r, "ConvID") + ":" + eGet(r, "ID");
    if (layoutStore[k]) eSet(r, "canvasRect", layoutStore[k]);
  }
}

/* ---------- 撤销 / 重做（快照式） ---------- */
let undoStack = [], redoStack = [];
function snap() {
  return JSON.stringify({
    e: model.entries, l: model.links,
    c: model.assets.Conversations ? model.assets.Conversations.rows : [],
    a: model.assets.Actors || null
  });
}
function pushUndoState(s) {
  if (!model || !s) return;
  if (undoStack[undoStack.length - 1] === s) return;
  undoStack.push(s);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function pushUndo() { if (model) pushUndoState(snap()); }
function restoreSnap(s) {
  const d = JSON.parse(s);
  model.entries = d.e; model.links = d.l;
  if (model.assets.Conversations) model.assets.Conversations.rows = d.c;
  if (d.a) model.assets.Actors = d.a;
  // 同步布局记忆：已记忆的节点回退到快照中的坐标，避免撤销移动后布局存储残留新坐标
  let layoutChanged = false;
  for (const r of model.entries) {
    const k = eGet(r, "ConvID") + ":" + eGet(r, "ID");
    if (layoutStore[k] && layoutStore[k] !== eGet(r, "canvasRect")) { layoutStore[k] = eGet(r, "canvasRect"); layoutChanged = true; }
  }
  if (layoutChanged) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutStore)); } catch (e) {} }
  if (!conversations().some(c => c.id === currentConv)) currentConv = conversations().length ? conversations()[0].id : null;
  clearSelection();
  markDirty(); renderAll(); runValidation(); updateUndoButtons();
}
function undo() { if (!undoStack.length) return; const cur = snap(); redoStack.push(cur); restoreSnap(undoStack.pop()); }
function redo() { if (!redoStack.length) return; const cur = snap(); undoStack.push(cur); restoreSnap(redoStack.pop()); }
function updateUndoButtons() { /* 工具栏撤销/重做按钮已移除，仅保留 Ctrl+Z / Ctrl+Y 快捷键 */ }
// 输入框：聚焦时记快照，首次输入时入栈（一次编辑会话 = 一步撤销）
function bindUndoCapture(input) {
  let snapAtFocus = null, pushed = false;
  input.addEventListener("focus", () => { snapAtFocus = snap(); pushed = false; });
  input.addEventListener("input", () => { if (!pushed && snapAtFocus) { pushUndoState(snapAtFocus); pushed = true; } });
}

/* ---------- 页面内提示（toast）与确认弹窗，替代浏览器 alert/confirm ---------- */
let toastTimer = null;
function toast(msg, type) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ""; }, 2600);
}
function uiConfirm(msg, onOk, opts = {}) {
  const ov = document.getElementById("modalOverlay");
  ov.querySelector(".msg").textContent = msg;
  const btns = ov.querySelector(".btns");
  btns.innerHTML = "";
  const cancel = document.createElement("button"); cancel.textContent = opts.cancelLabel || t("cancel");
  const ok = document.createElement("button"); ok.textContent = opts.okLabel || t("ok");
  ok.className = opts.danger ? "dangerB" : "primary";
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); close(); onOk(); }
  };
  const close = () => { ov.classList.remove("show"); window.removeEventListener("keydown", onKey, true); };
  cancel.onclick = close;
  ok.onclick = () => { close(); onOk(); };
  btns.append(cancel, ok);
  ov.classList.add("show");
  window.addEventListener("keydown", onKey, true);
  ok.focus();
}

// 多按钮选择弹窗：choices = [{label, danger|primary, fn}]，自带取消按钮
function uiChoice(msg, choices) {
  const ov = document.getElementById("modalOverlay");
  ov.querySelector(".msg").textContent = msg;
  const btns = ov.querySelector(".btns");
  btns.innerHTML = "";
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } };
  const close = () => { ov.classList.remove("show"); window.removeEventListener("keydown", onKey, true); };
  const cancel = document.createElement("button"); cancel.textContent = t("cancel"); cancel.onclick = close;
  btns.appendChild(cancel);
  for (const c of choices) {
    const b = document.createElement("button");
    b.textContent = c.label;
    if (c.danger) b.className = "dangerB"; else if (c.primary) b.className = "primary";
    b.onclick = () => { close(); c.fn(); };
    btns.appendChild(b);
  }
  ov.classList.add("show");
  window.addEventListener("keydown", onKey, true);
}

// 通用表单弹窗：fields = [{key, label, def, textarea, required}]，确定后回调 onOk(values)
function uiFormPrompt(title, fields, onOk, okLabel) {
  const ov = document.getElementById("modalOverlay");
  ov.querySelector(".msg").textContent = title;
  const btns = ov.querySelector(".btns");
  btns.innerHTML = "";
  const form = document.createElement("div");
  form.className = "promptForm vertical";
  const inputs = {};
  for (const f of fields) {
    const wrap = document.createElement("div"); wrap.className = "pfField";
    const lb = document.createElement("label"); lb.textContent = f.label;
    const inp = f.textarea ? document.createElement("textarea") : document.createElement("input");
    if (!f.textarea) inp.type = "text";
    inp.value = f.def || "";
    inputs[f.key] = inp;
    wrap.append(lb, inp);
    form.appendChild(wrap);
  }
  btns.before(form);
  const cancel = document.createElement("button"); cancel.textContent = t("cancel");
  const ok = document.createElement("button"); ok.textContent = okLabel || t("ok"); ok.className = "primary";
  const submit = () => {
    for (const f of fields) {
      if (f.required && !inputs[f.key].value.trim()) { inputs[f.key].focus(); return; }
    }
    const values = {};
    for (const k in inputs) values[k] = inputs[k].value.trim();
    close();
    onOk(values);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.stopPropagation(); e.preventDefault(); submit(); }
  };
  const close = () => { ov.classList.remove("show"); form.remove(); window.removeEventListener("keydown", onKey, true); };
  cancel.onclick = close;
  ok.onclick = submit;
  btns.append(cancel, ok);
  ov.classList.add("show");
  window.addEventListener("keydown", onKey, true);
  const first = fields.length ? inputs[fields[0].key] : null;
  if (first) { first.focus(); first.select(); }
}

/* ===================================================== 渲染 ===================================================== */
function applyView() { els.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`; }

function renderAll() {
  renderConvList();
  renderActorList();
  renderNodes();
  requestAnimationFrame(renderEdges);
  renderInspector();
}

function renderConvList() {
  els.convList.innerHTML = "";
  if (!model) return;
  for (const c of conversations()) {
    const div = document.createElement("div");
    div.className = "convItem" + (c.id === currentConv ? " active" : "");
    const issues = validateConv(c.id).filter(v => v.level === "err").length;
    div.innerHTML = `<span>${c.id}. ${escapeHtml(c.title || t("unnamed"))}</span>` +
      (issues ? `<span class="badge">${issues}</span>` : "") +
      `<span class="playBtn" title="${t("previewThis")}">▶</span>`;
    div.dataset.convId = c.id;
    div.onclick = () => { currentConv = c.id; selNodes.clear(); selection = { type: "conv", id: c.id }; fitView(); renderAll(); };
    div.ondblclick = () => startRenameConv(c.id);
    div.querySelector(".playBtn").onclick = (e) => { e.stopPropagation(); startPreview(c.id, "0"); };
    els.convList.appendChild(div);
  }
}

function renderActorList() {
  els.actorList.innerHTML = "";
  if (!model) return;
  for (const a of actors()) {
    const div = document.createElement("div");
    div.className = "convItem actorItem" + (selection && selection.type === "actor" && selection.id === a.id ? " active" : "");
    const dn = lang === "zh" ? (a.zh || a.name) : a.name;
    div.innerHTML = `<span>${a.id}. ${escapeHtml(dn)}</span>` +
      (a.isPlayer ? `<span class="pBadge" title="${t("playerBadgeTip")}">P</span>` : "");
    div.dataset.actorId = a.id;
    div.onclick = () => { selNodes.clear(); selection = { type: "actor", id: a.id }; renderAll(); };
    els.actorList.appendChild(div);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function autoLayoutMissing(rows) {
  // 没有坐标的节点：按 BFS 层级排
  const need = rows.filter(r => !nodePos(r));
  if (!need.length) return;
  const depth = {};
  const links = convLinks(currentConv);
  const queue = ["0"]; depth["0"] = 0;
  while (queue.length) {
    const id = queue.shift();
    for (const l of links.filter(l => l[1] === id && l[2] === currentConv)) {
      if (!(l[3] in depth)) { depth[l[3]] = depth[id] + 1; queue.push(l[3]); }
    }
  }
  const perDepth = {};
  for (const r of need) {
    const d = depth[eGet(r, "ID")] ?? 0;
    perDepth[d] = (perDepth[d] || 0);
    eSet(r, "canvasRect", `${160 + perDepth[d] * 230};${30 + d * 90}`);
    perDepth[d]++;
  }
}

function renderNodes() {
  els.nodes.innerHTML = "";
  if (!model || currentConv == null) { els.emptyHint.style.display = model ? "none" : "flex"; return; }
  els.emptyHint.style.display = "none";
  const rows = convEntries(currentConv);
  autoLayoutMissing(rows);
  const links = convLinks(currentConv);
  for (const row of rows) {
    const id = eGet(row, "ID");
    const pos = nodePos(row);
    const a = actorById(eGet(row, "Actor"));
    const isStart = id === "0";
    const isGroup = eGet(row, "IsGroup").toLowerCase() === "true";
    const div = document.createElement("div");
    div.className = "node" + (isStart ? " start" : a && a.isPlayer ? " player" : "") + (isGroup ? " group" : "");
    if (selNodes.has(id)) div.classList.add("selected");
    if (pv && pv.cur && pv.cur.conv === currentConv && pv.cur.id === id) div.classList.add("pvCurrent");
    div.style.left = pos.x + "px"; div.style.top = pos.y + "px";
    div.dataset.id = id;
    const speaker = a ? (lang === "zh" && a.zh ? `${a.zh} <span style="opacity:.6">${escapeHtml(a.name)}</span>` : escapeHtml(a.name)) : "?";
    let body = "";
    if (isStart) body = `<div class="en" style="color:var(--warn)">&lt;START&gt;</div>`;
    else {
      const menu = eGet(row, "MenuText"), en = eGet(row, "DialogueText"), zh = eGet(row, "zh-CN");
      if (menu) body += `<div class="menu">${t("menuTag")} ${escapeHtml(menu)}</div>`;
      if (en) body += `<div class="en">${escapeHtml(en)}</div>`;
      if (zh) body += `<div class="zh">${escapeHtml(zh)}</div>`;
      if (!body) body = `<div class="en" style="color:var(--text-dim)">${t("emptyText")}</div>`;
      if (isGroup) body = `<div class="en" style="color:#8fbc8f">${t("groupTag")}</div>` + body;
    }
    const cond = eGet(row, "Conditions");
    const script = eGet(row, "Script");
    const seq = eGet(row, "Sequence");
    let extra = "";
    if (cond) extra += `<div class="cond">if: ${escapeHtml(cond)}</div>`;
    if (script) extra += `<div class="cond" style="color:#9cdcfe">run: ${escapeHtml(script)}</div>`;
    if (seq && seq !== "None()") extra += `<div class="cond" style="color:#c586c0">seq: ${escapeHtml(seq)}</div>`;
    // 跨对话链接
    const xl = links.filter(l => l[1] === id && l[2] !== currentConv);
    if (xl.length) extra += `<div class="xlinks">${xl.map(l => `→ ${t("convRef", { n: l[2] })}:${l[3]}`).join("　")}</div>`;
    div.innerHTML = `<div class="head"><span>${speaker}</span><span class="eid">#${id}</span></div><div class="body">${body}</div>${extra}<div class="outPort" title="${t("dragToLink")}"></div>`;
    els.nodes.appendChild(div);
  }
}

function edgePath(x1, y1, x2, y2) {
  const dy = Math.max(30, Math.abs(y2 - y1) * 0.5);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}
function nodeAnchor(id) {
  const div = els.nodes.querySelector(`.node[data-id="${id}"]`);
  if (!div) return null;
  const x = parseFloat(div.style.left), y = parseFloat(div.style.top);
  return { top: { x: x + div.offsetWidth / 2, y: y }, bottom: { x: x + div.offsetWidth / 2, y: y + div.offsetHeight } };
}
function renderEdges() {
  els.edgeG.innerHTML = "";
  if (!model || currentConv == null) return;
  const links = convLinks(currentConv).filter(l => l[2] === currentConv);
  links.forEach((l) => {
    const a = nodeAnchor(l[1]), b = nodeAnchor(l[3]);
    if (!a || !b) return;
    const d = edgePath(a.bottom.x, a.bottom.y, b.top.x, b.top.y);
    const idx = model.links.indexOf(l);
    const sel = selection && selection.type === "link" && selection.idx === idx;
    for (const cls of ["hitarea", "edge" + (sel ? " selected" : "")]) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("class", cls.startsWith("hitarea") ? "edge hitarea" : cls);
      p.dataset.idx = idx;
      p.addEventListener("mousedown", (e) => { if (e.button !== 0) return; e.stopPropagation(); selNodes.clear(); selection = { type: "link", idx }; renderAll(); });
      els.edgeG.appendChild(p);
    }
  });
}

/* ===================================================== Inspector ===================================================== */
function renderInspector() {
  const ins = els.inspector;
  ins.innerHTML = "";
  if (!model || !selection) {
    ins.innerHTML = `<div class="hintText">${t("hintNoSelection")}</div>`;
    return;
  }
  if (selection.type === "conv") return renderConvInspector();
  if (selection.type === "link") return renderLinkInspector();
  if (selection.type === "actor") return renderActorInspector();
  if (selection.type === "nodes") {
    const h3 = document.createElement("h3");
    h3.textContent = t("selectedN", { n: selNodes.size });
    ins.appendChild(h3);
    const d = document.createElement("div"); d.className = "hintText";
    d.innerHTML = t("multiHint");
    ins.appendChild(d);
    const del = document.createElement("button"); del.className = "danger"; del.textContent = t("deleteNNodes", { n: selNodes.size });
    del.onclick = () => deleteNodes([...selNodes]);
    ins.appendChild(del);
    return;
  }
  const row = findEntry(currentConv, selection.id);
  if (!row) { selection = null; return renderInspector(); }
  const h3 = document.createElement("h3");
  h3.textContent = t("nodeTitle", { id: selection.id, tag: makeEntrytag(row) });
  ins.appendChild(h3);
  const skip = new Set(["entrytag", "ConvID", "ID", "canvasRect"]);
  const acts = actors();
  model.entriesHeader.forEach((name, ci) => {
    if (skip.has(name)) return;
    const fd = document.createElement("div"); fd.className = "field";
    fd.appendChild(makeFieldLabel(name, "entry", model.entriesTypes[ci] === "Localization" ? "locField" : null));
    const val = row[ci] || "";
    let input;
    if (name === "Actor" || name === "Conversant") {
      input = document.createElement("select");
      for (const a of acts) {
        const o = document.createElement("option");
        o.value = a.id; o.textContent = `${a.id}. ${lang === "zh" ? (a.zh || a.name) : a.name}`;
        if (a.id === val) o.selected = true;
        input.appendChild(o);
      }
    } else if (name === "IsGroup") {
      input = document.createElement("select");
      for (const v of ["False", "True"]) { const o = document.createElement("option"); o.value = v; o.textContent = v === "True" ? t("isGroupTrue") : t("isGroupFalse"); if (val.toLowerCase() === v.toLowerCase()) o.selected = true; input.appendChild(o); }
    } else if (name === "FalseConditionAction") {
      input = document.createElement("select");
      for (const v of ["Block", "Passthrough"]) { const o = document.createElement("option"); o.value = v; o.textContent = v; if (val === v) o.selected = true; input.appendChild(o); }
    } else if (name === "ConditionPriority") {
      input = document.createElement("select");
      for (const v of ["Low", "BelowNormal", "Normal", "AboveNormal", "High"]) { const o = document.createElement("option"); o.value = v; o.textContent = v; if (val === v || (!val && v === "Normal")) o.selected = true; input.appendChild(o); }
    } else if (["DialogueText", "Conditions", "Script", "Sequence", "Description"].includes(name) || model.entriesTypes[ci] === "Localization") {
      input = document.createElement("textarea"); input.value = val;
    } else {
      input = document.createElement("input"); input.type = "text"; input.value = val;
    }
    bindUndoCapture(input);
    input.addEventListener("input", () => {
      row[ci] = input.value;
      if (name === "Actor") eSet(row, "entrytag", makeEntrytag(row));
      markDirty(); renderNodes(); requestAnimationFrame(renderEdges); renderConvList();
      // 重新选中高亮
      const div = els.nodes.querySelector(`.node[data-id="${selection.id}"]`);
      if (div) div.classList.add("selected");
    });
    fd.appendChild(input);
    ins.appendChild(fd);
  });
  // 出链列表
  const h32 = document.createElement("h3"); h32.textContent = t("outgoingLinks"); ins.appendChild(h32);
  const out = model.links.filter(l => l[0] === currentConv && l[1] === selection.id);
  if (!out.length) { const d = document.createElement("div"); d.className = "linkRow"; d.style.color = "var(--text-dim)"; d.textContent = t("noOutgoing"); ins.appendChild(d); }
  for (const l of out) {
    const d = document.createElement("div"); d.className = "linkRow";
    const target = l[2] === currentConv ? findEntry(l[2], l[3]) : null;
    const desc = target ? (eGet(target, "MenuText") || eGet(target, "DialogueText") || eGet(target, "Title") || "").slice(0, 18) : "";
    d.innerHTML = `<span style="flex:1">→ ${l[2] === currentConv ? "" : t("convRef", { n: l[2] }) + " "}#${l[3]} <span style="color:var(--text-dim)">${escapeHtml(desc)}</span></span>`;
    const btn = document.createElement("button"); btn.textContent = t("unlink");
    btn.onclick = () => { pushUndo(); model.links.splice(model.links.indexOf(l), 1); markDirty(); renderAll(); };
    d.appendChild(btn);
    ins.appendChild(d);
  }
  if (selection.id !== "0") {
    const del = document.createElement("button"); del.className = "danger"; del.textContent = t("deleteNodeBtn");
    del.onclick = () => deleteNode(selection.id);
    ins.appendChild(del);
  }
}

function renderConvInspector() {
  const ins = els.inspector;
  const sec = model.assets.Conversations;
  const row = sec.rows.find(r => r[sec.header.indexOf("ID")] === selection.id);
  if (!row) return;
  const h3 = document.createElement("h3"); h3.textContent = t("convTitle", { id: selection.id }); ins.appendChild(h3);
  sec.header.forEach((name, ci) => {
    if (name === "ID" || name === "Overrides") return;
    const fd = document.createElement("div"); fd.className = "field";
    fd.appendChild(makeFieldLabel(name, "conv"));
    let input;
    if (name === "Actor" || name === "Conversant") {
      input = document.createElement("select");
      for (const a of actors()) { const o = document.createElement("option"); o.value = a.id; o.textContent = `${a.id}. ${lang === "zh" ? (a.zh || a.name) : a.name}`; if (a.id === row[ci]) o.selected = true; input.appendChild(o); }
    } else { input = document.createElement("input"); input.type = "text"; input.value = row[ci] || ""; }
    bindUndoCapture(input);
    input.addEventListener("input", () => { row[ci] = input.value; markDirty(); renderConvList(); });
    fd.appendChild(input); ins.appendChild(fd);
  });
  const del = document.createElement("button"); del.className = "danger"; del.textContent = t("deleteConvBtn");
  del.onclick = () => deleteConversation(selection.id);
  ins.appendChild(del);
}

function deleteConversation(id) {
  const sec = model.assets.Conversations;
  const conv = conversations().find(c => c.id === id);
  const count = convEntries(id).length;
  uiConfirm(t("confirmDeleteConv", { title: (conv && conv.title) || id, n: count }), () => {
    pushUndo();
    sec.rows = sec.rows.filter(r => r[sec.header.indexOf("ID")] !== id);
    model.entries = model.entries.filter(r => eGet(r, "ConvID") !== id);
    model.links = model.links.filter(l => l[0] !== id && l[2] !== id);
    if (currentConv === id) currentConv = conversations().length ? conversations()[0].id : null;
    clearSelection(); markDirty(); renderAll();
  }, { okLabel: t("delete"), danger: true });
}
// 内联重命名：侧栏对话名原地变成输入框（双击对话名或右键菜单触发）
function startRenameConv(id) {
  const item = els.convList.querySelector(`.convItem[data-conv-id="${id}"]`);
  const sec = model.assets.Conversations;
  const row = sec.rows.find(r => r[sec.header.indexOf("ID")] === id);
  if (!item || !row) return;
  const titleC = sec.header.indexOf("Title");
  const span = item.querySelector("span");
  const input = document.createElement("input");
  input.className = "rename";
  input.value = row[titleC] || "";
  span.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== row[titleC]) { pushUndo(); row[titleC] = v; markDirty(); }
    renderAll();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") commit(true);
    else if (e.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}

function renderLinkInspector() {
  const ins = els.inspector;
  const l = model.links[selection.idx];
  if (!l) return;
  const h3 = document.createElement("h3"); h3.textContent = t("linkTitle"); ins.appendChild(h3);
  const d = document.createElement("div"); d.className = "hintText";
  d.innerHTML = t("linkHint", { from: l[1], to: (l[2] === currentConv ? "" : t("convRef", { n: l[2] }) + " ") + "#" + l[3] });
  ins.appendChild(d);
  const del = document.createElement("button"); del.className = "danger"; del.textContent = t("deleteLink");
  del.onclick = () => { pushUndo(); model.links.splice(selection.idx, 1); selection = null; markDirty(); renderAll(); };
  ins.appendChild(del);
}

/* ===================================================== 角色（Actors） ===================================================== */
// ID / Name / IsPlayer 是核心列，不允许作为自定义字段删除
const ACTOR_CORE_FIELDS = new Set(["ID", "Name", "IsPlayer"]);

function renderActorInspector() {
  const ins = els.inspector;
  const sec = model.assets.Actors;
  if (!sec) { selection = null; return renderInspector(); }
  const idC = sec.header.indexOf("ID");
  const row = sec.rows.find(r => r[idC] === selection.id);
  if (!row) { selection = null; return renderInspector(); }
  const h3 = document.createElement("h3");
  h3.textContent = t("actorTitle", { id: selection.id });
  ins.appendChild(h3);
  sec.header.forEach((name, ci) => {
    if (name === "ID") return;
    const fd = document.createElement("div"); fd.className = "field";
    const label = makeFieldLabel(name, "actor", sec.types[ci] === "Localization" ? "locField" : null);
    if (!ACTOR_CORE_FIELDS.has(name)) {
      const x = document.createElement("span");
      x.className = "fieldDel"; x.textContent = "✕"; x.title = t("deleteFieldTip");
      x.onclick = () => deleteActorField(name);
      label.appendChild(x);
    }
    fd.appendChild(label);
    const val = row[ci] || "";
    let input;
    if (name === "IsPlayer" || sec.types[ci] === "Boolean") {
      input = document.createElement("select");
      for (const v of ["False", "True"]) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = name === "IsPlayer" ? (v === "True" ? t("isPlayerTrue") : t("isPlayerFalse")) : v;
        if (val.toLowerCase() === v.toLowerCase()) o.selected = true;
        input.appendChild(o);
      }
    } else if (name === "Description" || sec.types[ci] === "Localization") {
      input = document.createElement("textarea"); input.value = val;
    } else {
      input = document.createElement("input"); input.type = "text"; input.value = val;
    }
    input.dataset.fname = name;
    bindUndoCapture(input);
    input.addEventListener("input", () => {
      while (row.length <= ci) row.push("");
      row[ci] = input.value;
      // Name 变化会影响 entrytag，同步所有引用该角色的节点
      if (name === "Name") {
        for (const r of model.entries) if (eGet(r, "Actor") === selection.id) eSet(r, "entrytag", makeEntrytag(r));
      }
      markDirty(); renderNodes(); requestAnimationFrame(renderEdges); renderActorList(); renderConvList();
    });
    fd.appendChild(input);
    ins.appendChild(fd);
  });
  const addF = document.createElement("button");
  addF.className = "addField"; addF.textContent = t("addCustomField");
  addF.onclick = () => uiFieldPrompt(addActorField);
  ins.appendChild(addF);
  const del = document.createElement("button");
  del.className = "danger"; del.textContent = t("deleteActorBtn");
  del.onclick = () => deleteActor(selection.id);
  ins.appendChild(del);
}

function addActor() {
  if (!model) return;
  if (!model.assets.Actors) model.assets.Actors = { header: ["ID", "Name", "IsPlayer"], types: ["Number", "Text", "Boolean"], rows: [] };
  pushUndo();
  const sec = model.assets.Actors;
  const idC = sec.header.indexOf("ID");
  let max = 0; for (const r of sec.rows) max = Math.max(max, parseInt(r[idC], 10) || 0);
  const id = String(max + 1);
  const row = sec.header.map((name, ci) => {
    if (name === "ID") return id;
    if (name === "Name") return "NewActor" + id;
    if (name === "Pictures") return "[]";
    if (name === "IsPlayer" || sec.types[ci] === "Boolean") return "False";
    return "";
  });
  sec.rows.push(row);
  selNodes.clear();
  selection = { type: "actor", id };
  markDirty(); renderAll();
  const nameInput = els.inspector.querySelector('[data-fname="Name"]');
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

function deleteActor(id) {
  const sec = model.assets.Actors;
  if (!sec) return;
  const a = actorById(id);
  const nRefs = model.entries.filter(r => eGet(r, "Actor") === id || eGet(r, "Conversant") === id).length;
  let cRefs = 0;
  if (model.assets.Conversations) {
    const ch = model.assets.Conversations.header;
    const aC = ch.indexOf("Actor"), cC = ch.indexOf("Conversant");
    cRefs = model.assets.Conversations.rows.filter(r => (aC >= 0 && r[aC] === id) || (cC >= 0 && r[cC] === id)).length;
  }
  const refs = (nRefs || cRefs) ? t("actorRefs", { n: nRefs, c: cRefs }) : "";
  uiConfirm(t("confirmDeleteActor", { name: (a && (lang === "zh" ? (a.zh || a.name) : a.name)) || id, refs }), () => {
    pushUndo();
    sec.rows = sec.rows.filter(r => r[sec.header.indexOf("ID")] !== id);
    if (selection && selection.type === "actor" && selection.id === id) selection = null;
    markDirty(); renderAll();
  }, { okLabel: t("delete"), danger: true });
}

// 自定义字段：添加到 Actors 表的所有行（写回 CSV 的 Actors 段）
function addActorField(name, type) {
  const sec = model.assets.Actors;
  if (!sec) return;
  if (sec.header.includes(name)) { toast(t("fieldExists"), "warn"); return; }
  pushUndo();
  sec.header.push(name);
  sec.types.push(type);
  for (const r of sec.rows) {
    while (r.length < sec.header.length - 1) r.push("");
    r.push(type === "Boolean" ? "False" : "");
  }
  markDirty(); renderInspector();
}

function deleteActorField(name) {
  const sec = model.assets.Actors;
  const ci = sec.header.indexOf(name);
  if (ci < 0 || ACTOR_CORE_FIELDS.has(name)) return;
  uiConfirm(t("confirmDeleteField", { name }), () => {
    pushUndo();
    sec.header.splice(ci, 1);
    sec.types.splice(ci, 1);
    for (const r of sec.rows) if (r.length > ci) r.splice(ci, 1);
    markDirty(); renderAll();
  }, { okLabel: t("delete"), danger: true });
}

// 弹窗：输入字段名 + 选择类型（用于自定义字段）
function uiFieldPrompt(onOk) {
  const ov = document.getElementById("modalOverlay");
  ov.querySelector(".msg").textContent = t("addFieldTitle");
  const btns = ov.querySelector(".btns");
  btns.innerHTML = "";
  const form = document.createElement("div");
  form.className = "promptForm";
  const nameIn = document.createElement("input");
  nameIn.type = "text"; nameIn.placeholder = t("fieldNamePrompt");
  const typeSel = document.createElement("select");
  for (const v of ["Text", "Number", "Boolean", "Localization"]) {
    const o = document.createElement("option"); o.value = v; o.textContent = v; typeSel.appendChild(o);
  }
  form.append(nameIn, typeSel);
  btns.before(form);
  const cancel = document.createElement("button"); cancel.textContent = t("cancel");
  const ok = document.createElement("button"); ok.textContent = t("add"); ok.className = "primary";
  const submit = () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    close(); onOk(name, typeSel.value);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === "Enter") { e.stopPropagation(); e.preventDefault(); submit(); }
  };
  const close = () => { ov.classList.remove("show"); form.remove(); window.removeEventListener("keydown", onKey, true); };
  cancel.onclick = close;
  ok.onclick = submit;
  btns.append(cancel, ok);
  ov.classList.add("show");
  window.addEventListener("keydown", onKey, true);
  nameIn.focus();
}

/* ===================================================== 编辑操作 ===================================================== */
function nextEntryId(convId) {
  let max = -1;
  for (const r of convEntries(convId)) max = Math.max(max, parseInt(eGet(r, "ID"), 10) || 0);
  return String(max + 1);
}
function addNode(wx, wy) {
  if (!model || currentConv == null) return;
  pushUndo();
  const conv = conversations().find(c => c.id === currentConv);
  const h = model.assets.Conversations.header;
  const defActor = conv ? conv.row[h.indexOf("Conversant")] : "2";
  const defConversant = conv ? conv.row[h.indexOf("Actor")] : "1";
  const row = model.entriesHeader.map(() => "");
  eSet(row, "ConvID", currentConv);
  eSet(row, "ID", nextEntryId(currentConv));
  eSet(row, "Actor", defActor);
  eSet(row, "Conversant", defConversant);
  eSet(row, "IsGroup", "False");
  eSet(row, "FalseConditionAction", "Block");
  eSet(row, "ConditionPriority", "Normal");
  eSet(row, "canvasRect", `${Math.round(wx)};${Math.round(wy)}`);
  eSet(row, "entrytag", makeEntrytag(row));
  model.entries.push(row);
  saveNodeLayout(currentConv, eGet(row, "ID"), eGet(row, "canvasRect"));
  setNodeSelection([eGet(row, "ID")]);
  markDirty(); renderAll();
  return row;
}
function addChildNode(parentId) {
  const parent = findEntry(currentConv, parentId);
  if (!parent) return;
  const p = nodePos(parent) || { x: 160, y: 30 };
  const div = els.nodes.querySelector(`.node[data-id="${parentId}"]`);
  const h = div ? div.offsetHeight : 90;
  const row = addNode(p.x, p.y + h + 60);
  if (row) model.links.push([currentConv, parentId, currentConv, eGet(row, "ID"), "Normal"]);
  markDirty(); renderAll();
}
function duplicateNode(id) {
  const src = findEntry(currentConv, id);
  if (!src) return;
  pushUndo();
  const row = src.slice();
  eSet(row, "ID", nextEntryId(currentConv));
  eSet(row, "Title", "");
  const p = nodePos(src) || { x: 160, y: 30 };
  eSet(row, "canvasRect", `${Math.round(p.x + 30)};${Math.round(p.y + 30)}`);
  eSet(row, "entrytag", makeEntrytag(row));
  model.entries.push(row);
  saveNodeLayout(currentConv, eGet(row, "ID"), eGet(row, "canvasRect"));
  setNodeSelection([eGet(row, "ID")]);
  markDirty(); renderAll();
}
function deleteNodes(ids) {
  ids = ids.filter(id => id !== "0");
  if (!ids.length) { toast(t("startNodeNoDelete"), "warn"); return; }
  pushUndo();
  const del = new Set(ids);
  model.entries = model.entries.filter(r => !(eGet(r, "ConvID") === currentConv && del.has(eGet(r, "ID"))));
  model.links = model.links.filter(l =>
    !(l[0] === currentConv && del.has(l[1])) && !(l[2] === currentConv && del.has(l[3])));
  clearSelection(); markDirty(); renderAll();
}
function deleteNode(id) { deleteNodes([id]); }
function addLink(fromId, toId) {
  if (fromId === toId) return;
  if (model.links.some(l => l[0] === currentConv && l[1] === fromId && l[2] === currentConv && l[3] === toId)) return;
  pushUndo();
  model.links.push([currentConv, fromId, currentConv, toId, "Normal"]);
  markDirty(); renderAll();
}
function addConversation() {
  if (!model) return;
  // 默认名 Untitled N，创建后立即进入内联重命名（类似新建文件夹）
  const titles = new Set(conversations().map(c => c.title));
  let n = 1;
  while (titles.has(`Act ${n}`)) n++;
  const title = `Act ${n}`;
  pushUndo();
  const sec = model.assets.Conversations;
  const idC = sec.header.indexOf("ID");
  let max = 0; for (const r of sec.rows) max = Math.max(max, parseInt(r[idC], 10) || 0);
  const id = String(max + 1);
  const proto = sec.rows[0];
  const row = sec.header.map((name, ci) => {
    if (name === "ID") return id;
    if (name === "Title") return title;
    if (name === "Actor") return proto ? proto[ci] : "1";
    if (name === "Conversant") return proto ? proto[ci] : "2";
    if (name === "Overrides") return proto ? proto[ci] : "{}";
    return "";
  });
  sec.rows.push(row);
  // START 节点
  const e = model.entriesHeader.map(() => "");
  eSet(e, "ConvID", id); eSet(e, "ID", "0"); eSet(e, "Title", "START");
  eSet(e, "Actor", row[sec.header.indexOf("Actor")]); eSet(e, "Conversant", row[sec.header.indexOf("Conversant")]);
  eSet(e, "IsGroup", "False"); eSet(e, "FalseConditionAction", "Block"); eSet(e, "ConditionPriority", "Normal");
  eSet(e, "Sequence", "None()"); eSet(e, "canvasRect", "160;30");
  eSet(e, "entrytag", makeEntrytag(e));
  model.entries.push(e);
  currentConv = id; selection = { type: "conv", id };
  markDirty(); fitView(); renderAll();
  startRenameConv(id);
}

/* ---------- 自动排版：BFS 分层 + 重心法排序，按真实节点高度垂直堆叠 ---------- */
function autoLayout(convId) {
  if (!model || convId == null) return;
  pushUndo();
  const rows = convEntries(convId);
  const links = convLinks(convId).filter(l => l[2] === convId);
  const depth = {};
  const q = ["0"]; depth["0"] = 0;
  while (q.length) {
    const id = q.shift();
    for (const l of links.filter(l => l[1] === id)) {
      if (!(l[3] in depth)) { depth[l[3]] = depth[id] + 1; q.push(l[3]); }
    }
  }
  let maxD = 0;
  for (const k in depth) maxD = Math.max(maxD, depth[k]);
  for (const r of rows) { const id = eGet(r, "ID"); if (!(id in depth)) depth[id] = maxD + 1; } // 不可达节点排最下层
  const layers = [];
  for (const r of rows) { const id = eGet(r, "ID"); const d = depth[id]; (layers[d] = layers[d] || []).push(id); }
  const posIn = {};
  layers.forEach(l => l && l.forEach((id, i) => posIn[id] = i));
  const bary = (id) => {
    const ns = links.filter(l => l[3] === id).map(l => posIn[l[1]] ?? 0)
      .concat(links.filter(l => l[1] === id).map(l => posIn[l[3]] ?? 0));
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : posIn[id];
  };
  for (let s = 0; s < 3; s++) {
    for (const layer of layers) {
      if (!layer) continue;
      layer.sort((a, b) => bary(a) - bary(b));
      layer.forEach((id, i) => posIn[id] = i);
    }
  }
  const H = {};
  els.nodes.querySelectorAll(".node").forEach(n => H[n.dataset.id] = n.offsetHeight);
  const GAPX = 240, GAPY = 60;
  let y = 30;
  for (const layer of layers) {
    if (!layer || !layer.length) continue;
    layer.forEach((id, i) => {
      const x = Math.round(400 + (i - (layer.length - 1) / 2) * GAPX - 100);
      const r = findEntry(convId, id);
      eSet(r, "canvasRect", `${x};${Math.round(y)}`);
      saveNodeLayout(convId, id, eGet(r, "canvasRect"));
    });
    y += Math.max(...layer.map(id => H[id] || 100)) + GAPY;
  }
  markDirty(); renderAll(); fitView();
}

/* ---------- 台词同步：当前对话内，「台词文本」与「中文台词」互补填充 ---------- */
function syncDialogueText() {
  if (!model || currentConv == null) { toast(t("openFirst"), "warn"); return; }
  if (col("zh-CN") < 0) { toast(t("syncTextNoCol"), "warn"); return; }
  const toZh = [], toEn = [];
  for (const r of convEntries(currentConv)) {
    const en = eGet(r, "DialogueText"), zh = eGet(r, "zh-CN");
    if (en.trim() && !zh.trim()) toZh.push(r);
    else if (!en.trim() && zh.trim()) toEn.push(r);
    // 两边都空或都有值：不动
  }
  const n = toZh.length + toEn.length;
  if (!n) { toast(t("syncTextNone")); return; }
  uiConfirm(t("syncTextConfirm", { n, a: toZh.length, b: toEn.length }), () => {
    pushUndo();
    for (const r of toZh) eSet(r, "zh-CN", eGet(r, "DialogueText"));
    for (const r of toEn) eSet(r, "DialogueText", eGet(r, "zh-CN"));
    markDirty(); renderAll(); runValidation();
    toast(t("syncTextDone", { n }));
  });
}

/* ---------- 多选对齐 ---------- */
function alignSelected(dir) {
  if (selNodes.size < 2) return;
  pushUndo();
  const items = [...selNodes].map(id => {
    const r = findEntry(currentConv, id);
    const div = els.nodes.querySelector(`.node[data-id="${id}"]`);
    return { id, r, p: nodePos(r), h: div ? div.offsetHeight : 100 };
  }).filter(it => it.r && it.p);
  if (dir === "h") {
    const y = Math.round(items.reduce((s, it) => s + it.p.y, 0) / items.length);
    items.sort((a, b) => a.p.x - b.p.x);
    let x = items[0].p.x;
    for (const it of items) { eSet(it.r, "canvasRect", `${Math.round(x)};${y}`); saveNodeLayout(currentConv, it.id, eGet(it.r, "canvasRect")); x += 240; }
  } else {
    const x = Math.round(items.reduce((s, it) => s + it.p.x, 0) / items.length);
    items.sort((a, b) => a.p.y - b.p.y);
    let y = items[0].p.y;
    for (const it of items) { eSet(it.r, "canvasRect", `${x};${Math.round(y)}`); saveNodeLayout(currentConv, it.id, eGet(it.r, "canvasRect")); y += it.h + 40; }
  }
  markDirty(); renderAll();
}

/* ===================================================== 对话预览 ===================================================== */
let pv = null; // {trail:[{conv,id}], cur:{conv,id}, endTimer}
function startPreview(convId, id) {
  if (!model) return;
  cancelPendingLink(); hideCtx(); clearSelection();
  pv = { trail: [], cur: null };
  document.getElementById("preview").classList.add("show");
  pvGoto(convId, id, false);
}
function exitPreview(msg) {
  if (pv && pv.endTimer) clearTimeout(pv.endTimer);
  pv = null;
  document.getElementById("preview").classList.remove("show");
  renderAll();
  if (msg) toast(msg);
}
// 展开子节点：组节点是不可见的中转，穿透到其子节点
function pvExpandChildren(convId, id, visited) {
  visited = visited || new Set();
  const key = convId + ":" + id;
  if (visited.has(key)) return [];
  visited.add(key);
  const out = [];
  for (const l of model.links.filter(l => l[0] === convId && l[1] === id)) {
    const row = findEntry(l[2], l[3]);
    if (!row) continue;
    if (eGet(row, "IsGroup").toLowerCase() === "true") out.push(...pvExpandChildren(l[2], l[3], visited));
    else out.push({ conv: l[2], id: l[3], row });
  }
  return out;
}
function pvGoto(convId, id, pushTrail) {
  if (pv.endTimer) { clearTimeout(pv.endTimer); pv.endTimer = null; }
  const row = findEntry(convId, id);
  if (!row) { exitPreview(t("pvBroken")); return; }
  if (pushTrail && pv.cur) pv.trail.push(pv.cur);
  pv.cur = { conv: convId, id };
  if (currentConv !== convId) currentConv = convId;
  renderAll();
  focusNode(id);
  pvRender();
}
function pvRender() {
  const { conv, id } = pv.cur;
  const row = findEntry(conv, id);
  const c = conversations().find(c => c.id === conv);
  document.getElementById("pvTitle").textContent = t("pvTitle", { t: (c && c.title) || conv });
  document.getElementById("pvBack").disabled = pv.trail.length === 0;
  const isStart = eGet(row, "Title") === "START" && id === "0";
  const spk = document.getElementById("pvSpeaker"), txt = document.getElementById("pvText"),
        zh = document.getElementById("pvZh"), meta = document.getElementById("pvMeta");
  if (isStart) {
    spk.textContent = ""; txt.textContent = t("pvStart"); zh.textContent = ""; meta.textContent = "";
  } else {
    const a = actorById(eGet(row, "Actor"));
    spk.textContent = a ? (lang === "zh" && a.zh ? `${a.zh}（${a.name}）` : a.name) : "?";
    txt.textContent = eGet(row, "DialogueText") || eGet(row, "MenuText") || t("emptyText");
    zh.textContent = eGet(row, "zh-CN") || "";
    const m = [];
    if (eGet(row, "Conditions")) m.push("if: " + eGet(row, "Conditions"));
    if (eGet(row, "Script")) m.push("run: " + eGet(row, "Script"));
    const seq = eGet(row, "Sequence");
    if (seq && seq !== "None()") m.push("seq: " + seq);
    meta.textContent = m.join("　");
  }
  const kids = pvExpandChildren(conv, id);
  const box = document.getElementById("pvChoices");
  box.innerHTML = "";
  if (kids.length === 0) {
    const d = document.createElement("div");
    d.className = "pvEnd";
    d.textContent = t("pvEndSoon");
    box.appendChild(d);
    pv.endTimer = setTimeout(() => exitPreview(t("pvEnded")), 1500);
    return;
  }
  const single = kids.length === 1 && !(actorById(eGet(kids[0].row, "Actor")) || {}).isPlayer;
  if (single) {
    const b = document.createElement("button");
    b.textContent = t("pvContinue");
    b.onclick = () => pvGoto(kids[0].conv, kids[0].id, true);
    box.appendChild(b);
    return;
  }
  for (const k of kids) {
    const ka = actorById(eGet(k.row, "Actor"));
    const label = eGet(k.row, "MenuText") || eGet(k.row, "DialogueText") || t("emptyText");
    const labelZh = lang === "zh" ? (eGet(k.row, "Menu Text zh-CN") || eGet(k.row, "zh-CN") || "") : "";
    const b = document.createElement("button");
    b.textContent = (ka && !ka.isPlayer ? `${lang === "zh" ? (ka.zh || ka.name) : ka.name}: ` : "") + label + (labelZh ? `　${labelZh}` : "");
    const cond = eGet(k.row, "Conditions");
    if (cond) {
      const s = document.createElement("span");
      s.className = "cond";
      s.textContent = "if: " + cond;
      b.appendChild(s);
    }
    b.onclick = () => pvGoto(k.conv, k.id, true);
    box.appendChild(b);
  }
}
document.getElementById("pvExit").addEventListener("click", () => exitPreview());
document.getElementById("pvBack").addEventListener("click", () => {
  if (!pv || !pv.trail.length) return;
  const prev = pv.trail.pop();
  pvGoto(prev.conv, prev.id, false);
});

/* ---------- 右键"从此节点连线"模式 ---------- */
let pendingLinkFrom = null;
function startPendingLink(id) {
  pendingLinkFrom = id;
  els.tempEdge.style.display = "";
}
function cancelPendingLink() {
  pendingLinkFrom = null;
  els.tempEdge.style.display = "none";
  els.tempEdge.removeAttribute("d");
}

/* ===================================================== 检测 ===================================================== */
function validateConv(convId) {
  const issues = [];
  const rows = convEntries(convId);
  const ids = new Set(rows.map(r => eGet(r, "ID")));
  const links = convLinks(convId);
  if (!ids.has("0")) issues.push({ level: "err", msg: t("valNoStart"), conv: convId });
  for (const l of links) {
    if (!ids.has(l[1])) issues.push({ level: "err", msg: t("valLinkFrom", { id: l[1] }), conv: convId });
    const destOk = l[2] === convId ? ids.has(l[3]) : convEntries(l[2]).some(r => eGet(r, "ID") === l[3]);
    if (!destOk) issues.push({ level: "err", msg: t("valLinkTo", { to: t("convRef", { n: l[2] }) + "#" + l[3] }), conv: convId });
  }
  // 可达性
  const reach = new Set(["0"]);
  const queue = ["0"];
  while (queue.length) {
    const id = queue.shift();
    for (const l of links.filter(l => l[1] === id && l[2] === convId)) {
      if (!reach.has(l[3])) { reach.add(l[3]); queue.push(l[3]); }
    }
  }
  for (const r of rows) {
    const id = eGet(r, "ID");
    if (!reach.has(id)) issues.push({ level: "warn", msg: t("valUnreachable", { id }), conv: convId, node: id });
    if (id !== "0" && eGet(r, "IsGroup").toLowerCase() !== "true" && !eGet(r, "DialogueText") && !eGet(r, "MenuText"))
      issues.push({ level: "warn", msg: t("valNoText", { id }), conv: convId, node: id });
    const zh = col("zh-CN") >= 0 ? eGet(r, "zh-CN") : null;
    if (id !== "0" && zh !== null && eGet(r, "DialogueText") && !zh)
      issues.push({ level: "info", msg: t("valNoZh", { id }), conv: convId, node: id });
  }
  return issues;
}
function runValidation() {
  els.validation.innerHTML = "";
  if (!model) return;
  let total = 0;
  for (const c of conversations()) {
    for (const v of validateConv(c.id)) {
      total++;
      const d = document.createElement("div");
      d.className = "vItem " + v.level;
      d.textContent = `[${c.title || c.id}] ${v.msg}`;
      d.onclick = () => {
        currentConv = v.conv;
        if (v.node) { setNodeSelection([v.node]); focusNode(v.node); }
        renderAll();
      };
      els.validation.appendChild(d);
    }
  }
  if (!total) { const d = document.createElement("div"); d.className = "vItem info"; d.textContent = t("valOk"); els.validation.appendChild(d); }
  renderConvList();
}
function focusNode(id) {
  const row = findEntry(currentConv, id);
  if (!row) return;
  const p = nodePos(row) || { x: 0, y: 0 };
  const r = els.wrap.getBoundingClientRect();
  view.x = r.width / 2 - (p.x + 100) * view.s;
  view.y = r.height / 2 - p.y * view.s;
  applyView();
}
function fitView() {
  const rows = convEntries(currentConv);
  if (!rows.length) return;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const r of rows) {
    const p = nodePos(r); if (!p) continue;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + 200); maxY = Math.max(maxY, p.y + 120);
  }
  if (minX > maxX) return;
  const r = els.wrap.getBoundingClientRect();
  view.s = Math.min(1.2, Math.max(0.2, Math.min(r.width / (maxX - minX + 80), r.height / (maxY - minY + 80))));
  view.x = (r.width - (maxX - minX) * view.s) / 2 - minX * view.s;
  view.y = (r.height - (maxY - minY) * view.s) / 2 - minY * view.s;
  applyView();
}

/* ===================================================== 交互 ===================================================== */
const toWorld = (cx, cy) => {
  const r = els.wrap.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s };
};
let drag = null; // {mode:'pan'|'node'|'link'|'select', ...}
let spaceDown = false;
let suppressCtx = false;
const selBox = document.getElementById("selBox");

els.wrap.addEventListener("mousedown", (e) => {
  if (!model) return;
  if (pv) {
    // 预览中：仅允许平移画布，不允许编辑
    if (e.target.closest("#preview")) return;
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      drag = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, rmb: e.button === 2 };
      e.preventDefault();
    }
    return;
  }
  const port = e.target.closest(".outPort");
  const nodeDiv = e.target.closest(".node");
  const onEdge = e.target.closest("path.edge");
  // 右键：空白处按下可拖动平移（未移动则弹菜单），节点/连线交给 contextmenu
  if (e.button === 2) {
    if (!nodeDiv && !onEdge) {
      drag = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, rmb: true };
    }
    return;
  }
  if (pendingLinkFrom) {
    if (nodeDiv) addLink(pendingLinkFrom, nodeDiv.dataset.id);
    cancelPendingLink();
    e.preventDefault();
    return;
  }
  // 中键 / 空格+左键 / Alt+左键：平移
  if (e.button === 1 || ((spaceDown || e.altKey) && e.button === 0 && !nodeDiv && !port)) {
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  if (port && nodeDiv) {
    drag = { mode: "link", from: nodeDiv.dataset.id };
    els.tempEdge.style.display = "";
    e.preventDefault();
    return;
  }
  if (nodeDiv) {
    const id = nodeDiv.dataset.id;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+单击：增减选择，不拖动
      if (selNodes.has(id)) selNodes.delete(id); else selNodes.add(id);
      setNodeSelection([...selNodes]);
      renderNodes(); requestAnimationFrame(renderEdges); renderInspector();
      e.preventDefault();
      return;
    }
    if (!selNodes.has(id)) setNodeSelection([id]);
    else if (selNodes.size === 1) setNodeSelection([id]);
    else selection = selection && selection.type === "nodes" ? selection : { type: "nodes" };
    // 记录所有选中节点的起始位置，整组拖动
    const startPos = {};
    for (const nid of selNodes) {
      const r = findEntry(currentConv, nid);
      if (r) startPos[nid] = nodePos(r);
    }
    const w = toWorld(e.clientX, e.clientY);
    drag = { mode: "node", id, start: w, startPos, moved: false, preSnap: snap() };
    renderNodes(); requestAnimationFrame(renderEdges); renderInspector();
    e.preventDefault();
    return;
  }
  if (onEdge) return; // 边自己处理
  // 左键拖空白：框选
  const r = els.wrap.getBoundingClientRect();
  drag = { mode: "select", sx: e.clientX - r.left, sy: e.clientY - r.top, cx: e.clientX - r.left, cy: e.clientY - r.top, add: e.ctrlKey || e.metaKey, moved: false };
});

window.addEventListener("mousemove", (e) => {
  if (pendingLinkFrom && !drag) {
    const a = nodeAnchor(pendingLinkFrom);
    const w = toWorld(e.clientX, e.clientY);
    if (a) els.tempEdge.setAttribute("d", edgePath(a.bottom.x, a.bottom.y, w.x, w.y));
    return;
  }
  if (!drag) return;
  if (drag.mode === "pan") {
    view.x = drag.ox + e.clientX - drag.sx;
    view.y = drag.oy + e.clientY - drag.sy;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    applyView();
  } else if (drag.mode === "select") {
    const r = els.wrap.getBoundingClientRect();
    drag.cx = e.clientX - r.left; drag.cy = e.clientY - r.top;
    if (Math.abs(drag.cx - drag.sx) + Math.abs(drag.cy - drag.sy) > 4) drag.moved = true;
    selBox.style.display = "block";
    selBox.style.left = Math.min(drag.sx, drag.cx) + "px";
    selBox.style.top = Math.min(drag.sy, drag.cy) + "px";
    selBox.style.width = Math.abs(drag.cx - drag.sx) + "px";
    selBox.style.height = Math.abs(drag.cy - drag.sy) + "px";
  } else if (drag.mode === "node") {
    const w = toWorld(e.clientX, e.clientY);
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    drag.moved = true;
    for (const nid in drag.startPos) {
      const p = drag.startPos[nid];
      if (!p) continue;
      const x = Math.round(p.x + dx), y = Math.round(p.y + dy);
      const r = findEntry(currentConv, nid);
      eSet(r, "canvasRect", `${x};${y}`);
      const div = els.nodes.querySelector(`.node[data-id="${nid}"]`);
      if (div) { div.style.left = x + "px"; div.style.top = y + "px"; }
    }
    renderEdges();
  } else if (drag.mode === "link") {
    const a = nodeAnchor(drag.from);
    const w = toWorld(e.clientX, e.clientY);
    if (a) els.tempEdge.setAttribute("d", edgePath(a.bottom.x, a.bottom.y, w.x, w.y));
  }
});

window.addEventListener("mouseup", (e) => {
  if (!drag) return;
  if (drag.mode === "link") {
    els.tempEdge.style.display = "none";
    els.tempEdge.removeAttribute("d");
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const nodeDiv = target && target.closest(".node");
    if (nodeDiv) addLink(drag.from, nodeDiv.dataset.id);
  } else if (drag.mode === "node" && drag.moved) {
    pushUndoState(drag.preSnap);
    for (const nid in drag.startPos) {
      const r = findEntry(currentConv, nid);
      if (r) saveNodeLayout(currentConv, nid, eGet(r, "canvasRect"));
    }
    markDirty();
  } else if (drag.mode === "select") {
    selBox.style.display = "none";
    if (drag.moved) {
      // 框选：把与选区相交的节点加入选择
      const wr = els.wrap.getBoundingClientRect();
      const a = toWorld(Math.min(drag.sx, drag.cx) + wr.left, Math.min(drag.sy, drag.cy) + wr.top);
      const b = toWorld(Math.max(drag.sx, drag.cx) + wr.left, Math.max(drag.sy, drag.cy) + wr.top);
      const hit = [];
      els.nodes.querySelectorAll(".node").forEach(div => {
        const x = parseFloat(div.style.left), y = parseFloat(div.style.top);
        const w = div.offsetWidth, h = div.offsetHeight;
        if (x < b.x && x + w > a.x && y < b.y && y + h > a.y) hit.push(div.dataset.id);
      });
      setNodeSelection(drag.add ? [...selNodes, ...hit] : hit);
    } else {
      clearSelection();
    }
    renderAll();
  } else if (drag.mode === "pan" && drag.rmb && drag.moved) {
    suppressCtx = true; // 右键拖动平移后不弹菜单
  }
  drag = null;
});

els.wrap.addEventListener("dblclick", (e) => {
  if (!model || pv || e.target.closest("#preview") || e.target.closest(".node")) return;
  const w = toWorld(e.clientX, e.clientY);
  addNode(w.x - 100, w.y);
});

els.wrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const ns = Math.min(2.5, Math.max(0.15, view.s * factor));
  const r = els.wrap.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  view.x = mx - (mx - view.x) * (ns / view.s);
  view.y = my - (my - view.y) * (ns / view.s);
  view.s = ns;
  applyView();
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  if (pv) {
    if (e.key === "Escape") { e.preventDefault(); exitPreview(); }
    return; // 预览中屏蔽编辑快捷键
  }
  if (e.key === " ") { spaceDown = true; e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    if (!model || currentConv == null) return;
    e.preventDefault();
    setNodeSelection(convEntries(currentConv).map(r => eGet(r, "ID")));
    renderAll();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selNodes.size) deleteNodes([...selNodes]);
    else if (selection && selection.type === "link") { pushUndo(); model.links.splice(selection.idx, 1); selection = null; markDirty(); renderAll(); }
  } else if (e.key === "Escape") { cancelPendingLink(); hideCtx(); clearSelection(); renderAll(); }
  else if (e.key === "f") fitView();
});
window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

/* ===================================================== 右键菜单 ===================================================== */
const ctxMenu = document.getElementById("ctxMenu");
function showCtxMenu(x, y, items) {
  ctxMenu.innerHTML = "";
  for (const it of items) {
    if (it === "-") { const d = document.createElement("div"); d.className = "sep"; ctxMenu.appendChild(d); continue; }
    const d = document.createElement("div");
    d.className = "mi" + (it.danger ? " danger" : "") + (it.dim ? " dim" : "");
    d.textContent = it.label;
    d.onclick = () => { if (it.dim) return; hideCtx(); it.fn(); };
    ctxMenu.appendChild(d);
  }
  ctxMenu.style.display = "block";
  ctxMenu.style.left = Math.min(x, innerWidth - ctxMenu.offsetWidth - 4) + "px";
  ctxMenu.style.top = Math.min(y, innerHeight - ctxMenu.offsetHeight - 4) + "px";
}
function hideCtx() { ctxMenu.style.display = "none"; }
window.addEventListener("mousedown", (e) => { if (!e.target.closest("#ctxMenu")) hideCtx(); }, true);

els.wrap.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (suppressCtx) { suppressCtx = false; return; }
  if (!model || currentConv == null || pv) return;
  cancelPendingLink();
  const nodeDiv = e.target.closest(".node");
  const edge = e.target.closest("path.edge");
  const w = toWorld(e.clientX, e.clientY);
  if (nodeDiv) {
    const id = nodeDiv.dataset.id;
    // 在已多选的节点上右键 → 批量菜单；否则单选该节点
    if (!(selNodes.size > 1 && selNodes.has(id))) setNodeSelection([id]);
    renderAll();
    if (selNodes.size > 1) {
      const n = selNodes.size;
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("ctxAlignH"), fn: () => alignSelected("h") },
        { label: t("ctxAlignV"), fn: () => alignSelected("v") },
        "-",
        { label: t("ctxUnlinkN", { n }), fn: () => { pushUndo(); model.links = model.links.filter(l => !(l[0] === currentConv && selNodes.has(l[1]))); markDirty(); renderAll(); } },
        { label: t("ctxDeleteN", { n }), danger: true, fn: () => deleteNodes([...selNodes]) }
      ]);
      return;
    }
    const items = [
      { label: t("ctxPreviewFrom"), fn: () => startPreview(currentConv, id) },
      "-",
      { label: t("ctxLinkTo"), fn: () => startPendingLink(id) },
      { label: t("ctxAddChild"), fn: () => addChildNode(id) },
      { label: t("ctxDuplicate"), fn: () => duplicateNode(id) },
      "-",
      { label: t("ctxUnlinkAll"), fn: () => { pushUndo(); model.links = model.links.filter(l => !(l[0] === currentConv && l[1] === id)); markDirty(); renderAll(); } }
    ];
    if (id !== "0") items.push({ label: t("ctxDeleteNode"), danger: true, fn: () => deleteNode(id) });
    showCtxMenu(e.clientX, e.clientY, items);
  } else if (edge) {
    const idx = +edge.dataset.idx;
    selNodes.clear();
    selection = { type: "link", idx };
    renderAll();
    showCtxMenu(e.clientX, e.clientY, [
      { label: t("ctxDeleteLink"), danger: true, fn: () => { pushUndo(); model.links.splice(idx, 1); selection = null; markDirty(); renderAll(); } }
    ]);
  } else {
    showCtxMenu(e.clientX, e.clientY, [
      { label: t("ctxAddNode"), fn: () => addNode(w.x - 100, w.y) },
      "-",
      { label: t("ctxAutoLayout"), fn: () => autoLayout(currentConv) },
      { label: t("ctxFit"), fn: fitView }
    ]);
  }
});

// 左侧对话栏右键菜单
document.getElementById("sidebar").addEventListener("contextmenu", (e) => {
  if (!model || pv) return;
  // 角色区：新建 / 删除角色
  const aItem = e.target.closest(".actorItem");
  if (aItem || e.target.closest("#actorList")) {
    e.preventDefault();
    if (aItem) {
      const id = aItem.dataset.actorId;
      selNodes.clear(); selection = { type: "actor", id }; renderAll();
      showCtxMenu(e.clientX, e.clientY, [
        { label: t("ctxNewActor"), fn: addActor },
        "-",
        { label: t("ctxDeleteActor"), danger: true, fn: () => deleteActor(id) }
      ]);
    } else {
      showCtxMenu(e.clientX, e.clientY, [{ label: t("ctxNewActor"), fn: addActor }]);
    }
    return;
  }
  const item = e.target.closest(".convItem");
  if (!item && !e.target.closest("#convList") && !e.target.closest("h3")) return;
  e.preventDefault();
  if (item) {
    const id = item.dataset.convId;
    showCtxMenu(e.clientX, e.clientY, [
      { label: t("ctxRename"), fn: () => startRenameConv(id) },
      { label: t("ctxAutoLayout"), fn: () => { currentConv = id; renderAll(); requestAnimationFrame(() => autoLayout(id)); } },
      { label: t("ctxNewConv"), fn: addConversation },
      "-",
      { label: t("ctxDeleteConv"), danger: true, fn: () => deleteConversation(id) }
    ]);
  } else {
    showCtxMenu(e.clientX, e.clientY, [{ label: t("ctxNewConv"), fn: addConversation }]);
  }
});
// 侧栏小节标题上的 ＋ 按钮（事件委托：applyStaticI18n 会重写 h3 的 innerHTML）
document.getElementById("sidebar").addEventListener("click", (e) => {
  if (!model || pv) return;
  if (e.target.id === "btnAddActor") addActor();
  else if (e.target.id === "btnAddConv") addConversation();
});

/* ===================================================== 文件读写 ===================================================== */
/* ---------- 新建空白项目：页面内表单收集数据库元信息（Name/Author/Version/Description） ---------- */
function newProject() {
  const showForm = () => uiFormPrompt(t("newProjectTitle"), [
    { key: "name", label: t("fldProjName"), def: "New Dialogue", required: true },
    { key: "author", label: t("fldAuthor"), def: "" },
    { key: "version", label: t("fldVersion"), def: "1.0" },
    { key: "description", label: t("fldDescription"), def: "", textarea: true }
  ], createBlankProject, t("create"));
  if (dirty) uiConfirm(t("confirmDiscardNew"), showForm, { danger: true });
  else showForm();
}
function createBlankProject(info) {
  model = {
    dbHeader: ["ID", "Name", "Version", "Author", "Description", "Emphasis1", "Emphasis2", "Emphasis3", "Emphasis4"],
    dbValues: ["0", info.name, info.version, info.author, info.description, "#ffffff", "#ffffff", "#ffffff", "#ffffff"],
    globalUserScript: "",
    assets: {
      Actors: {
        header: ["ID", "Name", "Pictures", "NodeColor", "IsPlayer", "Description", "Display Name zh-CN"],
        types: ["Number", "Text", "Files", "Text", "Boolean", "Text", "Localization"],
        rows: [
          ["1", "Player", "[]", "", "True", "", ""],
          ["2", "NPC", "[]", "", "False", "", ""]
        ]
      },
      Items: { header: ["ID", "Name"], types: ["Number", "Text"], rows: [] },
      Locations: { header: ["ID", "Name"], types: ["Number", "Text"], rows: [] },
      Variables: { header: ["ID", "Name", "Initial Value", "Description"], types: ["Number", "Text", "Text", "Text"], rows: [] },
      Conversations: {
        header: ["ID", "Title", "Description", "Actor", "Conversant", "Overrides"],
        types: ["Number", "Text", "Text", "Number", "Number", "Special"],
        rows: [["1", "Act 1", "", "1", "2", "{}"]]
      }
    },
    entriesHeader: ["entrytag", "ConvID", "ID", "Actor", "Conversant", "Title", "MenuText", "DialogueText", "IsGroup", "FalseConditionAction", "ConditionPriority", "Conditions", "Script", "Sequence", "Description", "zh-CN", "Menu Text zh-CN", "canvasRect"],
    entriesTypes: ["Special", "Number", "Number", "Number", "Number", "Text", "Text", "Text", "Boolean", "Special", "Special", "Text", "Text", "Text", "Text", "Localization", "Localization", "Text"],
    entries: [],
    linksHeader: ["OriginConvID", "OriginID", "DestConvID", "DestID", "ConditionPriority"],
    linksTypes: ["Number", "Number", "Number", "Number", "Special"],
    links: []
  };
  // 对话 1 的 START 节点
  const e = model.entriesHeader.map(() => "");
  eSet(e, "ConvID", "1"); eSet(e, "ID", "0"); eSet(e, "Title", "START");
  eSet(e, "Actor", "1"); eSet(e, "Conversant", "2");
  eSet(e, "IsGroup", "False"); eSet(e, "FalseConditionAction", "Block"); eSet(e, "ConditionPriority", "Normal");
  eSet(e, "Sequence", "None()"); eSet(e, "canvasRect", "160;30");
  eSet(e, "entrytag", makeEntrytag(e));
  model.entries.push(e);
  fileName = (info.name || "dialogue").replace(/[\\/:*?"<>|]/g, "_") + ".csv";
  gdClearFiles();
  currentConv = "1";
  clearSelection();
  dirty = false;
  undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
  updateFileLabel();
  fitView(); renderAll(); runValidation();
  toast(t("projectCreated", { f: fileName }));
}

function updateFileLabel() {
  els.fileName.textContent = model ? fileName + t("fileInfo", { c: conversations().length, e: model.entries.length }) : "";
  updateAutosaveInfo();   // 文件来源变化（本地/Drive/新建）时同步刷新自动保存提示
}
function loadCsvText(text, name) {
  try {
    model = parseDSUCsv(text);
  } catch (err) {
    toast(t("csvParseFail", { msg: err.message }), "err");
    return;
  }
  fileName = name || fileName;
  applySavedLayout();   // 恢复网页端记忆的节点排版
  updateFileLabel();
  currentConv = conversations().length ? conversations()[0].id : null;
  clearSelection();
  dirty = false;
  undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
  fitView();
  renderAll();
  runValidation();
}

document.getElementById("fileInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { gdClearFiles(); loadCsvText(rd.result, f.name); };
  rd.readAsText(f, "utf-8");
  e.target.value = "";
});
/* ---------- ADG 项目格式（Atla Dialogue Graph，.adg）：CSV 数据 + 节点排版 ---------- */
const ADG_FORMAT = "atla-dialogue-graph";
function projectLayoutSubset() {
  // 只带上当前数据库里存在的对话的排版
  const ids = new Set(conversations().map(c => c.id));
  const out = {};
  for (const k in layoutStore) { if (ids.has(k.split(":")[0])) out[k] = layoutStore[k]; }
  return out;
}
function openAdgText(text, name) {
  let data;
  try { data = JSON.parse(text); } catch (err) { toast(t("adgParseFail"), "err"); return; }
  if (!data || data.format !== ADG_FORMAT || typeof data.csv !== "string") { toast(t("adgInvalid"), "err"); return; }
  Object.assign(layoutStore, data.layout || {});
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutStore)); } catch (e) {}
  loadCsvText(data.csv, data.fileName || name.replace(/\.(atladg|adg)$/i, ".csv"));
  toast(t("adgOpened", { f: name }));
}
function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportCsv() {
  if (!model) { toast(t("openFirst"), "warn"); return; }
  runValidation();
  const errs = conversations().flatMap(c => validateConv(c.id)).filter(v => v.level === "err");
  const doExport = () => {
    downloadFile(fileName, "﻿" + serializeDSUCsv(model), "text/csv;charset=utf-8");
    dirty = false;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
    toast(t("exported", { f: fileName }));
  };
  if (errs.length) uiConfirm(t("exportWithErrors", { n: errs.length }), doExport, { okLabel: t("exportAnyway"), danger: true });
  else doExport();
}
function exportAdg() {
  if (!model) { toast(t("openFirst"), "warn"); return; }
  const base = fileName.replace(/\.(csv|atladg|adg)$/i, "");
  const data = { format: ADG_FORMAT, version: 1, savedAt: Date.now(), fileName, csv: serializeDSUCsv(model), layout: projectLayoutSubset() };
  downloadFile(`${base}.atladg`, JSON.stringify(data), "application/json");
  dirty = false;
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
  toast(t("exported", { f: base + ".atladg" }));
}

document.getElementById("adgInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { gdClearFiles(); openAdgText(rd.result, f.name); };
  rd.readAsText(f, "utf-8");
  e.target.value = "";
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const rd = new FileReader();
  if (/\.(atladg|adg)$/i.test(f.name)) rd.onload = () => { gdClearFiles(); openAdgText(rd.result, f.name); };
  else if (f.name.toLowerCase().endsWith(".csv")) rd.onload = () => { gdClearFiles(); loadCsvText(rd.result, f.name); };
  else { toast(t("unsupportedFile"), "warn"); return; }
  rd.readAsText(f, "utf-8");
});

document.getElementById("btnOpenMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, [
    { label: t("newProject"), fn: newProject },
    "-",
    { label: t("openCsv"), fn: () => document.getElementById("fileInput").click() },
    { label: t("openAdgProj"), fn: () => document.getElementById("adgInput").click() },
    "-",
    { label: t("gdOpen"), fn: gdOpenFromDrive }
  ]);
});
document.getElementById("btnExportMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, [
    { label: t("exportCsvItem"), fn: exportCsv },
    { label: t("exportAdgItem"), fn: exportAdg },
    "-",
    { label: t("gdSaveCsv"), fn: () => gdSaveToDrive("csv") },
    { label: t("gdSaveAdg"), fn: () => gdSaveToDrive("adg") }
  ]);
});
document.getElementById("btnToolsMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, [
    { label: t("validateBtn"), fn: runValidation },
    { label: t("syncTextItem"), fn: syncDialogueText },
    { label: t("autoLayoutBtn"), fn: () => autoLayout(currentConv) },
    { label: t("fitBtn"), fn: fitView }
  ]);
});
document.getElementById("btnOptionsMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, [
    { label: t("langSection"), dim: true },
    { label: (lang === "zh" ? "✓ " : "　 ") + "中文", fn: () => setLang("zh") },
    { label: (lang === "en" ? "✓ " : "　 ") + "English", fn: () => setLang("en") },
    "-",
    { label: (gdAutosaveOn ? "✓ " : "　 ") + t("gdAutosaveOpt"), fn: gdToggleAutosave }
  ]);
});
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
// 语言切换后：重渲染所有动态生成的界面（节点、Inspector、检测结果、文件信息）
window.addEventListener("langchanged", () => {
  updateFileLabel();
  updateAutosaveInfo();
  hideCtx();
  renderAll();
  runValidation();
  if (pv && pv.cur) pvRender();
});

/* ===================================================== 侧栏缩放 / 折叠 ===================================================== */
const PANEL_KEY = "dsu-graph-editor-panels";
const PANEL_MIN = 150, PANEL_MAX = 520;
let panelState = { sidebarW: 220, inspectorW: 300, sidebarCollapsed: false, inspectorCollapsed: false };
try { Object.assign(panelState, JSON.parse(localStorage.getItem(PANEL_KEY)) || {}); } catch (e) {}

const appEl = document.getElementById("app");
function applyPanelState() {
  // 折叠时宽度设为 0；用 JS 直接算宽度，避免 inline 变量与 class 里的变量互相覆盖
  appEl.style.setProperty("--sidebar-w", (panelState.sidebarCollapsed ? 0 : panelState.sidebarW) + "px");
  appEl.style.setProperty("--inspector-w", (panelState.inspectorCollapsed ? 0 : panelState.inspectorW) + "px");
  appEl.classList.toggle("sidebar-collapsed", panelState.sidebarCollapsed);
  appEl.classList.toggle("inspector-collapsed", panelState.inspectorCollapsed);
  document.getElementById("toggleL").textContent = panelState.sidebarCollapsed ? "›" : "‹";
  document.getElementById("toggleR").textContent = panelState.inspectorCollapsed ? "‹" : "›";
}
function savePanelState() { try { localStorage.setItem(PANEL_KEY, JSON.stringify(panelState)); } catch (e) {} }

// 拖动分隔条改变宽度（在折叠状态下不响应拖动，仅折叠按钮可用）
function bindResizer(resizerId, side) {
  const rez = document.getElementById(resizerId);
  rez.addEventListener("mousedown", (e) => {
    if (e.target.closest(".panelToggle")) return;      // 点折叠按钮不触发拖动
    const collapsed = side === "left" ? panelState.sidebarCollapsed : panelState.inspectorCollapsed;
    if (collapsed) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? panelState.sidebarW : panelState.inspectorW;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const delta = side === "left" ? (ev.clientX - startX) : (startX - ev.clientX);
      const w = Math.max(PANEL_MIN, Math.min(PANEL_MAX, startW + delta));
      if (side === "left") panelState.sidebarW = w; else panelState.inspectorW = w;
      applyPanelState();
      requestAnimationFrame(renderEdges);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      savePanelState();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
bindResizer("resizeL", "left");
bindResizer("resizeR", "right");
document.getElementById("toggleL").addEventListener("click", (e) => {
  e.stopPropagation();
  panelState.sidebarCollapsed = !panelState.sidebarCollapsed;
  applyPanelState(); savePanelState(); requestAnimationFrame(renderEdges);
});
document.getElementById("toggleR").addEventListener("click", (e) => {
  e.stopPropagation();
  panelState.inspectorCollapsed = !panelState.inspectorCollapsed;
  applyPanelState(); savePanelState(); requestAnimationFrame(renderEdges);
});
applyPanelState();

/* ===================================================== 移动端提示 ===================================================== */
(function mobileWarn() {
  const isSmall = window.matchMedia("(max-width: 820px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem("dsu-mobile-ok") === "1"; } catch (e) {}
  if ((isSmall || coarse) && !dismissed) {
    document.getElementById("mobileWarn").classList.add("show");
  }
  document.getElementById("mobileContinue").addEventListener("click", () => {
    document.getElementById("mobileWarn").classList.remove("show");
    try { sessionStorage.setItem("dsu-mobile-ok", "1"); } catch (e) {}
  });
})();

/* ---------- 自动保存恢复 ---------- */
(function init() {
  applyView();
  updateUndoButtons();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)); } catch (e) {}
  if (saved && saved.csv) {
    const bar = document.getElementById("restoreBar");
    bar.style.display = "";
    document.getElementById("btnRestore").onclick = () => { loadCsvText(saved.csv, saved.fileName); bar.style.display = "none"; };
    document.getElementById("btnDiscard").onclick = () => { try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {} bar.style.display = "none"; };
  }
})();