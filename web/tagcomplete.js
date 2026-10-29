/**
 * ComfyUI-TagComplete entry point.
 *
 * Registers the extension, loads the tag database, and hooks every CLIP text
 * encoder text widget so the completion popup works inside the node itself.
 */

import { CFG, loadServerConfig, onConfigChanged, state } from "./tc_config.js";
import { loadFileDependentData } from "./tc_data.js";
import { applyPopupStyle, applyThemeVars, injectStyles } from "./tc_style.js";
import { hookAllNodes, hookNode, installObservers } from "./tc_attach.js";
import { installSettingsButton, openSettings } from "./tc_settings.js";
import { registerNativeSettings } from "./tc_native_settings.js";
import { installPanelSync } from "./tc_panel.js";
import { getApp, logWarn, toast, waitForApp } from "./tc_env.js";

const app = await waitForApp();

if (!app) {
  console.error("[TagComplete] ComfyUI app object not available, extension disabled.");
} else {
  let initialised = false;

  const api = {
    name: "ComfyUI.TagComplete",

    async setup() {
      if (initialised) return;
      initialised = true;
      injectStyles();
      applyThemeVars();

      try {
        await loadServerConfig();
      } catch (error) {
        logWarn("could not load configuration", error);
      }

      /* popup geometry from the settings (width / row height / font size / scale) */
      try {
        applyPopupStyle();
        onConfigChanged(() => applyPopupStyle());
      } catch (error) {
        logWarn("could not apply popup style", error);
      }

      /* register the options inside the ComfyUI settings dialog */
      try {
        await registerSettingsWithRetry(app);
      } catch (error) {
        logWarn("could not register native settings", error);
      }

      try {
        await loadFileDependentData();
      } catch (error) {
        logWarn("could not load tag data", error);
        toast("标签数据加载失败", String(error), "error");
      }

      hookAllNodes();
      installObservers();
      try {
        installPanelSync();
      } catch (error) {
        logWarn("could not attach the right side panel editor", error);
      }
      await maybeDisableOtherAutocomplete();

      try {
        installSettingsButton();
      } catch (error) {
        logWarn("could not install settings button", error);
      }

      const tags = state.allTags.length;
      const loras = state.loras.length;
      const wildcards = state.wildcards.length;
      console.log(
        `[TagComplete] ready - ${tags} tags (${CFG.tagFile}), ${loras} loras, ${wildcards} wildcard files`
      );
    },

    nodeCreated(node) {
      /* widgets can appear slightly after this hook */
      queueMicrotask(() => hookNode(node));
      setTimeout(() => hookNode(node), 60);
      setTimeout(() => hookNode(node), 300);
    },

    loadedGraphNode(node) {
      hookNode(node);
    },

    afterConfigureGraph() {
      hookAllNodes();
    },

    commands: [
      {
        id: "tagcomplete.settings",
        label: "Tag 自动补全设置",
        icon: "icon-[mdi--tag-text-outline]",
        function: () => openSettings(),
      },
    ],
  };

  app.registerExtension(api);

  /* Extra safety net: some widgets are created after all hooks above. */
  setTimeout(() => {
    try {
      hookAllNodes();
    } catch {
      /* ignore */
    }
  }, 2000);

  /* Re-apply theme vars when the user switches between light/dark themes. */
  try {
    app.ui?.settings?.addEventListener?.("change", applyThemeVars);
  } catch {
    /* ignore */
  }
}

async function registerSettingsWithRetry(app, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (app?.ui?.settings?.addSetting) {
      registerNativeSettings(app);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  logWarn("app.ui.settings never became available - native settings skipped");
  return false;
}

async function maybeDisableOtherAutocomplete() {
  if (!CFG.disableConflictingAutocomplete) return;
  try {
    const module = await import("/extensions/comfyui-custom-scripts/js/common/autocomplete.js");
    if (module?.TextAreaAutoComplete) {
      module.TextAreaAutoComplete.enabled = false;
      console.log("[TagComplete] disabled the pysssss autocompleter to avoid duplicate popups");
    }
  } catch {
    /* the pysssss extension is not installed - nothing to do */
  }
}
