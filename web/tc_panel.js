/**
 * Right side panel ("属性/参数" tab) support.
 *
 * The ComfyUI panel renders the selected node's widgets; for the CLIP text
 * widget it shows a textarea. This module
 *  - attaches the tag autocomplete to that textarea,
 *  - keeps it in sync with the canvas textarea / widget value,
 *  - injects an editor when the panel only shows a read-only fallback.
 */

import { getApp } from "./tc_env.js";
import { attachToTextarea } from "./tc_engine.js";

const PANEL_SELECTOR = '[data-testid="properties-panel"]';
const WIDGET_LIST_SELECTOR = '[data-testid="section-widgets-list"]';

let syncTimer = null;
let mutationObserver = null;

function panelRoot() {
  return document.querySelector(PANEL_SELECTOR);
}

function selectedNode() {
  const app = getApp();
  const selection =
    app?.canvas?.selected_nodes ?? app?.canvas?.selectedNodes ?? app?.canvas?.selected_items ?? null;
  if (!selection) return null;
  if (Array.isArray(selection)) return selection[0] ?? null;
  if (typeof selection.values === "function") {
    const values = [...selection.values()];
    return values.length === 1 ? values[0] : null;
  }
  const values = Object.values(selection);
  return values.length === 1 ? values[0] : null;
}

function textareaOf(widget) {
  const el = widget?.element ?? widget?.inputEl;
  return el instanceof HTMLTextAreaElement ? el : null;
}

/** All widgets of a node that are backed by a <textarea>. */
export function multilineWidgets(node) {
  return (node?.widgets ?? []).filter((widget) => textareaOf(widget) !== null);
}

function canvasTextarea(widget) {
  return textareaOf(widget);
}

function notifyNode(node, widget, value) {
  try {
    node?.onWidgetChanged?.(widget?.name, value, undefined, widget);
    node?.setDirtyCanvas?.(true, true);
    const app = getApp();
    app?.graph?.setDirtyCanvas?.(true, true);
  } catch {
    /* ignore */
  }
}

/** Write a value coming from the side panel into the widget + canvas textarea. */
export function pushToWidget(node, widget, value) {
  if (!widget) return;
  const canvasEl = canvasTextarea(widget);
  const unchanged = widget.value === value && (!canvasEl || canvasEl.value === value);
  if (unchanged) return;

  if (widget.value !== value) {
    try {
      widget.value = value;
    } catch {
      /* ignore */
    }
  }
  /* value only: dispatching a synthetic input event would re-open a second popup */
  if (canvasEl && canvasEl.value !== value) canvasEl.value = value;
  notifyNode(node, widget, value);
}

function attachPanelTextarea(textarea, widget, node) {
  if (textarea.__tacPanel) {
    textarea.__tacPanel.widget = widget;
    textarea.__tacPanel.node = node;
    return;
  }

  /* reuse the canvas autocomplete engine so typing in the panel behaves identically */
  const target = attachToTextarea(textarea, widget, node);

  const state = { widget, node, target };
  textarea.__tacPanel = state;

  textarea.addEventListener("input", () => {
    pushToWidget(node, widget, textarea.value);
  });
  textarea.addEventListener("blur", () => {
    pushToWidget(node, widget, textarea.value);
  });
  textarea.addEventListener("focus", () => {
    if (textarea.value !== widget.value) textarea.value = String(widget.value ?? "");
  });
}

function pullIntoPanel(textarea, widget) {
  if (document.activeElement === textarea) return;
  const value = String(widget?.value ?? "");
  if (textarea.value !== value) textarea.value = value;
}

function injectEditor(root, node, widget) {
  const list = root.querySelector(WIDGET_LIST_SELECTOR) ?? root;
  const id = `tac-panel-${node.id}-${widget.name}`;
  const existing = root.querySelector(`[data-tac-editor="${id}"]`);
  if (existing) {
    const textarea = existing.querySelector("textarea");
    if (textarea) attachPanelTextarea(textarea, widget, node);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.dataset.tacEditor = id;
  wrapper.style.cssText = "padding:6px 16px 10px;";

  const label = document.createElement("div");
  label.textContent = `${widget.label || widget.name}（Tag 补全）`;
  label.style.cssText = "font-size:11px;opacity:0.7;margin-bottom:4px;";

  const textarea = document.createElement("textarea");
  textarea.className = "comfy-multiline-input";
  textarea.dataset.tacEditorOnly = "1";
  textarea.style.cssText = "width:100%;min-height:120px;font-size:13px;line-height:1.4;resize:vertical;";
  textarea.value = String(widget.value ?? "");

  wrapper.appendChild(label);
  wrapper.appendChild(textarea);
  list.appendChild(wrapper);

  attachPanelTextarea(textarea, widget, node);
}

/** Attach to / refresh the side panel editors. Returns the number of attached textareas. */
export function syncPanel() {
  if (typeof document === "undefined") return 0;
  const root = panelRoot();
  if (!root) return 0;

  const node = selectedNode();
  if (!node) return 0;

  const widgets = multilineWidgets(node);
  if (!widgets.length) return 0;

  const all = [...root.querySelectorAll("textarea")];
  const panelTextareas = all.filter((el) => el.dataset?.tacEditorOnly !== "1");
  /* a read-only preview also needs our own editor */
  const editable = panelTextareas.filter((el) => !el.readOnly && !el.disabled);

  let attached = 0;
  if (editable.length) {
    for (let index = 0; index < editable.length && index < widgets.length; index++) {
      attachPanelTextarea(editable[index], widgets[index], node);
      pullIntoPanel(editable[index], widgets[index]);
      attached++;
    }
    return attached;
  }

  for (const widget of widgets) injectEditor(root, node, widget);
  for (const textarea of [...root.querySelectorAll("[data-tac-editor] textarea")]) {
    const state = textarea.__tacPanel;
    if (!state) continue;
    pullIntoPanel(textarea, state.widget);
    attached++;
  }
  return attached;
}

export function installPanelSync() {
  if (syncTimer) return;
  const schedule = () => {
    try {
      syncPanel();
    } catch (error) {
      console.warn("[TagComplete] side panel sync failed", error);
    }
  };
  schedule();
  syncTimer = setInterval(schedule, 500);

  if (typeof MutationObserver !== "undefined") {
    let pending = null;
    mutationObserver = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        schedule();
      }, 120);
    });
    try {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }
  }
}

export function stopPanelSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  mutationObserver?.disconnect();
  mutationObserver = null;
}
