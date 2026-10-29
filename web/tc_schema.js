/**
 * Single source of truth for every user-facing option.
 *
 * Both UIs are generated from this list:
 *  - `tc_native_settings.js` registers them inside the ComfyUI settings dialog
 *  - `tc_settings.js` renders the standalone panel (JSON editors, usage stats)
 */

import { CFG, DEFAULT_CFG, state } from "./tc_config.js";
import { getByPath } from "./tc_util.js";

/** [value, label] pairs used by combo boxes. */
const OPTIONS = {
  activeNodes: [
    ["clip", "仅 CLIP 文本编码节点"],
    ["all", "所有多行文本框"],
    ["list", "仅节点列表中的节点"],
  ],
  extraAddMode: [
    ["Insert before", "插入到主列表之前"],
    ["Insert after", "插入到主列表之后"],
  ],
  modelSortOrder: [
    ["Name", "名称"],
    ["Date Modified (newest first)", "修改时间（最新在前）"],
    ["Date Modified (oldest first)", "修改时间（最旧在前）"],
  ],
  wildcardCompletionMode: [
    ["To next folder level", "补全到下一层目录"],
    ["To first difference", "补全到第一个差异处"],
    ["Always fully", "总是补全完整路径"],
  ],
  modelKeywordCompletion: [
    ["Never", "关闭"],
    ["Only user list", "仅用户列表"],
    ["Always", "总是"],
  ],
  modelKeywordLocation: [
    ["Start of prompt", "提示词开头"],
    ["End of prompt", "提示词结尾"],
    ["Before LORA/LyCO", "LoRA 标签之前"],
  ],
  frequencyFunction: [
    ["Logarithmic (weak)", "对数（弱）"],
    ["Logarithmic (strong)", "对数（强）"],
    ["Usage first", "使用次数优先"],
  ],
  embeddingInsertFormat: [
    ["embedding:name", "embedding:名字（ComfyUI 原生）"],
    ["<embedding:name>", "<embedding:名字>（A1111 写法）"],
    ["name", "仅名字"],
  ],
};

function fileOptions(kind, { none = false, current } = {}) {
  const files = (state.files && state.files[kind]) || [];
  const options = files.map((name) => ({ value: name, text: name, selected: name === current }));
  if (none) options.unshift({ value: "None", text: "（不使用）", selected: current === "None" });
  return options;
}

function comboOptions(key, current) {
  return (OPTIONS[key] || []).map(([value, text]) => ({ value, text, selected: value === current }));
}

/**
 * Field definition:
 *  key      - dotted path inside CFG
 *  type     - bool | number | slider | text | textarea | json | combo | button
 *  section  - group shown in the UI
 *  reload   - "files" (tag/translation/extra/chant) or "scan" (library rescan)
 *  list     - value is an array, edited as newline separated text
 */
export const SETTINGS_SCHEMA = [
  {
    section: "数据文件",
    fields: [
      {
        key: "tagFile",
        label: "主标签文件",
        type: "combo",
        reload: "files",
        hint: "需要换数据集时在这里切换（例如 danbooru_e621_merged.csv）",
        getOptions: (current) => fileOptions("csv", { current }),
      },
      {
        key: "translationFile",
        label: "翻译文件（中文显示）",
        type: "combo",
        reload: "files",
        hint: "选择后候选列表会显示 [中文]，并支持直接输入中文搜索",
        getOptions: (current) => fileOptions("csv", { none: true, current }),
      },
      {
        key: "translationOldFormat",
        label: "翻译文件使用旧版三列格式",
        type: "bool",
        reload: "files",
      },
      {
        key: "extraFile",
        label: "额外标签文件",
        type: "combo",
        reload: "files",
        getOptions: (current) => fileOptions("csv", { none: true, current }),
      },
      { key: "extraAddMode", label: "额外标签插入位置", type: "combo", options: "extraAddMode" },
      {
        key: "chantFile",
        label: "Chant 预设文件",
        type: "combo",
        reload: "files",
        getOptions: (current) => fileOptions("json", { none: true, current }),
      },
    ],
  },
  {
    section: "启用范围",
    fields: [
      { key: "enabled", label: "启用标签自动补全", type: "bool" },
      {
        key: "activeNodes",
        label: "生效节点",
        type: "combo",
        options: "activeNodes",
        hint: "默认只在 CLIP 文本编码节点的输入框里生效",
      },
      {
        key: "nodeList",
        label: "节点列表（逗号分隔）",
        type: "text",
        hint: "仅在“仅节点列表中的节点”模式下生效，支持部分匹配",
      },
      { key: "activeInNegative", label: "在负面提示词节点中启用", type: "bool" },
      {
        key: "disableConflictingAutocomplete",
        label: "禁用 pysssss Autocompleter 弹窗",
        type: "bool",
        hint: "避免两个补全弹窗同时出现",
      },
    ],
  },
  {
    section: "结果显示",
    fields: [
      { key: "maxResults", label: "最多显示结果数", type: "slider", attrs: { min: 1, max: 50, step: 1 } },
      { key: "showAllResults", label: "显示全部结果（可滚动）", type: "bool" },
      {
        key: "resultStepLength",
        label: "每次加载的结果数量",
        type: "slider",
        attrs: { min: 10, max: 1000, step: 10 },
      },
      { key: "delayTime", label: "触发延迟 (ms)", type: "slider", attrs: { min: 0, max: 1000, step: 10 } },
      { key: "slidingPopup", label: "弹窗跟随光标移动", type: "bool" },
      { key: "showWikiLinks", label: "显示 wiki 跳转链接（?）", type: "bool" },
      { key: "showExtraNetworkPreviews", label: "显示 LoRA / Embedding 预览图", type: "bool" },
      { key: "modelSortOrder", label: "模型 / 通配符排序", type: "combo", options: "modelSortOrder" },
    ],
  },
  {
    section: "搜索与翻译",
    fields: [
      { key: "alias.searchByAlias", label: "搜索别名", type: "bool" },
      { key: "alias.onlyShowAlias", label: "只显示别名", type: "bool" },
      {
        key: "translation.searchByTranslation",
        label: "按翻译搜索（输入中文匹配标签）",
        type: "bool",
        hint: "关闭后只能输入英文标签匹配",
      },
      { key: "translation.liveTranslation", label: "在输入框下方实时显示翻译", type: "bool" },
    ],
  },
  {
    section: "插入",
    fields: [
      { key: "replaceUnderscores", label: "插入时把下划线替换为空格", type: "bool" },
      {
        key: "replaceUnderscoresExclusionList",
        label: "下划线替换排除列表",
        type: "text",
        hint: "逗号分隔，例如 0_0,(o)_(o),>_<",
      },
      { key: "escapeParentheses", label: "转义括号", type: "bool" },
      { key: "appendComma", label: "自动追加逗号", type: "bool" },
      { key: "appendSpace", label: "自动追加空格", type: "bool" },
      { key: "alwaysSpaceAtEnd", label: "在文本末尾时总是追加空格", type: "bool" },
      { key: "artistAtTrigger", label: "输入 @ 时显示画师标签", type: "bool" },
      { key: "artistInsertAt", label: "插入画师标签时自动添加 @", type: "bool" },
      { key: "wildcardCompletionMode", label: "通配符路径补全方式", type: "combo", options: "wildcardCompletionMode" },
      { key: "modelKeywordCompletion", label: "LoRA 触发词自动插入", type: "combo", options: "modelKeywordCompletion" },
      { key: "modelKeywordLocation", label: "触发词插入位置", type: "combo", options: "modelKeywordLocation" },
    ],
  },
  {
    section: "通配符与模型",
    fields: [
      { key: "useWildcards", label: "通配符补全", type: "bool" },
      { key: "sortWildcardResults", label: "通配符内容按字母排序", type: "bool" },
      {
        key: "wildcardPaths",
        label: "额外的通配符目录",
        type: "textarea",
        list: true,
        native: false,
        reload: "scan",
        hint: "每行一个绝对路径；修改后会重新扫描（仅在独立面板中编辑）",
      },
      { key: "useEmbeddings", label: "Embedding 补全", type: "bool" },
      { key: "includeEmbeddingsInNormalResults", label: "把 Embedding 混入普通标签结果", type: "bool" },
      { key: "embeddingInsertFormat", label: "Embedding 插入格式", type: "combo", options: "embeddingInsertFormat" },
      { key: "useLoras", label: "LoRA 补全", type: "bool" },
      { key: "useLycos", label: "LyCORIS 补全", type: "bool" },
      { key: "useLoraPrefixForLycos", label: "LyCORIS 使用 <lora: 前缀", type: "bool" },
      { key: "useHypernetworks", label: "Hypernetwork 补全", type: "bool" },
      { key: "useStyleVars", label: "Style 变量补全（$）", type: "bool" },
      {
        key: "extraNetworksDefaultMultiplier",
        label: "LoRA 默认权重",
        type: "number",
        attrs: { min: -10, max: 10, step: 0.05 },
      },
      { key: "extraNetworksSeparator", label: "LoRA / 超网络后续分隔符", type: "text" },
    ],
  },
  {
    section: "补全窗口外观",
    fields: [
      {
        key: "popupWidth",
        label: "窗口宽度 (px)",
        type: "slider",
        attrs: { min: 200, max: 900, step: 10 },
        hint: "候选列表的宽度；屏幕较窄时会自动收缩",
      },
      {
        key: "popupRowHeight",
        label: "每格高度 (px)",
        type: "slider",
        attrs: { min: 20, max: 60, step: 1 },
        hint: "每一行候选项的最小高度",
      },
      {
        key: "popupFontSize",
        label: "字体大小 (px)",
        type: "slider",
        attrs: { min: 10, max: 24, step: 1 },
        hint: "候选列表文字大小",
      },
      {
        key: "popupScale",
        label: "整体缩放比例",
        type: "slider",
        attrs: { min: 0.6, max: 2.5, step: 0.05 },
        hint: "1 = 原始大小；大于 1 放大，小于 1 缩小",
      },
    ],
  },
  {
    section: "使用频率排序",
    fields: [
      { key: "frequencySort", label: "记录使用频率并优先显示常用标签", type: "bool" },
      { key: "frequencyFunction", label: "排序函数", type: "combo", options: "frequencyFunction" },
      { key: "frequencyMinCount", label: "被视为常用的最少使用次数", type: "slider", attrs: { min: 0, max: 50, step: 1 } },
      {
        key: "frequencyMaxAge",
        label: "常用标签的最大未使用天数（0 为不限）",
        type: "slider",
        attrs: { min: 0, max: 365, step: 1 },
      },
      { key: "frequencyRecommendCap", label: "最多推荐的常用标签数量", type: "slider", attrs: { min: 0, max: 50, step: 1 } },
      { key: "frequencyIncludeAlias", label: "通过别名使用时也计入频率", type: "bool" },
    ],
  },
  {
    section: "高级（仅独立面板）",
    native: false,
    fields: [
      { key: "keymap", label: "快捷键映射 (JSON)", type: "json" },
      { key: "colorMap", label: "标签颜色 (JSON)", type: "json" },
    ],
  },
];

export const NATIVE_CATEGORY = "🏷️ Tag 自动补全";

/** Resolve the current CFG value of a field. */
export function fieldValue(field) {
  return getByPath(CFG, field.key, getByPath(DEFAULT_CFG, field.key));
}

/** Convert a CFG value into the value stored by the native settings dialog. */
export function toNativeValue(field, value) {
  if (field.list) return Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return value;
}

/** Convert a native settings value back into the CFG value. */
export function fromNativeValue(field, value) {
  if (field.list) {
    if (Array.isArray(value)) return value;
    return String(value ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  if (field.type === "number" || field.type === "slider") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (field.type === "bool") return Boolean(value);
  return value;
}

export function comboOptionsFor(field, current) {
  if (typeof field.getOptions === "function") return field.getOptions(current);
  if (field.options) return comboOptions(field.options, current);
  return [];
}

/** Flat list of fields shown in the native settings dialog. */
export function nativeFields() {
  const out = [];
  for (const group of SETTINGS_SCHEMA) {
    if (group.native === false) continue;
    for (const field of group.fields) {
      if (field.native === false) continue;
      out.push({ ...field, section: group.section });
    }
  }
  return out;
}
