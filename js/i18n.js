"use strict";
/* =====================================================
 * 国际化（i18n）：中 / 英切换
 * - t(key, vars)          取当前语言的界面文案
 * - makeFieldLabel(...)   生成 Inspector 字段 label + ? 帮助图标
 * - 右上角 #btnLang 切换语言，localStorage 持久化
 * ===================================================== */
const LANG_KEY = "dsu-graph-editor-lang";
let lang = "zh";
try { if (localStorage.getItem(LANG_KEY) === "en") lang = "en"; } catch (e) {}

const I18N = {
  /* ---------- 静态界面（data-i18n） ---------- */
  appName:        { zh: "Atla 对话编辑器", en: "Atla Dialogue Editor" },
  open:           { zh: "打开 ▾", en: "Open ▾" },
  export:         { zh: "导出 ▾", en: "Export ▾" },
  validateBtn:    { zh: "检测对话流", en: "Validate" },
  autoLayoutBtn:  { zh: "自动排版", en: "Auto Layout" },
  autoLayoutTip:  { zh: "按对话流分层自动排列当前对话的节点", en: "Automatically arrange the current conversation's nodes in layers by dialogue flow" },
  fitBtn:         { zh: "适应视图", en: "Fit View" },
  undoBtn:        { zh: "↩ 撤销", en: "↩ Undo" },
  redoBtn:        { zh: "↪ 重做", en: "↪ Redo" },
  restoreMsg:     { zh: "检测到上次未导出的修改", en: "Unexported changes from the last session were found" },
  restoreBtn:     { zh: "恢复", en: "Restore" },
  discardBtn:     { zh: "丢弃", en: "Discard" },
  conversations:  { zh: '对话 (Conversations)<span id="btnAddConv" class="hAdd" title="新建对话">＋</span>', en: 'Conversations<span id="btnAddConv" class="hAdd" title="New conversation">＋</span>' },
  actorsHeader:   { zh: '角色 (Actors)<span id="btnAddActor" class="hAdd" title="新建角色">＋</span>', en: 'Actors<span id="btnAddActor" class="hAdd" title="New actor">＋</span>' },
  validationResults: { zh: "检测结果", en: "Validation" },
  switchLang:     { zh: "Switch to English", en: "切换为中文" },
  pvBackBtn:      { zh: "← 上一步", en: "← Back" },
  pvExitBtn:      { zh: "✕ 结束预览", en: "✕ End Preview" },
  emptyHint: {
    zh: "打开 Dialogue System 导出的 CSV 或 ATLADG 项目文件开始编辑（可直接拖入窗口）<br><small>右键 / 双击空白处新建节点 · 左键拖空白框选 · Ctrl+单击多选 · 空格/中键/右键拖动平移</small>",
    en: "Open a CSV exported from Dialogue System, or an ATLADG project file, to start editing (or drag it into the window)<br><small>Right-click / double-click empty space: new node · Drag on empty space: box-select · Ctrl+click: multi-select · Space / middle / right drag: pan</small>"
  },
  /* ---------- Inspector ---------- */
  hintNoSelection: {
    zh: "未选中任何内容。<br><br>· 单击节点：编辑台词 / 条件 / 脚本 / 演出<br>· 右键节点 / 连线 / 空白处 / 左侧对话名：快捷菜单<br>· 左键拖空白框选，Ctrl+单击多选，Ctrl+A 全选<br>· 空格 / 鼠标中键 / 右键拖动：平移画布<br>· Ctrl+Z / Ctrl+Y：撤销 / 重做<br>· 对话名右侧 ▶ 或节点右键：预览对话",
    en: "Nothing selected.<br><br>· Click a node: edit text / conditions / script / sequence<br>· Right-click a node / link / empty space / conversation name: context menu<br>· Drag on empty space to box-select, Ctrl+click to multi-select, Ctrl+A to select all<br>· Space / middle mouse / right-drag: pan the canvas<br>· Ctrl+Z / Ctrl+Y: undo / redo<br>· ▶ next to a conversation, or node right-click: preview"
  },
  selectedN:      { zh: "已选中 {n} 个节点", en: "{n} nodes selected" },
  multiHint: {
    zh: "拖动任意选中节点可整体移动。<br>右键选中的节点可批量操作。<br>Ctrl+单击可增减选择。",
    en: "Drag any selected node to move them all.<br>Right-click a selected node for batch actions.<br>Ctrl+click to add / remove from the selection."
  },
  deleteNNodes:   { zh: "删除这 {n} 个节点", en: "Delete these {n} nodes" },
  nodeTitle:      { zh: "节点 #{id}（{tag}）", en: "Entry #{id} ({tag})" },
  outgoingLinks:  { zh: "出链 (Outgoing Links)", en: "Outgoing Links" },
  noOutgoing:     { zh: "（无 — 对话到此结束）", en: "(none — the conversation ends here)" },
  unlink:         { zh: "断开", en: "Unlink" },
  convRef:        { zh: "对话{n}", en: "Conv {n}" },
  deleteNodeBtn:  { zh: "删除此节点（含相关连线）", en: "Delete this entry (and its links)" },
  convTitle:      { zh: "对话 {id}", en: "Conversation {id}" },
  deleteConvBtn:  { zh: "删除整个对话", en: "Delete entire conversation" },
  confirmDeleteConv: { zh: "确定删除对话「{title}」及其 {n} 个节点？\n（可用 Ctrl+Z 撤销）", en: "Delete conversation “{title}” and its {n} entries?\n(Ctrl+Z to undo)" },
  linkTitle:      { zh: "连线", en: "Link" },
  linkHint:       { zh: "从 #{from} 到 {to}<br>按 Delete 键或下方按钮删除。", en: "From #{from} to {to}<br>Press Delete or use the button below to remove it." },
  deleteLink:     { zh: "删除连线", en: "Delete link" },
  isGroupTrue:    { zh: "是（组节点）", en: "True (group)" },
  isGroupFalse:   { zh: "否", en: "False" },
  /* ---------- 通用 ---------- */
  ok:             { zh: "确定", en: "OK" },
  cancel:         { zh: "取消", en: "Cancel" },
  delete:         { zh: "删除", en: "Delete" },
  unnamed:        { zh: "(未命名)", en: "(untitled)" },
  previewThis:    { zh: "预览此对话", en: "Preview this conversation" },
  dragToLink:     { zh: "拖出以连线", en: "Drag out to link" },
  menuTag:        { zh: "[菜单]", en: "[Menu]" },
  emptyText:      { zh: "(空)", en: "(empty)" },
  groupTag:       { zh: "[组节点]", en: "[Group]" },
  startNodeNoDelete: { zh: "START 节点不可删除", en: "The START entry cannot be deleted" },
  /* ---------- 预览 ---------- */
  pvTitle:        { zh: "预览 · {t}", en: "Preview · {t}" },
  pvStart:        { zh: "（对话开始）", en: "(Conversation start)" },
  pvContinue:     { zh: "▶ 继续", en: "▶ Continue" },
  pvEndSoon:      { zh: "— 对话结束，即将返回 —", en: "— End of conversation —" },
  pvEnded:        { zh: "对话结束", en: "Conversation ended" },
  pvBroken:       { zh: "预览中断：节点不存在", en: "Preview stopped: entry not found" },
  /* ---------- 检测 ---------- */
  valNoStart:     { zh: "缺少 START 节点 (ID 0)", en: "Missing START entry (ID 0)" },
  valLinkFrom:    { zh: "连线起点 #{id} 不存在", en: "Link origin #{id} does not exist" },
  valLinkTo:      { zh: "连线终点 {to} 不存在", en: "Link target {to} does not exist" },
  valUnreachable: { zh: "节点 #{id} 从 START 不可达", en: "Entry #{id} is unreachable from START" },
  valNoText:      { zh: "节点 #{id} 没有台词/菜单文本", en: "Entry #{id} has no dialogue / menu text" },
  valNoZh:        { zh: "节点 #{id} 缺少中文翻译", en: "Entry #{id} is missing the zh-CN translation" },
  valOk:          { zh: "✓ 未发现问题", en: "✓ No issues found" },
  /* ---------- 文件 ---------- */
  fileInfo:       { zh: "（{c} 个对话，{e} 条台词）", en: " ({c} conversations, {e} entries)" },
  csvParseFail:   { zh: "CSV 解析失败：{msg}", en: "Failed to parse CSV: {msg}" },
  openFirst:      { zh: "请先打开数据", en: "Open a file first" },
  exportWithErrors: { zh: "存在 {n} 个错误（见左下检测结果），仍要导出吗？", en: "There are {n} errors (see the validation panel). Export anyway?" },
  exportAnyway:   { zh: "仍然导出", en: "Export anyway" },
  exported:       { zh: "已导出 {f}", en: "Exported {f}" },
  adgParseFail:   { zh: "ADG 文件无法解析", en: "Cannot parse the ADG file" },
  adgInvalid:     { zh: "不是有效的 ADG 项目文件", en: "Not a valid ADG project file" },
  adgOpened:      { zh: "已打开项目 {f}", en: "Opened project {f}" },
  unsupportedFile: { zh: "只支持 .csv 或 .atladg 文件", en: "Only .csv or .atladg files are supported" },
  openCsv:        { zh: "打开 CSV…", en: "Open CSV…" },
  openAdgProj:    { zh: "打开 ATLADG 项目…", en: "Open ATLADG Project…" },
  exportCsvItem:  { zh: "导出 CSV", en: "Export CSV" },
  exportAdgItem:  { zh: "导出 ATLADG 项目", en: "Export ATLADG Project" },
  /* ---------- 右键菜单 ---------- */
  ctxAlignH:      { zh: "对齐所选（横向分布）", en: "Align selection (horizontal)" },
  ctxAlignV:      { zh: "对齐所选（纵向分布）", en: "Align selection (vertical)" },
  ctxUnlinkN:     { zh: "断开所选 {n} 个节点的出链", en: "Remove outgoing links of {n} selected nodes" },
  ctxDeleteN:     { zh: "删除所选 {n} 个节点", en: "Delete {n} selected nodes" },
  ctxPreviewFrom: { zh: "▶ 从此节点开始预览", en: "▶ Preview from this entry" },
  ctxLinkTo:      { zh: "连线到…（点击目标节点）", en: "Link to… (click a target node)" },
  ctxAddChild:    { zh: "添加后续节点", en: "Add child entry" },
  ctxDuplicate:   { zh: "复制节点", en: "Duplicate entry" },
  ctxUnlinkAll:   { zh: "断开所有出链", en: "Remove all outgoing links" },
  ctxDeleteNode:  { zh: "删除节点", en: "Delete entry" },
  ctxDeleteLink:  { zh: "删除连线", en: "Delete link" },
  ctxAddNode:     { zh: "在此处添加节点", en: "Add entry here" },
  ctxAutoLayout:  { zh: "自动排版本对话", en: "Auto-layout this conversation" },
  ctxFit:         { zh: "适应视图", en: "Fit view" },
  ctxRename:      { zh: "重命名", en: "Rename" },
  ctxNewConv:     { zh: "新建对话", en: "New conversation" },
  ctxDeleteConv:  { zh: "删除对话", en: "Delete conversation" },
  /* ---------- 角色 ---------- */
  actorTitle:     { zh: "角色 {id}", en: "Actor {id}" },
  playerBadgeTip: { zh: "玩家角色", en: "Player actor" },
  ctxNewActor:    { zh: "新建角色", en: "New actor" },
  ctxDeleteActor: { zh: "删除角色", en: "Delete actor" },
  deleteActorBtn: { zh: "删除此角色", en: "Delete this actor" },
  confirmDeleteActor: { zh: "确定删除角色「{name}」？{refs}\n（可用 Ctrl+Z 撤销）", en: "Delete actor “{name}”?{refs}\n(Ctrl+Z to undo)" },
  actorRefs:      { zh: "\n该角色被 {n} 条台词、{c} 个对话引用，删除后这些引用将失效。", en: "\nThis actor is referenced by {n} entries and {c} conversations; those references will become invalid." },
  isPlayerTrue:   { zh: "是（玩家）", en: "True (player)" },
  isPlayerFalse:  { zh: "否", en: "False" },
  boolTrue:       { zh: "True", en: "True" },
  boolFalse:      { zh: "False", en: "False" },
  /* ---------- 自定义字段 ---------- */
  addCustomField: { zh: "＋ 添加自定义字段", en: "＋ Add custom field" },
  addFieldTitle:  { zh: "添加自定义字段（将添加到所有角色）", en: "Add a custom field (added to all actors)" },
  fieldNamePrompt: { zh: "字段名称", en: "Field name" },
  fieldExists:    { zh: "字段已存在", en: "This field already exists" },
  confirmDeleteField: { zh: "删除字段「{name}」？所有角色的该字段值都会被移除。", en: "Delete field “{name}”? Its value will be removed from all actors." },
  deleteFieldTip: { zh: "删除此自定义字段", en: "Delete this custom field" },
  add:            { zh: "添加", en: "Add" },
  /* ---------- 字段通用 ---------- */
  locField:       { zh: "该语言的本地化译文。", en: "Localized text for this language." }
};

function t(key, vars) {
  const e = I18N[key];
  let s = e ? (e[lang] != null ? e[lang] : e.zh) : key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

/* =====================================================
 * Inspector 字段：中文标签 + 帮助说明
 * 说明文案参照 Dialogue System for Unity 各字段的含义
 * ===================================================== */
const FIELD_INFO = {
  entry: {
    "Title": { zh: "标题", help: {
      zh: "内部标注用的标题，只在编辑器里辨识节点用，不会显示给玩家。",
      en: "Internal title used to identify this entry in the editor. Not shown to the player." } },
    "Actor": { zh: "说话人", help: {
      zh: "说出本节点台词的角色（Speaker）。",
      en: "The actor who speaks this entry's line." } },
    "Conversant": { zh: "对话对象", help: {
      zh: "被说话的一方（Listener），通常是对话的另一位参与者。",
      en: "The actor being spoken to (the listener), usually the other participant of the conversation." } },
    "MenuText": { zh: "菜单文本", help: {
      zh: "显示在玩家选项菜单中的文本。留空时菜单会直接使用台词文本（Dialogue Text）。",
      en: "Text shown in the player response menu. If blank, the menu uses the Dialogue Text instead." } },
    "DialogueText": { zh: "台词文本", help: {
      zh: "角色实际说出的台词。留空时会使用菜单文本（Menu Text）。",
      en: "The line of dialogue that is actually spoken. If blank, the Menu Text is used instead." } },
    "IsGroup": { zh: "组节点", help: {
      zh: "组节点不显示任何内容，评估时直接穿透到它的子节点。常用于给分支分组或集中判断条件。",
      en: "Group entries show no content; evaluation passes through to their children. Useful for organizing branches or grouping conditions." } },
    "FalseConditionAction": { zh: "条件不满足时", help: {
      zh: "当 Conditions 为假时的处理方式：Block 阻止进入该节点；Passthrough 跳过本节点、继续评估其子节点。",
      en: "What to do when Conditions is false: Block prevents this entry from being used; Passthrough skips it and evaluates its children instead." } },
    "ConditionPriority": { zh: "条件优先级", help: {
      zh: "评估指向本节点的连线时使用的优先级，优先级高的先被评估（默认 Normal）。",
      en: "Priority used when evaluating links to this entry. Higher priorities are evaluated first (default: Normal)." } },
    "Conditions": { zh: "条件", help: {
      zh: "Lua 条件表达式，必须为真本节点才可用，例如 Variable[\"met\"] == true。留空表示总是可用。",
      en: "Lua expression that must be true for this entry to be available, e.g. Variable[\"met\"] == true. Blank means always available." } },
    "Script": { zh: "脚本", help: {
      zh: "本节点被说出时执行的 Lua 代码，例如 Variable[\"met\"] = true。",
      en: "Lua code that runs when this entry is spoken, e.g. Variable[\"met\"] = true." } },
    "Sequence": { zh: "演出序列", help: {
      zh: "节点播放时执行的 Sequencer 演出指令（镜头 / 动画 / 音频等）。留空使用 Dialogue Manager 的默认序列；None() 表示不执行任何演出。",
      en: "Sequencer commands (camera, animation, audio, etc.) played with this entry. Blank uses the Dialogue Manager's default sequence; None() does nothing." } },
    "Description": { zh: "描述", help: {
      zh: "给编剧或配音演员看的内部说明，不会显示给玩家。",
      en: "Internal notes for writers or voice actors. Not shown to the player." } },
    "zh-CN": { zh: "中文台词", help: {
      zh: "台词文本（Dialogue Text）的简体中文（zh-CN）译文。",
      en: "Simplified Chinese (zh-CN) localization of the Dialogue Text." } },
    "Menu Text zh-CN": { zh: "中文菜单文本", help: {
      zh: "菜单文本（Menu Text）的简体中文（zh-CN）译文。",
      en: "Simplified Chinese (zh-CN) localization of the Menu Text." } },
    "entrytag": { zh: "语音标签", help: {
      zh: "自动生成的条目标签（说话人_对话ID_节点ID），用于匹配语音等外部资源文件。",
      en: "Auto-generated tag (Actor_ConvID_EntryID) used to match voice-over and other external assets." } }
  },
  actor: {
    "Name": { zh: "名称", help: {
      zh: "角色的内部名称，在 Lua 脚本、entrytag 和数据表中使用。",
      en: "The actor's internal name, used in Lua scripts, entrytags, and data tables." } },
    "Display Name": { zh: "显示名", help: {
      zh: "显示给玩家的名称。留空时使用 Name。",
      en: "Name shown to the player. Falls back to Name if blank." } },
    "Display Name zh-CN": { zh: "中文显示名", help: {
      zh: "显示给玩家的简体中文（zh-CN）名称。",
      en: "Simplified Chinese (zh-CN) display name shown to the player." } },
    "Pictures": { zh: "图片", help: {
      zh: "角色的头像图片列表（DSU 中为 [] 括起的格式）。",
      en: "The actor's portrait picture list (bracketed [] format in DSU)." } },
    "NodeColor": { zh: "节点颜色", help: {
      zh: "该角色的节点在 Dialogue System 编辑器中的显示颜色。",
      en: "Color used for this actor's nodes in the Dialogue System editor." } },
    "IsPlayer": { zh: "玩家角色", help: {
      zh: "是否由玩家控制。玩家角色的台词会显示为响应菜单里的选项。",
      en: "Whether this actor is player-controlled. Player entries are shown as choices in the response menu." } },
    "Description": { zh: "描述", help: {
      zh: "角色的内部说明，不会显示给玩家。",
      en: "Internal description of this actor. Not shown to the player." } }
  },
  conv: {
    "Title": { zh: "对话标题", help: {
      zh: "对话的标题。可用 / 分隔形成子层级，例如 NPC/初次见面。",
      en: "Title of the conversation. Use / to create submenu levels, e.g. NPC/FirstMeeting." } },
    "Actor": { zh: "主要说话人", help: {
      zh: "对话的主要参与者（通常是玩家方）。新建节点时会默认引用它。",
      en: "Primary participant of the conversation (often the player). Used as the default for new entries." } },
    "Conversant": { zh: "对话对象", help: {
      zh: "对话的另一位参与者（通常是 NPC）。新建节点时会默认引用它。",
      en: "The other participant (often the NPC). Used as the default for new entries." } },
    "Description": { zh: "描述", help: {
      zh: "对话的内部说明，不会显示给玩家。",
      en: "Internal description of this conversation. Not shown to the player." } }
  }
};

/* ---------- 帮助提示（?）的悬浮气泡 ---------- */
let fieldTipEl = null;
function attachTip(el, text) {
  el.addEventListener("mouseenter", () => {
    if (!fieldTipEl) { fieldTipEl = document.createElement("div"); fieldTipEl.id = "fieldTip"; document.body.appendChild(fieldTipEl); }
    fieldTipEl.textContent = text;
    fieldTipEl.style.display = "block";
    const r = el.getBoundingClientRect();
    let left = r.left - 10;
    left = Math.min(left, innerWidth - fieldTipEl.offsetWidth - 8);
    if (left < 4) left = 4;
    fieldTipEl.style.left = left + "px";
    let top = r.bottom + 6;
    if (top + fieldTipEl.offsetHeight > innerHeight - 4) top = r.top - fieldTipEl.offsetHeight - 6;
    fieldTipEl.style.top = top + "px";
  });
  el.addEventListener("mouseleave", () => { if (fieldTipEl) fieldTipEl.style.display = "none"; });
}

// 生成 Inspector 字段的 label（含中英文标签与 ? 帮助图标）
// ctx: "entry" | "conv"；fallbackHelpKey：未收录字段的通用说明（如本地化列）
function makeFieldLabel(name, ctx, fallbackHelpKey) {
  const info = (FIELD_INFO[ctx] || {})[name];
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = (lang === "zh" && info && info.zh) ? info.zh : name;
  label.appendChild(span);
  const help = info && info.help ? (info.help[lang] || info.help.zh)
    : (fallbackHelpKey ? t(fallbackHelpKey) : null);
  if (help) {
    const q = document.createElement("span");
    q.className = "qmark";
    q.textContent = "?";
    attachTip(q, help);
    label.appendChild(q);
  }
  return label;
}

/* ---------- 静态界面文案替换与语言切换 ---------- */
function applyStaticI18n() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  const b = document.getElementById("btnLang");
  if (b) { b.textContent = lang === "zh" ? "English" : "中文"; b.title = t("switchLang"); }
}
document.getElementById("btnLang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  applyStaticI18n();
  window.dispatchEvent(new Event("langchanged"));
});
applyStaticI18n();
