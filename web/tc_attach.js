/** Node discovery: find CLIP text encoder text widgets and attach the popup. */

import { getApp } from "./tc_env.js";
import { CFG } from "./tc_config.js";
import { attachToTextarea } from "./tc_engine.js";

const CLIP_NAME_RE = /clip/i;
const TEXT_ENCODE_RE = /(^|[\s_.-])text\s*_?\s*encode/i;

export function nodeTypeName(node) {
  return String(node?.comfyClass || node?.constructor?.comfyClass || node?.type || "");
}

function matchesNodeFilter(node) {
  const name = nodeTypeName(node);
  if (!name) return false;
  switch (CFG.activeNodes) {
    case "all":
      return true;
    case "list": {
      const list = String(CFG.nodeList || "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
      if (!list.length) return false;
      const lower = name.toLowerCase();
      return list.some((entry) => lower.includes(entry));
    }
    default:
      return CLIP_NAME_RE.test(name) || TEXT_ENCODE_RE.test(name);
  }
}

export function isNegativeNode(node) {
  const title = String(node?.title || "").toLowerCase();
  const type = nodeTypeName(node).toLowerCase();
  return /(^|[\s_-])(neg|negative)([\s_-]|$)/.test(title) || /negative/.test(type) || /neg_prompt/.test(type);
}

function textareaOf(widget) {
  const el = widget?.element;
  if (el instanceof HTMLTextAreaElement) return el;
  const legacy = widget?.inputEl;
  if (legacy instanceof HTMLTextAreaElement) return legacy;
  return null;
}

/** Attach every eligible text widget of a single node. */
export function hookNode(node) {
  if (!node || !CFG.enabled) return 0;
  if (!matchesNodeFilter(node)) return 0;
  if (!CFG.activeInNegative && isNegativeNode(node)) return 0;

  let attached = 0;
  const widgets = Array.isArray(node.widgets) ? node.widgets : [];
  for (const widget of widgets) {
    const el = textareaOf(widget);
    if (!el) continue;
    if (el.disabled || el.readOnly) continue;
    try {
      attachToTextarea(el, widget, node);
      attached++;
    } catch (error) {
      console.warn("[TagComplete] could not attach to widget", widget?.name, error);
    }
  }
  return attached;
}

function collectGraphs() {
  const app = getApp();
  const out = [];
  const seen = new Set();
  const push = (graph) => {
    if (graph && typeof graph === "object" && !seen.has(graph)) {
      seen.add(graph);
      out.push(graph);
    }
  };
  push(app?.rootGraph);
  push(app?.graph);
  for (let index = 0; index < out.length; index++) {
    const graph = out[index];
    const subgraphs = graph?.subgraphs;
    if (subgraphs) {
      try {
        const values = typeof subgraphs.values === "function" ? [...subgraphs.values()] : Object.values(subgraphs);
        for (const sub of values) push(sub);
      } catch {
        /* ignore */
      }
    }
    for (const node of graph?._nodes || []) {
      if (node?.subgraph) push(node.subgraph);
    }
  }
  return out;
}

export function hookAllNodes() {
  let total = 0;
  for (const graph of collectGraphs()) {
    for (const node of graph._nodes || []) total += hookNode(node);
  }
  return total;
}

let observer = null;
let pending = null;

export function installObservers() {
  if (observer) return;
  if (typeof MutationObserver === "undefined") return;

  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      try {
        hookAllNodes();
      } catch (error) {
        console.warn("[TagComplete] sweep failed:", error);
      }
    }, 120);
  };

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        if (added.tagName === "TEXTAREA" && added.classList.contains("comfy-multiline-input")) {
          schedule();
          return;
        }
        if (added.querySelector?.("textarea.comfy-multiline-input")) {
          schedule();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
