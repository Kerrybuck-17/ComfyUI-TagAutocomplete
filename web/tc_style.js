/** Injected stylesheet for the tag autocomplete popup and settings dialog. */

import { CFG } from "./tc_config.js";

const CSS = `
.tac-popup {
  position: fixed;
  display: none;
  z-index: 100000;
  align-items: flex-start;
  gap: 8px;
  pointer-events: auto;
  font-family: inherit;
  font-size: var(--tac-popup-font-size, 13px);
  line-height: 1.35;
  transform: scale(var(--tac-popup-scale, 1));
  transform-origin: top left;
}
.tac-popup[data-visible="1"] { display: flex; }

.tac-results {
  background: var(--tac-bg);
  border: var(--tac-border-width) solid var(--tac-border);
  color: var(--tac-text);
  border-radius: 10px;
  overflow-y: auto;
  overflow-x: hidden;
  word-break: break-word;
  width: var(--tac-popup-width, 420px);
  max-width: calc(100vw - 40px);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
}

.tac-list { margin: 0; padding: 0; }
.tac-list > li {
  list-style: none;
  min-height: var(--tac-popup-row-height, 30px);
  display: flex;
  align-items: center;
  padding: 0 10px;
  cursor: pointer;
  margin: 0;
  box-sizing: border-box;
}
.tac-list > li:nth-child(odd) { background: var(--tac-bg-odd); }
.tac-list > li:hover { background: var(--tac-hover); }
.tac-list > li.selected { background: var(--tac-selected); }

.tac-flex { display: flex; align-items: baseline; gap: 6px; }
.tac-item { white-space: break-spaces; min-width: 80px; }
.tac-meta {
  margin-left: auto;
  text-align: end;
  padding-left: 12px;
  white-space: nowrap;
  color: var(--tac-meta);
  font-size: 0.9em;
}
.tac-meta.biased::before { content: "✨"; margin-right: 2px; }
.tac-meta span.used::after { content: "🔁"; margin-left: 3px; }
.tac-wiki {
  text-decoration: none;
  color: var(--tac-meta);
  padding: 0 4px;
  border-radius: 4px;
}
.tac-wiki:hover { text-decoration: underline; background: var(--tac-hover); }
.tac-emb-v1 { color: var(--tac-emb-v1); }
.tac-emb-v2 { color: var(--tac-emb-v2); }
.tac-path-part:nth-child(3n+1) { color: var(--tac-lt-1); }
.tac-path-part:nth-child(3n+2) { color: var(--tac-lt-2); }
.tac-path-part:nth-child(3n+3) { color: var(--tac-lt-3); }
.tac-empty { padding: 8px 12px; color: var(--tac-meta); }

.tac-preview {
  display: none;
  position: relative;
  width: 220px;
  height: 220px;
  border-radius: 10px;
  overflow: hidden;
  border: var(--tac-border-width) solid var(--tac-border);
  background: var(--tac-bg);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
}
.tac-preview[data-visible="1"] { display: block; }
.tac-preview > img { width: 100%; height: 100%; object-fit: cover; display: block; }

.tac-ruby {
  position: fixed;
  display: none;
  z-index: 99999;
  max-width: min(760px, calc(100vw - 40px));
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--tac-bg);
  border: var(--tac-border-width) solid var(--tac-border);
  color: var(--tac-meta);
  font-size: 12px;
  line-height: 1.6;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  overflow-wrap: anywhere;
}
.tac-ruby[data-visible="1"] { display: block; }
.tac-ruby ruby { display: inline-flex; flex-direction: column-reverse; vertical-align: bottom; margin-top: 0.35rem; cursor: pointer; }
.tac-ruby rt { font-size: 0.92em; line-height: 1.1rem; color: var(--tac-lt-1); padding-right: 4px; text-align: left; }
.tac-ruby > :nth-child(3n+1) rt { color: var(--tac-lt-1); }
.tac-ruby > :nth-child(3n+2) rt { color: var(--tac-lt-2); }
.tac-ruby > :nth-child(3n+3) rt { color: var(--tac-lt-3); }

.tac-settings-button {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 9990;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--tac-border);
  background: var(--tac-bg);
  color: var(--tac-text);
  cursor: pointer;
  opacity: 0.55;
  font-size: 15px;
  user-select: none;
}
.tac-settings-button:hover { opacity: 1; }

.tac-overlay {
  position: fixed;
  inset: 0;
  z-index: 100001;
  background: rgba(0, 0, 0, 0.55);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.tac-overlay[data-visible="1"] { display: flex; }

.tac-dialog {
  width: min(900px, 96vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--tac-bg);
  color: var(--tac-text);
  border: 1px solid var(--tac-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.tac-dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--tac-border);
}
.tac-dialog-header h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
.tac-dialog-body { overflow: auto; padding: 12px 16px 20px; }
.tac-dialog-footer {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--tac-border);
  flex-wrap: wrap;
}
.tac-dialog-footer .tac-spacer { flex: 1; }

.tac-section { margin-bottom: 18px; }
.tac-section > h3 {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tac-meta);
  border-bottom: 1px solid var(--tac-border);
  padding-bottom: 4px;
}
.tac-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 8px 18px; }
.tac-field { display: flex; align-items: center; gap: 8px; min-height: 26px; }
.tac-field > label { flex: 1; cursor: pointer; }
.tac-field input[type="text"],
.tac-field input[type="number"],
.tac-field select,
.tac-field textarea {
  background: var(--tac-bg-odd);
  color: var(--tac-text);
  border: 1px solid var(--tac-border);
  border-radius: 6px;
  padding: 3px 6px;
  font: inherit;
  font-size: 12px;
  min-width: 0;
}
.tac-field input[type="text"] { width: 190px; }
.tac-field input[type="number"] { width: 80px; }
.tac-field select { width: 190px; }
.tac-field textarea { width: 100%; min-height: 90px; font-family: ui-monospace, monospace; }
.tac-field-wide { display: block; margin-bottom: 8px; }
.tac-field-wide > label { display: block; margin-bottom: 4px; }
.tac-hint { display: block; color: var(--tac-meta); font-size: 11px; margin-top: 2px; }

.tac-btn {
  background: var(--tac-bg-odd);
  color: var(--tac-text);
  border: 1px solid var(--tac-border);
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.tac-btn:hover { background: var(--tac-hover); }
.tac-btn.primary { border-color: var(--tac-lt-1); color: var(--tac-lt-1); }
.tac-btn.danger { border-color: #d9534f; color: #d9534f; }

.tac-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tac-table th, .tac-table td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--tac-border); }
.tac-table-wrap { max-height: 260px; overflow: auto; }
.tac-status { color: var(--tac-meta); font-size: 12px; }
`;

let injected = false;

export function injectStyles() {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.id = "tac-styles";
  style.textContent = CSS;
  document.head.appendChild(style);
}

const DARK_VARS = {
  "--tac-text": "#e5e7eb",
  "--tac-bg": "#0f141d",
  "--tac-bg-odd": "#151c28",
  "--tac-border": "#3b4453",
  "--tac-border-width": "1px",
  "--tac-hover": "#1f2937",
  "--tac-selected": "#374151",
  "--tac-meta": "#8b93a1",
  "--tac-emb-v1": "#9db8d8",
  "--tac-emb-v2": "#7ec8f0",
  "--tac-lt-1": "#8ec5f0",
  "--tac-lt-2": "#e6d18a",
  "--tac-lt-3": "#8fbf8f",
};

const LIGHT_VARS = {
  "--tac-text": "#1f2937",
  "--tac-bg": "#ffffff",
  "--tac-bg-odd": "#f7f8fa",
  "--tac-border": "#d6dae1",
  "--tac-border-width": "1px",
  "--tac-hover": "#eef1f5",
  "--tac-selected": "#dde3ea",
  "--tac-meta": "#6b7280",
  "--tac-emb-v1": "#2b5797",
  "--tac-emb-v2": "#2d89ef",
  "--tac-lt-1": "#2d89ef",
  "--tac-lt-2": "#c25a00",
  "--tac-lt-3": "#2f7d2f",
};

export function isDarkMode() {
  const root = document.documentElement;
  const attr = (root.dataset.theme || root.getAttribute("data-theme") || "").toLowerCase();
  if (attr.includes("dark")) return true;
  if (attr.includes("light")) return false;
  if (document.body?.classList.contains("dark")) return true;
  try {
    const bg = getComputedStyle(document.body).backgroundColor || "";
    const match = bg.match(/rgba?\(([^)]+)\)/);
    if (match) {
      const [r, g, b] = match[1].split(",").map((part) => parseFloat(part));
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return 0.299 * r + 0.587 * g + 0.114 * b < 128;
      }
    }
  } catch {
    /* ignore */
  }
  return true;
}

export function applyThemeVars() {
  const vars = isDarkMode() ? DARK_VARS : LIGHT_VARS;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  return vars;
}

/* ------------------------------------------------------------------------- *
 * Popup geometry (width / row height / font size / scale) from the settings
 * ------------------------------------------------------------------------- */
const POPUP_DEFAULTS = { width: 420, rowHeight: 30, fontSize: 13, scale: 1 };

export function popupMetrics() {
  const cfg = (typeof CFG !== "undefined" && CFG) || {};
  const num = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  };
  return {
    width: num(cfg.popupWidth, POPUP_DEFAULTS.width, 200, 900),
    rowHeight: num(cfg.popupRowHeight, POPUP_DEFAULTS.rowHeight, 20, 60),
    fontSize: num(cfg.popupFontSize, POPUP_DEFAULTS.fontSize, 10, 24),
    scale: num(cfg.popupScale, POPUP_DEFAULTS.scale, 0.6, 2.5),
  };
}

/** Push the configured popup geometry into CSS variables. */
export function applyPopupStyle() {
  if (typeof document === "undefined") return;
  const metrics = popupMetrics();
  const root = document.documentElement;
  root.style.setProperty("--tac-popup-width", `${metrics.width}px`);
  root.style.setProperty("--tac-popup-row-height", `${metrics.rowHeight}px`);
  root.style.setProperty("--tac-popup-font-size", `${metrics.fontSize}px`);
  root.style.setProperty("--tac-popup-scale", String(metrics.scale));
  return metrics;
}
