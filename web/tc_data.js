/** Loading of tag CSV files, aliases, translations, extras and chants. */

import { CFG, state } from "./tc_config.js";
import { getJSON, getText, postJSON } from "./tc_env.js";
import { parseCSV } from "./tc_util.js";

function fileURL(name) {
  return `/tagcomplete/file?name=${encodeURIComponent(name)}`;
}

/** Load and parse the main tag file (cached per file name). */
export async function ensureTagFile(name = CFG.tagFile, force = false) {
  if (!name || name === "None") {
    state.allTags = [];
    state.allTagsLoaded = true;
    return state.allTags;
  }
  if (!force && state.tagFileCache.has(name)) {
    state.allTags = state.tagFileCache.get(name);
    state.allTagsLoaded = true;
    return state.allTags;
  }
  if (state.tagFileLoading && !force) {
    return state.tagFileLoading;
  }

  state.tagFileLoading = (async () => {
    const text = await getText(fileURL(name));
    const rows = parseCSV(text);
    const tags = [];
    for (const row of rows) {
      if (!row || !row[0]) continue;
      const tagName = row[0].trim();
      if (!tagName) continue;
      const aliases = row[3] === undefined ? "" : row[3];
      tags.push([
        tagName,
        row[1] === undefined ? 0 : row[1],
        row[2] === undefined ? Number.MAX_SAFE_INTEGER : row[2],
        aliases,
        tagName.toLowerCase(),
        String(aliases || "").toLowerCase(),
      ]);
    }
    state.tagFileCache.set(name, tags);
    state.allTags = tags;
    state.allTagsLoaded = true;
    return tags;
  })();

  try {
    return await state.tagFileLoading;
  } finally {
    state.tagFileLoading = null;
  }
}

/** Load the translation file into `state.translations` (a Map). */
export async function ensureTranslations(name = CFG.translationFile, oldFormat = CFG.translationOldFormat) {
  state.translations = new Map();
  if (!name || name === "None") return state.translations;

  const cacheKey = `${name}|${oldFormat ? "old" : "new"}`;
  let rows = state.translationCache.get(cacheKey);
  if (!rows) {
    rows = parseCSV(await getText(fileURL(name)));
    state.translationCache.set(cacheKey, rows);
  }

  const map = new Map();
  for (const row of rows) {
    if (!row || !row[0]) continue;
    if (oldFormat && row[2]) map.set(row[0], row[2]);
    else if (row[1]) map.set(row[0], row[1]);
    else map.set(row[0], "Not found");
  }
  state.translations = map;
  return map;
}

/** Load the extra (custom) tag file. */
export async function ensureExtras(name = CFG.extraFile) {
  state.extras = [];
  if (!name || name === "None") return state.extras;

  let rows = state.extraCache.get(name);
  if (!rows) {
    rows = parseCSV(await getText(fileURL(name)));
    state.extraCache.set(name, rows);
  }
  const extras = [];
  for (const row of rows) {
    if (!row || !row[0]) continue;
    const tagName = row[0].trim();
    if (!tagName) continue;
    extras.push([
      tagName,
      row[1] === undefined || row[1] === "" ? 0 : row[1],
      row[2] || "Custom tag",
      row[3] || "",
      row[4] || "",
      tagName.toLowerCase(),
      String(row[3] || "").toLowerCase(),
    ]);
    if (row[4]) state.translations.set(tagName, row[4]);
  }
  state.extras = extras;
  return extras;
}

/** Load chant presets (long prompt snippets). */
export async function ensureChants(name = CFG.chantFile) {
  state.chants = [];
  if (!name || name === "None") return state.chants;

  let chants = state.chantCache.get(name);
  if (!chants) {
    try {
      const data = await getJSON(fileURL(name));
      chants = Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("[TagComplete] could not load chant file:", error);
      chants = [];
    }
    state.chantCache.set(name, chants);
  }
  state.chants = chants;
  return chants;
}

/** All data that depends on the selected files. */
export async function loadFileDependentData({ force = false } = {}) {
  /* translations first, extra tags add their translations to the same map */
  await ensureTranslations(CFG.translationFile, CFG.translationOldFormat);
  await ensureExtras(CFG.extraFile);
  await Promise.all([ensureTagFile(CFG.tagFile, force), ensureChants(CFG.chantFile)]);
}

/** Re-scan the library on the server and refresh the cached lists. */
export async function refreshLibrary() {
  const response = await postJSON("/tagcomplete/refresh", {});
  const data = response?.data;
  if (data) {
    const { applyServerData } = await import("./tc_config.js");
    applyServerData(data);
  }
  return data;
}

export async function fetchModelInfo(kind, name) {
  const key = `${kind}:${name}`;
  if (state.modelInfoCache.has(key)) return state.modelInfoCache.get(key);
  let info = null;
  try {
    info = await getJSON(`/tagcomplete/model-info?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
  } catch {
    info = null;
  }
  state.modelInfoCache.set(key, info || {});
  return info || {};
}

export async function fetchModelKeywords(kind, name) {
  const key = `${kind}:${name}`;
  if (state.keywordCache.has(key)) return state.keywordCache.get(key);
  let keywords = null;
  try {
    const response = await getJSON(
      `/tagcomplete/model-keywords?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`
    );
    keywords = response?.keywords ?? null;
  } catch {
    keywords = null;
  }
  state.keywordCache.set(key, keywords);
  return keywords;
}
