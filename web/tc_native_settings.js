/**
 * Registers every option inside the ComfyUI settings dialog
 * (设置 → 🏷️ Tag 自动补全 → ...) and keeps it in sync with the standalone panel.
 */

import { CFG, DEFAULT_CFG, onConfigChanged } from "./tc_config.js";
import { loadFileDependentData, refreshLibrary } from "./tc_data.js";
import { getByPath, setByPath } from "./tc_util.js";
import { NATIVE_CATEGORY, comboOptionsFor, fromNativeValue, nativeFields, toNativeValue } from "./tc_schema.js";
import { applyPopupStyle } from "./tc_style.js";

const IDS = new Map();
let api = null;
let applying = false;
let persistTimer = null;
let reloadTimer = null;
const pendingReloads = new Set();

function settingId(key) {
  return `TagComplete.${key}`;
}

export function nativeSettingId(key) {
  return IDS.get(key) || settingId(key);
}

/** Register all settings in the ComfyUI settings dialog (idempotent). */
export function registerNativeSettings(app) {
  if (api) return;
  const settings = app?.ui?.settings;
  if (!settings || typeof settings.addSetting !== "function") {
    console.warn("[TagComplete] app.ui.settings is unavailable - skipping native settings");
    return;
  }
  api = settings;

  for (const field of nativeFields()) {
    const id = settingId(field.key);
    IDS.set(field.key, id);

    const current = getByPath(CFG, field.key, getByPath(DEFAULT_CFG, field.key));
    const def = {
      id,
      name: field.label,
      category: [NATIVE_CATEGORY, field.section, field.label],
      tooltip: field.hint || "",
      defaultValue: toNativeValue(field, current),
    };

    switch (field.type) {
      case "bool":
        def.type = "boolean";
        break;
      case "number":
        def.type = "number";
        if (field.attrs) def.attrs = field.attrs;
        break;
      case "slider":
        def.type = "slider";
        if (field.attrs) def.attrs = field.attrs;
        break;
      case "combo":
        def.type = "combo";
        def.options = (value) => comboOptionsFor(field, value ?? current);
        break;
      default:
        def.type = "text";
        break;
    }

    def.onChange = (value) => {
      const parsed = fromNativeValue(field, value);
      setByPath(CFG, field.key, parsed);
      try {
        applyPopupStyle();
      } catch {
        /* ignore */
      }
      if (applying) return;
      schedulePersist();
      if (field.reload) scheduleReload(field.reload);
    };

    applying = true;
    try {
      api.addSetting(def);
    } catch (error) {
      console.warn(`[TagComplete] could not register setting ${id}`, error);
    } finally {
      applying = false;
    }
  }

  /* the standalone panel calls applyConfig(), keep the native store in sync */
  onConfigChanged(() => syncToNative());

  console.log(`[TagComplete] registered ${IDS.size} settings in the ComfyUI settings dialog`);
}

/** Push the current CFG values into the native settings store. */
export function syncToNative() {
  if (!api || applying) return;
  applying = true;
  try {
    for (const field of nativeFields()) {
      const id = IDS.get(field.key);
      if (!id) continue;
      const desired = toNativeValue(field, getByPath(CFG, field.key, getByPath(DEFAULT_CFG, field.key)));
      let current;
      try {
        current = api.getSettingValue(id);
      } catch {
        current = undefined;
      }
      if (current !== desired) {
        try {
          api.setSettingValue(id, desired);
        } catch (error) {
          console.warn(`[TagComplete] could not update setting ${id}`, error);
        }
      }
    }
  } finally {
    applying = false;
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistSettings();
  }, 600);
}

async function persistSettings() {
  try {
    const { postJSON } = await import("./tc_env.js");
    await postJSON("/tagcomplete/settings", CFG);
  } catch (error) {
    console.warn("[TagComplete] could not save settings", error);
  }
}

function scheduleReload(kind) {
  pendingReloads.add(kind);
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    reloadTimer = null;
    const kinds = new Set(pendingReloads);
    pendingReloads.clear();
    try {
      if (kinds.has("scan")) await refreshLibrary();
      await loadFileDependentData({ force: true });
    } catch (error) {
      console.warn("[TagComplete] reload after settings change failed", error);
    }
  }, 500);
}
