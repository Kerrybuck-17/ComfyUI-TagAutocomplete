/**
 * Standalone settings panel (🏷️ button).
 *
 * The same options are registered in the ComfyUI settings dialog through
 * `tc_native_settings.js`; this panel additionally offers the JSON editors,
 * the usage statistics table and manual rescans.
 */

import { applyConfig, CFG, DEFAULT_CFG, state } from "./tc_config.js";
import { loadFileDependentData, refreshLibrary } from "./tc_data.js";
import { getJSON } from "./tc_env.js";
import { SETTINGS_SCHEMA, comboOptionsFor } from "./tc_schema.js";
import { getByPath, setByPath } from "./tc_util.js";
import { applyThemeVars, injectStyles } from "./tc_style.js";

let overlay = null;
let dialog = null;
let statusEl = null;
const FIELD_BY_KEY = new Map();

for (const group of SETTINGS_SCHEMA) {
  for (const field of group.fields) FIELD_BY_KEY.set(field.key, field);
}

function fieldId(key) {
  return `tac-field-${key.replace(/[.]/g, "-")}`;
}

function buildField(field) {
  const wrapper = document.createElement("div");
  const wide = field.type === "textarea" || field.type === "json" || field.list;
  wrapper.className = wide ? "tac-field-wide" : "tac-field";

  const label = document.createElement("label");
  label.textContent = field.label;
  label.htmlFor = fieldId(field.key);

  const current = getByPath(CFG, field.key, getByPath(DEFAULT_CFG, field.key));
  let input;

  switch (field.type) {
    case "bool": {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!current;
      break;
    }
    case "number":
    case "slider": {
      input = document.createElement("input");
      input.type = "number";
      const attrs = field.attrs || {};
      if (attrs.min !== undefined) input.min = String(attrs.min);
      if (attrs.max !== undefined) input.max = String(attrs.max);
      input.step = String(attrs.step ?? 1);
      input.value = current === undefined || current === null ? "" : String(current);
      break;
    }
    case "combo": {
      input = document.createElement("select");
      for (const option of comboOptionsFor(field, current)) {
        const el = document.createElement("option");
        el.value = String(option.value);
        el.textContent = option.text;
        input.appendChild(el);
      }
      if (current !== undefined && current !== null) input.value = String(current);
      break;
    }
    case "json": {
      input = document.createElement("textarea");
      try {
        input.value = JSON.stringify(current ?? {}, null, 2);
      } catch {
        input.value = "{}";
      }
      break;
    }
    case "textarea": {
      input = document.createElement("textarea");
      const value = Array.isArray(current) ? current.join("\n") : current ?? "";
      input.value = String(value);
      break;
    }
    default: {
      input = document.createElement("input");
      input.type = "text";
      input.value = current === undefined || current === null ? "" : String(current);
    }
  }

  input.id = fieldId(field.key);
  input.dataset.key = field.key;
  input.dataset.type = field.type;
  if (field.list) input.dataset.list = "1";

  if (field.type === "bool") {
    wrapper.appendChild(input);
    wrapper.appendChild(label);
  } else if (wide) {
    wrapper.appendChild(label);
    wrapper.appendChild(input);
  } else {
    wrapper.appendChild(input);
    wrapper.appendChild(label);
  }

  if (field.hint) {
    const hint = document.createElement("span");
    hint.className = "tac-hint";
    hint.textContent = field.hint;
    wrapper.appendChild(hint);
  }
  return wrapper;
}

function buildDialog() {
  injectStyles();
  applyThemeVars();

  overlay = document.createElement("div");
  overlay.className = "tac-overlay";

  dialog = document.createElement("div");
  dialog.className = "tac-dialog";

  const header = document.createElement("div");
  header.className = "tac-dialog-header";
  const title = document.createElement("h2");
  title.textContent = "Tag 自动补全设置 (TagComplete)";
  const closeBtn = document.createElement("button");
  closeBtn.className = "tac-btn";
  closeBtn.textContent = "✕";
  closeBtn.title = "关闭";
  closeBtn.addEventListener("click", closeSettings);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "tac-dialog-body";

  const note = document.createElement("div");
  note.className = "tac-section";
  note.innerHTML =
    '<p class="tac-hint" style="margin:0 0 8px">同样的选项也注册在 <b>ComfyUI 设置 → 🏷️ Tag 自动补全</b>，' +
    "可以直接在那里修改；这里另外提供 JSON 编辑、使用统计和重新扫描。</p>";
  body.appendChild(note);

  for (const group of SETTINGS_SCHEMA) {
    const box = document.createElement("div");
    box.className = "tac-section";
    const heading = document.createElement("h3");
    heading.textContent = group.section;
    box.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "tac-grid";
    for (const field of group.fields) grid.appendChild(buildField(field));
    box.appendChild(grid);
    body.appendChild(box);
  }

  const statsSection = document.createElement("div");
  statsSection.className = "tac-section";
  statsSection.innerHTML = "<h3>使用统计</h3>";
  const statsWrap = document.createElement("div");
  statsWrap.className = "tac-table-wrap";
  statsWrap.id = "tac-stats";
  statsSection.appendChild(statsWrap);
  body.appendChild(statsSection);

  const footer = document.createElement("div");
  footer.className = "tac-dialog-footer";

  const saveBtn = document.createElement("button");
  saveBtn.className = "tac-btn primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", () => saveSettings());

  const applyBtn = document.createElement("button");
  applyBtn.className = "tac-btn";
  applyBtn.textContent = "保存并关闭";
  applyBtn.addEventListener("click", async () => {
    await saveSettings();
    closeSettings();
  });

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "tac-btn";
  refreshBtn.textContent = "重新扫描通配符 / 模型";
  refreshBtn.addEventListener("click", async () => {
    setStatus("正在扫描…");
    try {
      await refreshLibrary();
      await loadFileDependentData({ force: true });
      rebuildDialog();
      setStatus("扫描完成");
    } catch (error) {
      setStatus(`扫描失败: ${error.message}`);
    }
  });

  const reloadTagsBtn = document.createElement("button");
  reloadTagsBtn.className = "tac-btn";
  reloadTagsBtn.textContent = "重新加载标签 / 翻译";
  reloadTagsBtn.addEventListener("click", async () => {
    setStatus("正在重新加载…");
    try {
      await loadFileDependentData({ force: true });
      setStatus(`已加载 ${state.allTags.length} 个标签`);
    } catch (error) {
      setStatus(`加载失败: ${error.message}`);
    }
  });

  const resetBtn = document.createElement("button");
  resetBtn.className = "tac-btn danger";
  resetBtn.textContent = "恢复默认";
  resetBtn.addEventListener("click", async () => {
    await applyConfig(JSON.parse(JSON.stringify(DEFAULT_CFG)));
    await loadFileDependentData({ force: true });
    rebuildDialog();
    setStatus("已恢复默认设置");
  });

  statusEl = document.createElement("span");
  statusEl.className = "tac-status";

  const spacer = document.createElement("span");
  spacer.className = "tac-spacer";

  footer.appendChild(saveBtn);
  footer.appendChild(applyBtn);
  footer.appendChild(reloadTagsBtn);
  footer.appendChild(refreshBtn);
  footer.appendChild(resetBtn);
  footer.appendChild(spacer);
  footer.appendChild(statusEl);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) closeSettings();
  });

  loadStats(statsWrap);
  return dialog;
}

function rebuildDialog() {
  const wasVisible = overlay?.dataset.visible === "1";
  overlay?.remove();
  overlay = null;
  dialog = null;
  if (wasVisible) openSettings();
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function loadStats(container) {
  try {
    const response = await getJSON("/tagcomplete/frequency/all");
    const rows = response?.result || [];
    if (!rows.length) {
      container.textContent = "暂无使用记录";
      return;
    }
    const table = document.createElement("table");
    table.className = "tac-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th>标签</th><th>类型</th><th>正向</th><th>负向</th><th>最后使用</th></tr>";
    table.appendChild(head);
    const body = document.createElement("tbody");
    for (const [name, type, pos, neg, lastUsed] of rows.slice(0, 300)) {
      const tr = document.createElement("tr");
      for (const value of [name, parseInt(type, 10) - 1, pos, neg, lastUsed]) {
        const td = document.createElement("td");
        td.textContent = String(value ?? "");
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    container.innerHTML = "";
    container.appendChild(table);
  } catch {
    container.textContent = "无法读取使用统计";
  }
}

function collectSettings() {
  const patch = {};
  const changedKeys = [];
  for (const input of dialog.querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    const field = FIELD_BY_KEY.get(key);
    const type = input.dataset.type;
    let value;

    if (type === "bool") {
      value = input.checked;
    } else if (type === "json") {
      try {
        value = JSON.parse(input.value);
      } catch {
        setStatus(`JSON 解析失败: ${key}`);
        value = getByPath(CFG, key);
      }
    } else if (type === "number" || type === "slider") {
      const parsed = Number(input.value);
      value = Number.isNaN(parsed) ? 0 : parsed;
    } else if (input.dataset.list === "1" || type === "textarea") {
      value = field && field.list
        ? input.value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        : input.value;
    } else {
      value = input.value;
    }

    const previous = getByPath(CFG, key);
    if (JSON.stringify(previous) !== JSON.stringify(value)) changedKeys.push(key);
    if (key.includes(".")) setByPath(patch, key, value);
    else patch[key] = value;
  }
  return { patch, changedKeys };
}

export async function saveSettings() {
  if (!dialog) return;
  const { patch, changedKeys } = collectSettings();

  const reloadKinds = new Set();
  for (const key of changedKeys) {
    const field = FIELD_BY_KEY.get(key);
    if (field?.reload) reloadKinds.add(field.reload);
  }

  await applyConfig(patch);
  setStatus("已保存");

  if (reloadKinds.size) {
    try {
      if (reloadKinds.has("scan")) await refreshLibrary();
      await loadFileDependentData({ force: true });
      setStatus(`已保存，已加载 ${state.allTags.length} 个标签 / ${state.translations.size} 条翻译`);
    } catch (error) {
      setStatus(`保存后重新加载失败: ${error.message}`);
    }
  }
}

export function openSettings() {
  if (!overlay) buildDialog();
  overlay.dataset.visible = "1";
  document.addEventListener("keydown", escapeHandler);
  applyThemeVars();
}

function escapeHandler(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeSettings();
  }
}

export function closeSettings() {
  document.removeEventListener("keydown", escapeHandler);
  if (overlay) overlay.dataset.visible = "0";
}

export function toggleSettings() {
  if (overlay?.dataset.visible === "1") closeSettings();
  else openSettings();
}

export function installSettingsButton() {
  injectStyles();
  const existing = document.getElementById("tac-settings-button");
  if (existing) return existing;
  const button = document.createElement("div");
  button.className = "tac-settings-button";
  button.id = "tac-settings-button";
  button.textContent = "🏷️";
  button.title = "Tag 自动补全设置（也可在 ComfyUI 设置 → 🏷️ Tag 自动补全 中修改）";
  button.addEventListener("click", () => toggleSettings());
  document.body.appendChild(button);
  return button;
}
