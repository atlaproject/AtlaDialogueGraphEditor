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

/* ---------- 自动保存 ---------- */
const AUTOSAVE_KEY = "dsu-graph-editor-autosave";
let dirty = false;
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
    c: model.assets.Conversations ? model.assets.Conversations.rows : []
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
function updateUndoButtons() {
  document.getElementById("btnUndo").disabled = !undoStack.length;
  document.getElementById("btnRedo").disabled = !redoStack.length;
}
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
  const cancel = document.createElement("button"); cancel.textContent = opts.cancelLabel || "取消";
  const ok = document.createElement("button"); ok.textContent = opts.okLabel || "确定";
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

/* ===================================================== 渲染 ===================================================== */
function applyView() { els.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`; }

function renderAll() {
  renderConvList();
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
    div.innerHTML = `<span>${c.id}. ${escapeHtml(c.title || "(未命名)")}</span>` +
      (issues ? `<span class="badge">${issues}</span>` : "") +
      `<span class="playBtn" title="预览此对话">▶</span>`;
    div.dataset.convId = c.id;
    div.onclick = () => { currentConv = c.id; selNodes.clear(); selection = { type: "conv", id: c.id }; fitView(); renderAll(); };
    div.ondblclick = () => startRenameConv(c.id);
    div.querySelector(".playBtn").onclick = (e) => { e.stopPropagation(); startPreview(c.id, "0"); };
    els.convList.appendChild(div);
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
    const speaker = a ? (a.zh ? `${a.zh} <span style="opacity:.6">${escapeHtml(a.name)}</span>` : escapeHtml(a.name)) : "?";
    let body = "";
    if (isStart) body = `<div class="en" style="color:var(--warn)">&lt;START&gt;</div>`;
    else {
      const menu = eGet(row, "MenuText"), en = eGet(row, "DialogueText"), zh = eGet(row, "zh-CN");
      if (menu) body += `<div class="menu">[菜单] ${escapeHtml(menu)}</div>`;
      if (en) body += `<div class="en">${escapeHtml(en)}</div>`;
      if (zh) body += `<div class="zh">${escapeHtml(zh)}</div>`;
      if (!body) body = `<div class="en" style="color:var(--text-dim)">(空)</div>`;
      if (isGroup) body = `<div class="en" style="color:#8fbc8f">[组节点]</div>` + body;
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
    if (xl.length) extra += `<div class="xlinks">${xl.map(l => `→ 对话${l[2]}:${l[3]}`).join("　")}</div>`;
    div.innerHTML = `<div class="head"><span>${speaker}</span><span class="eid">#${id}</span></div><div class="body">${body}</div>${extra}<div class="outPort" title="拖出以连线"></div>`;
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
    ins.innerHTML = `<div class="hintText">未选中任何内容。<br><br>· 单击节点：编辑台词 / 条件 / 脚本 / 演出<br>· 右键节点 / 连线 / 空白处 / 左侧对话名：快捷菜单<br>· 左键拖空白框选，Ctrl+单击多选，Ctrl+A 全选<br>· 空格 / 鼠标中键 / 右键拖动：平移画布<br>· Ctrl+Z / Ctrl+Y：撤销 / 重做<br>· 对话名右侧 ▶ 或节点右键：预览对话</div>`;
    return;
  }
  if (selection.type === "conv") return renderConvInspector();
  if (selection.type === "link") return renderLinkInspector();
  if (selection.type === "nodes") {
    const h3 = document.createElement("h3");
    h3.textContent = `已选中 ${selNodes.size} 个节点`;
    ins.appendChild(h3);
    const d = document.createElement("div"); d.className = "hintText";
    d.innerHTML = "拖动任意选中节点可整体移动。<br>右键选中的节点可批量操作。<br>Ctrl+单击可增减选择。";
    ins.appendChild(d);
    const del = document.createElement("button"); del.className = "danger"; del.textContent = `删除这 ${selNodes.size} 个节点`;
    del.onclick = () => deleteNodes([...selNodes]);
    ins.appendChild(del);
    return;
  }
  const row = findEntry(currentConv, selection.id);
  if (!row) { selection = null; return renderInspector(); }
  const h3 = document.createElement("h3");
  h3.textContent = `节点 #${selection.id}（${makeEntrytag(row)}）`;
  ins.appendChild(h3);
  const skip = new Set(["entrytag", "ConvID", "ID", "canvasRect"]);
  const acts = actors();
  model.entriesHeader.forEach((name, ci) => {
    if (skip.has(name)) return;
    const fd = document.createElement("div"); fd.className = "field";
    const label = document.createElement("label"); label.textContent = name; fd.appendChild(label);
    const val = row[ci] || "";
    let input;
    if (name === "Actor" || name === "Conversant") {
      input = document.createElement("select");
      for (const a of acts) {
        const o = document.createElement("option");
        o.value = a.id; o.textContent = `${a.id}. ${a.zh || a.name}`;
        if (a.id === val) o.selected = true;
        input.appendChild(o);
      }
    } else if (name === "IsGroup") {
      input = document.createElement("select");
      for (const v of ["False", "True"]) { const o = document.createElement("option"); o.value = v; o.textContent = v === "True" ? "是（组节点）" : "否"; if (val.toLowerCase() === v.toLowerCase()) o.selected = true; input.appendChild(o); }
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
  const h32 = document.createElement("h3"); h32.textContent = "出链 (Outgoing Links)"; ins.appendChild(h32);
  const out = model.links.filter(l => l[0] === currentConv && l[1] === selection.id);
  if (!out.length) { const d = document.createElement("div"); d.className = "linkRow"; d.style.color = "var(--text-dim)"; d.textContent = "（无 — 对话到此结束）"; ins.appendChild(d); }
  for (const l of out) {
    const d = document.createElement("div"); d.className = "linkRow";
    const target = l[2] === currentConv ? findEntry(l[2], l[3]) : null;
    const desc = target ? (eGet(target, "MenuText") || eGet(target, "DialogueText") || eGet(target, "Title") || "").slice(0, 18) : "";
    d.innerHTML = `<span style="flex:1">→ ${l[2] === currentConv ? "" : "对话" + l[2] + " "}#${l[3]} <span style="color:var(--text-dim)">${escapeHtml(desc)}</span></span>`;
    const btn = document.createElement("button"); btn.textContent = "断开";
    btn.onclick = () => { pushUndo(); model.links.splice(model.links.indexOf(l), 1); markDirty(); renderAll(); };
    d.appendChild(btn);
    ins.appendChild(d);
  }
  if (selection.id !== "0") {
    const del = document.createElement("button"); del.className = "danger"; del.textContent = "删除此节点（含相关连线）";
    del.onclick = () => deleteNode(selection.id);
    ins.appendChild(del);
  }
}

function renderConvInspector() {
  const ins = els.inspector;
  const sec = model.assets.Conversations;
  const row = sec.rows.find(r => r[sec.header.indexOf("ID")] === selection.id);
  if (!row) return;
  const h3 = document.createElement("h3"); h3.textContent = `对话 ${selection.id}`; ins.appendChild(h3);
  sec.header.forEach((name, ci) => {
    if (name === "ID" || name === "Overrides") return;
    const fd = document.createElement("div"); fd.className = "field";
    fd.innerHTML = `<label>${escapeHtml(name)}</label>`;
    let input;
    if (name === "Actor" || name === "Conversant") {
      input = document.createElement("select");
      for (const a of actors()) { const o = document.createElement("option"); o.value = a.id; o.textContent = `${a.id}. ${a.zh || a.name}`; if (a.id === row[ci]) o.selected = true; input.appendChild(o); }
    } else { input = document.createElement("input"); input.type = "text"; input.value = row[ci] || ""; }
    bindUndoCapture(input);
    input.addEventListener("input", () => { row[ci] = input.value; markDirty(); renderConvList(); });
    fd.appendChild(input); ins.appendChild(fd);
  });
  const del = document.createElement("button"); del.className = "danger"; del.textContent = "删除整个对话";
  del.onclick = () => deleteConversation(selection.id);
  ins.appendChild(del);
}

function deleteConversation(id) {
  const sec = model.assets.Conversations;
  const conv = conversations().find(c => c.id === id);
  const count = convEntries(id).length;
  uiConfirm(`确定删除对话「${(conv && conv.title) || id}」及其 ${count} 个节点？\n（可用 Ctrl+Z 撤销）`, () => {
    pushUndo();
    sec.rows = sec.rows.filter(r => r[sec.header.indexOf("ID")] !== id);
    model.entries = model.entries.filter(r => eGet(r, "ConvID") !== id);
    model.links = model.links.filter(l => l[0] !== id && l[2] !== id);
    if (currentConv === id) currentConv = conversations().length ? conversations()[0].id : null;
    clearSelection(); markDirty(); renderAll();
  }, { okLabel: "删除", danger: true });
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
  const h3 = document.createElement("h3"); h3.textContent = "连线"; ins.appendChild(h3);
  const d = document.createElement("div"); d.className = "hintText";
  d.innerHTML = `从 #${l[1]} 到 ${l[2] === currentConv ? "" : "对话" + l[2] + " "}#${l[3]}<br>按 Delete 键或下方按钮删除。`;
  ins.appendChild(d);
  const del = document.createElement("button"); del.className = "danger"; del.textContent = "删除连线";
  del.onclick = () => { pushUndo(); model.links.splice(selection.idx, 1); selection = null; markDirty(); renderAll(); };
  ins.appendChild(del);
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
  if (!ids.length) { toast("START 节点不可删除", "warn"); return; }
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
  if (!row) { exitPreview("预览中断：节点不存在"); return; }
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
  document.getElementById("pvTitle").textContent = `预览 · ${(c && c.title) || conv}`;
  document.getElementById("pvBack").disabled = pv.trail.length === 0;
  const isStart = eGet(row, "Title") === "START" && id === "0";
  const spk = document.getElementById("pvSpeaker"), txt = document.getElementById("pvText"),
        zh = document.getElementById("pvZh"), meta = document.getElementById("pvMeta");
  if (isStart) {
    spk.textContent = ""; txt.textContent = "（对话开始）"; zh.textContent = ""; meta.textContent = "";
  } else {
    const a = actorById(eGet(row, "Actor"));
    spk.textContent = a ? (a.zh ? `${a.zh}（${a.name}）` : a.name) : "?";
    txt.textContent = eGet(row, "DialogueText") || eGet(row, "MenuText") || "（空）";
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
    d.textContent = "— 对话结束，即将返回 —";
    box.appendChild(d);
    pv.endTimer = setTimeout(() => exitPreview("对话结束"), 1500);
    return;
  }
  const single = kids.length === 1 && !(actorById(eGet(kids[0].row, "Actor")) || {}).isPlayer;
  if (single) {
    const b = document.createElement("button");
    b.textContent = "▶ 继续";
    b.onclick = () => pvGoto(kids[0].conv, kids[0].id, true);
    box.appendChild(b);
    return;
  }
  for (const k of kids) {
    const ka = actorById(eGet(k.row, "Actor"));
    const label = eGet(k.row, "MenuText") || eGet(k.row, "DialogueText") || "（空）";
    const labelZh = eGet(k.row, "Menu Text zh-CN") || eGet(k.row, "zh-CN") || "";
    const b = document.createElement("button");
    b.textContent = (ka && !ka.isPlayer ? `${ka.zh || ka.name}: ` : "") + label + (labelZh ? `　${labelZh}` : "");
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
  if (!ids.has("0")) issues.push({ level: "err", msg: "缺少 START 节点 (ID 0)", conv: convId });
  for (const l of links) {
    if (!ids.has(l[1])) issues.push({ level: "err", msg: `连线起点 #${l[1]} 不存在`, conv: convId });
    const destOk = l[2] === convId ? ids.has(l[3]) : convEntries(l[2]).some(r => eGet(r, "ID") === l[3]);
    if (!destOk) issues.push({ level: "err", msg: `连线终点 对话${l[2]}#${l[3]} 不存在`, conv: convId });
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
    if (!reach.has(id)) issues.push({ level: "warn", msg: `节点 #${id} 从 START 不可达`, conv: convId, node: id });
    if (id !== "0" && eGet(r, "IsGroup").toLowerCase() !== "true" && !eGet(r, "DialogueText") && !eGet(r, "MenuText"))
      issues.push({ level: "warn", msg: `节点 #${id} 没有台词/菜单文本`, conv: convId, node: id });
    const zh = col("zh-CN") >= 0 ? eGet(r, "zh-CN") : null;
    if (id !== "0" && zh !== null && eGet(r, "DialogueText") && !zh)
      issues.push({ level: "info", msg: `节点 #${id} 缺少中文翻译`, conv: convId, node: id });
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
  if (!total) { const d = document.createElement("div"); d.className = "vItem info"; d.textContent = "✓ 未发现问题"; els.validation.appendChild(d); }
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
    d.className = "mi" + (it.danger ? " danger" : "");
    d.textContent = it.label;
    d.onclick = () => { hideCtx(); it.fn(); };
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
        { label: `对齐所选（横向分布）`, fn: () => alignSelected("h") },
        { label: `对齐所选（纵向分布）`, fn: () => alignSelected("v") },
        "-",
        { label: `断开所选 ${n} 个节点的出链`, fn: () => { pushUndo(); model.links = model.links.filter(l => !(l[0] === currentConv && selNodes.has(l[1]))); markDirty(); renderAll(); } },
        { label: `删除所选 ${n} 个节点`, danger: true, fn: () => deleteNodes([...selNodes]) }
      ]);
      return;
    }
    const items = [
      { label: "▶ 从此节点开始预览", fn: () => startPreview(currentConv, id) },
      "-",
      { label: "连线到…（点击目标节点）", fn: () => startPendingLink(id) },
      { label: "添加后续节点", fn: () => addChildNode(id) },
      { label: "复制节点", fn: () => duplicateNode(id) },
      "-",
      { label: "断开所有出链", fn: () => { pushUndo(); model.links = model.links.filter(l => !(l[0] === currentConv && l[1] === id)); markDirty(); renderAll(); } }
    ];
    if (id !== "0") items.push({ label: "删除节点", danger: true, fn: () => deleteNode(id) });
    showCtxMenu(e.clientX, e.clientY, items);
  } else if (edge) {
    const idx = +edge.dataset.idx;
    selNodes.clear();
    selection = { type: "link", idx };
    renderAll();
    showCtxMenu(e.clientX, e.clientY, [
      { label: "删除连线", danger: true, fn: () => { pushUndo(); model.links.splice(idx, 1); selection = null; markDirty(); renderAll(); } }
    ]);
  } else {
    showCtxMenu(e.clientX, e.clientY, [
      { label: "在此处添加节点", fn: () => addNode(w.x - 100, w.y) },
      "-",
      { label: "自动排版本对话", fn: () => autoLayout(currentConv) },
      { label: "适应视图", fn: fitView }
    ]);
  }
});

// 左侧对话栏右键菜单
document.getElementById("sidebar").addEventListener("contextmenu", (e) => {
  if (!model || pv) return;
  const item = e.target.closest(".convItem");
  if (!item && !e.target.closest("#convList") && !e.target.closest("h3")) return;
  e.preventDefault();
  if (item) {
    const id = item.dataset.convId;
    showCtxMenu(e.clientX, e.clientY, [
      { label: "重命名", fn: () => startRenameConv(id) },
      { label: "自动排版此对话", fn: () => { currentConv = id; renderAll(); requestAnimationFrame(() => autoLayout(id)); } },
      { label: "新建对话", fn: addConversation },
      "-",
      { label: "删除对话", danger: true, fn: () => deleteConversation(id) }
    ]);
  } else {
    showCtxMenu(e.clientX, e.clientY, [{ label: "新建对话", fn: addConversation }]);
  }
});

/* ===================================================== 文件读写 ===================================================== */
function loadCsvText(text, name) {
  try {
    model = parseDSUCsv(text);
  } catch (err) {
    toast("CSV 解析失败：" + err.message, "err");
    return;
  }
  fileName = name || fileName;
  applySavedLayout();   // 恢复网页端记忆的节点排版
  els.fileName.textContent = fileName + `（${conversations().length} 个对话，${model.entries.length} 条台词）`;
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
  rd.onload = () => loadCsvText(rd.result, f.name);
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
  try { data = JSON.parse(text); } catch (err) { toast("ADG 文件无法解析", "err"); return; }
  if (!data || data.format !== ADG_FORMAT || typeof data.csv !== "string") { toast("不是有效的 ADG 项目文件", "err"); return; }
  Object.assign(layoutStore, data.layout || {});
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutStore)); } catch (e) {}
  loadCsvText(data.csv, data.fileName || name.replace(/\.(atladg|adg)$/i, ".csv"));
  toast(`已打开项目 ${name}`);
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
  if (!model) { toast("请先打开数据", "warn"); return; }
  runValidation();
  const errs = conversations().flatMap(c => validateConv(c.id)).filter(v => v.level === "err");
  const doExport = () => {
    downloadFile(fileName, "﻿" + serializeDSUCsv(model), "text/csv;charset=utf-8");
    dirty = false;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
    toast(`已导出 ${fileName}`);
  };
  if (errs.length) uiConfirm(`存在 ${errs.length} 个错误（见左下检测结果），仍要导出吗？`, doExport, { okLabel: "仍然导出", danger: true });
  else doExport();
}
function exportAdg() {
  if (!model) { toast("请先打开数据", "warn"); return; }
  const base = fileName.replace(/\.(csv|atladg|adg)$/i, "");
  const data = { format: ADG_FORMAT, version: 1, savedAt: Date.now(), fileName, csv: serializeDSUCsv(model), layout: projectLayoutSubset() };
  downloadFile(`${base}.atladg`, JSON.stringify(data), "application/json");
  dirty = false;
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
  toast(`已导出 ${base}.atladg`);
}

document.getElementById("adgInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => openAdgText(rd.result, f.name);
  rd.readAsText(f, "utf-8");
  e.target.value = "";
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const rd = new FileReader();
  if (/\.(atladg|adg)$/i.test(f.name)) rd.onload = () => openAdgText(rd.result, f.name);
  else if (f.name.toLowerCase().endsWith(".csv")) rd.onload = () => loadCsvText(rd.result, f.name);
  else { toast("只支持 .csv 或 .atladg 文件", "warn"); return; }
  rd.readAsText(f, "utf-8");
});

document.getElementById("btnOpenMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, [
    { label: "打开 CSV…", fn: () => document.getElementById("fileInput").click() },
    { label: "打开 ATLADG 项目…", fn: () => document.getElementById("adgInput").click() }
  ]);
});
document.getElementById("btnExportMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, [
    { label: "导出 CSV", fn: exportCsv },
    { label: "导出 ATLADG 项目", fn: exportAdg }
  ]);
});
document.getElementById("btnValidate").addEventListener("click", runValidation);
document.getElementById("btnAutoLayout").addEventListener("click", () => autoLayout(currentConv));
document.getElementById("btnFit").addEventListener("click", fitView);
document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnRedo").addEventListener("click", redo);
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

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