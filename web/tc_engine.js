/**
 * Completion engine: tag search, tag-like parsers (wildcards, embeddings,
 * LoRAs, chants, UMI, styles, artist tags), popup rendering, keyboard
 * navigation and insertion.
 *
 * Port of the A1111 extension's tagAutocomplete.js + ext_*.js parsers,
 * adapted to ComfyUI canvas nodes and DOM text widgets.
 */

import { apiURL, getApp, postJSON } from "./tc_env.js";
import { CFG, ResultType, AutocompleteResult, state } from "./tc_config.js";
import { ensureExtras, fetchModelInfo, fetchModelKeywords } from "./tc_data.js";
import {
  clamp,
  difference,
  escapeHTML,
  escapeRegExp,
  formatCount,
  getCaretCoordinates,
} from "./tc_util.js";
import { isDarkMode, popupMetrics } from "./tc_style.js";

/* ------------------------------------------------------------------------- *
 * Regexes
 * ------------------------------------------------------------------------- */
const WEIGHT_REGEX = /[([]([^()[\]:|]+)(?::(?:\d+(?:\.\d+)?|\.\d+))?[)\]]/g;
const POINTY_REGEX = /<[^\s,<](?:[^\t\n\r,<>]*>|[^\t\n\r,> ]*)/g;
/* ASCII + full-width separators are used so Chinese punctuation also splits tags */
const NORMAL_TAG_REGEX = /[^\s,|<>\[\]:，、]+_\([^\s,|<>\[\]:，、]*\)?|[^\s,|<>():\[\]，、]+|</g;
const RUBY_TAG_REGEX = /[\w\d<][\w\d' \-?!/$%]{2,}>?/g;
const UMI_PROMPT_REGEX = /<[^\s]*?\[[^,<>]*[\]|]?>?/gi;
const UMI_TAG_REGEX = /(?:\[|\||--)([^<>\[\]\-|]+)/gi;

function wcWrap() {
  return CFG.wcWrap || "__";
}

function tagRegex() {
  const wrap = escapeRegExp(wcWrap());
  const completedWildcard = "__[^\\s,_][^\\t\\n\\r,_]*[^\\s,_]__[^\\s,_]*".replaceAll("__", wrap);
  return new RegExp(`${POINTY_REGEX.source}|${completedWildcard}|${NORMAL_TAG_REGEX.source}`, "g");
}

/* ------------------------------------------------------------------------- *
 * Trigger conditions (state.tagword is the fragment being completed)
 * ------------------------------------------------------------------------- */
const WC_FILE_TRIGGER = () =>
  CFG.useWildcards &&
  ((String(state.tagword).startsWith(wcWrap()) && !String(state.tagword).endsWith(wcWrap())) ||
    state.tagword === wcWrap());

const WC_TRIGGER = () => {
  if (!CFG.useWildcards) return false;
  const re = new RegExp("__([^,]+)__([^, ]*)".replaceAll("__", escapeRegExp(wcWrap())), "g");
  return [...String(state.tagword).matchAll(re)].length > 0;
};

const EMB_REGEX = /<(?!l:|h:|c:)[^,> ]*>?/g;
const EMB_TRIGGER = () =>
  CFG.useEmbeddings && (/<(?!l:|h:|c:)[^,> ]*>?/.test(String(state.tagword)) || CFG.includeEmbeddingsInNormalResults);

const LORA_TRIGGER = () => CFG.useLoras && /<(?!e:|h:|c:)[^,> ]*>?/.test(String(state.tagword));
const LYCO_TRIGGER = () => CFG.useLycos && /<(?!e:|h:|c:)[^,> ]*>?/.test(String(state.tagword));
const HYP_TRIGGER = () => CFG.useHypernetworks && /<(?!e:|l:|c:)[^,> ]*>?/.test(String(state.tagword));
const CHANT_TRIGGER = () =>
  !!CFG.chantFile && CFG.chantFile !== "None" && /<(?!e:|h:|l:)[^,> ]*>?/.test(String(state.tagword));
const STYLE_TRIGGER = () => CFG.useStyleVars && /\$(\d*)\(?/.test(String(state.tagword));
const ARTIST_TAG_TRIGGER = () => CFG.artistAtTrigger && /^@[^,\s]*/.test(String(state.tagword));

/* ------------------------------------------------------------------------- *
 * Popup DOM
 * ------------------------------------------------------------------------- */
let popup = null;
let listEl = null;
let resultsBox = null;
let previewBox = null;
let previewImg = null;
let rubyBox = null;

function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement("div");
  popup.className = "tac-popup notranslate";
  popup.setAttribute("translate", "no");

  resultsBox = document.createElement("div");
  resultsBox.className = "tac-results";
  listEl = document.createElement("ul");
  listEl.className = "tac-list";
  resultsBox.appendChild(listEl);

  previewBox = document.createElement("div");
  previewBox.className = "tac-preview";
  previewImg = document.createElement("img");
  previewImg.alt = "";
  previewBox.appendChild(previewImg);

  popup.appendChild(resultsBox);
  popup.appendChild(previewBox);
  document.body.appendChild(popup);
  return popup;
}

function ensureRuby() {
  if (rubyBox) return rubyBox;
  rubyBox = document.createElement("div");
  rubyBox.className = "tac-ruby notranslate";
  rubyBox.setAttribute("translate", "no");
  document.body.appendChild(rubyBox);
  return rubyBox;
}

/* ------------------------------------------------------------------------- *
 * Targets
 * ------------------------------------------------------------------------- */
const targets = new WeakMap();
let active = null;

function isNegativeTarget(target) {
  const node = target?.node;
  const title = `${node?.title || ""} ${target?.widget?.name || ""}`;
  return /neg/i.test(title);
}

export function isPopupVisible() {
  return popup?.dataset.visible === "1";
}

export function hidePopup(target = null) {
  if (!popup || popup.dataset.visible !== "1") {
    if (active && active.selected !== undefined) active.selected = null;
    return;
  }
  if (target && active && active !== target) return;
  popup.dataset.visible = "0";
  if (previewBox) previewBox.dataset.visible = "0";
  if (active) active.selected = null;
  if (listEl) listEl.innerHTML = "";
  state.resultCount = 0;
}

function showPopup(target) {
  ensurePopup();
  popup.dataset.visible = "1";
  active = target;
}

function positionPopup(target) {
  if (!popup || !target?.el) return;
  const el = target.el;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;

  let left = rect.left;
  let top = rect.bottom + 4;

  if (CFG.slidingPopup) {
    try {
      const caret = getCaretCoordinates(el, el.selectionEnd);
      left = rect.left + (caret.left - el.scrollLeft) * scale;
      top = rect.top + (caret.top - el.scrollTop) * scale + caret.height * scale + 4;
    } catch {
      /* ignore, fall back to the box corner */
    }
  }

  const metrics = popupMetrics();
  const rowPx = metrics.rowHeight + 4;
  const maxRows = Math.max(1, parseInt(CFG.maxResults, 10) || 5);
  const maxHeight = CFG.showAllResults ? 420 : Math.max(metrics.rowHeight * 3, maxRows * rowPx);
  if (resultsBox) resultsBox.style.maxHeight = `${maxHeight}px`;

  const width = (popup.offsetWidth || metrics.width) * metrics.scale;
  const height = (popup.offsetHeight || maxHeight) * metrics.scale;
  left = clamp(left, 4, Math.max(4, window.innerWidth - width - 8));
  if (top + height > window.innerHeight - 8) {
    const above = rect.top - height - 6;
    top = above > 8 ? above : Math.max(8, window.innerHeight - height - 8);
  }
  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function positionRuby(target) {
  if (!rubyBox || rubyBox.dataset.visible !== "1" || !target?.el) return;
  const rect = target.el.getBoundingClientRect();
  let top = rect.bottom + 4;
  if (popup?.dataset.visible === "1") {
    const popupRect = popup.getBoundingClientRect();
    top = Math.max(top, popupRect.bottom + 4);
  }
  rubyBox.style.left = `${Math.round(clamp(rect.left, 4, Math.max(4, window.innerWidth - 340)))}px`;
  rubyBox.style.top = `${Math.round(clamp(top, 4, window.innerHeight - 40))}px`;
}

/* ------------------------------------------------------------------------- *
 * Parsers
 * ------------------------------------------------------------------------- */
class BaseTagParser {
  constructor(triggerCondition) {
    this.triggerCondition = triggerCondition;
  }
  parse() {
    return [];
  }
}

const PARSERS = [];

class WildcardFileParser extends BaseTagParser {
  parse() {
    const files = [...state.wildcards, ...state.extWildcards];
    const needle = state.tagword === wcWrap() ? "" : state.tagword.replace(wcWrap(), "");
    const filtered = needle
      ? files.filter((entry) => String(entry[1]).toLowerCase().includes(needle.toLowerCase()))
      : files;

    const finalResults = [];
    const added = new Set();
    for (const entry of filtered) {
      const name = String(entry[1] || "").trim();
      if (!name || added.has(name)) continue;
      let result;
      if (String(entry[0]).toLowerCase().endsWith(".yaml") || String(entry[0]).toLowerCase().endsWith(".yml")) {
        result = new AutocompleteResult(name, ResultType.yamlWildcard);
        result.meta = "YAML wildcard";
      } else {
        result = new AutocompleteResult(name, ResultType.wildcardFile);
        result.meta = "Wildcard";
        result.sortKey = entry[2];
      }
      finalResults.push(result);
      added.add(name);
    }
    finalResults.sort(getSortFunction());
    return finalResults;
  }
}

class WildcardParser extends BaseTagParser {
  async parse() {
    const re = new RegExp(`__([^,]+)__([^, ]*)`.replaceAll("__", escapeRegExp(wcWrap())), "g");
    const match = [...state.tagword.matchAll(re)];
    if (!match.length) return [];
    const wcFile = match[0][1];
    const wcWord = match[0][2] || "";

    const found = state.wildcards.filter((entry) => String(entry[1]).toLowerCase() === String(wcFile).toLowerCase());
    const pairs = found.length
      ? found
      : state.extWildcards.filter((entry) => String(entry[1]).toLowerCase() === String(wcFile).toLowerCase());
    if (!pairs.length) return [];

    let wildcards = [];
    for (const [basePath, fileName] of pairs) {
      if (!basePath || !fileName) continue;
      if (String(basePath).toLowerCase().endsWith(".yaml") || String(basePath).toLowerCase().endsWith(".yml")) {
        let node = state.yamlWildcards[basePath];
        for (const part of String(fileName).split("/")) {
          node = node?.[part];
          if (node === undefined) break;
        }
        const values = Array.isArray(node) ? node : typeof node === "string" ? [node] : [];
        wildcards = wildcards.concat(values.map((value) => String(value)));
      } else {
        try {
          const url = apiURL(
            `/tagcomplete/wildcard?base=${encodeURIComponent(basePath)}&file=${encodeURIComponent(`${fileName}.txt`)}`
          );
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) continue;
          const text = await response.text();
          wildcards = wildcards.concat(
            text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0 && !line.startsWith("#"))
          );
        } catch (error) {
          console.warn("[TagComplete] could not read wildcard file:", error);
        }
      }
    }

    if (CFG.sortWildcardResults) wildcards.sort((a, b) => a.localeCompare(b));
    const filtered = wcWord ? wildcards.filter((item) => item.toLowerCase().includes(wcWord.toLowerCase())) : wildcards;
    return filtered.map((item) => {
      const result = new AutocompleteResult(item.trim(), ResultType.wildcardTag);
      result.meta = wcFile;
      return result;
    });
  }
}

class EmbeddingParser extends BaseTagParser {
  parse() {
    let tempResults = [];
    const tagword = state.tagword;
    if (tagword !== "<" && tagword !== "<e:") {
      let searchTerm = tagword.replace("<e:", "").replace("<", "");
      let versionString;
      if (searchTerm.startsWith("v1") || searchTerm.startsWith("v2")) {
        versionString = searchTerm.slice(0, 2);
        searchTerm = searchTerm.slice(2);
      } else if (searchTerm.startsWith("vxl")) {
        versionString = searchTerm.slice(0, 3);
        searchTerm = searchTerm.slice(3);
      }
      const regex = new RegExp(escapeRegExp(searchTerm, true), "i");
      const filter = (entry) =>
        regex.test(String(entry[0]).toLowerCase()) ||
        regex.test(String(entry[0]).toLowerCase().replaceAll(" ", "_"));
      tempResults = versionString
        ? state.embeddings.filter(
            (entry) => filter(entry) && entry[2] && String(entry[2]).toLowerCase() === versionString.toLowerCase()
          )
        : state.embeddings.filter(filter);
    } else {
      tempResults = state.embeddings;
    }

    return tempResults.map((entry) => {
      const raw = String(entry[0]);
      const lastDot = raw.lastIndexOf(".") > -1 ? raw.lastIndexOf(".") : raw.length;
      const lastSlash = raw.lastIndexOf("/") > -1 ? raw.lastIndexOf("/") : -1;
      const name = raw.substring(lastSlash + 1, lastDot);
      const result = new AutocompleteResult(name, ResultType.embedding);
      result.sortKey = entry[1];
      result.meta = entry[2] ? `${entry[2]} Embedding` : "Embedding";
      result.fullName = raw;
      return result;
    });
  }
}

function parseModelList(list, type, meta) {
  let tempResults = [];
  const tagword = state.tagword;
  const prefixes = type === ResultType.lora ? ["<l:", "<lora:"] : ["<l:", "<lyco:", "<lora:"];
  if (!["<", ...prefixes].includes(tagword)) {
    let searchTerm = String(tagword);
    for (const prefix of prefixes) searchTerm = searchTerm.replace(prefix, "");
    searchTerm = searchTerm.replace("<", "");
    const regex = new RegExp(escapeRegExp(searchTerm, true), "i");
    tempResults = list.filter(
      (entry) =>
        regex.test(String(entry[0]).toLowerCase()) ||
        regex.test(String(entry[0]).toLowerCase().replaceAll(" ", "_"))
    );
  } else {
    tempResults = list;
  }

  return tempResults.map((entry) => {
    const raw = String(entry[0]);
    const lastDot = raw.lastIndexOf(".") > -1 ? raw.lastIndexOf(".") : raw.length;
    const lastSlash = raw.lastIndexOf("/") > -1 ? raw.lastIndexOf("/") : -1;
    const name = raw.substring(lastSlash + 1, lastDot);
    const result = new AutocompleteResult(name, type);
    result.meta = meta;
    result.sortKey = entry[1];
    result.fullName = raw;
    return result;
  });
}

class LoraParser extends BaseTagParser {
  parse() {
    return parseModelList(state.loras, ResultType.lora, "LoRA");
  }
}

class LycoParser extends BaseTagParser {
  parse() {
    return parseModelList(state.lycos, ResultType.lyco, "LyCORIS");
  }
}

class HypernetParser extends BaseTagParser {
  parse() {
    let tempResults = [];
    const tagword = state.tagword;
    if (!["<", "<h:", "<hypernet:"].includes(tagword)) {
      const searchTerm = tagword.replace("<hypernet:", "").replace("<h:", "").replace("<", "");
      const regex = new RegExp(escapeRegExp(searchTerm, true), "i");
      tempResults = state.hypernets.filter(
        (entry) =>
          regex.test(String(entry[0]).toLowerCase()) || regex.test(String(entry[0]).toLowerCase().replaceAll(" ", "_"))
      );
    } else {
      tempResults = state.hypernets;
    }
    return tempResults.map((entry) => {
      const result = new AutocompleteResult(String(entry[0]).trim(), ResultType.hypernetwork);
      result.meta = "Hypernetwork";
      result.sortKey = entry[1];
      result.fullName = String(entry[0]);
      return result;
    });
  }
}

class ChantParser extends BaseTagParser {
  parse() {
    let tempResults = [];
    const tagword = state.tagword;
    if (tagword !== "<" && tagword !== "<c:") {
      const searchTerm = tagword.replace("<chant:", "").replace("<c:", "").replace("<", "");
      const regex = new RegExp(escapeRegExp(searchTerm, true), "i");
      tempResults = state.chants.filter(
        (chant) =>
          regex.test(String(chant.terms || "").toLowerCase()) || regex.test(String(chant.name || "").toLowerCase())
      );
    } else {
      tempResults = state.chants;
    }
    return tempResults.map((chant) => {
      const result = new AutocompleteResult(String(chant.content || "").trim(), ResultType.chant);
      result.meta = "Chant";
      result.aliases = chant.name;
      result.category = chant.color;
      return result;
    });
  }
}

let lastStyleVarIndex = "";

class StyleParser extends BaseTagParser {
  parse() {
    const match = state.tagword.match(/(\$(\d*)\(?)[^$|\[\],\s]*\)?/);
    if (!match) return [];
    lastStyleVarIndex = match[2] ? match[2] : "";
    let tempResults = [];
    if (state.tagword !== match[1]) {
      const searchTerm = state.tagword.replace(match[1], "");
      const regex = new RegExp(escapeRegExp(searchTerm, true), "i");
      tempResults = state.styles.filter(
        (entry) =>
          regex.test(String(entry[0]).toLowerCase()) || regex.test(String(entry[0]).toLowerCase().replaceAll(" ", "_"))
      );
    } else {
      tempResults = state.styles;
    }
    return tempResults.map((entry) => {
      const result = new AutocompleteResult(String(entry[0]).trim(), ResultType.styleName);
      result.meta = "Style";
      return result;
    });
  }
}

class ArtistTagParser extends BaseTagParser {
  parse() {
    const searchTerm = state.tagword.slice(1);
    let tempResults = state.allTags.filter((row) => parseInt(row[1], 10) === 1);
    if (searchTerm.length > 0) {
      const regex = new RegExp(escapeRegExp(searchTerm, true), "i");
      tempResults = tempResults.filter(
        (row) =>
          regex.test(row[4]) ||
          regex.test(row[4].replaceAll(" ", "_")) ||
          ((CFG.alias.searchByAlias || CFG.alias.onlyShowAlias) && row[5] && regex.test(row[5]))
      );
    }
    return tempResults.map((row) => {
      const result = new AutocompleteResult(row[0].trim(), ResultType.tag);
      result.category = parseInt(row[1], 10);
      result.count = parseInt(row[2], 10) || 0;
      return result;
    });
  }
}

class UmiParser extends BaseTagParser {
  parse(target, prompt) {
    const subPrompts = [...String(prompt).matchAll(UMI_PROMPT_REGEX)];
    if (!subPrompts.length) return [];

    let umiTags = [];
    let umiTagsWithOperators = "";

    for (const sub of subPrompts) {
      umiTags = umiTags.concat([...sub[0].matchAll(UMI_TAG_REGEX)].map((m) => String(m[1]).trim().toLowerCase()));
      const start = sub.index ?? 0;
      const end = start + sub[0].length;
      const cursor = target.el.selectionStart;
      if (cursor >= start && cursor <= end) {
        const offset = cursor - start;
        umiTagsWithOperators = sub[0].slice(0, offset) + "###" + sub[0].slice(offset);
      }
    }

    if (!umiTagsWithOperators.length) return [];

    const clean = (str) =>
      String(str).replaceAll(">", "").replaceAll("<", "").replaceAll("[", "").replaceAll("]", "").trim();

    const parts = umiTagsWithOperators.replace("]###[", "][").split("][");
    const matches = parts.reduce(
      (acc, current) => {
        const isOptional = current.includes("|");
        const isNegative = current.startsWith("--");
        if (isOptional) {
          const tags = clean(current)
            .split("|")
            .map((piece) => ({
              hasCursor: piece.includes("###"),
              isNegative: piece.startsWith("--"),
              tag: clean(piece).replaceAll("###", "").replaceAll("--", ""),
            }));
          acc.optional.push({ hasCursor: current.includes("###"), tags });
          acc.all.push(...tags.map((tag) => tag.tag));
        } else {
          const tags = clean(current)
            .replaceAll("###", "")
            .split("|")
            .map((piece) => (piece.startsWith("--") ? piece.substring(2) : piece));
          if (isNegative) acc.negative.push({ hasCursor: current.includes("###"), tags });
          else acc.positive.push({ hasCursor: current.includes("###"), tags });
          acc.all.push(...tags);
        }
        return acc;
      },
      { positive: [], negative: [], optional: [], all: [] }
    );

    const filtered = (word) => {
      const counts = {};
      for (const entry of state.umiTags) {
        const name = entry[0];
        const tagSet = entry[1] || {};
        const matchesNeg =
          matches.negative.length === 0 ||
          matches.negative.every((item) => item.hasCursor || item.tags.every((tag) => !tagSet[tag]));
        if (!matchesNeg) continue;
        const matchesPos =
          matches.positive.length === 0 ||
          matches.positive.every((item) => item.hasCursor || item.tags.every((tag) => tagSet[tag]));
        if (!matchesPos) continue;
        const matchesOpt =
          matches.optional.length === 0 ||
          matches.optional.some((item) =>
            item.tags.some((tag) => (tag.hasCursor || tag.isNegative ? !tagSet[tag.tag] : tagSet[tag.tag]))
          );
        if (!matchesOpt) continue;
        counts[name] = (counts[name] || 0) + (entry[2] || 1);
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .filter(([name]) => name === word || !matches.all.includes(name));
    };

    const tagCountChange = umiTags.length - target.umiPreviousTags.length;
    const diff = difference(umiTags, target.umiPreviousTags);
    target.umiPreviousTags = umiTags;

    const showAll = state.tagword.endsWith("[") || state.tagword.endsWith("[--") || state.tagword.endsWith("|");
    if ((!diff || diff.length === 0 || (diff.length === 1 && tagCountChange < 0)) && !showAll) {
      if (!state.hideBlocked) hidePopup(target);
      return [];
    }

    let umiTagword = tagCountChange < 0 ? "" : diff[0] || "";
    let entries;
    if (umiTagword && umiTagword.length > 0) {
      umiTagword = umiTagword.toLowerCase().replace(/[\n\r]/g, "");
      state.originalTagword = state.tagword;
      state.tagword = umiTagword;
      entries = filtered(umiTagword);
      const searchRegex = new RegExp(`(^|[^a-zA-Z])${escapeRegExp(umiTagword)}`, "i");
      entries = entries.filter(
        ([name]) =>
          name.toLowerCase().search(searchRegex) > -1 ||
          name.toLowerCase().replaceAll(" ", "_").search(searchRegex) > -1
      );
    } else {
      entries = filtered("");
      state.originalTagword = state.tagword;
      state.tagword = "";
    }

    return entries
      .map(([name, count]) => {
        const result = new AutocompleteResult(String(name).trim(), ResultType.umiWildcard);
        result.count = count;
        return result;
      })
      .sort((a, b) => b.count - a.count);
  }
}

/* ------------------------------------------------------------------------- *
 * Sorting
 * ------------------------------------------------------------------------- */
export function getSortFunction() {
  const criterion = CFG.modelSortOrder || "Name";

  const textSort = (a, b, reverse = false) => {
    if (!a.sortKeyText) {
      a.sortKeyText = a.type === ResultType.chant ? String(a.aliases || "").toLowerCase() : String(a.text || "").toLowerCase();
    }
    if (!b.sortKeyText) {
      b.sortKeyText = b.type === ResultType.chant ? String(b.aliases || "").toLowerCase() : String(b.text || "").toLowerCase();
    }
    return reverse ? b.sortKeyText.localeCompare(a.sortKeyText) : a.sortKeyText.localeCompare(b.sortKeyText);
  };

  const numericSort = (a, b, reverse = false) => {
    const noKey = reverse ? "-1" : String(Number.MAX_SAFE_INTEGER);
    const aParsed = parseFloat(a.sortKey ?? noKey);
    const bParsed = parseFloat(b.sortKey ?? noKey);
    if (aParsed === bParsed) return textSort(a, b, false);
    return reverse ? bParsed - aParsed : aParsed - bParsed;
  };

  return (a, b) => {
    switch (criterion) {
      case "Date Modified (newest first)":
        return numericSort(a, b, true);
      case "Date Modified (oldest first)":
        return numericSort(a, b, false);
      default:
        return textSort(a, b);
    }
  };
}

function calculateUsageBias(result, count, uses) {
  if (uses < CFG.frequencyMinCount) uses = 0;
  else if (uses !== 0) result.usageBias = true;

  switch (CFG.frequencyFunction) {
    case "Logarithmic (weak)":
      return Math.log(1 + count) + Math.log(1 + uses);
    case "Logarithmic (strong)":
      return Math.log(1 + count) + 2 * Math.log(1 + uses);
    case "Usage first":
      return uses;
    default:
      return count;
  }
}

/* ------------------------------------------------------------------------- *
 * Search
 * ------------------------------------------------------------------------- */
function tagsFromPrompt(prompt) {
  const weighted = [...String(prompt).matchAll(WEIGHT_REGEX)].map((match) => match[1]).sort((a, b) => a.length - b.length);
  let tags = [...String(prompt).match(tagRegex())].sort((a, b) => a.length - b.length);
  const working = [...tags];
  for (const weightedTag of weighted) {
    const index = working.findIndex((tag) => tag === weightedTag && !tag.startsWith("<[") && !tag.startsWith("$("));
    if (index !== -1) working.splice(index, 1);
  }
  tags = working.concat(weighted);
  return tags;
}

function searchTagList(query) {
  let searchRegex;
  let needle;
  if (query.startsWith("*")) {
    needle = query.slice(1);
    searchRegex = new RegExp(`${escapeRegExp(needle)}`, "i");
  } else {
    needle = query;
    searchRegex = new RegExp(`(^|[^a-zA-Z])${escapeRegExp(query)}`, "i");
  }
  needle = needle.toLowerCase();

  const aliasSearch = CFG.alias.searchByAlias || CFG.alias.onlyShowAlias;
  const translationSearch = CFG.translation.searchByTranslation;
  const translations = state.translations;
  const useTranslations = translationSearch && translations && translations.size > 0;

  const matchesTranslation = (row) => {
    const direct = translations.get(row[0]);
    if (direct && String(direct).toLowerCase().search(searchRegex) > -1) return true;
    if (row[5]) {
      for (const alias of row[5].split(",")) {
        const value = translations.get(alias.trim());
        if (value && String(value).toLowerCase().search(searchRegex) > -1) return true;
      }
    }
    return false;
  };

  const results = [];
  for (const row of state.allTags) {
    const lowerName = row[4];
    /* cheap substring pre-filter before the (more expensive) regex */
    const baseIncluded = lowerName.includes(needle);
    const aliasIncluded = aliasSearch && row[5] ? row[5].includes(needle) : false;
    if (!baseIncluded && !aliasIncluded && !useTranslations) continue;

    const baseMatch = baseIncluded && lowerName.search(searchRegex) > -1;
    if (!baseMatch) {
      const aliasMatch = aliasIncluded && row[5].search(searchRegex) > -1;
      if (!aliasMatch && !(useTranslations && matchesTranslation(row))) continue;
    }
    const result = new AutocompleteResult(row[0].trim(), ResultType.tag);
    result.category = row[1];
    result.count = parseInt(row[2], 10) || 0;
    result.aliases = row[3];
    results.push(result);
  }
  return results;
}

function searchExtras(query) {
  let searchRegex;
  if (query.startsWith("*")) searchRegex = new RegExp(`${escapeRegExp(query.slice(1))}`, "i");
  else searchRegex = new RegExp(`(^|[^a-zA-Z])${escapeRegExp(query)}`, "i");

  const aliasSearch = CFG.alias.searchByAlias || CFG.alias.onlyShowAlias;
  const results = [];
  for (const row of state.extras) {
    const baseMatch = row[5].search(searchRegex) > -1;
    const aliasMatch = aliasSearch && row[6] ? row[6].search(searchRegex) > -1 : false;
    if (!baseMatch && !aliasMatch) continue;
    const result = new AutocompleteResult(String(row[0]).trim(), ResultType.extra);
    result.category = row[1] || 0;
    result.meta = row[2] || "Custom tag";
    result.aliases = row[3] || "";
    results.push(result);
  }
  return results;
}

async function getUseCounts(names, types, negative) {
  try {
    const response = await postJSON("/tagcomplete/frequency/counts", { names, types, neg: negative });
    return (response?.result || []).map((row) => ({ name: row[0], type: row[1], count: row[2], lastUseDate: row[3] }));
  } catch {
    return [];
  }
}

function increaseUseCount(name, type, negative) {
  postJSON(
    `/tagcomplete/frequency/increase?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}&neg=${
      negative ? "1" : "0"
    }`,
    {}
  ).catch(() => {});
}

function resetUseCount(name, type, positive, negative) {
  postJSON(
    `/tagcomplete/frequency/reset?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}&pos=${
      positive ? "1" : "0"
    }&neg=${negative ? "1" : "0"}`,
    {}
  ).catch(() => {});
}

/* ------------------------------------------------------------------------- *
 * Main search entry
 * ------------------------------------------------------------------------- */
export async function autocomplete(target, prompt, fixedTag = null) {
  if (!target) return;
  if (!CFG.enabled) {
    hidePopup(target);
    return;
  }

  const el = target.el;

  if (!state.allTagsLoaded && state.tagFileLoading) {
    ensurePopup();
    listEl.innerHTML = "";
    const li = document.createElement("li");
    li.className = "tac-empty";
    li.textContent = "⏳ 正在加载标签库…";
    listEl.appendChild(li);
    resultsBox.style.maxHeight = "60px";
    showPopup(target);
    positionPopup(target);
    return;
  }

  if (!prompt || prompt.length === 0) {
    hidePopup(target);
    target.previousTags = [];
    state.tagword = "";
    return;
  }

  if (fixedTag === null) {
    const tags = tagsFromPrompt(prompt);
    if (!tags || tags.length === 0) {
      target.previousTags = [];
      state.tagword = "";
      hidePopup(target);
      return;
    }
    const tagCountChange = tags.length - target.previousTags.length;
    const diff = difference(tags, target.previousTags);
    target.previousTags = tags;
    if (!diff || diff.length === 0 || (diff.length === 1 && tagCountChange < 0)) {
      if (!state.hideBlocked) hidePopup(target);
      return;
    }
    state.tagword = diff[0] || "";
  } else {
    state.tagword = fixedTag;
  }

  if (!state.tagword) {
    hidePopup(target);
    return;
  }

  state.resultCountBeforeNormalTags = 0;
  state.tagword = String(state.tagword).toLowerCase().replace(/[\n\r]/g, "");
  state.originalTagword = state.tagword;

  let results = [];
  let parsed = null;

  const matching = PARSERS.filter((parser) => {
    try {
      return parser.triggerCondition();
    } catch {
      return false;
    }
  });

  if (matching.length) {
    const gathered = [];
    for (const parser of matching) {
      try {
        const value = await parser.parse(target, prompt);
        if (Array.isArray(value) && value.length) gathered.push(value);
      } catch (error) {
        console.warn("[TagComplete] parser failed:", error);
      }
    }
    if (gathered.length) parsed = gathered;
  }

  if (parsed && parsed.length) {
    results = parsed.flat();
    if (!(parsed.length === 1 && results[0]?.type === ResultType.umiWildcard)) {
      results = results.sort(getSortFunction());
    }
  }

  const afterParsers = state.tagword;
  let normalTags = false;

  if (
    !parsed ||
    parsed.length === 0 ||
    (CFG.includeEmbeddingsInNormalResults && !(afterParsers.startsWith("<") || afterParsers.startsWith("*<")))
  ) {
    normalTags = true;
    state.resultCountBeforeNormalTags = results.length;
    state.tagword = afterParsers;
    results = results.concat(searchTagList(afterParsers));

    if (CFG.extraFile && CFG.extraFile !== "None") {
      if (!state.extras.length) {
        try {
          await ensureExtras(CFG.extraFile);
        } catch {
          /* ignore */
        }
      }
      const extraResults = searchExtras(afterParsers);
      results = CFG.extraAddMode === "Insert before" ? extraResults.concat(results) : results.concat(extraResults);
    }
  }

  if (!results.length) {
    hidePopup(target);
    return;
  }

  if (CFG.frequencySort) {
    const aliasTypes = [ResultType.tag, ResultType.extra];
    const names = [];
    const types = [];
    const negative = isNegativeTarget(target);
    for (const result of results.slice(0, 2000)) {
      const name = result.type === ResultType.chant ? result.aliases : result.text;
      const keep = !(aliasTypes.includes(result.type) && !String(name).includes(state.tagword));
      if (keep) names.push(name);
      types.push(result.type);
    }
    const counts = await getUseCounts(names, types, negative);
    const countMap = new Map();
    for (const entry of counts) countMap.set(`${entry.name}\u0000${entry.type}`, entry.count || 0);
    const bias = new Map();
    for (const result of results) {
      const name = result.type === ResultType.chant ? result.aliases : result.text;
      const uses = countMap.get(`${name}\u0000${result.type}`) || 0;
      bias.set(result, calculateUsageBias(result, parseInt(result.count, 10) || 0, uses));
    }
    results = results.sort((a, b) => bias.get(b) - bias.get(a));
  }

  if (!CFG.showAllResults && normalTags) {
    results = results.slice(0, (parseInt(CFG.maxResults, 10) || 5) + state.resultCountBeforeNormalTags);
  }

  target.results = results;
  target.tagword = state.tagword;
  target.selected = null;
  target.oldSelected = null;
  state.results = results;
  state.resultCount = 0;
  active = target;

  renderResults(target, results, state.tagword, true);
  showPopup(target);
  positionPopup(target);
  renderRuby(target, prompt);
}

/* ------------------------------------------------------------------------- *
 * Rendering
 * ------------------------------------------------------------------------- */
function categoryColor(result) {
  const tagFileName = String(CFG.tagFile || "").split(".")[0];
  const colors = CFG.colorMap || {};
  const group = colors[tagFileName] || colors.danbooru;
  if (!group) return null;
  let category = result.category;
  if (category === null || category === undefined || !group[category]) category = "-1";
  const entry = group[category];
  if (!Array.isArray(entry)) return null;
  return entry[isDarkMode() ? 0 : 1] || entry[0];
}

function isDanOrE621() {
  const name = String(CFG.tagFile || "").split(".")[0].toLowerCase();
  return name.startsWith("danbooru") || name.startsWith("e621");
}

function wikiLinkFor(result) {
  const file = String(CFG.tagFile || "").split(".")[0].toLowerCase();
  const slug = encodeURIComponent(String(result.text || "").replaceAll(" ", "_"));
  if (file.startsWith("danbooru_e621_merged")) {
    return parseInt(result.category, 10) >= 6
      ? `https://e621.net/wiki_pages/${slug}`
      : `https://danbooru.donmai.us/wiki_pages/${slug}`;
  }
  if (file.startsWith("danbooru")) return `https://danbooru.donmai.us/wiki_pages/${slug}`;
  if (file.startsWith("e621")) return `https://e621.net/wiki_pages/${slug}`;
  return null;
}

function formatDisplayText(result, tagword) {
  const translations = state.translations;
  let displayText = "";

  if (result.type === ResultType.chant) {
    displayText = escapeHTML(result.aliases);
  } else if (result.aliases && !String(result.text).includes(tagword)) {
    const aliases = String(result.aliases).split(",");
    let bestAlias = aliases.find((alias) => alias.toLowerCase().includes(tagword));
    if (!bestAlias && translations.size) {
      const hit = [...translations].find(
        (pair) => (pair[0] === result.text || aliases.includes(pair[0])) && String(pair[1]).includes(tagword)
      );
      if (hit) bestAlias = hit[0];
    }
    if (!bestAlias) bestAlias = result.text;
    displayText = escapeHTML(bestAlias);
    if (translations.has(bestAlias) && translations.get(bestAlias) !== bestAlias && bestAlias !== result.text) {
      displayText += `[${translations.get(bestAlias)}]`;
    }
    if (!CFG.alias.onlyShowAlias && result.text !== bestAlias) displayText += ` ➝ ${result.text}`;
  } else {
    displayText = escapeHTML(result.text);
  }

  if (translations.has(result.text)) displayText += `[${translations.get(result.text)}]`;

  if (tagword) {
    const index = displayText.toLowerCase().indexOf(tagword.toLowerCase());
    if (index > -1) {
      displayText =
        displayText.slice(0, index) +
        `<b>${displayText.slice(index, index + tagword.length)}</b>` +
        displayText.slice(index + tagword.length);
    }
  }
  return displayText;
}

function countTagsInPrompt(prompt) {
  const counts = {};
  const tags = String(prompt || "")
    .trim()
    .replaceAll("\n", ",")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag);
  for (const tag of tags) {
    const weighted = [...tag.matchAll(WEIGHT_REGEX)].flat();
    let key = weighted.length === 2 ? weighted[1] : tag;
    key = key.replaceAll(" ", "_").replaceAll("\\(", "(").replaceAll("\\)", ")");
    counts[key] = counts[key] ? counts[key] + 1 : 1;
  }
  return counts;
}

function previewURL(result) {
  const kindMap = {
    [ResultType.embedding]: "embeddings",
    [ResultType.lora]: "loras",
    [ResultType.lyco]: "lycos",
    [ResultType.hypernetwork]: "hypernetworks",
  };
  const kind = kindMap[result.type];
  if (!kind) return null;
  const name = result.fullName || result.text;
  return apiURL(`/tagcomplete/preview?kind=${kind}&name=${encodeURIComponent(name)}`);
}

function showPreview(target, result) {
  if (!previewBox) return;
  const url = CFG.showExtraNetworkPreviews ? previewURL(result) : null;
  previewBox.dataset.visible = "0";
  if (!url) return;
  previewImg.onload = () => {
    previewBox.dataset.visible = "1";
    if (active) positionPopup(active);
  };
  previewImg.onerror = () => {
    previewBox.dataset.visible = "0";
    if (active) positionPopup(active);
  };
  previewImg.src = url;
}

export function renderResults(target, results, tagword, reset) {
  ensurePopup();
  if (reset) {
    listEl.innerHTML = "";
    resultsBox.scrollTop = 0;
    state.resultCount = 0;
  }

  const step = Math.max(1, parseInt(CFG.resultStepLength, 10) || 100);
  const nextLength = Math.min(results.length, state.resultCount + step);
  const usedTags = isDanOrE621() ? countTagsInPrompt(target.el.value) : {};

  for (let index = state.resultCount; index < nextLength; index++) {
    const result = results[index];
    if (!result) continue;

    const li = document.createElement("li");
    li.dataset.index = String(index);
    const flex = document.createElement("div");
    flex.className = "tac-flex";
    li.appendChild(flex);

    const itemText = document.createElement("div");
    itemText.className = "tac-item";
    itemText.innerHTML = formatDisplayText(result, tagword);

    if ([ResultType.wildcardFile, ResultType.yamlWildcard].includes(result.type) && itemText.innerHTML.includes("/")) {
      const parts = itemText.innerHTML.split("/");
      const last = parts.pop();
      itemText.innerHTML =
        parts.map((part) => `<span class="tac-path-part">${part}</span>`).join("/") + "/" + last;
    }

    const color = categoryColor(result);
    if (color) flex.style.color = color;

    if (result.type === ResultType.embedding) {
      if (String(result.meta || "").startsWith("v1")) itemText.classList.add("tac-emb-v1");
      else if (String(result.meta || "").startsWith("v2")) itemText.classList.add("tac-emb-v2");
    }

    if (CFG.showWikiLinks && result.type === ResultType.tag && isDanOrE621()) {
      const href = wikiLinkFor(result);
      if (href) {
        const link = document.createElement("a");
        link.className = "tac-wiki";
        link.textContent = "?";
        link.title = "打开该标签的 wiki 页面";
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.addEventListener("mousedown", (event) => event.preventDefault());
        link.addEventListener("click", (event) => event.stopPropagation());
        flex.appendChild(link);
      }
    }

    flex.appendChild(itemText);

    if (result.count && !Number.isNaN(result.count) && result.count !== Number.MAX_SAFE_INTEGER) {
      const countDiv = document.createElement("div");
      countDiv.className = "tac-meta";
      countDiv.textContent = formatCount(parseInt(result.count, 10) || 0);
      flex.appendChild(countDiv);
    } else if (result.meta) {
      const metaDiv = document.createElement("div");
      metaDiv.className = "tac-meta";
      metaDiv.textContent = result.meta;
      flex.appendChild(metaDiv);
    }

    if (result.usageBias) {
      const meta = flex.querySelector(".tac-meta");
      if (meta) {
        meta.classList.add("biased");
        flex.title = "✨ 常用标签（Ctrl/Cmd + 点击可重置使用次数）";
      }
    }

    if (usedTags[result.text] && !(result.text === tagword && usedTags[result.text] === 1)) {
      const meta = flex.querySelector(".tac-meta");
      if (meta) {
        const span = document.createElement("span");
        span.className = "used";
        span.title = "🔁 提示词中已包含该标签";
        meta.insertBefore(span, meta.firstChild);
      }
    }

    li.addEventListener("mousedown", (event) => event.preventDefault());
    li.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) {
        const meta = flex.querySelector(".tac-meta");
        if (meta) meta.classList.remove("biased");
        resetUseCount(result.text, result.type, !isNegativeTarget(target), isNegativeTarget(target));
        return;
      }
      insertResult(target, result, tagword).catch((error) => console.warn("[TagComplete]", error));
    });

    li.addEventListener("mouseenter", () => {
      if (target.hoverTimer) clearTimeout(target.hoverTimer);
      target.hoverTimer = setTimeout(() => {
        const previous = target.selected;
        target.selected = index;
        highlight(target, index, previous);
        showPreview(target, result);
      }, 350);
    });
    li.addEventListener("mouseleave", () => {
      if (target.hoverTimer) clearTimeout(target.hoverTimer);
      if (previewBox) previewBox.dataset.visible = "0";
    });

    listEl.appendChild(li);
  }

  state.resultCount = nextLength;
  if (reset) {
    target.selected = null;
    target.oldSelected = null;
    resultsBox.scrollTop = 0;
  }
}

function highlight(target, index, previousIndex, scroll = true) {
  const items = listEl?.getElementsByTagName("li");
  if (!items) return;
  if (previousIndex !== null && previousIndex !== undefined && items[previousIndex]) {
    items[previousIndex].classList.remove("selected");
  }
  if (index === null || index === undefined) return;
  const selected = items[index];
  if (!selected) return;
  selected.classList.add("selected");
  if (scroll && resultsBox) resultsBox.scrollTop = selected.offsetTop - resultsBox.offsetTop;
}

/* ------------------------------------------------------------------------- *
 * Insertion
 * ------------------------------------------------------------------------- */
const NO_COMMA_TYPES = [
  ResultType.wildcardFile,
  ResultType.yamlWildcard,
  ResultType.umiWildcard,
  ResultType.hypernetwork,
  ResultType.lora,
  ResultType.lyco,
];

async function multiplierFor(kind, name) {
  let multiplier = CFG.extraNetworksDefaultMultiplier;
  try {
    const info = await fetchModelInfo(kind, name);
    if (info && info["preferred weight"] !== undefined) multiplier = info["preferred weight"];
  } catch {
    /* ignore */
  }
  return multiplier;
}

function formatEmbeddingName(name) {
  const format = CFG.embeddingInsertFormat || "embedding:name";
  if (format === "name") return name;
  if (format === "<embedding:name>") return `<embedding:${name}>`;
  return `embedding:${name}`;
}

async function sanitizeResult(result) {
  const text = result.text;
  switch (result.type) {
    case ResultType.embedding:
      return formatEmbeddingName(text);
    case ResultType.wildcardFile:
    case ResultType.yamlWildcard:
      return `${wcWrap()}${text}${wcWrap()}`;
    case ResultType.wildcardTag:
    case ResultType.chant:
    case ResultType.umiWildcard:
      return text;
    case ResultType.styleName:
      return text.includes(" ") ? `$${lastStyleVarIndex}(${text})` : `$${lastStyleVarIndex}${text}`;
    case ResultType.hypernetwork:
      return `<hypernet:${text}:${CFG.extraNetworksDefaultMultiplier}>`;
    case ResultType.lora: {
      const weight = await multiplierFor("loras", result.fullName || text);
      return `<lora:${text}:${weight}>`;
    }
    case ResultType.lyco: {
      const weight = await multiplierFor("lycos", result.fullName || text);
      return `<${CFG.useLoraPrefixForLycos ? "lora" : "lyco"}:${text}:${weight}>`;
    }
    default:
      return null;
  }
}

export async function insertResult(target, result, tagword, tabCompletedWithoutChoice = false) {
  const el = target.el;
  const type = result.type;
  let sanitizedText = result.text;

  const sanitized = await sanitizeResult(result);
  if (sanitized !== null && sanitized !== undefined) {
    sanitizedText = sanitized;
  } else {
    const excluded = String(CFG.replaceUnderscoresExclusionList || "")
      .split(",")
      .map((entry) => entry.trim());
    if (CFG.replaceUnderscores && !excluded.includes(sanitizedText)) {
      sanitizedText = String(result.text).replaceAll("_", " ");
    } else {
      sanitizedText = result.text;
    }
    if (CFG.escapeParentheses && type === ResultType.tag) {
      sanitizedText = String(sanitizedText)
        .replaceAll("(", "\\(")
        .replaceAll(")", "\\)")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
    }
  }

  if (CFG.artistInsertAt && parseInt(result.category, 10) === 1 && !sanitizedText.startsWith("@")) {
    sanitizedText = `@${sanitizedText}`;
  }

  if (
    (type === ResultType.wildcardFile || type === ResultType.yamlWildcard) &&
    tabCompletedWithoutChoice &&
    CFG.wildcardCompletionMode !== "Always fully" &&
    sanitizedText.includes("/")
  ) {
    if (CFG.wildcardCompletionMode === "To next folder level") {
      const match = sanitizedText.match(new RegExp(`${escapeRegExp(tagword)}([^/]*\\/?)`, "i"));
      if (match) {
        let part = match[0];
        if (part === `${tagword}/`) {
          const deeper = sanitizedText.match(new RegExp(`${escapeRegExp(tagword)}\\/([^/]*\\/?)`, "i"));
          if (deeper) part = deeper[0];
        }
        sanitizedText = part;
      }
    } else if (CFG.wildcardCompletionMode === "To first difference") {
      const results = target.results || [];
      if (results.length) {
        const longest = results.reduce((max, item) => Math.max(max, String(item.text).length), 0);
        let firstDifference = 0;
        for (let i = 0; i < longest; i++) {
          const char = String(results[0].text)[i];
          if (results.every((item) => String(item.text)[i] === char)) firstDifference++;
          else break;
        }
        if (firstDifference > 0 && firstDifference < longest) {
          sanitizedText = sanitizedText.substring(0, firstDifference + wcWrap().length);
        } else if (firstDifference === 0) {
          sanitizedText = tagword;
        }
      }
    }
  }

  if (CFG.frequencySort) {
    let name = null;
    switch (type) {
      case ResultType.wildcardFile:
      case ResultType.yamlWildcard:
        if (String(sanitizedText).endsWith(wcWrap())) name = result.text;
        break;
      case ResultType.chant:
        name = result.aliases;
        break;
      default:
        name = result.text;
        break;
    }
    if (name && String(name).length > 0) increaseUseCount(name, type, isNegativeTarget(target));
  }

  const prompt = el.value;
  const cursorPos = el.selectionStart;
  const editStart = Math.max(cursorPos - tagword.length, 0);
  const editEnd = Math.min(cursorPos + tagword.length, prompt.length);
  const surrounding = prompt.substring(editStart, editEnd);
  const match = surrounding.match(new RegExp(escapeRegExp(tagword), "i"));
  const matchIndex = match ? match.index : 0;
  const afterInsertCursorPos = editStart + matchIndex + sanitizedText.length;

  let optionalSeparator = "";
  const extraNetworkTypes = [ResultType.hypernetwork, ResultType.lora, ResultType.lyco];
  if (!NO_COMMA_TYPES.includes(type)) {
    const beforeComma = surrounding.match(new RegExp(`${escapeRegExp(tagword)}[,:]`, "i")) !== null;
    if (CFG.appendComma) optionalSeparator = beforeComma ? "" : ",";
    if (CFG.appendSpace && !beforeComma) optionalSeparator += " ";
    if (!CFG.appendSpace && CFG.alwaysSpaceAtEnd) {
      optionalSeparator += surrounding.match(new RegExp(`${escapeRegExp(tagword)}$`, "im")) !== null ? " " : "";
    }
  } else if (extraNetworkTypes.includes(type)) {
    optionalSeparator = CFG.extraNetworksSeparator || " ";
  }

  const escaped = String(sanitizedText).replaceAll("$", "$$$$");
  const insert = surrounding.replace(new RegExp(escapeRegExp(tagword), "i"), escaped + optionalSeparator);
  let newPrompt = prompt.substring(0, editStart) + insert + prompt.substring(editEnd);

  let keywordsLength = 0;
  if (CFG.modelKeywordCompletion !== "Never" && (type === ResultType.lora || type === ResultType.lyco)) {
    let keywords = null;
    try {
      keywords = await fetchModelKeywords(type === ResultType.lora ? "loras" : "lycos", result.fullName || result.text);
    } catch {
      keywords = null;
    }
    if (keywords && String(keywords).length > 0) {
      state.textBeforeKeywordInsertion = newPrompt;
      if (CFG.modelKeywordLocation === "Start of prompt") {
        newPrompt = `${keywords}, ${newPrompt}`;
      } else if (CFG.modelKeywordLocation === "End of prompt") {
        newPrompt = `${newPrompt}, ${keywords}`;
      } else {
        const keywordStart = prompt[editStart - 1] === " " ? editStart - 1 : editStart;
        newPrompt = prompt.substring(0, keywordStart) + `, ${keywords} ${insert}` + prompt.substring(editEnd);
      }
      state.textAfterKeywordInsertion = newPrompt;
      state.keywordInsertionUndone = false;
      setTimeout(() => {
        state.lastEditWasKeywordInsertion = true;
      }, 200);
      keywordsLength = String(keywords).length + 2;
    }
  }

  commitValue(target, newPrompt);
  el.selectionStart = afterInsertCursorPos + optionalSeparator.length + keywordsLength;
  el.selectionEnd = el.selectionStart;

  if ([ResultType.wildcardFile, ResultType.yamlWildcard, ResultType.umiWildcard].includes(type)) {
    state.selfTrigger = true;
  }

  if (type === ResultType.wildcardFile || type === ResultType.yamlWildcard) {
    state.hideBlocked = true;
    setTimeout(() => {
      state.hideBlocked = false;
    }, 450);
    return;
  }

  if (type === ResultType.umiWildcard && state.originalTagword.length > 0) {
    let umiTags = [];
    for (const sub of newPrompt.matchAll(UMI_PROMPT_REGEX)) {
      umiTags = umiTags.concat([...sub[0].matchAll(UMI_TAG_REGEX)].map((m) => String(m[1]).trim().toLowerCase()));
    }
    target.umiPreviousTags = umiTags;
    hidePopup(target);
    return;
  }

  target.previousTags = tagsFromPrompt(newPrompt);
  hidePopup(target);
}

/* ------------------------------------------------------------------------- *
 * Widget write-back
 * ------------------------------------------------------------------------- */
export function commitValue(target, text) {
  const { el, widget, node } = target;
  if (!el) return;
  const previous = el.value;
  el.value = text;

  try {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } catch {
    const event = document.createEvent("Event");
    event.initEvent("input", true, false);
    el.dispatchEvent(event);
  }

  try {
    if (widget && widget.value !== text) widget.value = text;
  } catch {
    /* ignore */
  }

  /* when the side panel and the canvas share one widget, keep both elements in sync */
  try {
    const canvasEl =
      widget?.element instanceof HTMLTextAreaElement
        ? widget.element
        : widget?.inputEl instanceof HTMLTextAreaElement
          ? widget.inputEl
          : null;
    if (canvasEl && canvasEl !== el && canvasEl.value !== text) {
      /* value only - a synthetic input event here would trigger a second popup */
      canvasEl.value = text;
    }
  } catch {
    /* ignore */
  }

  try {
    node?.onWidgetChanged?.(widget?.name, text, previous, widget);
  } catch {
    /* ignore */
  }
  try {
    node?.setDirtyCanvas?.(true, true);
    const app = getApp();
    app?.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------- *
 * Live translation strip
 * ------------------------------------------------------------------------- */
function renderRuby(target, prompt) {
  if (!CFG.translation.liveTranslation || !CFG.translationFile || CFG.translationFile === "None") {
    if (rubyBox) rubyBox.dataset.visible = "0";
    return;
  }
  const translations = state.translations;
  if (!translations || translations.size === 0) return;

  ensureRuby();
  const escapedPrompt = String(prompt).replaceAll("\\(", "$").replaceAll("\\)", "%");
  let rubyTags = escapedPrompt.match(RUBY_TAG_REGEX);
  if (!rubyTags) {
    rubyBox.dataset.visible = "0";
    return;
  }
  rubyTags = [...new Set(rubyTags)].sort((a, b) => b.length - a.length);

  const prepareTag = (tag) => {
    const restored = tag.replaceAll("$", "\\(").replaceAll("%", "\\)");
    const unsanitized = restored.replaceAll(" ", "_").replaceAll("\\(", "(").replaceAll("\\)", ")");
    const translation = translations.get(restored) || translations.get(unsanitized);
    return { tag: restored, escapedTag: escapeRegExp(restored), translation };
  };

  const replaceOccurrences = (text, tuple) =>
    text.replaceAll(
      new RegExp(`(?<!<ruby>)(?:\\b)${tuple.escapedTag}(?:\\b|$|(?=[,|: \\t\\n\\r]))(?!<rt>)`, "g"),
      `<ruby>${escapeHTML(tuple.tag)}<rt>${escapeHTML(tuple.translation)}</rt></ruby>`
    );

  let html = escapeHTML(prompt);
  for (const raw of rubyTags) {
    const tuple = prepareTag(raw);
    if (tuple.translation) {
      html = replaceOccurrences(html, tuple);
      continue;
    }
    const subTags = tuple.tag.split(" ").filter((part) => part.trim().length > 0);
    if (subTags.length === 1) continue;
    let subHtml = raw.replaceAll("$", "\\(").replaceAll("%", "\\)");
    const translateNgram = (windows) => {
      for (const window of windows) {
        const subTuple = prepareTag(window.join(" "));
        if (subTuple.tag.length <= 2) continue;
        if (subTuple.translation) subHtml = replaceOccurrences(subHtml, subTuple);
      }
    };
    translateNgram(ngrams(subTags, 3));
    translateNgram(ngrams(subTags, 2));
    translateNgram(ngrams(subTags, 1));
    html = html.replaceAll(
      new RegExp(`(?<!<ruby>)(?:\\b)${escapeRegExp(tuple.tag)}(?:\\b|$|(?=[,|: \\t\\n\\r]))(?!<rt>)`, "g"),
      subHtml
    );
  }

  rubyBox.innerHTML = html;
  rubyBox.dataset.visible = "1";
  positionRuby(target);

  const children = [...rubyBox.children];
  const nodes = [...rubyBox.childNodes];
  for (const child of children) {
    if (child.tagName !== "RUBY") continue;
    const before = nodes
      .slice(0, nodes.indexOf(child))
      .map((entry) => entry.childNodes?.[0]?.textContent || entry.textContent || "")
      .join("");
    child.onclick = () => {
      const selectionText = child.childNodes[0]?.textContent || "";
      const start = String(prompt).indexOf(before) + before.length;
      target.el.focus();
      target.el.setSelectionRange(start, start + selectionText.length);
    };
  }
}

function ngrams(array, size) {
  const out = [];
  for (let i = 0; i + size - 1 < array.length; i++) out.push(array.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------------- *
 * Keyboard navigation
 * ------------------------------------------------------------------------- */
export function navigateInList(target, event) {
  if (!CFG.enabled) return;
  if (!isPopupVisible() || active !== target) return;

  const keys = CFG.keymap || {};
  if ((event.key === "Home" || event.key === "End") && !Object.values(keys).includes(event.key)) {
    hidePopup(target);
    return;
  }

  const validKeys = Object.values(keys).filter((key) => key && key !== "None");
  if (!validKeys.includes(event.key)) return;

  let modifier = "";
  if (event.ctrlKey) modifier += "Ctrl+";
  if (event.altKey) modifier += "Alt+";
  if (event.shiftKey) modifier += "Shift+";
  if (event.metaKey) modifier += "Meta+";
  modifier += event.key;

  const results = target.results || [];
  const total = state.resultCount;
  if (total === 0) return;

  target.oldSelected = target.selected;
  let handled = true;

  switch (modifier) {
    case keys.MoveUp:
      target.selected = target.selected === null ? total - 1 : (target.selected - 1 + total) % total;
      break;
    case keys.MoveDown:
      target.selected = target.selected === null ? 0 : (target.selected + 1) % total;
      break;
    case keys.JumpUp:
      target.selected =
        target.selected === null || target.selected === 0 ? total - 1 : Math.max(target.selected - 5, 0);
      break;
    case keys.JumpDown:
      target.selected =
        target.selected === null || target.selected === total - 1 ? 0 : Math.min(target.selected + 5, total - 1);
      break;
    case keys.JumpToStart:
      target.selected =
        CFG.includeEmbeddingsInNormalResults &&
        target.selected > state.resultCountBeforeNormalTags &&
        state.resultCountBeforeNormalTags > 0
          ? state.resultCountBeforeNormalTags
          : 0;
      break;
    case keys.JumpToEnd:
      target.selected =
        CFG.includeEmbeddingsInNormalResults &&
        target.selected < state.resultCountBeforeNormalTags &&
        state.resultCountBeforeNormalTags > 0
          ? Math.min(state.resultCountBeforeNormalTags, total - 1)
          : total - 1;
      break;
    case keys.ChooseSelected:
      if (target.selected !== null && results[target.selected]) {
        insertResult(target, results[target.selected], target.tagword || state.tagword).catch((error) =>
          console.warn("[TagComplete]", error)
        );
      } else {
        hidePopup(target);
        return;
      }
      break;
    case keys.ChooseFirstOrSelected: {
      let withoutChoice = false;
      if (target.selected === null) {
        target.selected = 0;
        withoutChoice = true;
      } else if (CFG.wildcardCompletionMode === "To next folder level") {
        withoutChoice = true;
      }
      if (results[target.selected]) {
        insertResult(target, results[target.selected], target.tagword || state.tagword, withoutChoice).catch((error) =>
          console.warn("[TagComplete]", error)
        );
      }
      break;
    }
    case keys.Close:
      hidePopup(target);
      if (rubyBox) rubyBox.dataset.visible = "0";
      break;
    default:
      handled = false;
      break;
  }

  if (!handled) {
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    return;
  }

  const moveKeys = [keys.MoveUp, keys.MoveDown, keys.JumpUp, keys.JumpDown, keys.JumpToStart, keys.JumpToEnd];
  if (isPopupVisible() && target.selected === total - 1 && moveKeys.includes(event.key)) {
    renderResults(target, results, target.tagword || state.tagword, false);
  }
  if (isPopupVisible() && target.selected !== null) highlight(target, target.selected, target.oldSelected);
  if (isPopupVisible()) positionPopup(target);

  event.preventDefault();
  event.stopPropagation();
}

/* ------------------------------------------------------------------------- *
 * Undo / redo support for keyword insertion
 * ------------------------------------------------------------------------- */
export function keywordsUndo(target, event) {
  if (CFG.modelKeywordCompletion === "Never") return;
  switch (event.inputType) {
    case "historyUndo":
      if (state.lastEditWasKeywordInsertion && !state.keywordInsertionUndone) {
        state.keywordInsertionUndone = true;
        commitValue(target, state.textBeforeKeywordInsertion);
      }
      break;
    case "historyRedo":
      if (state.lastEditWasKeywordInsertion && state.keywordInsertionUndone) {
        state.keywordInsertionUndone = false;
        commitValue(target, state.textAfterKeywordInsertion);
      }
      break;
    case undefined:
      break;
    default:
      state.lastEditWasKeywordInsertion = false;
      state.keywordInsertionUndone = false;
      state.textBeforeKeywordInsertion = "";
      state.textAfterKeywordInsertion = "";
      break;
  }
}

/* ------------------------------------------------------------------------- *
 * Attach
 * ------------------------------------------------------------------------- */
let autocompleteTimer = null;

export function scheduleAutocomplete(target) {
  if (autocompleteTimer) clearTimeout(autocompleteTimer);
  autocompleteTimer = setTimeout(() => {
    autocomplete(target, target.el.value).catch((error) => console.warn("[TagComplete]", error));
  }, Math.max(0, parseInt(CFG.delayTime, 10) || 100));
}

export function attachToTextarea(el, widget, node) {
  if (!el || el.__tacAttached) return targets.get(el) || null;
  el.__tacAttached = true;

  const target = {
    el,
    widget,
    node,
    previousTags: [],
    umiPreviousTags: [],
    selected: null,
    oldSelected: null,
    results: [],
    tagword: "",
    hoverTimer: null,
  };
  targets.set(el, target);

  el.addEventListener("input", (event) => {
    if (event.isComposing) {
      state.hideBlocked = true;
      setTimeout(() => {
        state.hideBlocked = false;
      }, 100);
    }
    if (CFG.translation.liveTranslation) renderRuby(target, el.value);
    if (!event.inputType && !state.selfTrigger) return;
    state.selfTrigger = false;
    scheduleAutocomplete(target);
    keywordsUndo(target, event);
  });

  el.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!state.hideBlocked && document.activeElement !== el) hidePopup(target);
    }, 250);
  });

  el.addEventListener("keydown", (event) => navigateInList(target, event));

  el.addEventListener("compositionend", () => {
    state.hideBlocked = true;
    setTimeout(() => {
      state.hideBlocked = false;
    }, 100);
  });

  el.addEventListener("scroll", () => {
    if (isPopupVisible() && active === target) positionPopup(target);
  });

  el.addEventListener("blur", () => {
    if (rubyBox) rubyBox.dataset.visible = "0";
  });

  return target;
}

export function getActiveTarget() {
  return active;
}

export function resetState() {
  state.results = [];
  state.resultCount = 0;
  hidePopup();
}

/* Parser registration */
PARSERS.push(new WildcardFileParser(WC_FILE_TRIGGER));
PARSERS.push(new WildcardParser(WC_TRIGGER));
PARSERS.push(new EmbeddingParser(EMB_TRIGGER));
PARSERS.push(new LoraParser(LORA_TRIGGER));
PARSERS.push(new LycoParser(LYCO_TRIGGER));
PARSERS.push(new HypernetParser(HYP_TRIGGER));
PARSERS.push(new ChantParser(CHANT_TRIGGER));
PARSERS.push(new StyleParser(STYLE_TRIGGER));
PARSERS.push(
  new UmiParser(() => CFG.useWildcards && [...String(state.tagword).matchAll(UMI_PROMPT_REGEX)].length > 0)
);
PARSERS.push(new ArtistTagParser(ARTIST_TAG_TRIGGER));
